/**
 * Wire reconnection / resume hardening regression tests.
 *
 * Covers the iOS-background / sleep / app-switch failure modes addressed in
 * `src/renderer-remote/wire.ts`:
 *   - replay attach / follow / workspace.set / workspace.status.subscribe on
 *     every auth_ok so the server's per-socket state catches up after a
 *     reconnect
 *   - foreground probe (online / visibilitychange / pageshow): force reconnect
 *     when socket is closed, ping + 5s deadline when socket claims OPEN
 *   - heartbeat ping + 10s pong deadline kills zombie sockets
 *   - close() rejects in-flight requests with code 'wire_closed'
 *   - sendFrame no-ops on non-OPEN sockets instead of throwing
 *   - exponential backoff resets after a successful auth
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

import { connect, type WireClient } from '../../../src/renderer-remote/wire';

// Every connect() registers window/document listeners. Without explicit
// teardown those leak across tests and old clients spuriously open new
// sockets when the next test dispatches `online` / `pageshow` etc. Track
// every client and close them all in afterEach.
const liveClients: WireClient[] = [];
function trackedConnect(token: string): WireClient {
  const c = connect(token);
  liveClients.push(c);
  return c;
}

// ---------------------------------------------------------------------------
// MockWebSocket — lets each test drive the open / message / close lifecycle.
// ---------------------------------------------------------------------------

interface MockWS {
  url: string;
  readyState: number;
  sent: string[];
  onopen: ((ev: Event) => void) | null;
  onmessage: ((ev: MessageEvent) => void) | null;
  onclose: ((ev: CloseEvent) => void) | null;
  onerror: ((ev: Event) => void) | null;
  send(data: string): void;
  close(): void;
  // Test helpers:
  open(): void;
  receive(payload: unknown): void;
  serverClose(): void;
}

let instances: MockWS[] = [];

function installMockWebSocket() {
  class FakeWebSocket implements MockWS {
    static CONNECTING = 0;
    static OPEN = 1;
    static CLOSING = 2;
    static CLOSED = 3;

    url: string;
    readyState: number = 0;
    sent: string[] = [];
    onopen: ((ev: Event) => void) | null = null;
    onmessage: ((ev: MessageEvent) => void) | null = null;
    onclose: ((ev: CloseEvent) => void) | null = null;
    onerror: ((ev: Event) => void) | null = null;

    constructor(url: string) {
      this.url = url;
      instances.push(this);
    }

    send(data: string) {
      if (this.readyState !== 1) throw new Error('not open');
      this.sent.push(data);
    }

    close() {
      if (this.readyState === 3) return;
      this.readyState = 3;
      // Mirror real WS: onclose fires asynchronously, but here we keep it
      // synchronous for test determinism (the wire layer doesn't care).
      this.onclose?.(new CloseEvent('close'));
    }

    open() {
      this.readyState = 1;
      this.onopen?.(new Event('open'));
    }

    receive(payload: unknown) {
      this.onmessage?.(new MessageEvent('message', { data: JSON.stringify(payload) }));
    }

    serverClose() {
      this.readyState = 3;
      this.onclose?.(new CloseEvent('close'));
    }
  }

  (globalThis as any).WebSocket = FakeWebSocket;
  // Constants on the constructor are required by the wire layer's
  // `WebSocket.OPEN` checks.
  (globalThis as any).WebSocket.CONNECTING = 0;
  (globalThis as any).WebSocket.OPEN = 1;
  (globalThis as any).WebSocket.CLOSING = 2;
  (globalThis as any).WebSocket.CLOSED = 3;
}

// ---------------------------------------------------------------------------
// Small driver: connect + immediately satisfy the initial auth handshake.
// ---------------------------------------------------------------------------

function freshConnect() {
  const c = trackedConnect('tok');
  expect(instances).toHaveLength(1);
  const ws = instances[0]!;
  ws.open();
  // wire sends `auth` on open
  expect(JSON.parse(ws.sent[0]!)).toEqual({ type: 'auth', token: 'tok' });
  ws.receive({ type: 'auth_ok' });
  return { client: c, ws };
}

function setVisibility(state: 'visible' | 'hidden') {
  Object.defineProperty(document, 'visibilityState', {
    configurable: true,
    get: () => state,
  });
  document.dispatchEvent(new Event('visibilitychange'));
}

beforeEach(() => {
  instances = [];
  installMockWebSocket();
  vi.useFakeTimers();
});

afterEach(() => {
  for (const c of liveClients) {
    try { c.close(); } catch { /* ignore */ }
  }
  liveClients.length = 0;
  vi.useRealTimers();
});

// ---------------------------------------------------------------------------

describe('wire.connect — basic lifecycle', () => {
  it('sends auth on open and flips state to open on auth_ok', () => {
    // connect() emits 'opening' synchronously before we can subscribe, so we
    // only assert the post-subscribe transitions.
    const states: string[] = [];
    const c = trackedConnect('tok');
    c.onState((s) => states.push(s));
    const ws = instances[0]!;
    ws.open();
    expect(JSON.parse(ws.sent[0]!)).toEqual({ type: 'auth', token: 'tok' });
    ws.receive({ type: 'auth_ok' });
    expect(states).toEqual(['open']);
  });

  it('sendFrame no-ops when socket is not OPEN (no throw)', () => {
    const c = trackedConnect('tok');
    // Before open, sending should be silently dropped.
    expect(() => c.send({ type: 'ping' })).not.toThrow();
    expect(instances[0]!.sent).toHaveLength(0);
  });
});

describe('wire.connect — replay on reconnect', () => {
  it('replays attach / follow / workspace state on every auth_ok', () => {
    const { client, ws } = freshConnect();
    client.subscribeWorkspaceStatus();
    client.setActiveWorkspace('/repo/a');
    client.setFollow(true);
    client.attach({ projectPath: '/repo/a', sessionId: 'sess-1' });

    // Sanity: those four frames were sent on the first socket (plus the auth).
    const firstSocketFrames = ws.sent.map((s) => JSON.parse(s).type);
    expect(firstSocketFrames).toContain('workspace.status.subscribe');
    expect(firstSocketFrames).toContain('workspace.set');
    expect(firstSocketFrames).toContain('session.follow');
    expect(firstSocketFrames).toContain('session.attach');

    // Server kicks the socket; backoff fires; new socket comes up.
    ws.serverClose();
    vi.advanceTimersByTime(1_500); // first backoff is ~1s + jitter
    expect(instances).toHaveLength(2);
    const ws2 = instances[1]!;
    ws2.open();
    ws2.receive({ type: 'auth_ok' });

    // Replay frames were sent on the new socket BEFORE any consumer touched it.
    const replayed = ws2.sent.map((s) => JSON.parse(s));
    expect(replayed).toEqual([
      { type: 'auth', token: 'tok' },
      { type: 'workspace.status.subscribe' },
      { type: 'workspace.set', projectPath: '/repo/a' },
      { type: 'session.follow', enabled: true },
      { type: 'session.attach', projectPath: '/repo/a', scope: 'chat', sessionId: 'sess-1' },
    ]);
  });

  it('does not replay unsubscribed workspace status after a reconnect', () => {
    const { client, ws } = freshConnect();
    client.subscribeWorkspaceStatus();
    client.unsubscribeWorkspaceStatus();
    ws.serverClose();
    vi.advanceTimersByTime(1_500);
    const ws2 = instances[1]!;
    ws2.open();
    ws2.receive({ type: 'auth_ok' });
    const types = ws2.sent.map((s) => JSON.parse(s).type);
    expect(types).not.toContain('workspace.status.subscribe');
  });

  it('replays the LATEST attach after a switch, not the first one', () => {
    const { client, ws } = freshConnect();
    client.attach({ projectPath: '/repo/a', sessionId: 's1' });
    client.attach({ projectPath: '/repo/b', sessionId: 's2' });
    ws.serverClose();
    vi.advanceTimersByTime(1_500);
    const ws2 = instances[1]!;
    ws2.open();
    ws2.receive({ type: 'auth_ok' });
    const attaches = ws2.sent
      .map((s) => JSON.parse(s))
      .filter((m) => m.type === 'session.attach');
    expect(attaches).toEqual([
      { type: 'session.attach', projectPath: '/repo/b', scope: 'chat', sessionId: 's2' },
    ]);
  });
});

describe('wire.connect — foreground probe', () => {
  it('reconnects immediately on `online` when socket is closed (bypasses backoff)', () => {
    const { ws } = freshConnect();
    ws.serverClose();
    // Backoff would normally wait at least 800ms. Trigger online sooner.
    vi.advanceTimersByTime(100);
    expect(instances).toHaveLength(1); // backoff hasn't fired yet
    window.dispatchEvent(new Event('online'));
    expect(instances).toHaveLength(2);
  });

  it('sends a ping when probing an OPEN socket and reconnects if no reply within 5s', () => {
    const { ws } = freshConnect();
    const sentBefore = ws.sent.length;
    setVisibility('visible');
    // Probe should have sent a ping immediately.
    const afterProbe = ws.sent.slice(sentBefore).map((s) => JSON.parse(s));
    expect(afterProbe.some((m) => m.type === 'ping')).toBe(true);

    // No reply in 5s → socket killed and reconnect scheduled.
    vi.advanceTimersByTime(5_500);
    expect(ws.readyState).toBe(3); // CLOSED
    // Backoff jitter range: 800–1200ms after a fresh kill.
    vi.advanceTimersByTime(1_500);
    expect(instances.length).toBeGreaterThanOrEqual(2);
  });

  it('any inbound message clears the probe deadline (no zombie kill)', () => {
    const { ws } = freshConnect();
    setVisibility('visible');
    // Server replies with pong — that's enough activity.
    ws.receive({ type: 'pong' });
    vi.advanceTimersByTime(6_000);
    expect(ws.readyState).toBe(1); // still OPEN
    expect(instances).toHaveLength(1);
  });

  it('pageshow triggers the same probe path', () => {
    const { ws } = freshConnect();
    const before = ws.sent.length;
    window.dispatchEvent(new Event('pageshow'));
    const sent = ws.sent.slice(before).map((s) => JSON.parse(s));
    expect(sent.some((m) => m.type === 'ping')).toBe(true);
  });

  it('visibilitychange while hidden does NOT probe', () => {
    const { ws } = freshConnect();
    const before = ws.sent.length;
    setVisibility('hidden');
    expect(ws.sent.length).toBe(before);
  });
});

describe('wire.connect — heartbeat with pong deadline', () => {
  it('kills socket when no traffic arrives within the pong deadline', () => {
    const { ws } = freshConnect();
    // First heartbeat ping fires at 25s.
    vi.advanceTimersByTime(25_000);
    const lastSent = JSON.parse(ws.sent[ws.sent.length - 1]!);
    expect(lastSent).toEqual({ type: 'ping' });
    // 10s without any inbound traffic → killSocket → reconnect.
    vi.advanceTimersByTime(10_500);
    expect(ws.readyState).toBe(3);
  });

  it('does NOT kill socket when a pong arrives in time', () => {
    const { ws } = freshConnect();
    vi.advanceTimersByTime(25_000);
    ws.receive({ type: 'pong' });
    vi.advanceTimersByTime(10_500);
    expect(ws.readyState).toBe(1);
    expect(instances).toHaveLength(1);
  });
});

describe('wire.connect — request rejection on close', () => {
  it('rejects every in-flight request immediately on socket close', async () => {
    const { client, ws } = freshConnect();
    const p1 = client.listWorkspaces();
    const p2 = client.listFiles('/cwd', '.');
    // Server closes — no per-call timeout should elapse.
    ws.serverClose();
    await expect(p1).rejects.toMatchObject({ code: 'wire_closed' });
    await expect(p2).rejects.toMatchObject({ code: 'wire_closed' });
  });

  it('per-call timeout is no longer needed in the close path', async () => {
    const { client, ws } = freshConnect();
    const p = client.listSessions('/repo');
    ws.serverClose();
    // Without the eager close-rejection, this would only reject after 5s.
    const start = vi.getTimerCount();
    await expect(p).rejects.toThrow(/connection lost/);
    // No leftover request-level timeout still pending.
    expect(vi.getTimerCount()).toBeLessThanOrEqual(start);
  });
});

describe('wire.connect — backoff', () => {
  it('resets retry counter after a successful auth (so post-resume backoff stays short)', () => {
    const { ws } = freshConnect();
    // Three churned reconnects to drive backoff up.
    ws.serverClose();
    vi.advanceTimersByTime(1_500);
    const ws2 = instances[1]!; ws2.open(); ws2.receive({ type: 'auth_ok' });
    // After a successful auth, the next close should backoff from 1s again,
    // not 8s or 16s.
    ws2.serverClose();
    // Within ~1.5s the third socket should already exist.
    vi.advanceTimersByTime(1_500);
    expect(instances.length).toBeGreaterThanOrEqual(3);
  });
});

describe('wire.close — listener teardown', () => {
  it('removes online / visibilitychange / pageshow listeners and stops reconnecting', () => {
    const { client, ws } = freshConnect();
    client.close();
    // A spurious online event should not spawn a new socket.
    const before = instances.length;
    window.dispatchEvent(new Event('online'));
    window.dispatchEvent(new Event('pageshow'));
    setVisibility('visible');
    expect(instances.length).toBe(before);
    // Even if backoff had been scheduled, advancing the clock doesn't
    // spawn a new socket either.
    vi.advanceTimersByTime(60_000);
    expect(instances.length).toBe(before);
    // The socket itself is closed.
    expect(ws.readyState).toBe(3);
  });
});

describe('sendPrompt sessionId threading', () => {
  it('includes the sessionId in the prompt frame', () => {
    const { client, ws } = freshConnect();
    client.sendPrompt({ text: 'hi', projectPath: '/p', sessionId: 's1' });
    const frame = JSON.parse(ws.sent.at(-1)!);
    expect(frame).toMatchObject({ type: 'prompt', text: 'hi', projectPath: '/p', sessionId: 's1' });
  });
});
