// Chat protocol v2 on the bridge WebSocket: per-chat subscriptions over the
// durable chat log (snapshot + seq catch-up + live entries) and idempotent
// commands through ChatCommands. Frames are documented in README.md ("v2").
import type { ChatCommand, CommandResult } from '../chatlog/commands';
import type { ChatEvent, ChatLogEntry, ChatSettings, ChatSnapshot, ChatState } from '../../../src/lib/chat/types';
import type { ChatSync } from '../chatlog/holder';
import { emptyChatState } from '../../../src/lib/chat/reducer';
import type { SessionBus } from './session-bus';
import type { RemoteWorkspace } from './renderer-proxy';
import type { WorkspaceRegistry } from './workspaceRegistry';
import type { AppSettingsFeed } from './appSettings';
import type { FileReadResult } from './fileRead';
import { parsePushRegistration, type PushRegistry } from '../push/registry';
import type { PhonePresence } from '../push/presence';

type Provider = ChatSettings['provider'];

/** Background-task snapshots per chat (backgroundTasksFeed in production). */
export interface BackgroundTasksSource {
  /** The chat's latest tasks ([] when none). */
  latest(chatId: string): unknown[];
  onChange(cb: (p: { scope: string; tasks: unknown[] }) => void): () => void;
}

/** The socket surface ChatV2 needs (a `ws` WebSocket in production). */
export interface V2Socket { send(data: string): void }

export interface ChatV2Opts {
  bus: SessionBus;
  /** The chat log (null until main has built it). */
  chat: () => Pick<ChatSync, 'store' | 'commands'> | null;
  /** Writes data-URL images to temp files; returns their paths (the v1 prompt writer). */
  saveImages?: (dataUrls: string[]) => string[];
  /** The renderer-reported workspace list (workspaces.subscribe). */
  workspaces?: WorkspaceRegistry;
  /** Used once by workspaces.subscribe while the renderer hasn't reported a list yet (the proxied v1 list). */
  listWorkspacesFallback?: () => Promise<RemoteWorkspace[]>;
  /** The phone-visible app settings (app.settings). */
  appSettings?: AppSettingsFeed;
  /** chats.changed throttle window (ms). */
  chatsThrottleMs?: number;
  /** models.list: the provider's list (the same function as its <provider>:models IPC). */
  listModels?: (provider: Provider) => Promise<unknown> | unknown;
  /** slash.list for a Claude chat (claude:refreshSlashCommands). */
  slashCommands?: (projectPath: string, chatId: string) => Promise<unknown[]> | unknown[];
  /** file.read (see fileRead.ts). */
  readFile?: (kind: unknown, ref: unknown) => Promise<FileReadResult> | FileReadResult;
  /** chat.background: the claude:backgroundTasks snapshots. */
  backgroundTasks?: BackgroundTasksSource;
  /** push.register / push.unregister / phone.presence (push notifications). */
  push?: {
    registry: Pick<PushRegistry, 'set' | 'delete'>;
    presence: Pick<PhonePresence, 'set' | 'clear'>;
    /** False once the device is revoked or superseded by a re-pair (its old sockets may still be open). */
    isLiveDevice: (deviceId: string) => boolean;
  };
}

/** Who sent a frame: the paired device bridge auth resolved (auth_ok). */
export interface V2FrameContext { deviceId?: string | null }

/** Most chats.subscribe projects one socket may hold. */
export const MAX_CHAT_LIST_SUBS = 32;

/** Most chat.subscribe chats one socket may hold (each adds a bus and a background-tasks listener). */
export const MAX_CHAT_SUBS = 64;

/** chats.changed is sent at most once per this window per subscribed project (trailing edge). */
export const CHATS_THROTTLE_MS = 500;

/** Messages a snapshot frame carries; the rest are counted in olderCount and paged with chat.page. */
export const SNAPSHOT_MESSAGES = 200;
export const PAGE_LIMIT = 200;
const MAX_IMAGES = 8;
const MAX_IMAGE_BYTES = 24 * 1024 * 1024;
const PROVIDERS = ['claude', 'codex', 'gemini', 'kimi'] as const;
const SETTINGS_KEYS = ['provider', 'model', 'permMode', 'effort', 'approvalMode', 'conversationMode'] as const;
/** Frame types outside the chat./chats. namespaces that ChatV2 handles. */
const OTHER_V2_TYPES = new Set([
  'workspaces.subscribe', 'app.settings', 'models.list', 'slash.list', 'file.read',
  'push.register', 'push.unregister', 'phone.presence',
]);

interface Sub {
  /** Highest seq sent to the client. */
  last: number;
  /** False while catching up: live entries are buffered. */
  live: boolean;
  buffer: ChatLogEntry[];
  unsub: () => void;
}

/** A chats.subscribe: one project's chat list, pushed on any list-row change. */
interface ChatsSub {
  /** The projectPath as the client sent it (echoed in chats.changed). */
  projectPath: string;
  /** Its realpath, as ChatLogStore matches projects. */
  real: string;
  timer: NodeJS.Timeout | null;
  unsub: () => void;
}

/** Per-socket subscriptions other than single chats. */
interface SockExtras {
  /** realpath → subscription (a Map: never a raw object key). */
  chats: Map<string, ChatsSub>;
  workspaces: (() => void) | null;
  settings: (() => void) | null;
}

type Frame = { type?: unknown; [k: string]: unknown };

const str = (v: unknown): string | null => (typeof v === 'string' && v ? v : null);
/**
 * The chat log's safe id shape (ChatLogStore SAFE_ID), minus names that exist
 * on Object.prototype ('__proto__', 'constructor', 'toString', …): those match
 * the shape but are never real chat ids (UUID-like), so they are refused.
 */
const CHAT_ID = /^[A-Za-z0-9_-]{1,128}$/;
const chatIdOf = (v: unknown): string | null =>
  (typeof v === 'string' && CHAT_ID.test(v) && !(v in Object.prototype) ? v : null);

/** The last SNAPSHOT_MESSAGES messages of a state; turn.startIndex shifts with the cut. */
export function trimForWire(state: ChatState): { state: ChatState; olderCount: number } {
  const olderCount = Math.max(0, state.messages.length - SNAPSHOT_MESSAGES);
  if (olderCount === 0) return { state, olderCount };
  const si = state.turn.startIndex;
  return {
    state: {
      ...state,
      messages: state.messages.slice(olderCount),
      turn: si == null ? state.turn : { ...state.turn, startIndex: Math.max(0, si - olderCount) },
    },
    olderCount,
  };
}

/** Data-URL images only, capped in count and total size (same limits as the v1 prompt). */
export function pickImages(raw: unknown): string[] | undefined {
  if (!Array.isArray(raw)) return undefined;
  const out: string[] = [];
  let total = 0;
  for (const it of raw) {
    if (typeof it !== 'string' || !/^data:image\/[\w+.-]+;base64,/.test(it)) continue;
    total += it.length;
    if (total > MAX_IMAGE_BYTES) break;
    out.push(it);
    if (out.length >= MAX_IMAGES) break;
  }
  return out.length ? out : undefined;
}

/** Frame types ChatV2 handles (bridge routing). */
export function isV2FrameType(type: unknown): boolean {
  return typeof type === 'string'
    && (type.startsWith('chat.') || type.startsWith('chats.') || OTHER_V2_TYPES.has(type));
}

export class ChatV2 {
  private readonly socks = new Map<V2Socket, Map<string, Sub>>();
  private readonly extras = new Map<V2Socket, SockExtras>();
  /** Sockets detached (closed) while an async subscribe was in flight. */
  private readonly closed = new WeakSet<V2Socket>();
  /** Sockets with a file.read in flight (a read can be 25 MB, synchronous on the main thread). */
  private readonly reading = new WeakSet<V2Socket>();

  constructor(private readonly opts: ChatV2Opts) {}

  /** Handles one authenticated v2 frame (see isV2FrameType). */
  async handle(ws: V2Socket, msg: Frame, ctx: V2FrameContext = {}): Promise<void> {
    if (msg.type === 'push.register' || msg.type === 'push.unregister' || msg.type === 'phone.presence') {
      return this.pushFrame(ws, msg, ctx.deviceId ?? null);
    }
    if (msg.type === 'workspaces.subscribe') return this.subscribeWorkspaces(ws, msg.reqId);
    if (msg.type === 'app.settings') return this.appSettings(ws, msg.reqId);
    if (msg.type === 'models.list') return this.listModels(ws, msg.reqId, msg.provider);
    if (msg.type === 'file.read') return this.readFile(ws, msg.reqId, msg.kind, msg.ref);
    if (msg.type === 'slash.list') return this.slashList(ws, msg.reqId, msg.projectPath, msg.chatId);
    const chat = this.opts.chat();
    if (!chat) {
      // Echo what identifies the failed frame: its reqId, chat id and (for a
      // command) clientId, so a client can match the error exactly.
      const raw = msg.command && typeof msg.command === 'object' ? msg.command as Frame : null;
      const clientId = msg.type === 'chat.command' && raw ? str(raw.clientId) : null;
      const chatId = chatIdOf(msg.type === 'chat.command' ? raw?.chatId : msg.chatId);
      return this.error(ws, chatId, 'unavailable', 'chat log is not available', msg.reqId, clientId);
    }
    switch (msg.type) {
      case 'chat.subscribe': {
        const chatId = chatIdOf(msg.chatId);
        if (!chatId) return this.error(ws, null, 'bad_request', 'valid chatId required');
        const after = typeof msg.after === 'number' && Number.isInteger(msg.after) && msg.after > 0 ? msg.after : 0;
        const held = this.socks.get(ws);
        if (held && !held.has(chatId) && held.size >= MAX_CHAT_SUBS) {
          // read_failed: one answer per subscribe that the phone settles the open on (like a failed read).
          return this.error(ws, chatId, 'read_failed', 'too many chat subscriptions', msg.reqId);
        }
        return this.subscribe(ws, chat, chatId, after);
      }
      case 'chat.unsubscribe': {
        const chatId = chatIdOf(msg.chatId);
        if (chatId) this.unsubscribe(ws, chatId);
        return;
      }
      case 'chats.list': {
        const projectPath = str(msg.projectPath);
        if (!projectPath) return this.error(ws, null, 'bad_request', 'projectPath required');
        // ChatLogStore.list matches by realpath (/home may be a symlink to /var/home).
        return this.send(ws, { type: 'chats.list.result', reqId: msg.reqId, chats: chat.store.list(projectPath) });
      }
      case 'chats.subscribe': {
        const projectPath = str(msg.projectPath);
        if (!projectPath) return this.error(ws, null, 'bad_request', 'projectPath required');
        return this.subscribeChats(ws, chat, projectPath, msg.reqId);
      }
      case 'chats.unsubscribe': {
        const projectPath = str(msg.projectPath);
        if (projectPath) this.unsubscribeChats(ws, chat.store.realPath(projectPath));
        return;
      }
      case 'chat.page': {
        const chatId = chatIdOf(msg.chatId);
        if (!chatId) return this.error(ws, null, 'bad_request', 'valid chatId required');
        const state = chat.store.state(chatId);
        if (!state) return this.error(ws, chatId, 'unknown_chat', `unknown chat ${chatId}`, msg.reqId);
        const n = state.messages.length;
        const before = typeof msg.beforeIndex === 'number' && Number.isFinite(msg.beforeIndex)
          ? Math.min(n, Math.max(0, Math.floor(msg.beforeIndex))) : n;
        const limit = typeof msg.limit === 'number' && Number.isFinite(msg.limit)
          ? Math.min(PAGE_LIMIT, Math.max(1, Math.floor(msg.limit))) : PAGE_LIMIT;
        const start = Math.max(0, before - limit);
        return this.send(ws, { type: 'chat.page.result', reqId: msg.reqId, chatId, messages: state.messages.slice(start, before), olderCount: start });
      }
      case 'chat.command': {
        const raw = msg.command && typeof msg.command === 'object' ? msg.command as Frame : null;
        const clientId = raw ? str(raw.clientId) : null;
        if (!raw || !clientId) return this.error(ws, chatIdOf(raw?.chatId), 'bad_request', 'command with clientId required');
        let cmd: ChatCommand;
        try { cmd = this.toCommand(raw, clientId, chat); } catch (err) {
          return this.ack(ws, { clientId, ok: false, duplicate: false, error: errText(err) });
        }
        let result: CommandResult;
        try { result = await chat.commands.run(cmd); } catch (err) {
          result = { clientId, ok: false, duplicate: false, error: errText(err) };
        }
        return this.ack(ws, result);
      }
      default:
        return this.error(ws, null, 'unknown_type', `unknown frame type ${String(msg.type)}`);
    }
  }

  /** Drops every subscription the socket holds (socket closed). */
  detach(ws: V2Socket): void {
    this.closed.add(ws);
    this.opts.push?.presence.clear(ws);
    const ex = this.extras.get(ws);
    if (ex) {
      for (const c of ex.chats.values()) { c.unsub(); if (c.timer) clearTimeout(c.timer); }
      ex.workspaces?.();
      ex.settings?.();
      this.extras.delete(ws);
    }
    const subs = this.socks.get(ws);
    if (!subs) return;
    for (const sub of subs.values()) sub.unsub();
    this.socks.delete(ws);
  }

  // ─── workspaces, chat lists, app settings ──────────────────────────────────

  private extrasOf(ws: V2Socket): SockExtras {
    let ex = this.extras.get(ws);
    if (!ex) { ex = { chats: new Map(), workspaces: null, settings: null }; this.extras.set(ws, ex); }
    return ex;
  }

  /**
   * Replies with the renderer-reported list, then pushes workspaces.changed on
   * every registry change. Until the renderer has reported, the reply falls
   * back once to the proxied v1 list (a report landing meanwhile wins).
   */
  private async subscribeWorkspaces(ws: V2Socket, reqId: unknown): Promise<void> {
    const reg = this.opts.workspaces;
    const ex = this.extrasOf(ws);
    ex.workspaces?.();
    ex.workspaces = null;
    let ready = false;
    const unsub = reg?.onChange((workspaces) => {
      if (ready) this.send(ws, { type: 'workspaces.changed', workspaces });
    }) ?? null;
    ex.workspaces = unsub;
    let list = reg?.get() ?? null;
    if (!list) {
      let fallback: RemoteWorkspace[] = [];
      try { fallback = (await this.opts.listWorkspacesFallback?.()) ?? []; } catch { /* renderer unavailable: empty */ }
      if (this.closed.has(ws) || ex.workspaces !== unsub) return; // closed or re-subscribed meanwhile
      list = reg?.get() ?? fallback;
    }
    this.send(ws, { type: 'workspaces.list.result', reqId, workspaces: list });
    ready = true;
  }

  private subscribeChats(ws: V2Socket, chat: Pick<ChatSync, 'store'>, projectPath: string, reqId: unknown): void {
    const store = chat.store;
    const real = store.realPath(projectPath);
    const ex = this.extrasOf(ws);
    if (!ex.chats.has(real) && ex.chats.size >= MAX_CHAT_LIST_SUBS) {
      return this.error(ws, null, 'bad_request', 'too many chat-list subscriptions', reqId);
    }
    this.unsubscribeChats(ws, real);
    const throttleMs = this.opts.chatsThrottleMs ?? CHATS_THROTTLE_MS;
    const sub: ChatsSub = { projectPath, real, timer: null, unsub: () => {} };
    // Trailing-edge throttle: the first change in a window arms the timer; the
    // push carries the list as it is when the timer fires (streaming deltas
    // collapse into one push per window).
    sub.unsub = store.onMetaChange((_chatId, chatProject) => {
      if (sub.timer || store.realPath(chatProject) !== real) return;
      sub.timer = setTimeout(() => {
        sub.timer = null;
        if (ex.chats.get(real) !== sub) return;
        let chats;
        try { chats = store.list(projectPath); } catch { return; }
        this.send(ws, { type: 'chats.changed', projectPath, chats });
      }, throttleMs);
      sub.timer.unref?.();
    });
    ex.chats.set(real, sub);
    this.send(ws, { type: 'chats.list.result', reqId, chats: store.list(projectPath) });
  }

  private unsubscribeChats(ws: V2Socket, real: string): void {
    const sub = this.extras.get(ws)?.chats.get(real);
    if (!sub) return;
    sub.unsub();
    if (sub.timer) clearTimeout(sub.timer);
    this.extras.get(ws)!.chats.delete(real);
  }

  /** Replies with the phone-visible settings; later changes push app.settings.changed. */
  private appSettings(ws: V2Socket, reqId: unknown): void {
    const feed = this.opts.appSettings;
    if (!feed) return this.error(ws, null, 'unavailable', 'app settings are not available');
    const ex = this.extrasOf(ws);
    if (!ex.settings) ex.settings = feed.onChange((settings) => this.send(ws, { type: 'app.settings.changed', settings }));
    let settings;
    try { settings = feed.get(); } catch (err) { return this.error(ws, null, 'read_failed', errText(err)); }
    this.send(ws, { type: 'app.settings.result', reqId, settings });
  }

  // ─── push notifications ────────────────────────────────────────────────────

  /**
   * push.register {reqId, pushId, sendSecret, secretId, sealKey, keyId, env}
   * → push.registered {reqId}; a replay (reconnect) is acked without a write.
   * push.unregister {reqId} → push.unregistered {reqId}.
   * phone.presence {chatId: string|null, foreground} (no reply; per socket).
   * Keyed by the authenticated deviceId, never by anything the phone sends.
   */
  private pushFrame(ws: V2Socket, msg: Frame, deviceId: string | null): void {
    const push = this.opts.push;
    if (!push) return this.error(ws, null, 'unavailable', 'push notifications are not available', msg.reqId);
    if (!deviceId || !push.isLiveDevice(deviceId)) return this.error(ws, null, 'unauthorized', 'no paired device', msg.reqId);
    if (msg.type === 'phone.presence') {
      if (typeof msg.foreground !== 'boolean') return;
      const chatId = msg.chatId === null ? null : chatIdOf(msg.chatId);
      if (msg.chatId !== null && !chatId) return;
      push.presence.set(deviceId, ws, { chatId, foreground: msg.foreground });
      return;
    }
    if (msg.type === 'push.unregister') {
      push.registry.delete(deviceId);
      return this.send(ws, { type: 'push.unregistered', reqId: msg.reqId });
    }
    const reg = parsePushRegistration(msg);
    if ('error' in reg) return this.error(ws, null, 'bad_request', `invalid ${reg.error}`, msg.reqId);
    try { push.registry.set(deviceId, reg); } catch (err) {
      return this.error(ws, null, 'internal', errText(err), msg.reqId);
    }
    this.send(ws, { type: 'push.registered', reqId: msg.reqId });
  }

  // ─── models, slash commands, files ─────────────────────────────────────────

  private async listModels(ws: V2Socket, reqId: unknown, raw: unknown): Promise<void> {
    const provider = PROVIDERS.find((p) => p === raw);
    if (!provider) return this.error(ws, null, 'bad_request', 'valid provider required', reqId);
    if (!this.opts.listModels) return this.error(ws, null, 'unavailable', 'model lists are not available', reqId);
    let models: unknown;
    try { models = await this.opts.listModels(provider); } catch (err) {
      return this.error(ws, null, 'read_failed', errText(err), reqId);
    }
    this.send(ws, { type: 'models.list.result', reqId, provider, models });
  }

  /**
   * The chat's slash commands: Claude chats re-pull the live list
   * (claude:refreshSlashCommands, scope = chat id); other providers have none.
   * An existing chat uses its logged projectPath and provider.
   */
  private async slashList(ws: V2Socket, reqId: unknown, rawPath: unknown, rawChatId: unknown): Promise<void> {
    const chatId = chatIdOf(rawChatId);
    const sentPath = str(rawPath);
    if (!chatId || !sentPath) return this.error(ws, null, 'bad_request', 'projectPath and valid chatId required', reqId);
    const store = this.opts.chat()?.store ?? null;
    const meta = store?.meta(chatId) ?? null;
    const provider: Provider = store?.state(chatId)?.settings.provider ?? meta?.provider ?? 'claude';
    if (provider !== 'claude' || !this.opts.slashCommands) {
      return this.send(ws, { type: 'slash.list.result', reqId, commands: [] });
    }
    let commands: unknown[];
    try {
      const res = await this.opts.slashCommands(meta ? meta.projectPath : sentPath, chatId);
      commands = Array.isArray(res) ? res : [];
    } catch (err) {
      return this.error(ws, chatId, 'read_failed', errText(err), reqId);
    }
    this.send(ws, { type: 'slash.list.result', reqId, commands });
  }

  private async readFile(ws: V2Socket, reqId: unknown, kind: unknown, ref: unknown): Promise<void> {
    if (this.reading.has(ws)) return this.error(ws, null, 'busy', 'a file read is already in flight', reqId);
    let result: FileReadResult;
    if (!this.opts.readFile) result = { error: 'unavailable' };
    else {
      this.reading.add(ws);
      try { result = await this.opts.readFile(kind, ref); } catch { result = { error: 'read_failed' }; } finally { this.reading.delete(ws); }
    }
    this.send(ws, { type: 'file.read.result', reqId, ...result });
  }

  // ─── subscriptions ─────────────────────────────────────────────────────────

  /**
   * Attach the bus listener first (buffering), then read. Send a snapshot if
   * the read has one, then the entries after it, then the buffered live
   * entries past what was sent, then go live. A client whose `after` is ahead
   * of the log (it was reset) gets a snapshot of the current state.
   */
  private subscribe(ws: V2Socket, chat: Pick<ChatSync, 'store'>, chatId: string, after: number): void {
    this.unsubscribe(ws, chatId);
    let subs = this.socks.get(ws);
    if (!subs) { subs = new Map(); this.socks.set(ws, subs); }
    const sub: Sub = { last: after, live: false, buffer: [], unsub: () => {} };
    subs.set(chatId, sub);
    const busUnsub = this.opts.bus.subscribe(`chatlog:${chatId}`, (e) => {
      const entry = e as unknown as ChatLogEntry;
      if (!entry || typeof entry.seq !== 'number') return;
      if (!sub.live) sub.buffer.push(entry);
      else this.deliver(ws, chatId, sub, entry);
    });
    // chat.background: the chat's background tasks (scope = chat id), current
    // list first, then every change while subscribed.
    const bg = this.opts.backgroundTasks;
    const bgUnsub = bg?.onChange((p) => {
      if (p && p.scope === chatId) this.send(ws, { type: 'chat.background', chatId, tasks: Array.isArray(p.tasks) ? p.tasks : [] });
    }) ?? null;
    sub.unsub = () => { busUnsub(); bgUnsub?.(); };

    let snapshot: ChatSnapshot | null;
    let entries: ChatLogEntry[];
    try {
      const res = chat.store.read(chatId, after);
      snapshot = res.snapshot;
      entries = res.entries;
      // No log yet: its first entries (seq 1..) arrive live, whatever `after`
      // was. A client ahead of that gets an empty snapshot at seq 0 so it
      // resets its head instead of dropping them as duplicates.
      if (!res.meta) {
        sub.last = 0;
        if (after > 0) snapshot = { chatId, seq: 0, state: emptyChatState({ provider: 'claude' }) };
      }
      if (res.meta && after > res.headSeq) {
        const state = chat.store.state(chatId);
        snapshot = state ? { chatId, seq: res.headSeq, state } : null;
        entries = [];
      }
    } catch (err) {
      this.unsubscribe(ws, chatId);
      return this.error(ws, chatId, 'read_failed', errText(err));
    }

    if (snapshot) {
      const { state, olderCount } = trimForWire(snapshot.state);
      this.send(ws, { type: 'chat.snapshot', chatId, seq: snapshot.seq, state, olderCount });
      sub.last = snapshot.seq;
    }
    const batch = entries.filter((e) => e.seq > sub.last);
    this.send(ws, { type: 'chat.entries', chatId, entries: batch });
    if (batch.length) sub.last = batch[batch.length - 1].seq;
    sub.live = true;
    const held = sub.buffer.sort((a, b) => a.seq - b.seq);
    sub.buffer = [];
    for (const e of held) this.deliver(ws, chatId, sub, e);
    if (bg) {
      let tasks: unknown[] = [];
      try { tasks = bg.latest(chatId); } catch { /* none */ }
      this.send(ws, { type: 'chat.background', chatId, tasks });
    }
  }

  private unsubscribe(ws: V2Socket, chatId: string): void {
    const subs = this.socks.get(ws);
    const sub = subs?.get(chatId);
    if (!subs || !sub) return;
    sub.unsub();
    subs.delete(chatId);
    if (subs.size === 0) this.socks.delete(ws);
  }

  private deliver(ws: V2Socket, chatId: string, sub: Sub, entry: ChatLogEntry): void {
    if (entry.seq <= sub.last) return;
    sub.last = entry.seq;
    this.send(ws, { type: 'chat.entry', chatId, entry });
  }

  // ─── commands ──────────────────────────────────────────────────────────────

  /**
   * Builds a ChatCommand from the phone's frame with only the fields a phone
   * may set. Sends and settings are `origin: 'remote'` (capped by the remote
   * ceiling); an existing chat keeps its logged projectPath.
   */
  private toCommand(raw: Frame, clientId: string, chat: Pick<ChatSync, 'store'>): ChatCommand {
    const chatId = chatIdOf(raw.chatId);
    if (!chatId) throw new Error('invalid chatId');
    const meta = chat.store.meta(chatId);
    const projectPath = meta ? meta.projectPath : (str(raw.projectPath) ?? '');
    const toolUseId = (): string => {
      const id = str(raw.toolUseId);
      if (!id) throw new Error('toolUseId required');
      return id;
    };
    const target = (): string => {
      const t = str(raw.target);
      if (!t) throw new Error('target required');
      return t;
    };
    const base = { chatId, clientId };
    switch (raw.kind) {
      case 'send': {
        // Images arrive as data URLs; imagePaths from the phone is ignored.
        const images = pickImages(raw.images);
        const imagePaths = images && this.opts.saveImages ? this.opts.saveImages(images) : [];
        const provider = PROVIDERS.find((p) => p === raw.provider);
        return {
          kind: 'send', ...base, origin: 'remote', projectPath,
          text: typeof raw.text === 'string' ? raw.text : '',
          ...(images ? { images } : {}),
          ...(imagePaths.length ? { imagePaths } : {}),
          ...(raw.now === true ? { now: true } : {}),
          ...(provider ? { provider } : {}),
          ...(typeof raw.label === 'string' && raw.label ? { label: raw.label } : {}),
        };
      }
      case 'approve':
        if (typeof raw.approved !== 'boolean') throw new Error('approved required');
        return {
          kind: 'approve', ...base, toolUseId: toolUseId(), approved: raw.approved,
          ...(typeof raw.modifiedCommand === 'string' ? { modifiedCommand: raw.modifiedCommand } : {}),
        };
      case 'answer':
        if (!raw.answers || typeof raw.answers !== 'object' || Array.isArray(raw.answers)) throw new Error('answers required');
        return { kind: 'answer', ...base, toolUseId: toolUseId(), answers: raw.answers as Record<string, string | string[]> };
      case 'planReview':
        if (typeof raw.approved !== 'boolean') throw new Error('approved required');
        return { kind: 'planReview', ...base, toolUseId: toolUseId(), approved: raw.approved };
      case 'interrupt':
        return { kind: 'interrupt', ...base };
      case 'settings': {
        const src = raw.settings && typeof raw.settings === 'object' ? raw.settings as Record<string, unknown> : null;
        if (!src) throw new Error('settings required');
        const settings: Partial<ChatSettings> = {};
        for (const k of SETTINGS_KEYS) {
          const v = src[k];
          if (typeof v !== 'string') continue;
          if (k === 'provider') {
            const p = PROVIDERS.find((x) => x === v);
            if (p) settings.provider = p;
          } else settings[k] = v;
        }
        return { kind: 'settings', ...base, settings, origin: 'remote', ...(projectPath ? { projectPath } : {}) };
      }
      case 'queueRemove': return { kind: 'queueRemove', ...base, target: target() };
      case 'queuePromote': return { kind: 'queuePromote', ...base, target: target() };
      case 'queueClear': return { kind: 'queueClear', ...base };
      case 'clear': return { kind: 'clear', ...base };
      case 'compact': return { kind: 'compact', ...base, origin: 'remote', ...(raw.queue === true ? { queue: true } : {}) };
      case 'clientEvent': {
        // ChatCommands checks the event type (local_note, watcher_snapshot, local user_message) and keeps only its fields.
        if (!raw.ev || typeof raw.ev !== 'object' || Array.isArray(raw.ev)) throw new Error('ev required');
        const provider = PROVIDERS.find((p) => p === raw.provider);
        return {
          kind: 'clientEvent', ...base, ev: raw.ev as ChatEvent, origin: 'remote',
          ...(projectPath ? { projectPath } : {}), ...(provider ? { provider } : {}),
        };
      }
      case 'stopTask': {
        const taskId = str(raw.taskId);
        if (!taskId) throw new Error('taskId required');
        return { kind: 'stopTask', ...base, taskId };
      }
      default:
        throw new Error(`unknown command ${String(raw.kind)}`);
    }
  }

  // ─── frames ────────────────────────────────────────────────────────────────

  private ack(ws: V2Socket, result: CommandResult): void {
    this.send(ws, { type: 'chat.ack', result });
  }

  private error(ws: V2Socket, chatId: string | null, code: string, message: string, reqId?: unknown, clientId?: string | null): void {
    this.send(ws, {
      type: 'chat.error', ...(reqId !== undefined ? { reqId } : {}), ...(chatId ? { chatId } : {}),
      ...(clientId ? { clientId } : {}), code, message,
    });
  }

  private send(ws: V2Socket, frame: Record<string, unknown>): void {
    try { ws.send(JSON.stringify({ v: 2, ...frame })); } catch { /* socket closed */ }
  }
}

function errText(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
