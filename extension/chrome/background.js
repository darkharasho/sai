/**
 * SAI Browser Bridge — MV3 service worker.
 *
 * Consent model: SAI can see NOTHING until you click the toolbar button on a
 * tab. That click attaches a CDP session (chrome.debugger) to just that tab;
 * Chrome shows its own "DevTools is debugging this tab" infobar for as long as
 * the attachment lasts. Clicking again detaches. Tabs you never attached are
 * not enumerated, so SAI cannot even see that they exist.
 *
 * Clicking the toolbar button shares a tab READ-ONLY. Control (click, type,
 * navigate) is a second, explicit opt-in per tab, via the right-click menu on
 * that same button — so a tab shared for reading can never be driven, and
 * "SAI can see this" never silently becomes "SAI can act here".
 *
 * Transport: chrome.runtime.connectNative to a relay process, which forwards
 * frames to the already-running SAI app over a unix socket / named pipe. SAI
 * is the requester; we only ever answer.
 */

import {
  SNAPSHOT_FN_SOURCE,
  READ_FN_SOURCE,
  RESOLVE_FN_SOURCE,
  SCROLL_FN_SOURCE,
  LOCATION_FN_SOURCE,
} from './pageScripts.js';

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

const CONTROL_MENU_ID = 'sai-allow-control';

/** How long an action waits for the page to settle before reporting back. */
const SETTLE_TIMEOUT_MS = 5000;

/** tabId -> { url, title, control } captured at attach time. */
const attached = new Map();

let port = null;
let connecting = false;

// ---------------------------------------------------------------------------
// attachment state
// ---------------------------------------------------------------------------

async function persistAttached() {
  const tabIds = [...attached.keys()];
  // Control grants are kept in *session* storage on purpose: they outlive a
  // service-worker teardown (which happens constantly) but never a browser
  // restart, so consent to be driven is not something you grant once forever.
  const controlled = [...attached.entries()].filter(([, m]) => m.control).map(([id]) => id);
  try {
    await chrome.storage.session.set({ attachedTabIds: tabIds, controlledTabIds: controlled });
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
  let controlled = [];
  try {
    const got = await chrome.storage.session.get(['attachedTabIds', 'controlledTabIds']);
    stored = Array.isArray(got?.attachedTabIds) ? got.attachedTabIds : [];
    controlled = Array.isArray(got?.controlledTabIds) ? got.controlledTabIds : [];
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
    if (target) {
      attached.set(tabId, {
        url: target.url,
        title: target.title,
        control: controlled.includes(tabId),
      });
    }
  }
  await persistAttached();
  await refreshBadge();
  if (attached.size) ensureConnected();
}

async function refreshBadge() {
  const count = attached.size;
  const controlling = [...attached.values()].some((m) => m.control);
  try {
    await chrome.action.setBadgeText({ text: count ? String(count) : '' });
    // Amber whenever any tab can be driven — "SAI can act here" should never
    // look the same as "SAI can look here".
    await chrome.action.setBadgeBackgroundColor({ color: controlling ? '#d29922' : '#2f81f7' });
    await chrome.action.setTitle({
      title: count
        ? `${count} tab(s) shared with SAI${controlling ? ' — control enabled' : ' (read-only)'}`
        : 'Attach this tab to SAI',
    });
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
  // Always read-only to begin with. Control is a deliberate second step.
  attached.set(tab.id, { url: tab.url, title: tab.title, control: false });
  await persistAttached();
  await refreshBadge();
  ensureConnected();
  send({ type: 'event', event: 'attached', tabId: tab.id, url: tab.url, title: tab.title });
}

/**
 * Control is granted per tab and never survives a detach — re-attaching a tab
 * starts it read-only again, so a stale grant can't outlive the user's intent.
 */
async function setControl(tabId, control) {
  const meta = attached.get(tabId);
  if (!meta) return;
  meta.control = control;
  await persistAttached();
  await refreshBadge();
  send({ type: 'event', event: control ? 'control-granted' : 'control-revoked', tabId });
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
  // Detaching drops any control grant with it; the checkbox must follow.
  try {
    await chrome.contextMenus.update(CONTROL_MENU_ID, { checked: false });
  } catch {
    /* menu may not exist yet */
  }
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

/**
 * The control opt-in lives in the toolbar button's right-click menu. A plain
 * left-click can't carry it: `action.onClicked` reports no modifier keys, and
 * a popup would replace the one-click share that already works.
 */
async function installContextMenu() {
  try {
    await chrome.contextMenus.removeAll();
    chrome.contextMenus.create({
      id: CONTROL_MENU_ID,
      title: 'Let SAI control this tab',
      type: 'checkbox',
      checked: false,
      contexts: ['action'],
    });
  } catch {
    /* menu is an affordance, not the enforcement point */
  }
}

chrome.contextMenus.onClicked.addListener((info, tab) => {
  if (info.menuItemId !== CONTROL_MENU_ID || !tab?.id) return;
  if (!attached.has(tab.id)) {
    // Nothing to grant control over yet. Put the checkbox back.
    void chrome.contextMenus.update(CONTROL_MENU_ID, { checked: false });
    return;
  }
  void setControl(tab.id, info.checked === true);
});

/** Keep the checkbox showing the active tab's real state, not the last one's. */
chrome.tabs.onActivated.addListener(({ tabId }) => {
  void chrome.contextMenus.update(CONTROL_MENU_ID, {
    checked: attached.get(tabId)?.control === true,
  }).catch(() => { /* menu may not exist yet */ });
});

chrome.runtime.onStartup.addListener(() => void rehydrate());
chrome.runtime.onInstalled.addListener(() => void rehydrate());
void installContextMenu();
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

/**
 * Resolves the target tab *and* asserts the user granted control on it. Every
 * mutating handler goes through this rather than `resolveTabId`, so a
 * read-only tab stays read-only even if a new method forgets to check.
 */
function resolveControlledTabId(params) {
  const tabId = resolveTabId(params);
  if (!attached.get(tabId)?.control) {
    throw new Error(
      `tab ${tabId} is shared read-only — the user must right-click the SAI toolbar button ` +
      'and tick "Let SAI control this tab" before it can be clicked or typed into',
    );
  }
  return tabId;
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
// input helpers
// ---------------------------------------------------------------------------

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** Runs a page script and turns its `{ error }` convention into a throw. */
async function evaluateOrThrow(tabId, source, opts) {
  const res = await evaluateFn(tabId, source, opts);
  if (!res) throw new Error('page returned nothing (it may still be loading)');
  if (res.error) throw new Error(res.error);
  return res;
}

/**
 * Waits for the page to stop being mid-navigation, so an action's reported URL
 * is the one that resulted from it. Best-effort: a slow page just returns
 * whatever it has at the deadline rather than failing the whole action.
 */
async function settle(tabId, timeoutMs = SETTLE_TIMEOUT_MS) {
  const deadline = Date.now() + timeoutMs;
  let last = null;
  while (Date.now() < deadline) {
    try {
      last = await evaluateFn(tabId, LOCATION_FN_SOURCE, {});
    } catch {
      // Mid-navigation the context is torn down; that's expected, so retry.
      last = null;
    }
    if (last?.readyState === 'complete') return last;
    await sleep(120);
  }
  return last;
}

const KEYS = {
  Enter: { key: 'Enter', code: 'Enter', keyCode: 13, text: '\r' },
  Tab: { key: 'Tab', code: 'Tab', keyCode: 9 },
  Escape: { key: 'Escape', code: 'Escape', keyCode: 27 },
  Backspace: { key: 'Backspace', code: 'Backspace', keyCode: 8 },
  Delete: { key: 'Delete', code: 'Delete', keyCode: 46 },
  ArrowUp: { key: 'ArrowUp', code: 'ArrowUp', keyCode: 38 },
  ArrowDown: { key: 'ArrowDown', code: 'ArrowDown', keyCode: 40 },
  ArrowLeft: { key: 'ArrowLeft', code: 'ArrowLeft', keyCode: 37 },
  ArrowRight: { key: 'ArrowRight', code: 'ArrowRight', keyCode: 39 },
  Home: { key: 'Home', code: 'Home', keyCode: 36 },
  End: { key: 'End', code: 'End', keyCode: 35 },
  PageUp: { key: 'PageUp', code: 'PageUp', keyCode: 33 },
  PageDown: { key: 'PageDown', code: 'PageDown', keyCode: 34 },
};

async function dispatchKey(tabId, name) {
  const def = KEYS[name];
  if (!def) {
    throw new Error(`unsupported key: ${name} (supported: ${Object.keys(KEYS).join(', ')})`);
  }
  const base = {
    key: def.key,
    code: def.code,
    windowsVirtualKeyCode: def.keyCode,
    nativeVirtualKeyCode: def.keyCode,
  };
  await cdp(tabId, 'Input.dispatchKeyEvent', {
    ...base,
    type: def.text ? 'keyDown' : 'rawKeyDown',
    ...(def.text ? { text: def.text } : {}),
  });
  await cdp(tabId, 'Input.dispatchKeyEvent', { ...base, type: 'keyUp' });
}

async function clickAt(tabId, x, y) {
  const base = { x, y, button: 'left', clickCount: 1, buttons: 1 };
  // A real pointer arrives before the press; some menus only open on hover.
  await cdp(tabId, 'Input.dispatchMouseEvent', { ...base, type: 'mouseMoved', buttons: 0 });
  await cdp(tabId, 'Input.dispatchMouseEvent', { ...base, type: 'mousePressed' });
  await cdp(tabId, 'Input.dispatchMouseEvent', { ...base, type: 'mouseReleased', buttons: 0 });
}

/**
 * Same-origin gate for navigation. Driving a consented tab to an arbitrary
 * URL is a much bigger surface than clicking what is already on screen, so
 * anything that leaves the current origin — or uses a non-http scheme — is
 * refused and left to the user.
 */
async function resolveSameOriginUrl(tabId, raw) {
  const here = await evaluateFn(tabId, LOCATION_FN_SOURCE, {});
  if (!here?.url) throw new Error('could not determine the current page URL');

  let target;
  try {
    target = new URL(String(raw), here.url);
  } catch {
    throw new Error(`not a valid URL: ${raw}`);
  }
  if (target.protocol !== 'http:' && target.protocol !== 'https:') {
    throw new Error(`refusing to navigate to a ${target.protocol} URL — only http(s) is allowed`);
  }
  if (target.origin !== here.origin) {
    throw new Error(
      `refusing to navigate from ${here.origin} to ${target.origin} — ` +
      'the bridge is same-origin only; the user can open another origin themselves',
    );
  }
  return target.href;
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

  async click(params) {
    const tabId = resolveControlledTabId(params);
    const target = await evaluateOrThrow(tabId, RESOLVE_FN_SOURCE, {
      ref: params?.ref,
      refGen: params?.refGen,
    });
    await clickAt(tabId, target.x, target.y);
    const after = await settle(tabId, 1500);
    return { tabId, clicked: params?.ref, url: after?.url ?? target.url, title: after?.title ?? target.title };
  },

  async type(params) {
    const tabId = resolveControlledTabId(params);
    const text = String(params?.text ?? '');
    const target = await evaluateOrThrow(tabId, RESOLVE_FN_SOURCE, {
      ref: params?.ref,
      refGen: params?.refGen,
      focus: true,
    });
    if (!target.editable) {
      throw new Error(`${params?.ref} is a <${target.tag}>, which is not a text field`);
    }
    // Click first so frameworks that track focus via pointer events keep up,
    // and only then clear — clearing before the click would let the click's
    // own focus handling repopulate the field on some widgets.
    await clickAt(tabId, target.x, target.y);
    if (params?.replace === true) {
      await evaluateOrThrow(tabId, RESOLVE_FN_SOURCE, {
        ref: params?.ref, refGen: params?.refGen, focus: true, clear: true, scrollIntoView: false,
      });
    }
    if (text) await cdp(tabId, 'Input.insertText', { text });
    if (params?.submit === true) await dispatchKey(tabId, 'Enter');

    const after = await settle(tabId, params?.submit === true ? SETTLE_TIMEOUT_MS : 1000);
    return {
      tabId,
      typedInto: params?.ref,
      chars: text.length,
      submitted: params?.submit === true,
      url: after?.url ?? target.url,
      title: after?.title ?? target.title,
    };
  },

  async press(params) {
    const tabId = resolveControlledTabId(params);
    await dispatchKey(tabId, String(params?.key ?? ''));
    const after = await settle(tabId, 1500);
    return { tabId, pressed: params?.key, url: after?.url ?? null, title: after?.title ?? null };
  },

  async scroll(params) {
    // Scrolling changes nothing on the page, but it moves what a later click
    // would land on, so it stays behind the same control gate.
    const tabId = resolveControlledTabId(params);
    const res = await evaluateOrThrow(tabId, SCROLL_FN_SOURCE, {
      dy: typeof params?.dy === 'number' ? params.dy : (params?.to ? 0 : 600),
      dx: params?.dx,
      to: params?.to,
    });
    return { tabId, ...res };
  },

  async navigate(params) {
    const tabId = resolveControlledTabId(params);
    const url = await resolveSameOriginUrl(tabId, params?.url);
    await cdp(tabId, 'Page.navigate', { url });
    const after = await settle(tabId);
    return { tabId, url: after?.url ?? url, title: after?.title ?? null };
  },
};

async function handleRequest(frame) {
  const handler = HANDLERS[frame.method];
  if (!handler) throw new Error(`unknown method: ${frame.method}`);
  return handler(frame.params ?? {});
}

// Exported for the unit tests only — Chrome loads this as a service worker and
// never imports it. The control gate is the security boundary of this whole
// feature, so it is worth being able to test directly.
export { HANDLERS, handleRequest, attached, resolveControlledTabId, KEYS };
