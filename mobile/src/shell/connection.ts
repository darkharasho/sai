// The phone's connection to the active desktop, and the window.sai the shared
// chat graph calls.
//
// window.sai is installed once, before anything imports the chat graph
// (several modules call settingsGet at import time). It delegates to the
// active connection's shim, so switching machines swaps what it reaches
// without replacing the object.
//
// Lifetime rules (Task 7):
// - client.close() only when unpairing, forgetting the active machine or
//   switching to another machine (it rejects un-acked commands that may have run);
// - backgrounding and chat switches never close the client (resume() on foreground).
import { V2Client } from '../v2/client';
import { createSaiShim, type SaiShimOpts } from '../v2/saiShim';
import type { ConnState } from '../v2/types';
import type { SaiChatLogApi } from '../../../src/types';
import { createChatMirror, type ChatMirror } from './chatMirror';

export interface Connection {
  client: V2Client;
  /** The shim with chatlog.open/onEvent tapped by the mirror. */
  sai: SaiBridge;
  mirror: ChatMirror;
}

/** A shim over `client` whose chat reads also feed a ChatMirror. */
export function createConnection(client: V2Client, opts: SaiShimOpts): Connection {
  const shim = createSaiShim(client, opts);
  const mirror = createChatMirror();
  const raw = shim.chatlog as SaiChatLogApi;
  raw.onEvent((e) => mirror.ingest(e));
  const chatlog: SaiChatLogApi = {
    ...raw,
    open: (chatId: string, after: number, o?: { panel?: boolean }) =>
      mirror.tapOpen(chatId, typeof after === 'number' ? after : 0, raw.open(chatId, after, o)),
    close: (chatId: string) => {
      raw.close?.(chatId);
      mirror.forget(chatId);
    },
  };
  const sai = new Proxy(shim as object, {
    get(t, name, receiver) {
      if (name === 'chatlog') return chatlog;
      return Reflect.get(t, name, receiver);
    },
  }) as SaiBridge;
  return { client, sai, mirror };
}

// ─── app settings (theme, accent, chat display, provider defaults) ───────────

const SETTINGS_KEY = 'sai.appSettings.v1';
type Settings = Record<string, unknown>;

function loadSettings(): Settings {
  try {
    const v = JSON.parse(localStorage.getItem(SETTINGS_KEY) ?? '{}');
    return v && typeof v === 'object' && !Array.isArray(v) ? v as Settings : {};
  } catch {
    return {};
  }
}

let appSettings: Settings = loadSettings();
const settingsListeners = new Set<(s: Settings) => void>();

/** The desktop's phone-visible settings (last known, persisted so the theme paints before connecting). */
export function getAppSettings(): Settings {
  return appSettings;
}

export function setAppSettings(next: unknown): void {
  if (!next || typeof next !== 'object' || Array.isArray(next)) return;
  appSettings = next as Settings;
  try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(appSettings)); } catch { /* storage full: memory only */ }
  for (const cb of [...settingsListeners]) { try { cb(appSettings); } catch (err) { console.error('[settings] listener failed', err); } }
}

export function onAppSettings(cb: (s: Settings) => void): () => void {
  settingsListeners.add(cb);
  return () => { settingsListeners.delete(cb); };
}

// ─── the active connection ───────────────────────────────────────────────────

export interface ActiveConnection extends Connection {
  machineId: string;
}

let active: ActiveConnection | null = null;
const activeListeners = new Set<(c: ActiveConnection | null) => void>();

function setActive(c: ActiveConnection | null): void {
  active = c;
  for (const cb of [...activeListeners]) { try { cb(c); } catch (err) { console.error('[connection] listener failed', err); } }
}

export function getActive(): ActiveConnection | null {
  return active;
}

export function onActive(cb: (c: ActiveConnection | null) => void): () => void {
  activeListeners.add(cb);
  return () => { activeListeners.delete(cb); };
}

/** ws(s)://host:port/ws for a machine's http(s) base URL. */
export function wsUrlOf(baseUrl: string): string {
  const u = new URL(baseUrl);
  return `${u.protocol === 'https:' ? 'wss:' : 'ws:'}//${u.host}/ws`;
}

/**
 * Connects to a machine (closing the connection to a different one first).
 * The same machine keeps its live connection.
 */
export function connectTo(
  machine: { id: string; baseUrl: string },
  token: string,
  opts: Omit<SaiShimOpts, 'settings'>,
  WebSocketImpl?: ConstructorParameters<typeof V2Client>[0]['WebSocketImpl'],
): ActiveConnection {
  if (active && active.machineId === machine.id) return active;
  active?.client.close();
  const client = new V2Client({ url: wsUrlOf(machine.baseUrl), token, ...(WebSocketImpl ? { WebSocketImpl } : {}) });
  const conn: ActiveConnection = { ...createConnection(client, { ...opts, settings: getAppSettings }), machineId: machine.id };
  client.on('app.settings.result', (f: { settings?: unknown }) => setAppSettings(f.settings));
  client.on('app.settings.changed', (f: { settings?: unknown }) => setAppSettings(f.settings));
  client.connect();
  // Re-sent by the client after every reconnect (so is the shell's workspaces.subscribe).
  client.send({ type: 'app.settings' });
  setActive(conn);
  return conn;
}

/** Closes the active connection (unpair / forget / switching machine only). */
export function disconnect(): void {
  if (!active) return;
  active.client.close();
  setActive(null);
}

// ─── window.sai ──────────────────────────────────────────────────────────────

/** What window.sai answers with no connection: cached settings, everything else a no-op. */
const offline: Record<string, unknown> = {
  platform: 'ios',
  settingsGet: (key: string, defaultValue?: unknown) => {
    const v = appSettings[key];
    return Promise.resolve(v === undefined ? defaultValue : v);
  },
  settingsSet: () => Promise.resolve(),
};

/** Installs window.sai (idempotent). Must run before the chat graph is imported. */
export function installSai(): void {
  if ((window as { __saiPhoneHost?: boolean }).__saiPhoneHost) return;
  (window as { __saiPhoneHost?: boolean }).__saiPhoneHost = true;
  window.sai = new Proxy({}, {
    get(_t, name) {
      if (active) return Reflect.get(active.sai as object, name);
      if (typeof name === 'symbol') return undefined;
      if (name in offline) return offline[name];
      if (name === 'then' || name === 'toJSON' || name === '$$typeof' || name === 'constructor' || name === 'chatlog') return undefined;
      return () => undefined;
    },
  }) as SaiBridge;
}

/** True when a connection state means the socket is authenticated. */
export const isLive = (s: ConnState): boolean => s === 'open' || s === 'catching_up';
