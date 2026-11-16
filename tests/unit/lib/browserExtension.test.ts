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
