/**
 * Browser bridge host (main process side).
 *
 * Listens on a stable socket for the native-messaging relay that Chrome spawns
 * on behalf of the SAI Browser Bridge extension, and exposes `call()` so the
 * sai_browser_* tools can ask the extension questions.
 *
 * Direction of travel matters: the extension connects to us, we never reach
 * into the browser. If no tab is attached the extension never connects, so
 * `call()` fails closed with an actionable message.
 *
 * Mirrors saiMcpHost's framing (NDJSON + hello/welcome) but differs in two
 * ways forced by the relay being spawned by Chrome rather than by SAI:
 *  - the socket path is stable, not PID-suffixed, because the relay can only
 *    derive it from $HOME;
 *  - the shared secret lives in a 0600 token file for the same reason.
 */
import * as net from 'node:net';
import * as fs from 'node:fs';
import * as crypto from 'node:crypto';
import { bridgeDir, bridgeSocketPath, bridgeTokenPath } from './browserBridgePaths';
import { devlog } from './devlog';

export interface BridgeHandle {
  socketPath: string;
  tokenPath: string;
}

export interface BridgeStatus {
  listening: boolean;
  /** An extension port is live (i.e. at least one tab was attached). */
  connected: boolean;
  attachedTabIds: number[];
}

type PendingCall = { resolve: (v: unknown) => void; reject: (e: Error) => void; timer: NodeJS.Timeout };

interface Instance {
  server: net.Server;
  handle: BridgeHandle;
  token: string;
  /** The single authenticated relay connection, if any. */
  relay: net.Socket | null;
  pending: Map<string, PendingCall>;
  attachedTabIds: Set<number>;
  listening: Promise<void>;
  /** When a relay was last connected (0 = never). */
  lastRelayAt: number;
}

/**
 * The extension reconnects within a second or two of its relay dying (SAI
 * restart, a newer relay winning). A call that lands in that gap waits this
 * long for the link instead of failing outright.
 */
const RELAY_RECONNECT_WAIT_MS = 4000;
/** Only wait if a relay was connected this recently; otherwise fail fast. */
const RELAY_RECENT_MS = 60_000;

let instance: Instance | null = null;

const CALL_TIMEOUT_MS = 20_000;

/**
 * Every method SAI may ask the extension for. Sharing a tab means SAI can
 * control it, so there is no read/write split; the extension decides which
 * tabs are reachable (only the ones the user shared).
 */
export const BRIDGE_METHOD_LIST = [
  'tabs.list', 'snapshot', 'read', 'click', 'type', 'press', 'scroll', 'navigate', 'dialog',
  'hover', 'select', 'wait', 'tabs.open', 'tabs.close',
] as const;

export const BRIDGE_METHODS = new Set<string>(BRIDGE_METHOD_LIST);

function writeToken(tokenPath: string, token: string): void {
  fs.mkdirSync(bridgeDir(), { recursive: true, mode: 0o700 });
  // 0600: any local process that can read this can drive the bridge.
  fs.writeFileSync(tokenPath, token + '\n', { mode: 0o600 });
}

function rejectAllPending(inst: Instance, message: string): void {
  for (const pending of inst.pending.values()) {
    clearTimeout(pending.timer);
    pending.reject(new Error(message));
  }
  inst.pending.clear();
}

function dropRelay(inst: Instance, message: string): void {
  if (inst.relay) {
    devlog('browserBridge', 'relay-dropped', { reason: message });
    inst.lastRelayAt = Date.now();
  }
  if (inst.relay) {
    try { inst.relay.destroy(); } catch { /* noop */ }
  }
  inst.relay = null;
  inst.buffer = '';
  inst.attachedTabIds.clear();
  rejectAllPending(inst, message);
}

function handleFrame(inst: Instance, frame: unknown): void {
  const f = frame as {
    type?: string;
    role?: string;
    id?: string;
    ok?: boolean;
    result?: unknown;
    error?: string;
    event?: string;
    kind?: string;
    tabId?: number;
    attachedTabIds?: unknown;
  };

  if (f?.type === 'hello' && f.role === 'extension') {
    // The extension's own hello, relayed through the host verbatim.
    if (Array.isArray(f.attachedTabIds)) {
      inst.attachedTabIds = new Set(f.attachedTabIds.filter((n): n is number => typeof n === 'number'));
    }
    return;
  }

  if (f?.type === 'event') {
    // The extension's diagnostics (detach reasons, port drops, attach
    // failures) exist only to be read later; they change no state here.
    if (f.event === 'diag' && typeof f.kind === 'string') {
      const { type: _t, event: _e, ...data } = f as Record<string, unknown>;
      devlog('browserBridge', f.kind, data);
      return;
    }
    if (f.event === 'attached' && typeof f.tabId === 'number') inst.attachedTabIds.add(f.tabId);
    if (f.event === 'detached' && typeof f.tabId === 'number') inst.attachedTabIds.delete(f.tabId);
    return;
  }

  if (f?.type === 'bridge-error') {
    rejectAllPending(inst, f.error || 'bridge error');
    return;
  }

  if (f?.type === 'response' && typeof f.id === 'string') {
    const pending = inst.pending.get(f.id);
    if (!pending) return;
    inst.pending.delete(f.id);
    clearTimeout(pending.timer);
    if (f.ok) pending.resolve(f.result);
    else pending.reject(new Error(f.error || 'extension returned an error'));
  }
}

function attachRelay(inst: Instance, socket: net.Socket): void {
  let authed = false;
  socket.setEncoding('utf8');

  const fail = (error: string) => {
    try { socket.write(JSON.stringify({ type: 'error', error }) + '\n'); } catch { /* noop */ }
    try { socket.destroy(); } catch { /* noop */ }
  };

  let buffer = '';
  socket.on('data', (chunk: string) => {
    buffer += chunk;
    let idx: number;
    while ((idx = buffer.indexOf('\n')) !== -1) {
      const line = buffer.slice(0, idx).trim();
      buffer = buffer.slice(idx + 1);
      if (!line) continue;

      let frame: any;
      try {
        frame = JSON.parse(line);
      } catch {
        fail('invalid json');
        return;
      }

      if (!authed) {
        if (frame?.type !== 'hello' || frame.role !== 'relay') {
          fail('expected relay hello');
          return;
        }
        if (typeof frame.token !== 'string'
            || frame.token.length !== inst.token.length
            || !crypto.timingSafeEqual(Buffer.from(frame.token), Buffer.from(inst.token))) {
          fail('auth failed');
          return;
        }
        authed = true;
        // Chrome spawns a fresh relay per port; the newest one wins so a
        // reconnecting service worker isn't locked out by a stale socket.
        if (inst.relay && inst.relay !== socket) dropRelay(inst, 'replaced by a newer browser connection');
        inst.relay = socket;
        inst.lastRelayAt = Date.now();
        devlog('browserBridge', 'relay-connected', {});
        try { socket.write(JSON.stringify({ type: 'welcome' }) + '\n'); } catch { /* noop */ }
        continue;
      }

      handleFrame(inst, frame);
    }
  });

  const cleanup = () => {
    if (inst.relay === socket) dropRelay(inst, 'browser disconnected');
  };
  socket.on('close', cleanup);
  socket.on('error', cleanup);
}

interface StartOptions {
  socketPath?: string;
  tokenPath?: string;
  token?: string;
  /** Tests listen on a temp socket and don't want a real ~/.sai token file. */
  writeTokenFile?: boolean;
}

function startInternal(opts: StartOptions = {}): BridgeHandle {
  if (instance) return instance.handle;

  const socketPath = opts.socketPath ?? bridgeSocketPath();
  const tokenPath = opts.tokenPath ?? bridgeTokenPath();
  const token = opts.token ?? crypto.randomBytes(32).toString('hex');

  if (opts.writeTokenFile !== false) writeToken(tokenPath, token);

  if (process.platform !== 'win32') {
    try { fs.unlinkSync(socketPath); } catch { /* stale socket may not exist */ }
  }

  const server = net.createServer((socket) => {
    if (instance) attachRelay(instance, socket);
    else socket.destroy();
  });
  server.on('error', (err) => {
    console.error('[browser-bridge] server error:', err);
  });
  const listening = new Promise<void>((resolve, reject) => {
    server.once('listening', () => resolve());
    server.once('error', reject);
  });
  // Nobody is required to await whenListening(); the error handler above logs.
  listening.catch(() => { /* handled */ });
  server.listen(socketPath);

  instance = {
    server,
    handle: { socketPath, tokenPath },
    token,
    relay: null,
    pending: new Map(),
    attachedTabIds: new Set(),
    listening,
    lastRelayAt: 0,
  };
  return instance.handle;
}

/** Resolves once the socket is accepting connections (rejects on listen error). */
export function whenListening(): Promise<void> {
  return instance?.listening ?? Promise.reject(new Error('browser bridge is not running'));
}

export function start(): BridgeHandle {
  return startInternal();
}

export function stop(): void {
  if (!instance) return;
  const inst = instance;
  instance = null;
  dropRelay(inst, 'bridge stopped');
  try { inst.server.close(); } catch { /* noop */ }
  if (process.platform !== 'win32') {
    try { fs.unlinkSync(inst.handle.socketPath); } catch { /* noop */ }
  }
  // Invalidate the token so a relay spawned after shutdown fails fast instead
  // of hanging on a dead socket.
  try { fs.unlinkSync(inst.handle.tokenPath); } catch { /* noop */ }
}

export function status(): BridgeStatus {
  if (!instance) return { listening: false, connected: false, attachedTabIds: [] };
  return {
    listening: true,
    connected: instance.relay !== null,
    attachedTabIds: [...instance.attachedTabIds],
  };
}

const NOT_CONNECTED =
  'No browser is connected. Install the SAI Browser Bridge extension (see docs/browser-bridge.md), '
  + 'then click its toolbar button on the tab you want to share.';

/** Resolves with the relay once one is connected, or null after `ms`. */
async function waitForRelay(inst: Instance, ms: number): Promise<net.Socket | null> {
  const deadline = Date.now() + ms;
  while (Date.now() < deadline) {
    if (inst.relay) return inst.relay;
    await new Promise((r) => setTimeout(r, 100));
  }
  return inst.relay;
}

export async function call(method: string, params: unknown = {}): Promise<unknown> {
  const inst = instance;
  if (!inst) throw new Error('browser bridge is not running');
  let relay = inst.relay;
  if (!relay) {
    if (!inst.lastRelayAt || Date.now() - inst.lastRelayAt > RELAY_RECENT_MS) throw new Error(NOT_CONNECTED);
    relay = await waitForRelay(inst, RELAY_RECONNECT_WAIT_MS);
    if (!relay) {
      throw new Error(
        `the link to the browser dropped and did not come back within ${RELAY_RECONNECT_WAIT_MS / 1000}s — `
        + 'click the SAI toolbar button on the tab to reconnect',
      );
    }
  }

  const id = crypto.randomUUID();

  return new Promise<unknown>((resolve, reject) => {
    const timer = setTimeout(() => {
      if (inst.pending.delete(id)) {
        reject(new Error(`browser call ${method} timed out after ${CALL_TIMEOUT_MS / 1000}s`));
      }
    }, CALL_TIMEOUT_MS);

    inst.pending.set(id, { resolve, reject, timer });

    try {
      relay.write(JSON.stringify({ type: 'request', id, method, params }) + '\n');
    } catch (err) {
      inst.pending.delete(id);
      clearTimeout(timer);
      reject(err instanceof Error ? err : new Error(String(err)));
    }
  });
}

/** @internal */
export function _test_start(opts: StartOptions = {}): BridgeHandle {
  return startInternal({ writeTokenFile: false, ...opts });
}

/** @internal */
export function _test_token(): string | null {
  return instance?.token ?? null;
}

/** @internal */
export function _resetForTests(): void {
  if (!instance) return;
  const inst = instance;
  instance = null;
  dropRelay(inst, 'reset');
  try { inst.server.close(); } catch { /* noop */ }
  if (process.platform !== 'win32') {
    try { fs.unlinkSync(inst.handle.socketPath); } catch { /* noop */ }
  }
}
