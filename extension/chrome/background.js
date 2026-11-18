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
  SELECT_FN_SOURCE,
  WAIT_CHECK_FN_SOURCE,
  FRAME_GUARD_FN_SOURCE,
  frameGuard,
} from './pageScripts.js';
import { KEYS, parseKeySpec } from './keys.js';

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

/** browser_wait: default and hard cap (must stay under SAI's 20 s call timeout). */
const WAIT_DEFAULT_MS = 5000;
const WAIT_MAX_MS = 15_000;
const WAIT_POLL_MS = 200;

/**
 * A tab opened by a shared tab is shared automatically only if SAI was acting
 * in the opener at the time, or within this long after (OAuth popups open a
 * beat late). Tabs the user opens themselves stay private.
 */
const ACTION_GRACE_MS = 3000;
/** Attempts to attach a freshly opened child tab, which may still be starting. */
const CHILD_ATTACH_TRIES = 3;
const CHILD_ATTACH_GAP_MS = 200;

/**
 * Budget pieces that keep navigate under SAI's 20 s call timeout even when
 * the page never answers: 3 s to read the current URL + 5 s for the navigation
 * to commit + the 5 s settle, plus up to 3 s waiting for a re-attach.
 */
const LOCATION_READ_TIMEOUT_MS = 3000;
const NAVIGATE_COMMIT_TIMEOUT_MS = 5000;
/** Never give a poll less than this, even near a deadline. */
const MIN_POLL_EVAL_MS = 250;

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
/** Retry delay once a sweep has cleared the frame that blocked re-attach. */
const REATTACH_AFTER_SWEEP_MS = 100;
/** Installing the frame guard must never stall an attach for long. */
const FRAME_GUARD_TIMEOUT_MS = 2000;

/** Native-port reconnect schedule while any tab is shared. */
const RECONNECT_DELAYS_MS = [500, 1000, 2000, 5000];
/** A port that stayed up this long resets the backoff. */
const RECONNECT_STABLE_MS = 10_000;
/** storage.local key for the tabs to re-share after reloading into an update. */
const RELOAD_HANDOFF_KEY = 'reloadHandoff';
/** A handoff older than this is stale (the reload never happened, or crashed). */
const RELOAD_HANDOFF_MAX_AGE_MS = 60_000;
/** How long a pending self-reload waits for in-flight requests to finish. */
const RELOAD_DRAIN_MS = 5000;

/** tabId -> { url, title, state: 'attached' | 'reattaching' }. */
const attached = new Map();

let port = null;
let connecting = false;
let reconnectAttempt = 0;
let requestsInFlight = 0;
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
    // Dialog state lived in the old worker's memory; enabling Page again makes
    // Chrome replay a dialog that is still open.
    try { await cdp(tabId, 'Page.enable', {}, { timeoutMs: 2000 }); } catch { /* non-fatal */ }
    await installFrameGuard(tabId);
  }
  const resumed = await resumeAfterReload();
  await persistAttached();
  await refreshBadge();
  if (attached.size) ensureConnected();
  diag('rehydrate', { stored: stored.length, adopted: adopted.length, resumed });
}

// ---------------------------------------------------------------------------
// self-update
// ---------------------------------------------------------------------------

/**
 * Chrome rereads an unpacked extension's folder only when it reloads. SAI
 * keeps that folder current and, when it sees an older version connect,
 * sends a `reload` frame. Reloading drops every debugger session and clears
 * session storage, so the shared tabs are handed over in local storage and
 * shared again by the new version.
 */
let reloading = false;

async function reloadForUpdate(frame) {
  if (reloading) return;
  reloading = true;
  const deadline = Date.now() + RELOAD_DRAIN_MS;
  while (requestsInFlight > 0 && Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 100));
  }
  const tabIds = [...attached.keys()];
  const from = chrome.runtime.getManifest().version;
  diag('self-reload', { from, to: typeof frame?.version === 'string' ? frame.version : null, tabs: tabIds.length });
  try {
    await chrome.storage.local.set({ [RELOAD_HANDOFF_KEY]: { tabIds, from, at: Date.now() } });
  } catch {
    /* without the handoff the tabs just need sharing again by hand */
  }
  chrome.runtime.reload();
}

/** Consumed once per worker: concurrent rehydrates must not both re-share. */
let handoffTaken = null;

function takeReloadHandoff() {
  if (!handoffTaken) {
    handoffTaken = (async () => {
      try {
        const got = await chrome.storage.local.get([RELOAD_HANDOFF_KEY]);
        await chrome.storage.local.remove(RELOAD_HANDOFF_KEY);
        const h = got?.[RELOAD_HANDOFF_KEY];
        if (!h || !Array.isArray(h.tabIds) || Date.now() - (h.at || 0) > RELOAD_HANDOFF_MAX_AGE_MS) return null;
        return h;
      } catch {
        return null;
      }
    })();
  }
  return handoffTaken;
}

/** Shares again the tabs that were shared before reloading into an update. */
async function resumeAfterReload() {
  const handoff = await takeReloadHandoff();
  if (!handoff) return 0;
  let resumed = 0;
  for (const tabId of handoff.tabIds) {
    if (typeof tabId !== 'number' || attached.has(tabId)) continue;
    try {
      const tab = await chrome.tabs.get(tabId);
      await attachTab(tab);
      resumed += 1;
    } catch (err) {
      diag('reload-reshare-failed', { tabId, error: String(err?.message || err) });
    }
  }
  diag('updated', { from: handoff.from, to: chrome.runtime.getManifest().version, resumed, of: handoff.tabIds.length });
  return resumed;
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

async function attachTab(tab, { openedBy } = {}) {
  try {
    await chrome.debugger.attach({ tabId: tab.id }, CDP_VERSION);
  } catch (err) {
    // A password manager's frame already in the page blocks the share itself.
    // Clear it out and try once more.
    if (!isForeignFrameError(err) || !(await sweepForeignFrames(tab.id))) throw err;
    await chrome.debugger.attach({ tabId: tab.id }, CDP_VERSION);
  }
  // Page must be enabled before captureScreenshot is reliable on some targets.
  try {
    await cdp(tab.id, 'Page.enable', {});
  } catch {
    /* non-fatal: snapshot/read still work */
  }
  await installFrameGuard(tab.id);
  attached.set(tab.id, { url: tab.url, title: tab.title, state: 'attached' });
  await persistAttached();
  await refreshBadge();
  ensureConnected();
  send({
    type: 'event', event: 'attached', tabId: tab.id, url: tab.url, title: tab.title,
    ...(openedBy !== undefined ? { openedBy } : {}),
  });
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
  closePortIfIdle();
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
  const win = beginAction(tabId);
  let result;
  try {
    result = await fn();
  } catch (err) {
    if (!(err instanceof DialogOpenError) || !dialogs.has(tabId)) throw err;
    result = { tabId };
  } finally {
    endAction(tabId);
  }
  const d = dialogs.get(tabId);
  const opened = win.opened.splice(0);
  return {
    ...result,
    ...(d ? { dialog: d } : {}),
    ...(opened.length ? { openedTabs: opened } : {}),
  };
}

// ---------------------------------------------------------------------------
// action windows and child tabs
// ---------------------------------------------------------------------------

/** tabId -> { depth, until, opened: number[] } while SAI acts in that tab. */
const actionWindows = new Map();

function beginAction(tabId) {
  let win = actionWindows.get(tabId);
  if (!win) actionWindows.set(tabId, (win = { depth: 0, until: 0, opened: [] }));
  win.depth += 1;
  return win;
}

function endAction(tabId) {
  const win = actionWindows.get(tabId);
  if (!win) return;
  win.depth = Math.max(0, win.depth - 1);
  win.until = Date.now() + ACTION_GRACE_MS;
}

function isInActionWindow(tabId) {
  const win = actionWindows.get(tabId);
  return !!win && (win.depth > 0 || Date.now() < win.until);
}

/**
 * Tabs we created ourselves (tabs.open) and attach directly, plus openers with
 * a tabs.open in flight: Chrome fires onCreated before tabs.create resolves,
 * so the id isn't known yet when the event arrives.
 */
const selfOpened = new Set();
const openingFrom = new Map();

chrome.tabs.onCreated.addListener((tab) => {
  const opener = tab?.openerTabId;
  if (typeof tab?.id !== 'number' || typeof opener !== 'number') return;
  if (selfOpened.has(tab.id) || attached.has(tab.id) || openingFrom.get(opener)) return;
  if (!attached.has(opener) || !isInActionWindow(opener)) return;
  actionWindows.get(opener)?.opened.push(tab.id);
  void attachChild(tab, opener);
});

async function attachChild(tab, openedBy) {
  for (let i = 0; i < CHILD_ATTACH_TRIES; i++) {
    try {
      await attachTab(tab, { openedBy });
      return;
    } catch (err) {
      if (i === CHILD_ATTACH_TRIES - 1) {
        diag('child-attach-failed', { tabId: tab.id, openedBy, error: String(err?.message || err) });
        return;
      }
      await sleep(CHILD_ATTACH_GAP_MS);
    }
  }
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
  if (reattaching.get(tabId) !== job) {
    // Cancelled while attach was in flight (the user unshared the tab, or it
    // closed). If the attach still went through, undo it: the user said stop.
    if (ok) {
      try { await chrome.debugger.detach({ tabId }); } catch { /* already gone */ }
    }
    return;
  }

  if (ok) {
    reattaching.delete(tabId);
    const meta = attached.get(tabId);
    if (meta) meta.state = 'attached';
    // A dialog may have closed while we were detached and couldn't hear it.
    // Forget it; Page.enable replays one that is still open.
    dialogs.delete(tabId);
    try { await cdp(tabId, 'Page.enable', {}); } catch { /* non-fatal */ }
    await installFrameGuard(tabId);
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
  // The frame that knocked us off is still in the page. Take it out without
  // the debugger, then come straight back rather than waiting out the backoff.
  if (isForeignFrameError(error) && (await sweepForeignFrames(tabId))) {
    if (reattaching.get(tabId) !== job) return;
    job.timer = setTimeout(() => void reattachAttempt(tabId, job), REATTACH_AFTER_SWEEP_MS);
    return;
  }
  queueReattachAttempt(tabId, job);
}

// ---------------------------------------------------------------------------
// foreign-extension frames
// ---------------------------------------------------------------------------

/** Chrome's refusal while another extension's frame is in the page. */
function isForeignFrameError(err) {
  return /chrome-extension:\/\/ URL of different extension/i.test(String(err?.message || err || ''));
}

/**
 * Installs frameGuard in a freshly attached tab: on every future document (so
 * it survives navigation) and in the current one. Lost when the debugger
 * detaches, so every attach path calls this again.
 */
async function installFrameGuard(tabId) {
  const source = `(${FRAME_GUARD_FN_SOURCE})(${JSON.stringify({ selfId: chrome.runtime.id })})`;
  try {
    await cdp(tabId, 'Page.addScriptToEvaluateOnNewDocument', { source }, { timeoutMs: FRAME_GUARD_TIMEOUT_MS });
  } catch (err) {
    diag('frame-guard-failed', { tabId, step: 'new-document', error: String(err?.message || err) });
  }
  // An open dialog blocks Runtime.evaluate; the new-document hook still covers
  // the next page.
  if (dialogs.has(tabId)) return;
  try {
    await cdp(tabId, 'Runtime.evaluate', { expression: source, returnByValue: true }, { timeoutMs: FRAME_GUARD_TIMEOUT_MS });
  } catch (err) {
    diag('frame-guard-failed', { tabId, step: 'current', error: String(err?.message || err) });
  }
}

/**
 * Removes other extensions' frames with chrome.scripting, which works while
 * the debugger is off the tab. Runs in the content-script world, where
 * chrome.dom can see into closed shadow roots. True if anything was removed.
 */
async function sweepForeignFrames(tabId) {
  if (!chrome.scripting?.executeScript) return false;
  const run = (allFrames) => chrome.scripting.executeScript({
    target: { tabId, allFrames },
    func: frameGuard,
    args: [{ selfId: chrome.runtime.id }],
  });
  let results;
  try {
    results = await run(true);
  } catch {
    try {
      results = await run(false);
    } catch (err) {
      diag('frame-sweep-failed', { tabId, error: String(err?.message || err) });
      return false;
    }
  }
  const removed = (results || []).reduce((n, r) => n + (Number(r?.result?.removed) || 0), 0);
  diag('frame-sweep', { tabId, removed });
  return removed > 0;
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
    if (frame?.type === 'reload') {
      void reloadForUpdate(frame);
      return;
    }
    if (frame?.type !== 'request') return;
    requestsInFlight += 1;
    handleRequest(frame).then(
      (result) => send({ type: 'response', id: frame.id, ok: true, result }),
      (err) => send({ type: 'response', id: frame.id, ok: false, error: String(err?.message || err) }),
    ).finally(() => {
      requestsInFlight -= 1;
      closePortIfIdle();
    });
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

/**
 * With nothing shared the port has no reason to stay open — but a request
 * that just unshared the last tab (tabs.close) still has to be answered, so
 * only close once nothing is in flight.
 */
function closePortIfIdle() {
  if (attached.size || requestsInFlight || !port) return;
  try { port.disconnect(); } catch { /* noop */ }
  port = null;
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
async function evaluateFn(tabId, source, opts, { timeoutMs = CDP_TIMEOUT_MS } = {}) {
  const expression = `(${source})(${JSON.stringify(opts ?? {})})`;
  const res = await cdp(tabId, 'Runtime.evaluate', {
    expression,
    returnByValue: true,
    awaitPromise: false,
    timeout: Math.min(EVALUATE_TIMEOUT_MS, timeoutMs),
  }, { timeoutMs });
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
      // Each poll gets only the time left, so a hung page can't stretch the
      // settle past its deadline by a whole CDP timeout.
      const left = Math.max(MIN_POLL_EVAL_MS, deadline - Date.now());
      last = await evaluateFn(tabId, LOCATION_FN_SOURCE, {}, { timeoutMs: left });
    } catch {
      // Mid-navigation the context is torn down; that's expected, so retry.
      last = null;
    }
    if (last?.readyState === 'complete') return last;
    await sleep(120);
  }
  return last;
}

/** Sends one key (or combo, e.g. "Control+a") to whatever is focused. */
async function dispatchKey(tabId, spec) {
  const def = parseKeySpec(spec);
  const base = {
    key: def.key,
    code: def.code,
    windowsVirtualKeyCode: def.keyCode,
    nativeVirtualKeyCode: def.keyCode,
    modifiers: def.modifiers,
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
 * Resolves a navigation target. Any http(s) URL is allowed — sharing a tab
 * grants control of it — but other schemes (javascript:, data:, file:, …) are
 * refused: they run code or read local files rather than load a page.
 */
async function resolveNavigableUrl(tabId, raw) {
  let base;
  try {
    base = (await evaluateFn(tabId, LOCATION_FN_SOURCE, {}, { timeoutMs: LOCATION_READ_TIMEOUT_MS }))?.url;
  } catch {
    base = undefined;
  }
  return checkHttpUrl(raw, base);
}

function checkHttpUrl(raw, base) {
  let target;
  try {
    target = base ? new URL(String(raw), base) : new URL(String(raw));
  } catch {
    throw new Error(`not a valid URL: ${raw}`);
  }
  if (target.protocol !== 'http:' && target.protocol !== 'https:') {
    throw new Error(`refusing to navigate to a ${target.protocol} URL — only http(s) is allowed`);
  }
  return target.href;
}

/** Moves one step through the tab's session history. */
async function stepHistory(tabId, direction) {
  const hist = await cdp(tabId, 'Page.getNavigationHistory', {});
  const index = (hist?.currentIndex ?? 0) + (direction === 'back' ? -1 : 1);
  const entry = hist?.entries?.[index];
  if (!entry) {
    throw new Error(`no ${direction === 'back' ? 'previous' : 'next'} page in this tab's history`);
  }
  await cdp(tabId, 'Page.navigateToHistoryEntry', { entryId: entry.id });
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
    const action = params?.action;
    if (action && params?.url) throw new Error('pass either url or action, not both');
    if (action && !['back', 'forward', 'reload'].includes(action)) {
      throw new Error(`unknown navigate action: ${action} (expected back, forward or reload)`);
    }
    if (!action && !params?.url) throw new Error('navigate needs a url, or an action of back, forward or reload');

    const url = action ? null : await resolveNavigableUrl(tabId, params.url);
    return runAction(tabId, async () => {
      if (action === 'reload') await cdp(tabId, 'Page.reload', {});
      else if (action) await stepHistory(tabId, action);
      else {
        try {
          await cdp(tabId, 'Page.navigate', { url }, { timeoutMs: NAVIGATE_COMMIT_TIMEOUT_MS });
        } catch (err) {
          // Page.navigate only answers once the navigation commits; a slow
          // server isn't a failed navigation. Let settle report where we are.
          if (!(err instanceof CdpTimeoutError)) throw err;
        }
      }
      const after = await settle(tabId);
      return { tabId, ...(action ? { action } : {}), url: after?.url ?? url, title: after?.title ?? null };
    });
  },

  async hover(params) {
    const tabId = await resolveTabId(params);
    return runAction(tabId, async () => {
      const target = await evaluateOrThrow(tabId, RESOLVE_FN_SOURCE, { ref: params?.ref, refGen: params?.refGen });
      await cdp(tabId, 'Input.dispatchMouseEvent', { type: 'mouseMoved', x: target.x, y: target.y, buttons: 0 });
      const after = await settle(tabId, 500);
      return { tabId, hovered: params?.ref, url: after?.url ?? target.url, title: after?.title ?? target.title };
    });
  },

  async select(params) {
    const tabId = await resolveTabId(params);
    return runAction(tabId, async () => {
      const res = await evaluateOrThrow(tabId, SELECT_FN_SOURCE, {
        ref: params?.ref,
        refGen: params?.refGen,
        value: params?.value,
        label: params?.label,
        values: params?.values,
      });
      return { tabId, ref: params?.ref, selected: res.selected };
    });
  },

  /**
   * Polls until a condition holds. Never fails on timeout — `met: false` is
   * an answer, and the caller decides what it means.
   */
  async wait(params) {
    const tabId = await resolveTabId(params);
    const { text, selector, urlIncludes } = params ?? {};
    if (!text && !selector && !urlIncludes) throw new Error('wait needs text, selector or urlIncludes');
    const gone = params?.gone === true;
    const requested = typeof params?.timeoutMs === 'number' ? params.timeoutMs : WAIT_DEFAULT_MS;
    const timeoutMs = Math.max(0, Math.min(WAIT_MAX_MS, requested));
    const started = Date.now();

    for (;;) {
      if (dialogs.has(tabId)) {
        return { tabId, met: false, waitedMs: Date.now() - started, dialog: dialogs.get(tabId) };
      }
      let res = null;
      try {
        const left = Math.max(MIN_POLL_EVAL_MS, timeoutMs - (Date.now() - started));
        res = await evaluateFn(tabId, WAIT_CHECK_FN_SOURCE, { text, selector }, { timeoutMs: left });
      } catch {
        res = null; // mid-navigation; try again
      }
      if (res?.error) throw new Error(res.error);
      if (res) {
        let present = (text || selector) ? res.met === true : true;
        if (urlIncludes) present = present && String(res.url || '').includes(String(urlIncludes));
        if (present !== gone) {
          return { tabId, met: true, waitedMs: Date.now() - started, url: res.url ?? null };
        }
      }
      if (Date.now() - started >= timeoutMs) {
        return { tabId, met: false, waitedMs: Date.now() - started, url: res?.url ?? null };
      }
      await sleep(WAIT_POLL_MS);
    }
  },

  /** Opens a new background tab next to a shared one, and shares it. */
  async 'tabs.open'(params) {
    const opener = await resolveTabId(params, { allowDialog: true });
    const url = checkHttpUrl(params?.url);
    const openerTab = await chrome.tabs.get(opener);
    openingFrom.set(opener, (openingFrom.get(opener) || 0) + 1);
    let created;
    try {
      created = await chrome.tabs.create({ url, openerTabId: opener, windowId: openerTab?.windowId, active: false });
      selfOpened.add(created.id);
    } finally {
      const left = (openingFrom.get(opener) || 1) - 1;
      if (left) openingFrom.set(opener, left);
      else openingFrom.delete(opener);
    }
    try {
      await attachTab({ id: created.id, url, title: created.title }, { openedBy: opener });
    } finally {
      // onCreated has fired by now; the guard is only needed until then.
      setTimeout(() => selfOpened.delete(created.id), ACTION_GRACE_MS);
    }
    return { tabId: created.id, url, openedBy: opener };
  },

  /** Closes a shared tab. Needs the id spelled out: closing is not undoable. */
  async 'tabs.close'(params) {
    if (typeof params?.tabId !== 'number') throw new Error('tabs.close needs an explicit tabId');
    const tabId = await resolveTabId(params, { allowDialog: true });
    await detachTab(tabId, { reason: 'closed-by-sai' });
    await chrome.tabs.remove(tabId);
    return { closed: tabId };
  },

  /** Accepts or dismisses the native dialog blocking a tab. */
  async dialog(params) {
    const tabId = await resolveTabId(params, { allowDialog: true });
    const d = dialogs.get(tabId);
    if (!d) throw new Error(`no dialog is open on tab ${tabId}`);
    const action = params?.action;
    // Never default to accept: a "Leave site?" accepted by mistake loses the
    // user's unsaved work.
    if (action !== 'accept' && action !== 'dismiss') {
      throw new Error(`dialog action must be accept or dismiss (got ${JSON.stringify(action)})`);
    }
    return runAction(tabId, async () => {
      let handled = action;
      try {
        await cdp(tabId, 'Page.handleJavaScriptDialog', {
          accept: action === 'accept',
          ...(typeof params?.promptText === 'string' ? { promptText: params.promptText } : {}),
        });
      } catch (err) {
        // We missed its close event (e.g. it closed while we were detached).
        if (!/no (javascript )?dialog/i.test(String(err?.message || err))) throw err;
        handled = 'none';
      }
      dialogs.delete(tabId);
      const after = await settle(tabId);
      return {
        tabId, handled, type: d.type, url: after?.url ?? null, title: after?.title ?? null,
        ...(handled === 'none' ? { note: 'the dialog had already closed' } : {}),
      };
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
  friendlyAttachError, rehydrate, dialogs, reloadForUpdate, RELOAD_HANDOFF_KEY, isForeignFrameError, sweepForeignFrames, checkHttpUrl, probeAttached, ensureConnected, cdp, abortInflight,
};
