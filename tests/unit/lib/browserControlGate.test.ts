/**
 * The control gate is the security boundary of the whole browser-control
 * feature: it is the single thing standing between "the user shared a tab so
 * SAI could read it" and "SAI typed into their bank".
 *
 * The service worker is loaded here against a stubbed `chrome` so the gate can
 * be exercised directly, rather than only through a real browser.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';

type Listener = (...args: any[]) => void;

function stubChrome() {
  const listeners: Record<string, Listener[]> = {};
  const on = () => ({ addListener: (fn: Listener) => void fn });

  const chrome = {
    runtime: {
      connectNative: vi.fn(() => ({
        onMessage: on(),
        onDisconnect: on(),
        postMessage: vi.fn(),
        disconnect: vi.fn(),
      })),
      getManifest: () => ({ version: '0.2.0' }),
      onStartup: on(),
      onInstalled: on(),
      lastError: undefined as undefined | { message: string },
    },
    storage: { session: { get: vi.fn(async () => ({})), set: vi.fn(async () => undefined) } },
    action: {
      setBadgeText: vi.fn(async () => undefined),
      setBadgeBackgroundColor: vi.fn(async () => undefined),
      setTitle: vi.fn(async () => undefined),
      onClicked: on(),
    },
    alarms: { create: vi.fn(async () => undefined), clear: vi.fn(async () => undefined), onAlarm: on() },
    contextMenus: {
      removeAll: vi.fn(async () => undefined),
      create: vi.fn(),
      update: vi.fn(async () => undefined),
      onClicked: on(),
    },
    tabs: { onActivated: on() },
    debugger: {
      attach: vi.fn(async () => undefined),
      detach: vi.fn(async () => undefined),
      getTargets: vi.fn((cb: Listener) => cb([])),
      sendCommand: vi.fn(),
      onDetach: on(),
    },
    _listeners: listeners,
  };
  return chrome;
}

let chromeStub: ReturnType<typeof stubChrome>;
let mod: any;

/** CDP replies, keyed by the method the worker sends. */
let cdpReplies: Record<string, any>;
let cdpCalls: Array<{ method: string; params: any }>;

beforeEach(async () => {
  vi.resetModules();
  chromeStub = stubChrome();
  cdpCalls = [];
  cdpReplies = {};

  chromeStub.debugger.sendCommand = vi.fn(
    (_target: any, method: string, params: any, cb: Listener) => {
      cdpCalls.push({ method, params });
      // Runtime.evaluate carries a page-script result; everything else (the
      // Input domain) just acknowledges.
      const reply = Object.prototype.hasOwnProperty.call(cdpReplies, method)
        ? cdpReplies[method]
        : {};
      cb(typeof reply === 'function' ? reply(params) : reply);
    },
  ) as any;

  (globalThis as any).chrome = chromeStub;
  mod = await import('../../../extension/chrome/background.js');
  mod.attached.clear();
});

/** Makes Runtime.evaluate return `value` for whichever page script runs. */
function evaluateReturns(value: unknown) {
  cdpReplies['Runtime.evaluate'] = { result: { value } };
}

function share(tabId: number, control: boolean) {
  mod.attached.set(tabId, { url: 'https://example.test/a', title: 'A', control });
}

const CONTROL_METHODS = ['click', 'type', 'press', 'scroll', 'navigate'];

describe('control gate', () => {
  it('refuses every control method on a read-only tab', async () => {
    share(1, false);
    evaluateReturns({ x: 5, y: 5, editable: true, tag: 'INPUT', url: 'https://example.test/a' });

    for (const method of CONTROL_METHODS) {
      await expect(
        mod.handleRequest({ method, params: { ref: 'e1', text: 'x', key: 'Enter', url: '/b' } }),
        `${method} should be refused`,
      ).rejects.toThrow(/shared read-only/);
    }
  });

  it('names the exact menu item so the user can act on the refusal', async () => {
    share(1, false);
    await expect(mod.handleRequest({ method: 'click', params: { ref: 'e1' } }))
      .rejects.toThrow(/Let SAI control this tab/);
  });

  it('dispatches no CDP command at all when refused', async () => {
    share(1, false);
    await expect(mod.handleRequest({ method: 'click', params: { ref: 'e1' } })).rejects.toThrow();
    // The gate must come before anything touches the page.
    expect(cdpCalls).toHaveLength(0);
  });

  it('still allows read methods on a read-only tab', async () => {
    share(1, false);
    evaluateReturns({ url: 'https://example.test/a', title: 'A', text: 'hello', truncated: false });

    const res = await mod.handleRequest({ method: 'read', params: {} });
    expect(res).toMatchObject({ tabId: 1, text: 'hello' });
  });

  it('allows control once the tab is granted it', async () => {
    share(1, true);
    evaluateReturns({ x: 20, y: 30, editable: false, tag: 'BUTTON', url: 'https://example.test/a', title: 'A' });

    const res = await mod.handleRequest({ method: 'click', params: { ref: 'e2', refGen: 1 } });
    expect(res).toMatchObject({ tabId: 1, clicked: 'e2' });

    const mouse = cdpCalls.filter((c) => c.method === 'Input.dispatchMouseEvent');
    expect(mouse.map((c) => c.params.type)).toEqual(['mouseMoved', 'mousePressed', 'mouseReleased']);
    expect(mouse[1].params).toMatchObject({ x: 20, y: 30, button: 'left' });
  });

  it('refuses control on a tab that was never shared', async () => {
    await expect(mod.handleRequest({ method: 'click', params: { tabId: 99, ref: 'e1' } }))
      .rejects.toThrow(/not attached/);
  });
});

describe('same-origin navigation', () => {
  beforeEach(() => share(1, true));

  it('refuses a different origin', async () => {
    evaluateReturns({ url: 'https://a.test/x', origin: 'https://a.test', readyState: 'complete' });
    await expect(mod.handleRequest({ method: 'navigate', params: { url: 'https://b.test/y' } }))
      .rejects.toThrow(/same-origin only/);
    expect(cdpCalls.some((c) => c.method === 'Page.navigate')).toBe(false);
  });

  it('refuses javascript: and data: URLs', async () => {
    evaluateReturns({ url: 'https://a.test/x', origin: 'https://a.test', readyState: 'complete' });
    for (const url of ['javascript:alert(1)', 'data:text/html,<b>x', 'file:///etc/passwd']) {
      await expect(mod.handleRequest({ method: 'navigate', params: { url } }))
        .rejects.toThrow(/only http\(s\) is allowed/);
    }
  });

  it('allows a relative path on the same origin', async () => {
    evaluateReturns({ url: 'https://a.test/x', origin: 'https://a.test', readyState: 'complete' });
    await mod.handleRequest({ method: 'navigate', params: { url: '/settings' } });

    const nav = cdpCalls.find((c) => c.method === 'Page.navigate');
    expect(nav?.params.url).toBe('https://a.test/settings');
  });

  it('treats a port change as a different origin', async () => {
    evaluateReturns({ url: 'https://a.test/x', origin: 'https://a.test', readyState: 'complete' });
    await expect(mod.handleRequest({ method: 'navigate', params: { url: 'https://a.test:8443/y' } }))
      .rejects.toThrow(/same-origin only/);
  });
});

describe('typing', () => {
  beforeEach(() => share(1, true));

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
  beforeEach(() => share(1, true));

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
    cdpReplies['Runtime.evaluate'] = () => { throw new Error('context destroyed'); };

    const res: any = await mod.handleRequest({ method: 'press', params: { key: 'Escape' } });
    expect(res.focusBefore).toBeNull();
    expect(cdpCalls.some((c) => c.method === 'Input.dispatchKeyEvent')).toBe(true);
  });
});

describe('stale refs', () => {
  beforeEach(() => share(1, true));

  it('propagates the page-side staleness refusal instead of clicking', async () => {
    evaluateReturns({ error: 'refs are stale (page changed since snapshot 1, now 2) — re-snapshot first' });

    await expect(mod.handleRequest({ method: 'click', params: { ref: 'e1', refGen: 1 } }))
      .rejects.toThrow(/stale/);
    expect(cdpCalls.some((c) => c.method === 'Input.dispatchMouseEvent')).toBe(false);
  });
});
