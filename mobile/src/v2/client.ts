// The phone's protocol-v2 connection to one desktop (electron/services/remote
// chat-v2.ts + bridge-server.ts): auth, heartbeat, reconnect with backoff,
// reqId-matched requests and replay of every subscription after a reconnect.
//
// Timing is the PWA's (src/renderer-remote/wire.ts): ping every 25s and
// expect any traffic within 10s; foreground probe with a 5s deadline;
// reconnect backoff 1s → 30s with ±20% jitter, reset by a successful auth.
//
// The socket constructor is injectable (WebSocketImpl). Nothing else here
// touches window.WebSocket, so a native socket can be swapped in if iOS
// treats ws:// from capacitor://localhost as mixed content.
import {
  CHAT_LOG_UNAVAILABLE_MESSAGE, V2Error,
  type ConnState, type SocketCtor, type SocketLike, type V2ClientOpts,
} from './types';

export type Frame = Record<string, unknown>;

export const PING_INTERVAL_MS = 25_000;
export const PONG_TIMEOUT_MS = 10_000;
export const PROBE_TIMEOUT_MS = 5_000;
export const BACKOFF_BASE_MS = 1_000;
export const BACKOFF_MAX_MS = 30_000;
export const REQUEST_TIMEOUT_MS = 10_000;

const CONNECTING = 0;
const OPEN = 1;

/** Close codes after which the token is no good: 4001 auth_failed, 1008 revoked. */
const UNPAIRED_CODES = new Set([4001, 1008]);

/** Frames re-sent after every auth_ok (the server forgets them with the socket). */
const PERSISTENT = new Set(['chat.subscribe', 'chats.subscribe', 'workspaces.subscribe', 'app.settings']);

interface Pending {
  type: string;
  chatId: string | null;
  resolve: (frame: any) => void;
  reject: (err: Error) => void;
  timer: ReturnType<typeof setTimeout>;
  /** The socket the request went out on; null while it waits for a connection. */
  socket: SocketLike | null;
}

/** One chat subscription: what to resume from, and the subscribes still awaiting their chat.entries. */
interface ChatSub {
  /** Highest seq the client has been given (the replay's `after`). */
  head: number;
  /** `after` of each chat.subscribe not yet answered, oldest first. */
  awaiting: number[];
  /** A chat.snapshot seen for awaiting[0] (its chat.entries follow it). */
  snapSeq: number | null;
}

const lastSeq = (entries: unknown): number => {
  if (!Array.isArray(entries) || entries.length === 0) return 0;
  const e = entries[entries.length - 1] as { seq?: unknown };
  return typeof e?.seq === 'number' ? e.seq : 0;
};

export class V2Client {
  state: ConnState = 'offline';

  private readonly url: string;
  private readonly token: string;
  private readonly Impl: SocketCtor;
  private readonly now: () => number;
  private readonly random: () => number;

  private ws: SocketLike | null = null;
  private authed = false;
  /** close() was called (or never connected): no reconnects. */
  private stopped = true;
  private retryAttempt = 0;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private pingTimer: ReturnType<typeof setInterval> | null = null;
  private pongDeadline: ReturnType<typeof setTimeout> | null = null;
  private probeDeadline: ReturnType<typeof setTimeout> | null = null;
  private lastActivity = 0;

  private queue: Frame[] = [];
  private pending = new Map<string, Pending>();
  private reqSeq = 0;
  private readonly listeners = new Map<string, Set<(frame: any) => void>>();
  private readonly stateListeners = new Set<(s: ConnState) => void>();
  private readonly resubListeners = new Set<(chatId: string, after: number) => void>();

  private readonly chatSubs = new Map<string, ChatSub>();
  /** projectPath → its chats.subscribe frame (reqId included). */
  private readonly chatsSubs = new Map<string, Frame>();
  /** reqId of a chats.subscribe → its projectPath (chats.list.result doesn't echo it). */
  private readonly reqProject = new Map<string, string>();
  /** workspaces.subscribe / app.settings frames. */
  private readonly singletons = new Map<string, Frame>();

  constructor(opts: V2ClientOpts) {
    this.url = opts.url;
    this.token = opts.token;
    this.Impl = (opts.WebSocketImpl ?? (globalThis as unknown as { WebSocket: SocketCtor }).WebSocket) as SocketCtor;
    this.now = opts.now ?? (() => Date.now());
    this.random = opts.random ?? Math.random;
  }

  // ─── public surface ────────────────────────────────────────────────────────

  connect(): void {
    this.stopped = false;
    if (this.ws) return;
    if (this.reconnectTimer) { clearTimeout(this.reconnectTimer); this.reconnectTimer = null; }
    this.retryAttempt = 0;
    this.open();
  }

  close(): void {
    this.stopped = true;
    if (this.reconnectTimer) { clearTimeout(this.reconnectTimer); this.reconnectTimer = null; }
    this.clearTimers();
    const s = this.ws;
    this.ws = null;
    this.authed = false;
    if (s) { try { s.close(1000, 'client closed'); } catch { /* already closed */ } }
    this.rejectAll(() => true, 'closed', 'connection closed');
    this.setState('offline');
  }

  onState(cb: (s: ConnState) => void): () => void {
    this.stateListeners.add(cb);
    return () => { this.stateListeners.delete(cb); };
  }

  on(type: string, cb: (frame: any) => void): () => void {
    let set = this.listeners.get(type);
    if (!set) { set = new Set(); this.listeners.set(type, set); }
    set.add(cb);
    return () => { set!.delete(cb); };
  }

  /**
   * Called when a reconnect re-subscribes a live chat (one with no subscribe
   * outstanding) from its head. Its chat.snapshot/chat.entries answer this
   * replay, not any open the caller has in flight; a still-outstanding
   * subscribe is re-sent as itself and is not reported.
   */
  onResubscribe(cb: (chatId: string, after: number) => void): () => void {
    this.resubListeners.add(cb);
    return () => { this.resubListeners.delete(cb); };
  }

  /** True once auth_ok arrived on the current socket. */
  get connected(): boolean {
    return this.authed;
  }

  /**
   * Sends a frame. Subscriptions are remembered and re-sent after every
   * reconnect (chat.subscribe with the chat's current `after`); anything else
   * sent while not authenticated waits for the next auth_ok.
   */
  send(frame: Frame): void {
    const type = typeof frame.type === 'string' ? frame.type : '';
    this.track(frame, type);
    if (this.authed) { this.raw(frame); return; }
    if (PERSISTENT.has(type)) return; // the replay sends it
    if (type === 'chat.unsubscribe' || type === 'chats.unsubscribe') return; // the socket's subscriptions die with it
    this.queue.push(frame);
  }

  /** Sends `frame` with a fresh reqId; resolves with the reply carrying it, rejects on chat.error, timeout or a lost socket. */
  request<T = any>(frame: Frame, timeoutMs = REQUEST_TIMEOUT_MS): Promise<T> {
    const reqId = `r${++this.reqSeq}`;
    const full = { ...frame, reqId };
    const type = typeof frame.type === 'string' ? frame.type : '';
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        if (!this.pending.delete(reqId)) return;
        reject(new V2Error(`${type} timed out`, 'timeout'));
      }, timeoutMs);
      this.pending.set(reqId, {
        type, chatId: typeof frame.chatId === 'string' ? frame.chatId : null,
        resolve, reject, timer, socket: this.authed ? this.ws : null,
      });
      this.send(full);
    });
  }

  /**
   * Foreground probe. A dead or missing socket reconnects now (no backoff);
   * an authenticated one gets a ping and must show traffic within 5s.
   */
  resume(): void {
    if (this.stopped || this.state === 'unpaired') return;
    if (this.reconnectTimer) { clearTimeout(this.reconnectTimer); this.reconnectTimer = null; }
    const s = this.ws;
    if (!s || s.readyState > OPEN) {
      if (s) this.drop(s, false);
      this.retryAttempt = 0;
      this.open();
      return;
    }
    if (s.readyState === CONNECTING || !this.authed) return; // let the open/auth finish
    if (this.probeDeadline) return;
    try { s.send(JSON.stringify({ type: 'ping' })); } catch { this.kill(); return; }
    // Any frame clears the deadline; firing means nothing arrived since the ping.
    this.probeDeadline = setTimeout(() => {
      this.probeDeadline = null;
      if (this.ws === s && this.now() - this.lastActivity > PROBE_TIMEOUT_MS - 500) { this.retryAttempt = 0; this.kill(); }
    }, PROBE_TIMEOUT_MS);
  }

  // ─── socket lifecycle ──────────────────────────────────────────────────────

  private open(): void {
    this.clearTimers();
    this.authed = false;
    this.setState('connecting');
    let sock: SocketLike;
    try {
      sock = new this.Impl(this.url);
    } catch {
      this.ws = null;
      this.setState('offline');
      this.scheduleReconnect();
      return;
    }
    this.ws = sock;
    sock.onopen = () => {
      if (this.ws !== sock) return;
      try { sock.send(JSON.stringify({ type: 'auth', token: this.token })); } catch { /* onclose follows */ }
    };
    sock.onmessage = (ev) => {
      if (this.ws !== sock) return;
      this.lastActivity = this.now();
      if (this.pongDeadline) { clearTimeout(this.pongDeadline); this.pongDeadline = null; }
      if (this.probeDeadline) { clearTimeout(this.probeDeadline); this.probeDeadline = null; }
      let msg: Frame;
      try { msg = JSON.parse(typeof ev.data === 'string' ? ev.data : String(ev.data)); } catch { return; }
      if (!msg || typeof msg !== 'object') return;
      if (msg.type === 'auth_ok') {
        if (!this.authed) this.onAuthOk(sock);
        return;
      }
      this.receive(msg);
    };
    sock.onclose = (ev) => {
      if (this.ws !== sock) return;
      const code = typeof ev?.code === 'number' ? ev.code : 0;
      if (UNPAIRED_CODES.has(code)) {
        this.ws = null;
        this.authed = false;
        this.clearTimers();
        if (this.reconnectTimer) { clearTimeout(this.reconnectTimer); this.reconnectTimer = null; }
        this.rejectAll(() => true, 'unpaired', code === 4001 ? 'auth_failed' : 'revoked');
        this.setState('unpaired');
        return;
      }
      this.drop(sock, true);
    };
    sock.onerror = () => { /* onclose follows */ };
  }

  /** Forgets `sock`, fails what was in flight on it, and (optionally) schedules the reconnect. */
  private drop(sock: SocketLike, reconnect: boolean): void {
    if (this.ws === sock) this.ws = null;
    this.authed = false;
    this.clearTimers();
    this.rejectAll((p) => p.socket === sock, 'closed', 'connection lost');
    this.setState('offline');
    if (reconnect) this.scheduleReconnect();
  }

  /** Force-closes a zombie socket and goes through the backoff path. */
  private kill(): void {
    const s = this.ws;
    if (!s) return;
    this.ws = null; // its late onclose is ignored
    try { s.close(); } catch { /* ignore */ }
    this.drop(s, true);
  }

  private scheduleReconnect(): void {
    if (this.stopped || this.reconnectTimer || this.state === 'unpaired') return;
    const base = Math.min(BACKOFF_MAX_MS, BACKOFF_BASE_MS * 2 ** this.retryAttempt);
    const delay = base * (0.8 + this.random() * 0.4);
    this.retryAttempt++;
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      if (!this.stopped && !this.ws) this.open();
    }, delay);
  }

  private clearTimers(): void {
    if (this.pingTimer) { clearInterval(this.pingTimer); this.pingTimer = null; }
    if (this.pongDeadline) { clearTimeout(this.pongDeadline); this.pongDeadline = null; }
    if (this.probeDeadline) { clearTimeout(this.probeDeadline); this.probeDeadline = null; }
  }

  private onAuthOk(sock: SocketLike): void {
    this.authed = true;
    this.retryAttempt = 0;
    // Replay what the server forgot with the old socket.
    for (const [chatId, sub] of this.chatSubs) {
      sub.snapSeq = null;
      if (sub.awaiting.length) {
        for (const after of sub.awaiting) this.raw({ type: 'chat.subscribe', chatId, after });
        continue;
      }
      sub.awaiting = [sub.head];
      this.raw({ type: 'chat.subscribe', chatId, after: sub.head });
      for (const cb of [...this.resubListeners]) { try { cb(chatId, sub.head); } catch (err) { console.error('[v2] resubscribe listener failed', err); } }
    }
    for (const f of this.chatsSubs.values()) this.raw(f);
    for (const f of this.singletons.values()) this.raw(f);
    const queued = this.queue;
    this.queue = [];
    for (const f of queued) this.raw(f);
    for (const p of this.pending.values()) if (!p.socket) p.socket = sock;
    // Heartbeat: any traffic within 10s of each ping, or the socket is dead.
    this.pingTimer = setInterval(() => {
      if (this.ws !== sock) return;
      try { sock.send(JSON.stringify({ type: 'ping' })); } catch { this.kill(); return; }
      if (this.pongDeadline) return;
      const sentAt = this.now();
      this.pongDeadline = setTimeout(() => {
        this.pongDeadline = null;
        if (this.ws === sock && this.lastActivity < sentAt) this.kill();
      }, PONG_TIMEOUT_MS);
    }, PING_INTERVAL_MS);
    this.setState(this.catchingUp() ? 'catching_up' : 'open');
  }

  // ─── frames ────────────────────────────────────────────────────────────────

  private raw(frame: Frame): void {
    const s = this.ws;
    if (!s) return;
    try { s.send(JSON.stringify(frame)); } catch { /* onclose follows */ }
  }

  /** Records subscriptions so a reconnect can replay them. */
  private track(frame: Frame, type: string): void {
    const chatId = typeof frame.chatId === 'string' ? frame.chatId : null;
    const projectPath = typeof frame.projectPath === 'string' ? frame.projectPath : null;
    switch (type) {
      case 'chat.subscribe': {
        if (!chatId) return;
        const after = typeof frame.after === 'number' && frame.after > 0 ? frame.after : 0;
        let sub = this.chatSubs.get(chatId);
        if (!sub) { sub = { head: after, awaiting: [], snapSeq: null }; this.chatSubs.set(chatId, sub); }
        sub.awaiting.push(after);
        if (this.authed) this.setState('catching_up');
        return;
      }
      case 'chat.unsubscribe':
        if (chatId) this.chatSubs.delete(chatId);
        if (this.authed) this.setState(this.catchingUp() ? 'catching_up' : 'open');
        return;
      case 'chats.subscribe':
        if (!projectPath) return;
        this.chatsSubs.set(projectPath, frame);
        if (typeof frame.reqId === 'string') this.reqProject.set(frame.reqId, projectPath);
        return;
      case 'chats.unsubscribe':
        if (projectPath) this.untrackChats(projectPath);
        return;
      case 'workspaces.subscribe':
      case 'app.settings':
        this.singletons.set(type, frame);
        return;
    }
  }

  private untrackChats(projectPath: string): void {
    const f = this.chatsSubs.get(projectPath);
    if (f && typeof f.reqId === 'string') this.reqProject.delete(f.reqId);
    this.chatsSubs.delete(projectPath);
  }

  private receive(msg: Frame): void {
    const type = typeof msg.type === 'string' ? msg.type : '';
    const chatId = typeof msg.chatId === 'string' ? msg.chatId : null;
    const reqId = typeof msg.reqId === 'string' ? msg.reqId : null;

    // chats.list.result doesn't echo its projectPath: tag it.
    if (type === 'chats.list.result' && reqId && this.reqProject.has(reqId) && typeof msg.projectPath !== 'string') {
      msg = { ...msg, projectPath: this.reqProject.get(reqId) };
    }

    let catchUpChanged = false;
    if (chatId && (type === 'chat.snapshot' || type === 'chat.entries' || type === 'chat.entry')) {
      const sub = this.chatSubs.get(chatId);
      if (sub) {
        if (type === 'chat.snapshot' && sub.awaiting.length && typeof msg.seq === 'number') {
          sub.snapSeq = msg.seq;
        } else if (type === 'chat.entries') {
          if (sub.awaiting.length) { sub.awaiting.shift(); catchUpChanged = true; }
          // A snapshot resets the head (it may be lower: the log was reset).
          if (sub.snapSeq !== null) { sub.head = sub.snapSeq; sub.snapSeq = null; }
          sub.head = Math.max(sub.head, lastSeq(msg.entries));
        } else if (type === 'chat.entry' && !sub.awaiting.length) {
          // While a subscribe is outstanding, live entries belong to the one it
          // replaces: the replay must keep the outstanding subscribe's `after`.
          const seq = (msg.entry as { seq?: unknown } | undefined)?.seq;
          if (typeof seq === 'number' && seq > sub.head) sub.head = seq;
        }
      }
    }

    if (type === 'chat.error' && !reqId) {
      if (chatId && msg.code === 'read_failed') {
        // That chat's subscribe failed.
        const sub = this.chatSubs.get(chatId);
        if (sub?.awaiting.length) { sub.awaiting.shift(); sub.snapSeq = null; catchUpChanged = true; }
      } else if (chatId && msg.code === 'unknown_chat') {
        // chat.page's error carries no reqId.
        this.rejectAll((p) => p.type === 'chat.page' && p.chatId === chatId, 'unknown_chat', String(msg.message ?? 'unknown chat'));
      } else if (!chatId && msg.message === CHAT_LOG_UNAVAILABLE_MESSAGE) {
        // Main's chat log isn't built yet: every chat frame on this socket failed.
        for (const sub of this.chatSubs.values()) {
          if (sub.awaiting.length) { sub.awaiting = []; sub.snapSeq = null; catchUpChanged = true; }
        }
        this.rejectAll((p) => p.type.startsWith('chat.') || p.type.startsWith('chats.'), 'unavailable', CHAT_LOG_UNAVAILABLE_MESSAGE);
      }
    }

    if (reqId) {
      const p = this.pending.get(reqId);
      if (p) {
        this.pending.delete(reqId);
        clearTimeout(p.timer);
        if (type === 'chat.error') p.reject(new V2Error(String(msg.message ?? 'request failed'), String(msg.code ?? 'error')));
        else p.resolve(msg);
      }
      if (type === 'chat.error' && this.reqProject.has(reqId)) this.untrackChats(this.reqProject.get(reqId)!);
    }

    const set = this.listeners.get(type);
    if (set) for (const cb of [...set]) { try { cb(msg); } catch (err) { console.error('[v2] listener failed', type, err); } }

    if (catchUpChanged && this.authed) this.setState(this.catchingUp() ? 'catching_up' : 'open');
  }

  private catchingUp(): boolean {
    for (const sub of this.chatSubs.values()) if (sub.awaiting.length) return true;
    return false;
  }

  private rejectAll(match: (p: Pending) => boolean, code: string, message: string): void {
    for (const [id, p] of [...this.pending]) {
      if (!match(p)) continue;
      this.pending.delete(id);
      clearTimeout(p.timer);
      p.reject(new V2Error(message, code));
    }
  }

  private setState(s: ConnState): void {
    if (this.state === s) return;
    this.state = s;
    for (const cb of [...this.stateListeners]) { try { cb(s); } catch (err) { console.error('[v2] state listener failed', err); } }
  }
}
