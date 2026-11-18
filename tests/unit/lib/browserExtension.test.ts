/**
 * The browser-bridge service worker, loaded against a stubbed `chrome` so its
 * request handlers, attachment bookkeeping and recovery paths can be driven
 * directly rather than only through a real browser.
 *
 * Sharing a tab means SAI can control it: there is no read-only mode.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { makeChromeStub, loadWorker, type ChromeStub } from './chromeStub';

let stub: ChromeStub;
let mod: any;
/** CDP calls the worker made, in order. */
let cdpCalls: ChromeStub['cdp']['calls'];
/** CDP replies keyed by method: a value, or a function of the params. */
let cdpReplies: Record<string, any>;

beforeEach(async () => {
  stub = makeChromeStub();
  cdpCalls = stub.cdp.calls;
  cdpReplies = new Proxy({}, {
    set(_t, method: string, value) {
      stub.cdp.script[method] = { reply: value };
      return true;
    },
  });
  mod = await loadWorker(stub);
  mod.attached.clear();
});

afterEach(() => {
  vi.useRealTimers();
});

/** Makes Runtime.evaluate return `value` for whichever page script runs. */
function evaluateReturns(value: unknown) {
  cdpReplies['Runtime.evaluate'] = { result: { value } };
}

function share(tabId: number) {
  mod.attached.set(tabId, { url: 'https://example.test/a', title: 'A', state: 'attached' });
}

describe('sharing = control', () => {
  it('drives any attached tab', async () => {
    share(1);
    evaluateReturns({ x: 20, y: 30, editable: false, tag: 'BUTTON', url: 'https://example.test/a', title: 'A' });

    const res = await mod.handleRequest({ method: 'click', params: { ref: 'e2', refGen: 1 } });
    expect(res).toMatchObject({ tabId: 1, clicked: 'e2' });

    const mouse = cdpCalls.filter((c) => c.method === 'Input.dispatchMouseEvent');
    expect(mouse.map((c) => c.params.type)).toEqual(['mouseMoved', 'mousePressed', 'mouseReleased']);
    expect(mouse[1].params).toMatchObject({ x: 20, y: 30, button: 'left' });
  });

  it('refuses a tab that was never shared', async () => {
    await expect(mod.handleRequest({ method: 'click', params: { tabId: 99, ref: 'e1' } }))
      .rejects.toThrow(/not attached/);
  });

  it('installs no context menu', () => {
    // The stub has no chrome.contextMenus; loading the worker must not need it.
    expect(stub.chrome.contextMenus).toBeUndefined();
    expect(mod.HANDLERS).toBeDefined();
  });

  it('badge is amber with the control title', async () => {
    stub.cdp.script['Runtime.evaluate'] = { error: 'Debugger is not attached to the tab with id: 1.' };
    await stub.fire('action.onClicked', { id: 1, url: 'https://a.test', title: 'A' });
    await vi.waitFor(() => {
      expect(stub.chrome.action.setBadgeBackgroundColor).toHaveBeenLastCalledWith({ color: '#d29922' });
      expect(stub.chrome.action.setTitle).toHaveBeenLastCalledWith({
        title: '1 tab(s) shared with SAI — SAI can control them',
      });
    });
  });

  it('still reads a page', async () => {
    share(1);
    evaluateReturns({ url: 'https://example.test/a', title: 'A', text: 'hello', truncated: false });
    const res = await mod.handleRequest({ method: 'read', params: {} });
    expect(res).toMatchObject({ tabId: 1, text: 'hello' });
  });
});

describe('navigation', () => {
  beforeEach(() => share(1));
  const here = { url: 'https://a.test/x', origin: 'https://a.test', title: 'A', readyState: 'complete' };

  it('navigates to another origin', async () => {
    evaluateReturns(here);
    await mod.handleRequest({ method: 'navigate', params: { url: 'https://b.test/y' } });
    expect(cdpCalls.find((c) => c.method === 'Page.navigate')?.params.url).toBe('https://b.test/y');
  });

  it('refuses javascript:, data: and file: URLs', async () => {
    evaluateReturns(here);
    for (const url of ['javascript:alert(1)', 'data:text/html,<b>x', 'file:///etc/passwd']) {
      await expect(mod.handleRequest({ method: 'navigate', params: { url } }))
        .rejects.toThrow(/only http\(s\) is allowed/);
    }
    expect(cdpCalls.some((c) => c.method === 'Page.navigate')).toBe(false);
  });

  it('resolves a relative path against the current page', async () => {
    evaluateReturns(here);
    await mod.handleRequest({ method: 'navigate', params: { url: '/settings' } });
    expect(cdpCalls.find((c) => c.method === 'Page.navigate')?.params.url).toBe('https://a.test/settings');
  });

  it('back uses the previous history entry', async () => {
    evaluateReturns(here);
    cdpReplies['Page.getNavigationHistory'] = { currentIndex: 1, entries: [{ id: 7 }, { id: 8 }] };
    await mod.handleRequest({ method: 'navigate', params: { action: 'back' } });
    expect(cdpCalls.find((c) => c.method === 'Page.navigateToHistoryEntry')?.params).toEqual({ entryId: 7 });
  });

  it('forward uses the next history entry', async () => {
    evaluateReturns(here);
    cdpReplies['Page.getNavigationHistory'] = { currentIndex: 0, entries: [{ id: 7 }, { id: 8 }] };
    await mod.handleRequest({ method: 'navigate', params: { action: 'forward' } });
    expect(cdpCalls.find((c) => c.method === 'Page.navigateToHistoryEntry')?.params).toEqual({ entryId: 8 });
  });

  it('back at the start of history is an error', async () => {
    cdpReplies['Page.getNavigationHistory'] = { currentIndex: 0, entries: [{ id: 7 }] };
    await expect(mod.handleRequest({ method: 'navigate', params: { action: 'back' } }))
      .rejects.toThrow(/no previous page in this tab's history/);
  });

  it('reload calls Page.reload', async () => {
    evaluateReturns(here);
    await mod.handleRequest({ method: 'navigate', params: { action: 'reload' } });
    expect(cdpCalls.some((c) => c.method === 'Page.reload')).toBe(true);
  });

  it('refuses url and action together', async () => {
    await expect(mod.handleRequest({ method: 'navigate', params: { url: '/a', action: 'back' } }))
      .rejects.toThrow(/pass either url or action, not both/);
  });
});

describe('typing', () => {
  beforeEach(() => share(1));

  it('refuses to type into a non-editable element', async () => {
    evaluateReturns({ x: 1, y: 1, editable: false, tag: 'BUTTON', url: 'u', title: 't' });
    await expect(mod.handleRequest({ method: 'type', params: { ref: 'e1', text: 'hi' } }))
      .rejects.toThrow(/not a text field/);
    expect(cdpCalls.some((c) => c.method === 'Input.insertText')).toBe(false);
  });

  it('inserts text and only presses Enter when asked', async () => {
    evaluateReturns({ x: 1, y: 1, editable: true, tag: 'INPUT', url: 'u', title: 't', readyState: 'complete' });

    await mod.handleRequest({ method: 'type', params: { ref: 'e1', text: 'hello' } });
    expect(cdpCalls.find((c) => c.method === 'Input.insertText')?.params.text).toBe('hello');
    expect(cdpCalls.some((c) => c.method === 'Input.dispatchKeyEvent')).toBe(false);

    cdpCalls.length = 0;
    await mod.handleRequest({ method: 'type', params: { ref: 'e1', text: 'hi', submit: true } });
    const keys = cdpCalls.filter((c) => c.method === 'Input.dispatchKeyEvent');
    expect(keys.map((k) => k.params.type)).toEqual(['keyDown', 'keyUp']);
    expect(keys[0].params.key).toBe('Enter');
  });
});

describe('key dispatch', () => {
  beforeEach(() => share(1));

  it('rejects a key outside the supported set', async () => {
    await expect(mod.handleRequest({ method: 'press', params: { key: 'F13' } }))
      .rejects.toThrow(/unsupported key/);
  });

  it('supports the documented keys and nothing surprising', () => {
    expect(Object.keys(mod.KEYS).sort()).toEqual([
      'ArrowDown', 'ArrowLeft', 'ArrowRight', 'ArrowUp', 'Backspace', 'Delete',
      'End', 'Enter', 'Escape', 'Home', 'PageDown', 'PageUp', 'Space', 'Tab',
    ]);
  });

  /**
   * Space is the only way to toggle a focused checkbox. Without it the model
   * reaches for Enter, which does not activate a checkbox at all — on an app
   * with global shortcuts it falls through to the page behind the dialog and
   * activates something else entirely.
   */
  it('sends Space as a real space keypress, with text so the page sees it', async () => {
    await mod.handleRequest({ method: 'press', params: { key: 'Space' } });

    const keys = cdpCalls.filter((c) => c.method === 'Input.dispatchKeyEvent');
    expect(keys).toHaveLength(2);
    expect(keys[0].params).toMatchObject({
      type: 'keyDown', key: ' ', code: 'Space', text: ' ', windowsVirtualKeyCode: 32,
    });
    expect(keys[1].params).toMatchObject({ type: 'keyUp', key: ' ', code: 'Space' });
  });

  it.each([' ', 'Spacebar', 'space'])('accepts %j as Space', async (alias) => {
    await mod.handleRequest({ method: 'press', params: { key: alias } });
    const down = cdpCalls.find((c) => c.method === 'Input.dispatchKeyEvent');
    expect(down?.params).toMatchObject({ code: 'Space' });
  });

  /**
   * press is the one control action with no ref behind it, so without this the
   * caller cannot tell "toggled the checkbox" from "key went to the page
   * behind the modal" — both return success.
   */
  it('reports the focused element before and after, so a no-op press is visible', async () => {
    evaluateReturns({ focus: { tag: 'INPUT', role: 'checkbox', name: 'Skip the Inbox', checked: false } });

    const res: any = await mod.handleRequest({ method: 'press', params: { key: 'Space' } });
    expect(res.focusBefore).toMatchObject({ role: 'checkbox', checked: false });
    expect(res.focusAfter).toMatchObject({ role: 'checkbox' });
  });

  it('still presses the key when the page will not report focus', async () => {
    stub.cdp.script['Runtime.evaluate'] = { error: 'context destroyed' };

    const res: any = await mod.handleRequest({ method: 'press', params: { key: 'Escape' } });
    expect(res.focusBefore).toBeNull();
    expect(cdpCalls.some((c) => c.method === 'Input.dispatchKeyEvent')).toBe(true);
  });
});

describe('stale refs', () => {
  beforeEach(() => share(1));

  it('propagates the page-side staleness refusal instead of clicking', async () => {
    evaluateReturns({ error: 'refs are stale (page changed since snapshot 1, now 2) — re-snapshot first' });

    await expect(mod.handleRequest({ method: 'click', params: { ref: 'e1', refGen: 1 } }))
      .rejects.toThrow(/stale/);
    expect(cdpCalls.some((c) => c.method === 'Input.dispatchMouseEvent')).toBe(false);
  });
});

describe('attachment truth', () => {
  it('cdp times out with the method name', async () => {
    share(1);
    stub.cdp.script['Runtime.evaluate'] = { hang: true };
    vi.useFakeTimers();
    const p = mod.handleRequest({ method: 'read', params: {} });
    const settled = expect(p).rejects.toThrow(/CDP Runtime\.evaluate timed out after 8s on tab 1/);
    await vi.advanceTimersByTimeAsync(8000);
    await settled;
  });

  it('toolbar click on an attached-but-forgotten tab detaches it', async () => {
    // The map is empty (worker restarted) but Chrome still has our debugger on tab 3.
    await stub.fire('action.onClicked', { id: 3, url: 'https://a.test' });
    await vi.waitFor(() => expect(stub.chrome.debugger.detach).toHaveBeenCalledWith({ tabId: 3 }));
    expect(stub.chrome.debugger.attach).not.toHaveBeenCalled();
  });

  it('toolbar click on a dialog-wedged tab detaches it', async () => {
    stub.cdp.script['Runtime.evaluate'] = { hang: true };
    vi.useFakeTimers();
    const click = stub.fire('action.onClicked', { id: 3, url: 'https://a.test' });
    await vi.advanceTimersByTimeAsync(1500);
    await click;
    expect(stub.chrome.debugger.detach).toHaveBeenCalledWith({ tabId: 3 });
    expect(stub.chrome.debugger.attach).not.toHaveBeenCalled();
  });

  it('attaches when the probe says the tab is not ours', async () => {
    stub.cdp.script['Runtime.evaluate'] = { error: 'Debugger is not attached to the tab with id: 3.' };
    await stub.fire('action.onClicked', { id: 3, url: 'https://a.test' });
    await vi.waitFor(() => expect(mod.attached.has(3)).toBe(true));
    expect(stub.chrome.debugger.attach).toHaveBeenCalledWith({ tabId: 3 }, '1.3');
  });

  it('shows an attach failure on the badge and title', async () => {
    stub.cdp.script['Runtime.evaluate'] = { error: 'Debugger is not attached to the tab with id: 3.' };
    stub.chrome.debugger.attach.mockRejectedValueOnce(
      new Error('Another debugger is already attached to the tab with id: 3.'),
    );
    // A port must exist for diag frames to be posted.
    share(9);
    mod.ensureConnected();
    await stub.fire('action.onClicked', { id: 3, url: 'https://a.test' });
    await vi.waitFor(() => expect(stub.chrome.action.setBadgeText).toHaveBeenCalledWith({ tabId: 3, text: '!' }));
    expect(stub.chrome.action.setTitle).toHaveBeenCalledWith(expect.objectContaining({
      tabId: 3, title: expect.stringContaining('DevTools (or another debugger) is open'),
    }));
    expect(stub.posted).toContainEqual(expect.objectContaining({ type: 'event', event: 'diag', kind: 'attach-failed' }));
    expect(mod.attached.has(3)).toBe(false);
  });

  it('maps known attach errors to plain text', () => {
    expect(mod.friendlyAttachError('Cannot access a chrome:// URL')).toBe("Chrome doesn't allow sharing this page");
    expect(mod.friendlyAttachError('No tab with given id 4.')).toBe('That tab is gone');
    expect(mod.friendlyAttachError('weird')).toBe('weird');
  });

  it('rehydrate adopts tabs missing from storage', async () => {
    stub.chrome.debugger.getTargets = vi.fn((cb: any) => cb([{ tabId: 5, attached: true, url: 'u', title: 't' }]));
    await mod.rehydrate();
    expect(mod.attached.has(5)).toBe(true);
  });

  it('rehydrate ignores attached targets that are not ours', async () => {
    stub.chrome.debugger.getTargets = vi.fn((cb: any) => cb([{ tabId: 5, attached: true }]));
    stub.cdp.script['Runtime.evaluate'] = { error: 'Debugger is not attached to the tab with id: 5.' };
    await mod.rehydrate();
    expect(mod.attached.has(5)).toBe(false);
  });
});

describe('auto re-attach after a foreign-extension frame', () => {
  const NOT_ALLOWED = 'Cannot access a chrome-extension:// URL of different extension';

  beforeEach(() => {
    share(1);
    mod.ensureConnected();
    vi.useFakeTimers();
  });

  it('keeps the tab and re-attaches once Chrome allows it', async () => {
    stub.chrome.debugger.attach.mockRejectedValueOnce(new Error(NOT_ALLOWED));
    await stub.fire('debugger.onDetach', { tabId: 1 }, 'target_closed');

    expect(mod.attached.get(1)?.state).toBe('reattaching');
    expect(stub.posted).toContainEqual(expect.objectContaining({ event: 'reattaching', tabId: 1 }));

    await vi.advanceTimersByTimeAsync(250 + 500);
    expect(stub.chrome.debugger.attach).toHaveBeenCalledTimes(2);
    expect(mod.attached.get(1)?.state).toBe('attached');
    expect(stub.cdp.calls.some((c) => c.method === 'Page.enable' && c.tabId === 1)).toBe(true);
    expect(stub.posted).toContainEqual(expect.objectContaining({ event: 'reattached', tabId: 1 }));
  });

  it('a call during re-attach waits, then succeeds', async () => {
    stub.chrome.debugger.attach.mockRejectedValueOnce(new Error(NOT_ALLOWED));
    evaluateReturns({ url: 'u', title: 't', text: 'back', truncated: false });
    await stub.fire('debugger.onDetach', { tabId: 1 }, 'target_closed');

    const read = mod.handleRequest({ method: 'read', params: {} });
    await vi.advanceTimersByTimeAsync(750);
    await expect(read).resolves.toMatchObject({ tabId: 1, text: 'back' });
  });

  it('a call during a long re-attach fails with the password-manager message', async () => {
    stub.chrome.debugger.attach.mockRejectedValue(new Error(NOT_ALLOWED));
    await stub.fire('debugger.onDetach', { tabId: 1 }, 'target_closed');

    const read = mod.handleRequest({ method: 'read', params: {} });
    const settled = expect(read).rejects.toThrow(/likely a password manager's autofill menu/);
    await vi.advanceTimersByTimeAsync(3000);
    await settled;
  });

  it('gives up after 2 minutes', async () => {
    stub.chrome.debugger.attach.mockRejectedValue(new Error(NOT_ALLOWED));
    await stub.fire('debugger.onDetach', { tabId: 1 }, 'target_closed');
    await vi.advanceTimersByTimeAsync(125_000);
    expect(mod.attached.has(1)).toBe(false);
    expect(stub.posted).toContainEqual(expect.objectContaining({ event: 'detached', tabId: 1, reason: 'reattach-timeout' }));
  });

  it('canceled_by_user drops the tab immediately', async () => {
    await stub.fire('debugger.onDetach', { tabId: 1 }, 'canceled_by_user');
    await vi.advanceTimersByTimeAsync(0);
    expect(mod.attached.has(1)).toBe(false);
    await vi.advanceTimersByTimeAsync(10_000);
    expect(stub.chrome.debugger.attach).not.toHaveBeenCalled();
  });

  it('a closed tab is dropped, not re-attached', async () => {
    await stub.fire('debugger.onDetach', { tabId: 1 }, 'target_closed');
    await stub.fire('tabs.onRemoved', 1, {});
    await vi.advanceTimersByTimeAsync(10_000);
    expect(mod.attached.has(1)).toBe(false);
    expect(stub.chrome.debugger.attach).not.toHaveBeenCalled();
  });

  it('a second detach during re-attach does not stack timers', async () => {
    await stub.fire('debugger.onDetach', { tabId: 1 }, 'target_closed');
    await vi.advanceTimersByTimeAsync(250);
    expect(mod.attached.get(1)?.state).toBe('attached');

    stub.chrome.debugger.attach.mockRejectedValue(new Error(NOT_ALLOWED));
    await stub.fire('debugger.onDetach', { tabId: 1 }, 'target_closed');
    await stub.fire('debugger.onDetach', { tabId: 1 }, 'target_closed');
    expect(vi.getTimerCount()).toBe(1);
    const before = stub.chrome.debugger.attach.mock.calls.length;
    await vi.advanceTimersByTimeAsync(250);
    expect(stub.chrome.debugger.attach.mock.calls.length).toBe(before + 1);
  });

  it('toolbar click on a reattaching tab cancels and detaches', async () => {
    stub.chrome.debugger.attach.mockRejectedValue(new Error(NOT_ALLOWED));
    await stub.fire('debugger.onDetach', { tabId: 1 }, 'target_closed');
    await stub.fire('action.onClicked', { id: 1, url: 'https://a.test' });
    expect(mod.attached.has(1)).toBe(false);
    const calls = stub.chrome.debugger.attach.mock.calls.length;
    await vi.advanceTimersByTimeAsync(10_000);
    expect(stub.chrome.debugger.attach.mock.calls.length).toBe(calls);
  });

  it('port drop reconnects without waiting for the alarm', async () => {
    expect(stub.chrome.runtime.connectNative).toHaveBeenCalledTimes(1);
    await stub.fire('port.onDisconnect');
    await vi.advanceTimersByTimeAsync(500);
    expect(stub.chrome.runtime.connectNative).toHaveBeenCalledTimes(2);
  });
});

describe('foreign-extension frame guard', () => {
  const NOT_ALLOWED = 'Cannot access a chrome-extension:// URL of different extension';
  const guardCalls = () => cdpCalls.filter((c) =>
    (c.method === 'Page.addScriptToEvaluateOnNewDocument' && /__saiFrameGuard/.test(c.params.source)) ||
    (c.method === 'Runtime.evaluate' && /__saiFrameGuard/.test(c.params.expression)));

  // The toolbar probe must read the tab as not-yet-ours.
  const unshared = () => {
    stub.cdp.script['Runtime.evaluate'] = { error: 'Debugger is not attached to the tab with id: 1.' };
  };

  it('installs the guard on share, for this page and the next ones', async () => {
    unshared();
    await stub.fire('action.onClicked', { id: 1, url: 'https://a.test', title: 'A' });
    await vi.waitFor(() => expect(mod.attached.has(1)).toBe(true));
    const calls = guardCalls();
    expect(calls.map((c) => c.method)).toEqual(['Page.addScriptToEvaluateOnNewDocument', 'Runtime.evaluate']);
    // Our own extension's frames are exempt.
    expect(calls[0].params.source).toContain('saiselfextensionid');
  });

  it('a page already holding a password-manager frame is swept, then shared', async () => {
    unshared();
    stub.chrome.debugger.attach.mockRejectedValueOnce(new Error(NOT_ALLOWED));
    stub.chrome.scripting.executeScript.mockResolvedValueOnce([{ frameId: 0, result: { removed: 1 } }]);
    await stub.fire('action.onClicked', { id: 1, url: 'https://a.test', title: 'A' });
    await vi.waitFor(() => expect(mod.attached.has(1)).toBe(true));
    expect(stub.chrome.scripting.executeScript).toHaveBeenCalledWith(
      expect.objectContaining({ target: { tabId: 1, allFrames: true }, args: [{ selfId: 'saiselfextensionid' }] }),
    );
  });

  it('a share that a sweep cannot fix still fails', async () => {
    unshared();
    stub.chrome.debugger.attach.mockRejectedValueOnce(new Error(NOT_ALLOWED));
    await stub.fire('action.onClicked', { id: 1, url: 'https://a.test', title: 'A' });
    expect(mod.attached.has(1)).toBe(false);
    expect(stub.chrome.debugger.attach).toHaveBeenCalledTimes(1);
  });

  describe('during re-attach', () => {
    beforeEach(() => {
      share(1);
      mod.ensureConnected();
      vi.useFakeTimers();
    });

    it('sweeps the blocking frame and retries at once instead of backing off', async () => {
      stub.chrome.debugger.attach.mockRejectedValueOnce(new Error(NOT_ALLOWED));
      stub.chrome.scripting.executeScript.mockResolvedValueOnce([{ frameId: 0, result: { removed: 1 } }]);
      await stub.fire('debugger.onDetach', { tabId: 1 }, 'target_closed');
      await vi.advanceTimersByTimeAsync(250 + 100);
      expect(stub.chrome.debugger.attach).toHaveBeenCalledTimes(2);
      expect(mod.attached.get(1)?.state).toBe('attached');
      expect(guardCalls().length).toBeGreaterThan(0);
    });

    it('falls back to the normal backoff when nothing was swept', async () => {
      stub.chrome.debugger.attach.mockRejectedValueOnce(new Error(NOT_ALLOWED));
      await stub.fire('debugger.onDetach', { tabId: 1 }, 'target_closed');
      await vi.advanceTimersByTimeAsync(250 + 100);
      expect(stub.chrome.debugger.attach).toHaveBeenCalledTimes(1);
      await vi.advanceTimersByTimeAsync(400);
      expect(stub.chrome.debugger.attach).toHaveBeenCalledTimes(2);
    });

    it('a sweep that throws is survived', async () => {
      stub.chrome.debugger.attach.mockRejectedValueOnce(new Error(NOT_ALLOWED));
      stub.chrome.scripting.executeScript.mockRejectedValue(new Error('Cannot access contents of the page'));
      await stub.fire('debugger.onDetach', { tabId: 1 }, 'target_closed');
      await vi.advanceTimersByTimeAsync(250 + 500);
      expect(mod.attached.get(1)?.state).toBe('attached');
    });
  });
});

describe('dialogs', () => {
  const openDialog = (type = 'beforeunload', message = '') =>
    stub.fire('debugger.onEvent', { tabId: 1 }, 'Page.javascriptDialogOpening', {
      type, message, url: 'https://example.test/a', defaultPrompt: '',
    });

  beforeEach(() => share(1));

  it('blocks calls while a dialog is open, without touching the page', async () => {
    await openDialog('beforeunload');
    await expect(mod.handleRequest({ method: 'read', params: {} }))
      .rejects.toThrow(/a beforeunload dialog is open on tab 1: "" — call sai_browser_dialog/);
    expect(cdpCalls.some((c) => c.method === 'Runtime.evaluate')).toBe(false);
  });

  it('an action that opens a dialog returns it promptly', async () => {
    stub.cdp.script['Page.navigate'] = { hang: true };
    evaluateReturns({ url: 'https://example.test/a', origin: 'https://example.test', readyState: 'complete' });
    vi.useFakeTimers();
    const nav = mod.handleRequest({ method: 'navigate', params: { url: '/b' } });
    await vi.advanceTimersByTimeAsync(100);
    await openDialog('beforeunload', 'Leave site?');
    await vi.advanceTimersByTimeAsync(10);
    await expect(nav).resolves.toMatchObject({ tabId: 1, dialog: { type: 'beforeunload', message: 'Leave site?' } });
  });

  it('reports a dialog that was already open when the tab was shared', async () => {
    mod.attached.clear();
    stub.cdp.script['Runtime.evaluate'] = { error: 'Debugger is not attached to the tab with id: 1.' };
    stub.cdp.script['Page.enable'] = {
      reply: () => {
        // Chrome replays an open dialog as soon as Page is enabled.
        void stub.fire('debugger.onEvent', { tabId: 1 }, 'Page.javascriptDialogOpening', {
          type: 'alert', message: 'hi', url: 'u',
        });
        return {};
      },
    };
    await stub.fire('action.onClicked', { id: 1, url: 'https://a.test' });
    await vi.waitFor(() => expect(mod.attached.has(1)).toBe(true));
    await expect(mod.handleRequest({ method: 'click', params: { ref: 'e1' } }))
      .rejects.toThrow(/an? alert dialog is open on tab 1: "hi"/);
  });

  it('accepts a dialog and reports where the tab ended up', async () => {
    await openDialog('beforeunload');
    evaluateReturns({ url: 'https://example.test/b', title: 'B', readyState: 'complete' });
    const res = await mod.handleRequest({ method: 'dialog', params: { action: 'accept' } });
    expect(cdpCalls.find((c) => c.method === 'Page.handleJavaScriptDialog')?.params).toEqual({ accept: true });
    expect(res).toMatchObject({ tabId: 1, handled: 'accept', type: 'beforeunload', url: 'https://example.test/b' });
    expect(mod.dialogs.has(1)).toBe(false);
  });

  it('dismisses a prompt, passing promptText through', async () => {
    await openDialog('prompt', 'Name?');
    evaluateReturns({ url: 'u', title: 't', readyState: 'complete' });
    await mod.handleRequest({ method: 'dialog', params: { action: 'dismiss', promptText: 'x' } });
    expect(cdpCalls.find((c) => c.method === 'Page.handleJavaScriptDialog')?.params)
      .toEqual({ accept: false, promptText: 'x' });
  });

  it('dialog with nothing open is an error', async () => {
    await expect(mod.handleRequest({ method: 'dialog', params: { action: 'accept' } }))
      .rejects.toThrow(/no dialog is open on tab 1/);
  });

  it('closing clears the dialog', async () => {
    await openDialog('alert', 'x');
    await stub.fire('debugger.onEvent', { tabId: 1 }, 'Page.javascriptDialogClosed', { result: true });
    expect(mod.dialogs.has(1)).toBe(false);
  });

  it('snapshot reports the dialog without evaluating', async () => {
    await openDialog('confirm', 'Sure?');
    const res = await mod.handleRequest({ method: 'snapshot', params: {} });
    expect(res).toMatchObject({ tabId: 1, dialog: { type: 'confirm', message: 'Sure?' }, elements: [] });
    expect(res.note).toMatch(/sai_browser_dialog/);
    expect(cdpCalls).toHaveLength(0);
  });

  it('tabs.list shows the open dialog', async () => {
    await openDialog('alert', 'x');
    const res = await mod.handleRequest({ method: 'tabs.list', params: {} });
    expect(res.tabs[0]).toMatchObject({ tabId: 1, dialog: { type: 'alert' } });
  });
});

describe('hover, select, wait', () => {
  beforeEach(() => share(1));

  it('hover sends exactly one mouseMoved at the ref centre', async () => {
    evaluateReturns({ x: 40, y: 50, tag: 'A', url: 'u', title: 't', readyState: 'complete' });
    const res = await mod.handleRequest({ method: 'hover', params: { ref: 'e3', refGen: 1 } });
    const mouse = cdpCalls.filter((c) => c.method === 'Input.dispatchMouseEvent');
    expect(mouse).toHaveLength(1);
    expect(mouse[0].params).toMatchObject({ type: 'mouseMoved', x: 40, y: 50 });
    expect(res).toMatchObject({ tabId: 1, hovered: 'e3' });
  });

  it('select returns what the page selected', async () => {
    evaluateReturns({ selected: [{ value: 'b', label: 'Banana' }] });
    const res = await mod.handleRequest({ method: 'select', params: { ref: 'e2', value: 'b' } });
    expect(res).toEqual({ tabId: 1, ref: 'e2', selected: [{ value: 'b', label: 'Banana' }] });
  });

  it('select surfaces the page error', async () => {
    evaluateReturns({ error: 'no option matching "z" — options: A' });
    await expect(mod.handleRequest({ method: 'select', params: { ref: 'e2', value: 'z' } }))
      .rejects.toThrow(/no option matching/);
  });

  it('wait resolves met once the text appears on the 3rd poll', async () => {
    let n = 0;
    cdpReplies['Runtime.evaluate'] = () => ({ result: { value: { met: ++n >= 3, url: 'u' } } });
    vi.useFakeTimers();
    const p = mod.handleRequest({ method: 'wait', params: { text: 'Done' } });
    await vi.advanceTimersByTimeAsync(1000);
    await expect(p).resolves.toMatchObject({ tabId: 1, met: true });
    expect(n).toBe(3);
  });

  it('wait caps timeoutMs at 15000 and reports met:false instead of failing', async () => {
    evaluateReturns({ met: false, url: 'u' });
    vi.useFakeTimers();
    const p = mod.handleRequest({ method: 'wait', params: { text: 'Never', timeoutMs: 60_000 } });
    await vi.advanceTimersByTimeAsync(15_500);
    const res = await p;
    expect(res).toMatchObject({ met: false });
    expect(res.waitedMs).toBeGreaterThanOrEqual(15_000);
    expect(res.waitedMs).toBeLessThan(16_000);
  });

  it('wait with gone:true is met when the text disappears', async () => {
    let n = 0;
    cdpReplies['Runtime.evaluate'] = () => ({ result: { value: { met: ++n < 2, url: 'u' } } });
    vi.useFakeTimers();
    const p = mod.handleRequest({ method: 'wait', params: { text: 'Loading', gone: true } });
    await vi.advanceTimersByTimeAsync(1000);
    await expect(p).resolves.toMatchObject({ met: true });
  });

  it('wait on urlIncludes checks the page URL', async () => {
    evaluateReturns({ met: false, url: 'https://a.test/done?x=1' });
    const res = await mod.handleRequest({ method: 'wait', params: { urlIncludes: '/done' } });
    expect(res).toMatchObject({ met: true });
  });

  it('wait with nothing to wait for is an error', async () => {
    await expect(mod.handleRequest({ method: 'wait', params: {} }))
      .rejects.toThrow('wait needs text, selector or urlIncludes');
  });
});

describe('key combos', () => {
  beforeEach(() => share(1));

  it('sends the modifier bitmask on both key events', async () => {
    await mod.handleRequest({ method: 'press', params: { key: 'Control+a' } });
    const keys = cdpCalls.filter((c) => c.method === 'Input.dispatchKeyEvent');
    expect(keys).toHaveLength(2);
    expect(keys[0].params).toMatchObject({ type: 'rawKeyDown', key: 'a', modifiers: 2 });
    expect(keys[1].params).toMatchObject({ type: 'keyUp', key: 'a', modifiers: 2 });
  });
});

describe('child tabs and tab management', () => {
  const button = { x: 5, y: 5, editable: false, tag: 'A', url: 'https://a.test/', title: 'A', readyState: 'complete' };

  beforeEach(() => share(1));

  /** Makes the click's mouse release open a new tab, like a target=_blank link. */
  function clickOpensTab(id: number) {
    stub.cdp.script['Input.dispatchMouseEvent'] = {
      reply: (params: any) => {
        if (params.type === 'mouseReleased') void stub.fire('tabs.onCreated', { id, openerTabId: 1 });
        return {};
      },
    };
  }

  it('a tab opened during a click is shared and reported', async () => {
    evaluateReturns(button);
    clickOpensTab(9);
    const res = await mod.handleRequest({ method: 'click', params: { ref: 'e1' } });
    expect(res.openedTabs).toEqual([9]);
    await vi.waitFor(() => expect(mod.attached.has(9)).toBe(true));
  });

  it('announces the child with openedBy', async () => {
    mod.ensureConnected();
    evaluateReturns(button);
    clickOpensTab(9);
    await mod.handleRequest({ method: 'click', params: { ref: 'e1' } });
    await vi.waitFor(() =>
      expect(stub.posted).toContainEqual(expect.objectContaining({ event: 'attached', tabId: 9, openedBy: 1 })));
  });

  it('a tab opened within 3s after an action is shared', async () => {
    evaluateReturns(button);
    vi.useFakeTimers();
    const click = mod.handleRequest({ method: 'click', params: { ref: 'e1' } });
    await vi.advanceTimersByTimeAsync(10);
    await click;
    await vi.advanceTimersByTimeAsync(2000);
    await stub.fire('tabs.onCreated', { id: 10, openerTabId: 1 });
    await vi.advanceTimersByTimeAsync(10);
    expect(mod.attached.has(10)).toBe(true);
  });

  it('a tab the user opens while SAI is idle stays unshared', async () => {
    evaluateReturns(button);
    vi.useFakeTimers();
    const click = mod.handleRequest({ method: 'click', params: { ref: 'e1' } });
    await vi.advanceTimersByTimeAsync(10);
    await click;
    await vi.advanceTimersByTimeAsync(3001);
    await stub.fire('tabs.onCreated', { id: 11, openerTabId: 1 });
    await vi.advanceTimersByTimeAsync(1000);
    expect(mod.attached.has(11)).toBe(false);
    expect(stub.chrome.debugger.attach).not.toHaveBeenCalled();
  });

  it('a child of an unshared tab is ignored', async () => {
    await stub.fire('tabs.onCreated', { id: 12, openerTabId: 77 });
    expect(stub.chrome.debugger.attach).not.toHaveBeenCalled();
  });

  it('open_tab creates a background tab in the opener window and shares it', async () => {
    stub.chrome.tabs.get.mockResolvedValueOnce({ id: 1, windowId: 4 });
    const res = await mod.handleRequest({ method: 'tabs.open', params: { url: 'https://b.test/' } });
    expect(stub.chrome.tabs.create).toHaveBeenCalledWith({
      url: 'https://b.test/', openerTabId: 1, windowId: 4, active: false,
    });
    expect(res).toMatchObject({ tabId: 100, url: 'https://b.test/', openedBy: 1 });
    expect(mod.attached.has(100)).toBe(true);
    // The onCreated that follows must not attach it a second time.
    await stub.fire('tabs.onCreated', { id: 100, openerTabId: 1 });
    expect(stub.chrome.debugger.attach).toHaveBeenCalledTimes(1);
  });

  it('open_tab right after an action attaches the new tab exactly once', async () => {
    // Real Chrome fires onCreated before tabs.create resolves.
    evaluateReturns(button);
    await mod.handleRequest({ method: 'click', params: { ref: 'e1' } });
    stub.chrome.tabs.create.mockImplementationOnce(async (props: any) => {
      await stub.fire('tabs.onCreated', { id: 101, openerTabId: 1 });
      return { id: 101, ...props };
    });
    const res = await mod.handleRequest({ method: 'tabs.open', params: { url: 'https://b.test/' } });
    expect(res.tabId).toBe(101);
    await new Promise((r) => setTimeout(r, 20));
    expect(stub.chrome.debugger.attach).toHaveBeenCalledTimes(1);
  });

  it('open_tab refuses non-http URLs', async () => {
    await expect(mod.handleRequest({ method: 'tabs.open', params: { url: 'file:///etc/passwd' } }))
      .rejects.toThrow(/only http\(s\) is allowed/);
    expect(stub.chrome.tabs.create).not.toHaveBeenCalled();
  });

  it('close_tab needs an explicit tabId and only closes shared tabs', async () => {
    await expect(mod.handleRequest({ method: 'tabs.close', params: {} }))
      .rejects.toThrow('tabs.close needs an explicit tabId');
    await expect(mod.handleRequest({ method: 'tabs.close', params: { tabId: 50 } }))
      .rejects.toThrow(/not attached/);
    const res = await mod.handleRequest({ method: 'tabs.close', params: { tabId: 1 } });
    expect(stub.chrome.tabs.remove).toHaveBeenCalledWith(1);
    expect(res).toEqual({ closed: 1 });
    expect(mod.attached.has(1)).toBe(false);
  });
});

describe('final review fixes', () => {
  beforeEach(() => share(1));

  it('a toolbar click during an in-flight re-attach leaves the tab detached', async () => {
    let finishAttach!: () => void;
    stub.chrome.debugger.attach.mockImplementationOnce(() => new Promise<void>((r) => { finishAttach = r; }));
    vi.useFakeTimers();
    await stub.fire('debugger.onDetach', { tabId: 1 }, 'target_closed');
    await vi.advanceTimersByTimeAsync(250); // attempt starts, attach pending
    await stub.fire('action.onClicked', { id: 1, url: 'https://a.test' });
    stub.chrome.debugger.detach.mockClear();
    finishAttach();
    await vi.advanceTimersByTimeAsync(0);
    expect(stub.chrome.debugger.detach).toHaveBeenCalledWith({ tabId: 1 });
    expect(mod.attached.has(1)).toBe(false);
  });

  it('closing the last shared tab still answers the request', async () => {
    mod.ensureConnected();
    await stub.fire('port.onMessage', { type: 'request', id: 'r1', method: 'tabs.close', params: { tabId: 1 } });
    await vi.waitFor(() =>
      expect(stub.posted).toContainEqual({ type: 'response', id: 'r1', ok: true, result: { closed: 1 } }));
  });

  it('a dialog Chrome says is already gone is cleared, not stuck', async () => {
    await stub.fire('debugger.onEvent', { tabId: 1 }, 'Page.javascriptDialogOpening', { type: 'alert', message: 'x' });
    stub.cdp.script['Page.handleJavaScriptDialog'] = { error: 'No dialog is showing' };
    evaluateReturns({ url: 'u', title: 't', readyState: 'complete' });
    const res = await mod.handleRequest({ method: 'dialog', params: { action: 'accept' } });
    expect(res).toMatchObject({ tabId: 1, handled: 'none' });
    expect(mod.dialogs.has(1)).toBe(false);
  });

  it('re-attach forgets a dialog that may have closed while detached', async () => {
    await stub.fire('debugger.onEvent', { tabId: 1 }, 'Page.javascriptDialogOpening', { type: 'alert', message: 'x' });
    vi.useFakeTimers();
    await stub.fire('debugger.onDetach', { tabId: 1 }, 'target_closed');
    await vi.advanceTimersByTimeAsync(250);
    expect(mod.attached.get(1)?.state).toBe('attached');
    expect(mod.dialogs.has(1)).toBe(false);
  });

  it('rehydrate re-enables Page so an open dialog is replayed', async () => {
    mod.attached.clear();
    stub.chrome.debugger.getTargets = vi.fn((cb: any) => cb([{ tabId: 5, attached: true }]));
    stub.cdp.script['Page.enable'] = {
      reply: () => {
        void stub.fire('debugger.onEvent', { tabId: 5 }, 'Page.javascriptDialogOpening', { type: 'alert', message: 'hi' });
        return {};
      },
    };
    await mod.rehydrate();
    expect(mod.attached.has(5)).toBe(true);
    expect(mod.dialogs.get(5)).toMatchObject({ type: 'alert' });
  });

  it('dialog refuses an unknown action instead of accepting', async () => {
    await stub.fire('debugger.onEvent', { tabId: 1 }, 'Page.javascriptDialogOpening', { type: 'beforeunload', message: '' });
    for (const action of [undefined, 'cancel', 'stay']) {
      await expect(mod.handleRequest({ method: 'dialog', params: { action } }))
        .rejects.toThrow(/action must be accept or dismiss/);
    }
    expect(cdpCalls.some((c) => c.method === 'Page.handleJavaScriptDialog')).toBe(false);
  });

  it('navigate finishes inside the 20s SAI budget when the page never answers', async () => {
    stub.cdp.script['Runtime.evaluate'] = { hang: true };
    stub.cdp.script['Page.navigate'] = { hang: true };
    vi.useFakeTimers();
    let settled: any = 'pending';
    mod.handleRequest({ method: 'navigate', params: { url: 'https://b.test/' } })
      .then((r: any) => { settled = r; }, (e: any) => { settled = e; });
    await vi.advanceTimersByTimeAsync(17_000);
    expect(settled).toMatchObject({ tabId: 1, url: 'https://b.test/' });
  });

  it('wait finishes inside the budget even when polls hang', async () => {
    stub.cdp.script['Runtime.evaluate'] = { hang: true };
    vi.useFakeTimers();
    let settled: any = 'pending';
    mod.handleRequest({ method: 'wait', params: { text: 'x', timeoutMs: 15_000 } })
      .then((r: any) => { settled = r; }, (e: any) => { settled = e; });
    await vi.advanceTimersByTimeAsync(16_000);
    expect(settled).toMatchObject({ met: false });
  });
});

describe('self-update', () => {
  it('reloads on SAI\'s request, handing the shared tabs to the next version', async () => {
    share(4);
    share(7);
    mod.ensureConnected();
    await stub.fire('port.onMessage', { type: 'reload', version: '0.7.0' });
    await vi.waitFor(() => expect(stub.chrome.runtime.reload).toHaveBeenCalledTimes(1));
    const handoff = stub.chrome.storage.local.data[mod.RELOAD_HANDOFF_KEY];
    expect(handoff).toMatchObject({ tabIds: [4, 7], from: '0.6.0' });
    expect(stub.posted).toContainEqual(expect.objectContaining({ kind: 'self-reload', from: '0.6.0', to: '0.7.0', tabs: 2 }));
  });

  it('waits for in-flight requests before reloading', async () => {
    share(1);
    stub.cdp.script['Runtime.evaluate'] = { hang: true };
    mod.ensureConnected();
    await stub.fire('port.onMessage', { type: 'request', id: 'r1', method: 'read', params: { tabId: 1 } });
    await stub.fire('port.onMessage', { type: 'reload', version: '0.7.0' });
    await new Promise((r) => setTimeout(r, 150));
    expect(stub.chrome.runtime.reload).not.toHaveBeenCalled();
  });

  it('shares the handed-over tabs again after the reload, once', async () => {
    const next = makeChromeStub();
    next.chrome.storage.local.data.reloadHandoff = { tabIds: [4, 7], from: '0.5.0', at: Date.now() };
    const worker = await loadWorker(next);
    // onInstalled fires too after a reload; it must not share the tabs twice.
    await next.fire('runtime.onInstalled', {});
    await vi.waitFor(() => expect(worker.attached.size).toBe(2));
    expect(next.chrome.debugger.attach).toHaveBeenCalledTimes(2);
    expect(next.chrome.debugger.attach).toHaveBeenCalledWith({ tabId: 4 }, '1.3');
    expect(next.chrome.debugger.attach).toHaveBeenCalledWith({ tabId: 7 }, '1.3');
    expect(next.chrome.storage.local.data.reloadHandoff).toBeUndefined();
    await vi.waitFor(() => expect(next.posted).toContainEqual(
      expect.objectContaining({ kind: 'updated', from: '0.5.0', to: '0.6.0', resumed: 2 }),
    ));
  });

  it('ignores a stale handoff', async () => {
    const next = makeChromeStub();
    next.chrome.storage.local.data.reloadHandoff = { tabIds: [4], from: '0.5.0', at: Date.now() - 10 * 60_000 };
    const worker = await loadWorker(next);
    await new Promise((r) => setTimeout(r, 20));
    expect(worker.attached.size).toBe(0);
    expect(next.chrome.debugger.attach).not.toHaveBeenCalled();
    expect(next.chrome.storage.local.data.reloadHandoff).toBeUndefined();
  });

  it('keeps going when a handed-over tab has since closed', async () => {
    const next = makeChromeStub();
    next.chrome.storage.local.data.reloadHandoff = { tabIds: [4, 9], from: '0.5.0', at: Date.now() };
    next.chrome.tabs.get.mockImplementation(async (id: number) => {
      if (id === 9) throw new Error('No tab with id: 9.');
      return { id, windowId: 1 };
    });
    const worker = await loadWorker(next);
    await vi.waitFor(() => expect(worker.attached.size).toBe(1));
    expect(worker.attached.has(4)).toBe(true);
  });
});
