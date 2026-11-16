/**
 * SAI Browser Bridge — MV3 service worker.
 *
 * Consent model: SAI can see NOTHING until you click the toolbar button on a
 * tab. That click attaches a CDP session (chrome.debugger) to just that tab;
 * Chrome shows its own "DevTools is debugging this tab" infobar for as long as
 * the attachment lasts. Clicking again detaches. Tabs you never attached are
 * not enumerated, so SAI cannot even see that they exist.
 *
 * Sharing a tab means SAI can control it (click, type, navigate). There is no
 * separate read-only mode: the toolbar click is the one consent decision, and
 * the amber badge says so.
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
  FOCUS_FN_SOURCE,
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

/** Badge colour while any tab is shared. Amber: shared means drivable. */
const BADGE_COLOR = '#d29922';

/** How long an action waits for the page to settle before reporting back. */
const SETTLE_TIMEOUT_MS = 5000;

/**
 * Every CDP command is time-boxed. A page wedged by a native dialog, or a
 * debugger session Chrome has quietly dropped, would otherwise hang the call
 * until SAI's own 20 s timeout with no hint as to why.
 */
const CDP_TIMEOUT_MS = 8000;

/** In-page cap for Runtime.evaluate, so a runaway page script is cut off too. */
const EVALUATE_TIMEOUT_MS = 6000;

/** How long the toolbar probe waits before treating a silent tab as ours. */
const PROBE_TIMEOUT_MS = 1500;

/** How long an attach failure stays on the badge. */
const ATTACH_ERROR_BADGE_MS = 4000;

/**
 * Re-attach schedule after Chrome drops our debugger for a reason the user
 * didn't choose — most often a password manager's autofill menu, which is
 * another extension's iframe; Chrome won't keep one extension debugging a page
 * that contains another's frame. It allows us back once the menu closes.
 */
const REATTACH_DELAYS_MS = [250, 500, 1000, 2000];
const REATTACH_STEADY_MS = 5000;
const REATTACH_GIVE_UP_MS = 120_000;
/** How long a call on a re-attaching tab waits before failing. */
const REATTACH_CALL_WAIT_MS = 3000;

/** Native-port reconnect schedule while any tab is shared. */
const RECONNECT_DELAYS_MS = [500, 1000, 2000, 5000];
/** A port that stayed up this long resets the backoff. */
const RECONNECT_STABLE_MS = 10_000;

/** tabId -> { url, title, state: 'attached' | 'reattaching' }. */
const attached = new Map();

let port = null;
let connecting = false;
let reconnectAttempt = 0;
let reconnectTimer = null;
let portOpenedAt = 0;
/** Why the native port last closed; sent to SAI on the next hello. */
let lastPortError = null;

// ---------------------------------------------------------------------------
// attachment state
// ---------------------------------------------------------------------------

async function persistAttached() {
  const tabIds = [...attached.keys()];
  // Session storage outlives a service-worker teardown (which happens
  // constantly) but never a browser restart.
  try {
    await chrome.storage.session.set({ attachedTabIds: tabIds });
  } catch {
    /* session storage is best-effort; attachment itself is the source of truth */
  }
}

/**
 * The service worker can be torn down while tabs stay attached (the debugger
 * session outlives it). On restart, rebuild the map by asking Chrome rather
 * than trusting storage: storage is only a hint, and it can be empty while our
 * debugger is still on a tab — which used to leave that tab un-reattachable.
 */
async function rehydrate() {
  let stored = [];
  try {
    const got = await chrome.storage.session.get(['attachedTabIds']);
    stored = Array.isArray(got?.attachedTabIds) ? got.attachedTabIds : [];
  } catch {
    stored = [];
  }

  const targets = await getTargets();
  const candidates = new Set(stored);
  for (const t of targets) {
    if (t.attached && typeof t.tabId === 'number') candidates.add(t.tabId);
  }

  const adopted = [];
  for (const tabId of candidates) {
    if (attached.has(tabId)) continue;
    if (!(await probeAttached(tabId))) continue;
    const target = targets.find((t) => t.tabId === tabId);
    attached.set(tabId, { url: target?.url, title: target?.title, state: 'attached' });
    adopted.push(tabId);
  }
  await persistAttached();
  await refreshBadge();
  if (attached.size) ensureConnected();
  diag('rehydrate', { stored: stored.length, adopted: adopted.length });
}

function getTargets() {
  return new Promise((resolve) => {
    try {
      chrome.debugger.getTargets((t) => resolve(Array.isArray(t) ? t : []));
    } catch {
      resolve([]);
    }
  });
}

/**
 * Is our debugger on this tab? A cheap command answers it: Chrome rejects it
 * at once for a tab we aren't attached to. A tab that doesn't answer at all is
 * attached but wedged (a native dialog blocks evaluation), so silence counts as
 * ours.
 */
async function probeAttached(tabId) {
  try {
    await cdp(tabId, 'Runtime.evaluate', { expression: '1', returnByValue: true }, { timeoutMs: PROBE_TIMEOUT_MS });
    return true;
  } catch (err) {
    return err instanceof CdpTimeoutError;
  }
}

/** Plain-language versions of the attach errors Chrome actually throws. */
function friendlyAttachError(message) {
  const m = String(message || '');
  if (/Another debugger is already attached/i.test(m)) {
    return 'DevTools (or another debugger) is open on this tab — close it and click again';
  }
  if (/Cannot access|chrome:\/\/|chrome-extension:\/\/|cannot be scripted/i.test(m)) {
    return "Chrome doesn't allow sharing this page";
  }
  if (/No tab with given id/i.test(m)) return 'That tab is gone';
  return m;
}

/** Flags a failed share on that tab's badge for a few seconds. */
async function showAttachError(tabId, message) {
  try {
    await chrome.action.setBadgeText({ tabId, text: '!' });
    await chrome.action.setTitle({ tabId, title: `Couldn't share this tab with SAI: ${message}` });
  } catch {
    /* cosmetic */
  }
  setTimeout(() => {
    void (async () => {
      try {
        await chrome.action.setBadgeText({ tabId, text: '' });
        await chrome.action.setTitle({ tabId, title: '' });
      } catch { /* cosmetic */ }
      await refreshBadge();
    })();
  }, ATTACH_ERROR_BADGE_MS);
}

/**
 * The toolbar button. Decides attach-vs-detach from what Chrome says, not just
 * from our map, which a worker restart can empty while the debugger stays on.
 */
async function toggleTab(tab) {
  const ours = attached.has(tab.id) || (await probeAttached(tab.id));
  if (ours) {
    await detachTab(tab.id, { reason: 'user' });
    return;
  }
  try {
    await attachTab(tab);
  } catch (err) {
    const raw = String(err?.message || err);
    const message = friendlyAttachError(raw);
    diag('attach-failed', { tabId: tab.id, error: raw });
    console.error('[sai-bridge] attach failed:', raw);
    await showAttachError(tab.id, message);
  }
}

async function refreshBadge() {
  const count = attached.size;
  try {
    await chrome.action.setBadgeText({ text: count ? String(count) : '' });
    await chrome.action.setBadgeBackgroundColor({ color: BADGE_COLOR });
    await chrome.action.setTitle({
      title: count
        ? `${count} tab(s) shared with SAI — SAI can control them`
        : 'Share this tab with SAI',
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
    await cdp(tab.id, 'Page.enable', {});
  } catch {
    /* non-fatal: snapshot/read still work */
  }
  attached.set(tab.id, { url: tab.url, title: tab.title, state: 'attached' });
  await persistAttached();
  await refreshBadge();
  ensureConnected();
  send({ type: 'event', event: 'attached', tabId: tab.id, url: tab.url, title: tab.title });
}

async function detachTab(tabId, { notify = true, reason = null } = {}) {
  dialogs.delete(tabId);
  cancelReattach(tabId, new Error(`tab ${tabId} is no longer shared with SAI`));
  try {
    await chrome.debugger.detach({ tabId });
  } catch {
    /* already gone (tab closed, DevTools stole the session) */
  }
  attached.delete(tabId);
  await persistAttached();
  await refreshBadge();
  if (notify) send({ type: 'event', event: 'detached', tabId, reason });
  if (!attached.size && port) {
    try { port.disconnect(); } catch { /* noop */ }
    port = null;
  }
}

chrome.action.onClicked.addListener((tab) => {
  if (!tab?.id) return undefined;
  return toggleTab(tab).catch((err) => console.error('[sai-bridge] toggle failed:', err));
});

chrome.debugger.onDetach.addListener((source, reason) => {
  if (typeof source.tabId !== 'number') return;
  diag('detach', { tabId: source.tabId, reason, known: attached.has(source.tabId) });
  if (!attached.has(source.tabId)) return;
  // The user dismissing the "debugging this tab" infobar is a decision to stop
  // sharing. Anything else (a foreign extension frame, a renderer swap) is
  // Chrome's doing, so keep the tab and win it back.
  if (reason === 'canceled_by_user') void detachTab(source.tabId, { reason });
  else scheduleReattach(source.tabId, reason);
});

chrome.tabs.onRemoved.addListener((tabId) => {
  if (attached.has(tabId)) void detachTab(tabId, { reason: 'tab-closed' });
});

// ---------------------------------------------------------------------------
// native dialogs
// ---------------------------------------------------------------------------

/**
 * tabId -> { type, message, url, defaultPrompt } for an open alert, confirm,
 * prompt or "Leave site?" (beforeunload) dialog. While one is open Chrome
 * blocks Runtime.evaluate on that page, so every call would otherwise hang.
 * Recorded even before the tab is in `attached`: Page.enable replays a dialog
 * that was already open when the user shared the tab.
 */
const dialogs = new Map();

class DialogOpenError extends Error {
  constructor(tabId, dialog) {
    super(dialogMessage(tabId, dialog));
    this.dialog = dialog;
  }
}

function dialogMessage(tabId, d) {
  const article = /^[aeiou]/i.test(d.type) ? 'an' : 'a';
  return `${article} ${d.type} dialog is open on tab ${tabId}: "${d.message}" — call sai_browser_dialog to accept or dismiss it`;
}

function assertNoDialog(tabId) {
  const d = dialogs.get(tabId);
  if (d) throw new DialogOpenError(tabId, d);
}

chrome.debugger.onEvent.addListener((source, method, params) => {
  const tabId = source?.tabId;
  if (typeof tabId !== 'number') return;
  if (method === 'Page.javascriptDialogOpening') {
    const d = {
      type: params?.type ?? 'alert',
      message: params?.message ?? '',
      url: params?.url ?? null,
      defaultPrompt: params?.defaultPrompt ?? '',
    };
    dialogs.set(tabId, d);
    // Fail whatever was waiting on the page now, rather than at its timeout.
    abortInflight(tabId, new DialogOpenError(tabId, d));
    send({ type: 'event', event: 'dialog-opened', tabId, dialog: d });
  } else if (method === 'Page.javascriptDialogClosed') {
    if (dialogs.delete(tabId)) send({ type: 'event', event: 'dialog-closed', tabId });
  }
});

/**
 * Runs a page-changing action. A dialog the action itself triggered (a
 * "Leave site?" on navigate, an alert on click) is the action's result, not a
 * failure: the action happened, and SAI needs to know what is now in the way.
 */
async function runAction(tabId, fn) {
  let result;
  try {
    result = await fn();
  } catch (err) {
    if (!(err instanceof DialogOpenError) || !dialogs.has(tabId)) throw err;
    result = { tabId };
  }
  const d = dialogs.get(tabId);
  return d ? { ...result, dialog: d } : result;
}

// ---------------------------------------------------------------------------
// re-attach
// ---------------------------------------------------------------------------

/** tabId -> { startedAt, attempt, timer, waiters: Set<{resolve, reject}> } */
const reattaching = new Map();

function scheduleReattach(tabId, reason) {
  const meta = attached.get(tabId);
  if (!meta) return;
  let job = reattaching.get(tabId);
  if (job) {
    // Already trying: restart the clock on the existing job, never a second one.
    clearTimeout(job.timer);
    job.attempt = 0;
  } else {
    job = { startedAt: Date.now(), attempt: 0, timer: null, waiters: new Set() };
    reattaching.set(tabId, job);
  }
  meta.state = 'reattaching';
  abortInflight(tabId, new Error(reattachingMessage(tabId)));
  send({ type: 'event', event: 'reattaching', tabId, reason });
  queueReattachAttempt(tabId, job);
}

function queueReattachAttempt(tabId, job) {
  const delay = job.attempt < REATTACH_DELAYS_MS.length ? REATTACH_DELAYS_MS[job.attempt] : REATTACH_STEADY_MS;
  job.timer = setTimeout(() => void reattachAttempt(tabId, job), delay);
}

async function reattachAttempt(tabId, job) {
  if (reattaching.get(tabId) !== job) return;
  job.attempt += 1;
  let ok = false;
  let error = null;
  try {
    await chrome.debugger.attach({ tabId }, CDP_VERSION);
    ok = true;
  } catch (err) {
    error = String(err?.message || err);
    // Chrome may have handed the session back on its own.
    if (/already attached/i.test(error) && (await probeAttached(tabId))) ok = true;
  }
  if (reattaching.get(tabId) !== job) return; // cancelled while we awaited

  if (ok) {
    reattaching.delete(tabId);
    const meta = attached.get(tabId);
    if (meta) meta.state = 'attached';
    try { await cdp(tabId, 'Page.enable', {}); } catch { /* non-fatal */ }
    send({ type: 'event', event: 'reattached', tabId });
    diag('reattached', { tabId, attempts: job.attempt, waitedMs: Date.now() - job.startedAt });
    for (const w of job.waiters) w.resolve();
    return;
  }

  if (/No tab with given id/i.test(error)) {
    await detachTab(tabId, { reason: 'tab-closed' });
    return;
  }
  if (Date.now() - job.startedAt >= REATTACH_GIVE_UP_MS) {
    diag('reattach-gave-up', { tabId, attempts: job.attempt, error });
    await detachTab(tabId, { reason: 'reattach-timeout' });
    return;
  }
  queueReattachAttempt(tabId, job);
}

function cancelReattach(tabId, err) {
  const job = reattaching.get(tabId);
  if (!job) return;
  reattaching.delete(tabId);
  clearTimeout(job.timer);
  for (const w of job.waiters) w.reject(err);
}

function reattachingMessage(tabId) {
  return (
    `Chrome detached the debugger on tab ${tabId} because another extension (likely a password ` +
    "manager's autofill menu) put a frame in the page — reattaching automatically; press Escape or " +
    'dismiss the menu, then retry'
  );
}

/** Resolves once the tab is attached again; rejects after `ms`. */
function awaitAttached(tabId, ms = REATTACH_CALL_WAIT_MS) {
  const job = reattaching.get(tabId);
  if (!job) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const waiter = {
      resolve: () => { clearTimeout(timer); job.waiters.delete(waiter); resolve(); },
      reject: (err) => { clearTimeout(timer); job.waiters.delete(waiter); reject(err); },
    };
    const timer = setTimeout(() => waiter.reject(new Error(reattachingMessage(tabId))), ms);
    job.waiters.add(waiter);
  });
}

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
  portOpenedAt = Date.now();
  const thisPort = port;

  port.onMessage.addListener((frame) => {
    reconnectAttempt = 0; // SAI answered: the link works
    if (frame?.type !== 'request') return;
    handleRequest(frame).then(
      (result) => send({ type: 'response', id: frame.id, ok: true, result }),
      (err) => send({ type: 'response', id: frame.id, ok: false, error: String(err?.message || err) }),
    );
  });

  port.onDisconnect.addListener(() => {
    const why = chrome.runtime.lastError?.message;
    if (why) console.warn('[sai-bridge] native port closed:', why);
    if (port === thisPort) port = null;
    // Recorded locally only: with the port gone there is no one to tell.
    lastPortError = why || 'disconnected';
    if (Date.now() - portOpenedAt >= RECONNECT_STABLE_MS) reconnectAttempt = 0;
    scheduleReconnect();
  });

  send({
    type: 'hello',
    role: 'extension',
    version: chrome.runtime.getManifest().version,
    attachedTabIds: [...attached.keys()],
  });
  if (lastPortError) {
    diag('port-reconnected', { previousError: lastPortError });
    lastPortError = null;
  }
}

/**
 * The relay exits whenever SAI's socket closes (SAI restarting, or a newer
 * relay winning), which drops our port while tabs stay attached. Reconnect
 * promptly instead of leaving SAI blind until the 30 s keepalive alarm.
 */
function scheduleReconnect() {
  if (reconnectTimer || !attached.size) return;
  const delay = RECONNECT_DELAYS_MS[Math.min(reconnectAttempt, RECONNECT_DELAYS_MS.length - 1)];
  reconnectAttempt += 1;
  reconnectTimer = setTimeout(() => {
    reconnectTimer = null;
    if (attached.size) ensureConnected();
  }, delay);
}

/** A diagnostic frame for SAI's devlog. Fire-and-forget, never throws. */
function diag(kind, data = {}) {
  send({ type: 'event', event: 'diag', kind, ...data });
}

// ---------------------------------------------------------------------------
// CDP helpers
// ---------------------------------------------------------------------------

class CdpTimeoutError extends Error {}

/**
 * In-flight CDP calls per tab, so a tab-wide event (a dialog opening, the
 * debugger detaching) can fail them at once instead of letting each wait out
 * its timeout.
 */
const inflight = new Map();

function abortInflight(tabId, err) {
  const set = inflight.get(tabId);
  if (!set) return;
  inflight.delete(tabId);
  for (const fail of set) fail(err);
}

function cdp(tabId, method, params = {}, { timeoutMs = CDP_TIMEOUT_MS } = {}) {
  return new Promise((resolve, reject) => {
    let set = inflight.get(tabId);
    if (!set) inflight.set(tabId, (set = new Set()));
    let timer = null;
    const finish = () => {
      clearTimeout(timer);
      set.delete(fail);
      if (!set.size && inflight.get(tabId) === set) inflight.delete(tabId);
    };
    const fail = (err) => { finish(); reject(err); };
    set.add(fail);
    timer = setTimeout(() => {
      fail(new CdpTimeoutError(`CDP ${method} timed out after ${timeoutMs / 1000}s on tab ${tabId}`));
    }, timeoutMs);
    try {
      chrome.debugger.sendCommand({ tabId }, method, params, (result) => {
        const err = chrome.runtime.lastError;
        if (!set.has(fail)) return; // already timed out or aborted
        finish();
        if (err) reject(new Error(err.message));
        else resolve(result);
      });
    } catch (err) {
      fail(err instanceof Error ? err : new Error(String(err)));
    }
  });
}

/**
 * Resolves which attached tab a request targets. A tab Chrome briefly took
 * away (see scheduleReattach) is waited for rather than refused outright.
 */
async function resolveTabId(params, { allowDialog = false } = {}) {
  let tabId;
  if (typeof params?.tabId === 'number') {
    if (!attached.has(params.tabId)) {
      throw new Error(`tab ${params.tabId} is not attached — click the SAI toolbar button on it first`);
    }
    tabId = params.tabId;
  } else if (attached.size === 1) {
    tabId = [...attached.keys()][0];
  } else if (attached.size === 0) {
    throw new Error('no tab is attached — click the SAI toolbar button on the tab you want to share');
  } else {
    throw new Error(`${attached.size} tabs attached — pass tabId (see sai_browser_tabs)`);
  }
  if (attached.get(tabId)?.state === 'reattaching') await awaitAttached(tabId);
  if (!allowDialog) assertNoDialog(tabId);
  return tabId;
}

/** Evaluates one of the pageScripts sources and unwraps the CDP envelope. */
async function evaluateFn(tabId, source, opts) {
  const expression = `(${source})(${JSON.stringify(opts ?? {})})`;
  const res = await cdp(tabId, 'Runtime.evaluate', {
    expression,
    returnByValue: true,
    awaitPromise: false,
    timeout: EVALUATE_TIMEOUT_MS,
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
    if (dialogs.has(tabId)) return last;
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
  // Space is how a focused checkbox, radio or switch is toggled — Enter does
  // not activate them, and on an app with global shortcuts it falls through to
  // the page behind instead, which is worse than doing nothing.
  Space: { key: ' ', code: 'Space', keyCode: 32, text: ' ' },
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

/**
 * The DOM name for the space key is a single space, and models reach for
 * "Spacebar" too, so both resolve to Space rather than being refused for a
 * naming mismatch. Everything else must match a key in KEYS exactly.
 */
const KEY_ALIASES = { ' ': 'Space', Spacebar: 'Space', space: 'Space', Esc: 'Escape' };

async function dispatchKey(tabId, name) {
  const resolved = KEY_ALIASES[name] || name;
  const def = KEYS[resolved];
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
        state: meta.state ?? 'attached',
        ...(dialogs.has(tabId) ? { dialog: dialogs.get(tabId) } : {}),
      };
    });
    return { tabs, note: 'Only tabs the user attached via the SAI toolbar button are visible.' };
  },

  async snapshot(params) {
    const tabId = await resolveTabId(params, { allowDialog: true });
    const dialog = dialogs.get(tabId);
    if (dialog) {
      // The page can't be evaluated or reliably captured behind a native
      // dialog, so report the dialog itself as what is on screen.
      return {
        tabId,
        dialog,
        elements: [],
        note: 'a dialog is blocking the page — handle it with sai_browser_dialog',
      };
    }
    const snap = await evaluateFn(tabId, SNAPSHOT_FN_SOURCE, {
      maxElements: params?.maxElements,
      offset: params?.offset,
      match: params?.match,
      root: params?.root,
    });
    if (!snap) throw new Error('snapshot returned nothing (page may still be loading)');
    // A bad root selector is the caller's mistake, not an empty page.
    if (snap.error) throw new Error(snap.error);

    const out = { tabId, ...snap };
    if (params?.screenshot !== false) {
      out.screenshot = await captureScreenshot(tabId, snap.viewport, snap.scroll);
    }
    return out;
  },

  async read(params) {
    const tabId = await resolveTabId(params);
    const res = await evaluateFn(tabId, READ_FN_SOURCE, {
      selector: params?.selector,
      maxChars: params?.maxChars,
    });
    if (!res) throw new Error('read returned nothing (page may still be loading)');
    if (res.error) throw new Error(res.error);
    return { tabId, ...res };
  },

  async click(params) {
    const tabId = await resolveTabId(params);
    return runAction(tabId, async () => {
      const target = await evaluateOrThrow(tabId, RESOLVE_FN_SOURCE, {
        ref: params?.ref,
        refGen: params?.refGen,
      });
      await clickAt(tabId, target.x, target.y);
      const after = await settle(tabId, 1500);
      return { tabId, clicked: params?.ref, url: after?.url ?? target.url, title: after?.title ?? target.title };
    });
  },

  async type(params) {
    const tabId = await resolveTabId(params);
    return runAction(tabId, async () => {
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
    });
  },

  async press(params) {
    const tabId = await resolveTabId(params);
    return runAction(tabId, async () => {
      // Focus before and after, so a key that was swallowed (or that activated
      // something behind a modal) shows up in the result instead of reading as
      // a success. Best-effort: a page that won't evaluate still gets the key.
      let before = null;
      try { before = await evaluateFn(tabId, FOCUS_FN_SOURCE, {}); } catch { /* not fatal */ }

      await dispatchKey(tabId, String(params?.key ?? ''));
      const after = await settle(tabId, 1500);

      let focus = null;
      try { focus = await evaluateFn(tabId, FOCUS_FN_SOURCE, {}); } catch { /* not fatal */ }

      return {
        tabId,
        pressed: params?.key,
        focusBefore: before?.focus ?? null,
        focusAfter: focus?.focus ?? null,
        url: after?.url ?? null,
        title: after?.title ?? null,
      };
    });
  },

  async scroll(params) {
    const tabId = await resolveTabId(params);
    const res = await evaluateOrThrow(tabId, SCROLL_FN_SOURCE, {
      dy: typeof params?.dy === 'number' ? params.dy : (params?.to ? 0 : 600),
      dx: params?.dx,
      to: params?.to,
    });
    return { tabId, ...res };
  },

  async navigate(params) {
    const tabId = await resolveTabId(params);
    const url = await resolveSameOriginUrl(tabId, params?.url);
    return runAction(tabId, async () => {
      await cdp(tabId, 'Page.navigate', { url });
      const after = await settle(tabId);
      return { tabId, url: after?.url ?? url, title: after?.title ?? null };
    });
  },

  /** Accepts or dismisses the native dialog blocking a tab. */
  async dialog(params) {
    const tabId = await resolveTabId(params, { allowDialog: true });
    const d = dialogs.get(tabId);
    if (!d) throw new Error(`no dialog is open on tab ${tabId}`);
    const action = params?.action === 'dismiss' ? 'dismiss' : 'accept';
    return runAction(tabId, async () => {
      await cdp(tabId, 'Page.handleJavaScriptDialog', {
        accept: action === 'accept',
        ...(typeof params?.promptText === 'string' ? { promptText: params.promptText } : {}),
      });
      dialogs.delete(tabId);
      const after = await settle(tabId);
      return { tabId, handled: action, type: d.type, url: after?.url ?? null, title: after?.title ?? null };
    });
  },
};

async function handleRequest(frame) {
  const handler = HANDLERS[frame.method];
  if (!handler) throw new Error(`unknown method: ${frame.method}`);
  return handler(frame.params ?? {});
}

// Exported for the unit tests only — Chrome loads this as a service worker and
// never imports it.
export {
  HANDLERS, handleRequest, attached, resolveTabId, KEYS,
  friendlyAttachError, rehydrate, dialogs, probeAttached, ensureConnected, cdp, abortInflight,
};
