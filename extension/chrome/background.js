/**
 * SAI Browser Bridge — MV3 service worker.
 *
 * Consent model: SAI can see NOTHING until you click the toolbar button on a
 * tab. That click attaches a CDP session (chrome.debugger) to just that tab;
 * Chrome shows its own "DevTools is debugging this tab" infobar for as long as
 * the attachment lasts. Clicking again detaches. Tabs you never attached are
 * not enumerated, so SAI cannot even see that they exist.
 *
 * This is the READ-ONLY slice: snapshot, read, tabs. No Input domain commands
 * are implemented, so nothing here can click or type.
 *
 * Transport: chrome.runtime.connectNative to a relay process, which forwards
 * frames to the already-running SAI app over a unix socket / named pipe. SAI
 * is the requester; we only ever answer.
 */

import { SNAPSHOT_FN_SOURCE, READ_FN_SOURCE } from './pageScripts.js';

const NATIVE_HOST = 'com.sai.browser_bridge';
const CDP_VERSION = '1.3';
const KEEPALIVE_ALARM = 'sai-keepalive';

/**
 * Chrome caps a single message to a native host at 1 MB. Screenshots are the
 * only thing that gets anywhere near it, so they degrade until they fit.
 */
const MAX_FRAME_BYTES = 768 * 1024;
const SCREENSHOT_TIERS = [
  { maxWidth: 1024, quality: 60 },
  { maxWidth: 800, quality: 45 },
  { maxWidth: 600, quality: 35 },
];

/** tabId -> { url, title } captured at attach time. */
const attached = new Map();

let port = null;
let connecting = false;

// ---------------------------------------------------------------------------
// attachment state
// ---------------------------------------------------------------------------

async function persistAttached() {
  const tabIds = [...attached.keys()];
  try {
    await chrome.storage.session.set({ attachedTabIds: tabIds });
  } catch {
    /* session storage is best-effort; attachment itself is the source of truth */
  }
}

/**
 * The service worker can be torn down while tabs stay attached (the debugger
 * session outlives it). On restart, re-derive our map from the targets Chrome
 * still reports as ours rather than trusting storage blindly.
 */
async function rehydrate() {
  let stored = [];
  try {
    const got = await chrome.storage.session.get('attachedTabIds');
    stored = Array.isArray(got?.attachedTabIds) ? got.attachedTabIds : [];
  } catch {
    stored = [];
  }
  if (!stored.length) return;

  const targets = await new Promise((resolve) => {
    try {
      chrome.debugger.getTargets((t) => resolve(Array.isArray(t) ? t : []));
    } catch {
      resolve([]);
    }
  });

  for (const tabId of stored) {
    const target = targets.find((t) => t.tabId === tabId && t.attached);
    if (target) attached.set(tabId, { url: target.url, title: target.title });
  }
  await persistAttached();
  await refreshBadge();
  if (attached.size) ensureConnected();
}

async function refreshBadge() {
  const count = attached.size;
  try {
    await chrome.action.setBadgeText({ text: count ? String(count) : '' });
    await chrome.action.setBadgeBackgroundColor({ color: '#2f81f7' });
  } catch {
    /* badge is cosmetic */
  }
  if (count) {
    await chrome.alarms.create(KEEPALIVE_ALARM, { periodInMinutes: 0.5 });
  } else {
    await chrome.alarms.clear(KEEPALIVE_ALARM);
  }
}

async function attachTab(tab) {
  await chrome.debugger.attach({ tabId: tab.id }, CDP_VERSION);
  // Page must be enabled before captureScreenshot is reliable on some targets.
  try {
    await chrome.debugger.sendCommand({ tabId: tab.id }, 'Page.enable', {});
  } catch {
    /* non-fatal: snapshot/read still work */
  }
  attached.set(tab.id, { url: tab.url, title: tab.title });
  await persistAttached();
  await refreshBadge();
  ensureConnected();
  send({ type: 'event', event: 'attached', tabId: tab.id, url: tab.url, title: tab.title });
}

async function detachTab(tabId, { notify = true } = {}) {
  try {
    await chrome.debugger.detach({ tabId });
  } catch {
    /* already gone (tab closed, DevTools stole the session) */
  }
  attached.delete(tabId);
  await persistAttached();
  await refreshBadge();
  if (notify) send({ type: 'event', event: 'detached', tabId });
  if (!attached.size && port) {
    try { port.disconnect(); } catch { /* noop */ }
    port = null;
  }
}

chrome.action.onClicked.addListener((tab) => {
  if (!tab?.id) return;
  const run = attached.has(tab.id) ? detachTab(tab.id) : attachTab(tab);
  run.catch((err) => console.error('[sai-bridge] toggle failed:', err));
});

chrome.debugger.onDetach.addListener((source) => {
  if (typeof source.tabId === 'number' && attached.has(source.tabId)) {
    void detachTab(source.tabId);
  }
});

chrome.alarms.onAlarm.addListener((alarm) => {
  // Waking for the alarm is the point: it keeps the worker (and the native
  // port) alive while a tab is attached. Reconnect if the port died with us.
  if (alarm.name === KEEPALIVE_ALARM && attached.size) ensureConnected();
});

chrome.runtime.onStartup.addListener(() => void rehydrate());
chrome.runtime.onInstalled.addListener(() => void rehydrate());
void rehydrate();

// ---------------------------------------------------------------------------
// native transport
// ---------------------------------------------------------------------------

function send(frame) {
  if (!port) return;
  try {
    port.postMessage(frame);
  } catch (err) {
    console.warn('[sai-bridge] post failed:', err);
    port = null;
  }
}

function ensureConnected() {
  if (port || connecting) return;
  connecting = true;
  try {
    port = chrome.runtime.connectNative(NATIVE_HOST);
  } catch (err) {
    connecting = false;
    console.warn('[sai-bridge] connectNative failed:', err);
    return;
  }
  connecting = false;

  port.onMessage.addListener((frame) => {
    if (frame?.type !== 'request') return;
    handleRequest(frame).then(
      (result) => send({ type: 'response', id: frame.id, ok: true, result }),
      (err) => send({ type: 'response', id: frame.id, ok: false, error: String(err?.message || err) }),
    );
  });

  port.onDisconnect.addListener(() => {
    const why = chrome.runtime.lastError?.message;
    if (why) console.warn('[sai-bridge] native port closed:', why);
    port = null;
  });

  send({
    type: 'hello',
    role: 'extension',
    version: chrome.runtime.getManifest().version,
    attachedTabIds: [...attached.keys()],
  });
}

// ---------------------------------------------------------------------------
// CDP helpers
// ---------------------------------------------------------------------------

function cdp(tabId, method, params = {}) {
  return new Promise((resolve, reject) => {
    chrome.debugger.sendCommand({ tabId }, method, params, (result) => {
      const err = chrome.runtime.lastError;
      if (err) reject(new Error(err.message));
      else resolve(result);
    });
  });
}

/** Resolves which attached tab a request targets. */
function resolveTabId(params) {
  if (typeof params?.tabId === 'number') {
    if (!attached.has(params.tabId)) {
      throw new Error(`tab ${params.tabId} is not attached — click the SAI toolbar button on it first`);
    }
    return params.tabId;
  }
  if (attached.size === 1) return [...attached.keys()][0];
  if (attached.size === 0) {
    throw new Error('no tab is attached — click the SAI toolbar button on the tab you want to share');
  }
  throw new Error(`${attached.size} tabs attached — pass tabId (see sai_browser_tabs)`);
}

/** Evaluates one of the pageScripts sources and unwraps the CDP envelope. */
async function evaluateFn(tabId, source, opts) {
  const expression = `(${source})(${JSON.stringify(opts ?? {})})`;
  const res = await cdp(tabId, 'Runtime.evaluate', {
    expression,
    returnByValue: true,
    awaitPromise: false,
  });
  if (res?.exceptionDetails) {
    const text = res.exceptionDetails.exception?.description || res.exceptionDetails.text;
    throw new Error(`page evaluation failed: ${text}`);
  }
  return res?.result?.value;
}

async function captureScreenshot(tabId, viewport, scroll) {
  const width = viewport?.w ?? 0;
  const height = viewport?.h ?? 0;

  for (const tier of SCREENSHOT_TIERS) {
    const scale = width > 0 ? Math.min(1, tier.maxWidth / width) : 1;
    const params = { format: 'jpeg', quality: tier.quality, captureBeyondViewport: false };
    // `clip` is the only way to ask CDP to downscale; it needs real dimensions,
    // so fall back to a full-size capture if the page didn't report a viewport.
    // `clip` is in document coordinates, so offset by the current scroll or we
    // would silently screenshot the top of the page instead of what's on screen.
    if (scale < 1 && width > 0 && height > 0) {
      params.clip = { x: scroll?.x ?? 0, y: scroll?.y ?? 0, width, height, scale };
    }
    const shot = await cdp(tabId, 'Page.captureScreenshot', params);
    const data = shot?.data || '';
    if (data.length <= MAX_FRAME_BYTES) {
      return { base64: data, mimeType: 'image/jpeg', scale, quality: tier.quality };
    }
  }
  throw new Error(
    'screenshot exceeds the 1 MB native-messaging limit even at the lowest tier — ' +
    'retry with screenshot:false, or on a smaller window',
  );
}

// ---------------------------------------------------------------------------
// request handlers
// ---------------------------------------------------------------------------

const HANDLERS = {
  /** Only attached tabs are listed — unattached tabs stay invisible by design. */
  async 'tabs.list'() {
    const targets = await new Promise((resolve) => {
      chrome.debugger.getTargets((t) => resolve(Array.isArray(t) ? t : []));
    });
    const tabs = [...attached.entries()].map(([tabId, meta]) => {
      const live = targets.find((t) => t.tabId === tabId);
      return {
        tabId,
        url: live?.url ?? meta.url ?? null,
        title: live?.title ?? meta.title ?? null,
        attached: true,
      };
    });
    return { tabs, note: 'Only tabs the user attached via the SAI toolbar button are visible.' };
  },

  async snapshot(params) {
    const tabId = resolveTabId(params);
    const snap = await evaluateFn(tabId, SNAPSHOT_FN_SOURCE, {
      maxElements: params?.maxElements,
    });
    if (!snap) throw new Error('snapshot returned nothing (page may still be loading)');

    const out = { tabId, ...snap };
    if (params?.screenshot !== false) {
      out.screenshot = await captureScreenshot(tabId, snap.viewport, snap.scroll);
    }
    return out;
  },

  async read(params) {
    const tabId = resolveTabId(params);
    const res = await evaluateFn(tabId, READ_FN_SOURCE, {
      selector: params?.selector,
      maxChars: params?.maxChars,
    });
    if (!res) throw new Error('read returned nothing (page may still be loading)');
    if (res.error) throw new Error(res.error);
    return { tabId, ...res };
  },
};

async function handleRequest(frame) {
  const handler = HANDLERS[frame.method];
  if (!handler) throw new Error(`unknown method: ${frame.method}`);
  return handler(frame.params ?? {});
}
