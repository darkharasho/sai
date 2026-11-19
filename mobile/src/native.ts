// Native capabilities for the phone: Capacitor plugins in the app, web fallbacks in the browser and tests.
// Extends Task 7's NativeApi (openUrl/copyText/toast) with keychain and native HTTP.
import { Capacitor, CapacitorHttp, registerPlugin } from '@capacitor/core';
import type { NativeApi } from './v2/types';

export interface HttpRequest {
  method: 'GET' | 'POST';
  url: string;
  body?: unknown;
  timeoutMs?: number;
}
export interface HttpResponse {
  status: number;
  /** Parsed JSON when the body is JSON, otherwise the raw text. */
  data: unknown;
}

export interface FullNativeApi extends NativeApi {
  keychainGet(key: string): Promise<string | null>;
  keychainSet(key: string, value: string): Promise<void>;
  keychainRemove(key: string): Promise<void>;
  /** HTTP that bypasses WebView mixed-content/CORS on native. Rejects on network failure or timeout. */
  http(req: HttpRequest): Promise<HttpResponse>;
}

interface KeychainPlugin {
  get(opts: { key: string }): Promise<{ value: string | null }>;
  set(opts: { key: string; value: string }): Promise<void>;
  remove(opts: { key: string }): Promise<void>;
}

const DEFAULT_TIMEOUT_MS = 10_000;

function parseBody(text: string): unknown {
  try { return JSON.parse(text); } catch { return text; }
}

export function createNative(toast: (message: string) => void = () => {}): FullNativeApi {
  const isNative = Capacitor.isNativePlatform();
  const memory = new Map<string, string>();
  const keychain = isNative ? registerPlugin<KeychainPlugin>('Keychain') : null;

  return {
    async openUrl(url) {
      if (isNative) {
        const { Browser } = await import('@capacitor/browser');
        await Browser.open({ url });
      } else if (typeof window !== 'undefined') {
        window.open(url, '_blank', 'noopener');
      }
    },
    async copyText(text) {
      if (isNative) {
        const { Clipboard } = await import('@capacitor/clipboard');
        await Clipboard.write({ string: text });
      } else {
        await navigator.clipboard.writeText(text);
      }
    },
    toast,
    async keychainGet(key) {
      if (keychain) return (await keychain.get({ key })).value ?? null;
      return memory.get(key) ?? null;
    },
    async keychainSet(key, value) {
      if (keychain) await keychain.set({ key, value });
      else memory.set(key, value);
    },
    async keychainRemove(key) {
      if (keychain) await keychain.remove({ key });
      else memory.delete(key);
    },
    async http({ method, url, body, timeoutMs = DEFAULT_TIMEOUT_MS }) {
      if (isNative) {
        const res = await CapacitorHttp.request({
          method,
          url,
          headers: body === undefined ? {} : { 'Content-Type': 'application/json' },
          data: body,
          connectTimeout: timeoutMs,
          readTimeout: timeoutMs,
        });
        return { status: res.status, data: typeof res.data === 'string' ? parseBody(res.data) : res.data };
      }
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), timeoutMs);
      try {
        const res = await fetch(url, {
          method,
          headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
          body: body === undefined ? undefined : JSON.stringify(body),
          signal: ctrl.signal,
        });
        return { status: res.status, data: parseBody(await res.text()) };
      } finally {
        clearTimeout(timer);
      }
    },
  };
}

let shared: FullNativeApi | null = null;
/** The app-wide instance (lazy so tests can mock @capacitor/core first). */
export function getNative(): FullNativeApi {
  return (shared ??= createNative());
}
