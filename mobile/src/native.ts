// Native capabilities for the phone: Capacitor plugins in the app, web fallbacks in the browser and tests.
// Extends Task 7's NativeApi (openUrl/copyText/toast) with keychain, native HTTP and push.
import { Capacitor, CapacitorHttp, registerPlugin } from '@capacitor/core';
import type { NativeApi } from './v2/types';

export interface HttpRequest {
  method: 'GET' | 'POST' | 'DELETE';
  url: string;
  body?: unknown;
  timeoutMs?: number;
}
export interface HttpResponse {
  status: number;
  /** Parsed JSON when the body is JSON, otherwise the raw text. */
  data: unknown;
}

export interface KeychainOpts {
  /**
   * Keychain access group, without the team prefix (native prepends
   * $(AppIdentifierPrefix)). Omitted: the app's default group.
   */
  accessGroup?: string;
}

export type PushEnv = 'sandbox' | 'production';
export type PushPermission = 'granted' | 'denied' | 'prompt';

/** @capacitor/push-notifications, reduced to what the phone uses. Listeners return a sync remover. */
export interface PushApi {
  checkPermission(): Promise<PushPermission>;
  requestPermission(): Promise<PushPermission>;
  /** Asks iOS for the APNs token; it arrives through onRegistration (again whenever it rotates). */
  register(): Promise<void>;
  /** The APNs device token, hex. */
  onRegistration(cb: (token: string) => void): () => void;
  onRegistrationError(cb: (error: string) => void): () => void;
  /** A tap on a notification: its userInfo (what the Notification Service Extension wrote). */
  onAction(cb: (data: Record<string, unknown>) => void): () => void;
}

export interface FullNativeApi extends NativeApi {
  keychainGet(key: string, opts?: KeychainOpts): Promise<string | null>;
  keychainSet(key: string, value: string, opts?: KeychainOpts): Promise<void>;
  keychainRemove(key: string, opts?: KeychainOpts): Promise<void>;
  /** HTTP that bypasses WebView mixed-content/CORS on native. Rejects on network failure or timeout. */
  http(req: HttpRequest): Promise<HttpResponse>;
  /** Push notifications; absent off-device (browser, tests). */
  push?: PushApi | null;
  /** The APNs environment this build was signed for; 'production' when unknown. */
  buildEnv?(): Promise<PushEnv>;
  /** Opens this app's page in iOS Settings. */
  openSettings?(): Promise<void>;
}

interface KeychainPlugin {
  get(opts: { key: string; accessGroup?: string }): Promise<{ value: string | null }>;
  set(opts: { key: string; value: string; accessGroup?: string }): Promise<void>;
  remove(opts: { key: string; accessGroup?: string }): Promise<void>;
  /** Task 5: `aps-environment` from the embedded provisioning profile. */
  buildEnv(): Promise<{ env?: string }>;
  /** Task 5: opens UIApplication.openSettingsURLString. */
  openSettings(): Promise<void>;
}

/** Only adds accessGroup when one is given (older shells see exactly the old call). */
const withGroup = <T extends object>(o: T, opts?: KeychainOpts): T & { accessGroup?: string } =>
  (opts?.accessGroup ? { ...o, accessGroup: opts.accessGroup } : o);

const permOf = (s: unknown): PushPermission => (s === 'granted' ? 'granted' : s === 'denied' ? 'denied' : 'prompt');

/** The Capacitor push plugin behind PushApi (loaded lazily: it only exists in the native app). */
function createPushApi(): PushApi {
  const load = () => import('@capacitor/push-notifications').then((m) => m.PushNotifications);
  type Handle = { remove: () => Promise<void> | void };
  const listen = (add: (P: Awaited<ReturnType<typeof load>>) => Promise<Handle>): (() => void) => {
    let stopped = false;
    let handle: Handle | null = null;
    void load().then(add)
      .then((h) => { if (stopped) void h.remove(); else handle = h; })
      .catch((err) => { console.warn('[push] listener failed', err); });
    return () => { stopped = true; if (handle) void handle.remove(); };
  };
  return {
    async checkPermission() { return permOf((await (await load()).checkPermissions()).receive); },
    async requestPermission() { return permOf((await (await load()).requestPermissions()).receive); },
    async register() { await (await load()).register(); },
    onRegistration: (cb) => listen((P) => P.addListener('registration', (t) => cb(String(t?.value ?? '')))),
    onRegistrationError: (cb) => listen((P) => P.addListener('registrationError', (e) => cb(String(e?.error ?? 'error')))),
    onAction: (cb) => listen((P) => P.addListener('pushNotificationActionPerformed', (a) => {
      const data = a?.notification?.data;
      cb(data && typeof data === 'object' && !Array.isArray(data) ? data as Record<string, unknown> : {});
    })),
  };
}

const DEFAULT_TIMEOUT_MS = 10_000;

function parseBody(text: string): unknown {
  try { return JSON.parse(text); } catch { return text; }
}

export function createNative(toast: (message: string) => void = () => {}): FullNativeApi {
  const isNative = Capacitor.isNativePlatform();
  const memory = new Map<string, string>();
  const memKey = (key: string, opts?: KeychainOpts) => (opts?.accessGroup ? `${opts.accessGroup}\u0000${key}` : key);
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
    async keychainGet(key, opts) {
      if (keychain) return (await keychain.get(withGroup({ key }, opts))).value ?? null;
      return memory.get(memKey(key, opts)) ?? null;
    },
    async keychainSet(key, value, opts) {
      if (keychain) await keychain.set(withGroup({ key, value }, opts));
      else memory.set(memKey(key, opts), value);
    },
    async keychainRemove(key, opts) {
      if (keychain) await keychain.remove(withGroup({ key }, opts));
      else memory.delete(memKey(key, opts));
    },
    push: isNative ? createPushApi() : null,
    async buildEnv() {
      // An older shell without buildEnv rejects (UNIMPLEMENTED): production is the safe default.
      if (!keychain) return 'production';
      try {
        const { env } = await keychain.buildEnv();
        return env === 'sandbox' || env === 'development' ? 'sandbox' : 'production';
      } catch {
        return 'production';
      }
    },
    async openSettings() {
      if (!keychain) return;
      try {
        await keychain.openSettings();
      } catch {
        // Older shell: WKWebView hands non-web schemes to UIApplication.open.
        window.location.href = 'app-settings:';
      }
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
