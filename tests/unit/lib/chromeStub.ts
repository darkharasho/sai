/**
 * A stubbed `chrome` global for loading the browser-bridge service worker
 * (extension/chrome/background.js) under vitest.
 *
 * Every `addListener` is captured under its dotted path (`action.onClicked`,
 * `debugger.onEvent`, `port.onDisconnect`, …) so tests can `fire` it. CDP
 * commands follow `cdp.script[method]`: a reply value or function, an error
 * (surfaced through `chrome.runtime.lastError` like the real API), or a hang.
 */
import { vi } from 'vitest';

type Listener = (...args: any[]) => any;

export interface CdpScript {
  reply?: any | ((params: any) => any);
  error?: string;
  hang?: boolean;
}

export interface ChromeStub {
  chrome: any;
  cdp: {
    script: Record<string, CdpScript>;
    calls: Array<{ tabId: number; method: string; params: any }>;
  };
  /** Invokes every listener registered at `event` and awaits them. */
  fire(event: string, ...args: any[]): Promise<void>;
  /** Frames the worker posted on its native port(s). */
  posted: any[];
  listeners: Record<string, Listener[]>;
}

export function makeChromeStub(): ChromeStub {
  const listeners: Record<string, Listener[]> = {};
  const posted: any[] = [];
  const on = (path: string) => ({
    addListener: (fn: Listener) => {
      (listeners[path] ||= []).push(fn);
    },
    removeListener: (fn: Listener) => {
      listeners[path] = (listeners[path] || []).filter((l) => l !== fn);
    },
  });

  const cdp: ChromeStub['cdp'] = { script: {}, calls: [] };

  const chrome: any = {
    runtime: {
      connectNative: vi.fn(() => {
        // A fresh port replaces the old one's listeners, like a real reconnect.
        delete listeners['port.onMessage'];
        delete listeners['port.onDisconnect'];
        return {
          onMessage: on('port.onMessage'),
          onDisconnect: on('port.onDisconnect'),
          postMessage: vi.fn((frame: any) => posted.push(frame)),
          disconnect: vi.fn(),
        };
      }),
      id: 'saiselfextensionid',
      getManifest: () => ({ version: '0.5.0' }),
      onStartup: on('runtime.onStartup'),
      onInstalled: on('runtime.onInstalled'),
      lastError: undefined as undefined | { message: string },
    },
    storage: { session: { get: vi.fn(async () => ({})), set: vi.fn(async () => undefined) } },
    action: {
      setBadgeText: vi.fn(async () => undefined),
      setBadgeBackgroundColor: vi.fn(async () => undefined),
      setTitle: vi.fn(async () => undefined),
      onClicked: on('action.onClicked'),
    },
    scripting: {
      executeScript: vi.fn(async () => [{ frameId: 0, result: { removed: 0 } }]),
    },
    alarms: {
      create: vi.fn(async () => undefined),
      clear: vi.fn(async () => undefined),
      onAlarm: on('alarms.onAlarm'),
    },
    tabs: {
      onActivated: on('tabs.onActivated'),
      onCreated: on('tabs.onCreated'),
      onRemoved: on('tabs.onRemoved'),
      get: vi.fn(async (id: number) => ({ id, windowId: 1 })),
      create: vi.fn(async (props: any) => ({ id: 100, ...props })),
      remove: vi.fn(async () => undefined),
    },
    debugger: {
      attach: vi.fn(async () => undefined),
      detach: vi.fn(async () => undefined),
      getTargets: vi.fn((cb: Listener) => cb([])),
      sendCommand: vi.fn((target: any, method: string, params: any, cb: Listener) => {
        cdp.calls.push({ tabId: target?.tabId, method, params });
        const s = cdp.script[method];
        if (s?.hang) return;
        if (s?.error) {
          chrome.runtime.lastError = { message: s.error };
          try { cb(undefined); } finally { chrome.runtime.lastError = undefined; }
          return;
        }
        const reply = s && 'reply' in s ? s.reply : {};
        cb(typeof reply === 'function' ? reply(params) : reply);
      }),
      onDetach: on('debugger.onDetach'),
      onEvent: on('debugger.onEvent'),
    },
  };

  return {
    chrome,
    cdp,
    posted,
    listeners,
    async fire(event, ...args) {
      for (const fn of [...(listeners[event] || [])]) await fn(...args);
    },
  };
}

/** Loads a fresh copy of the service worker against `stub`. */
export async function loadWorker(stub: ChromeStub): Promise<any> {
  vi.resetModules();
  (globalThis as any).chrome = stub.chrome;
  const mod = await import('../../../extension/chrome/background.js');
  // Let the import-time rehydrate() settle before the test drives anything.
  await new Promise((r) => setTimeout(r, 0));
  return mod;
}
