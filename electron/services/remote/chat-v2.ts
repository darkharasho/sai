// Chat protocol v2 on the bridge WebSocket: per-chat subscriptions over the
// durable chat log (snapshot + seq catch-up + live entries) and idempotent
// commands through ChatCommands. Frames are documented in README.md ("v2").
import type { ChatCommand, CommandResult } from '../chatlog/commands';
import type { ChatLogEntry, ChatSettings, ChatSnapshot, ChatState } from '../../../src/lib/chat/types';
import type { ChatSync } from '../chatlog/holder';
import { emptyChatState } from '../../../src/lib/chat/reducer';
import type { SessionBus } from './session-bus';

/** The socket surface ChatV2 needs (a `ws` WebSocket in production). */
export interface V2Socket { send(data: string): void }

export interface ChatV2Opts {
  bus: SessionBus;
  /** The chat log (null until main has built it). */
  chat: () => Pick<ChatSync, 'store' | 'commands'> | null;
  /** Writes data-URL images to temp files; returns their paths (the v1 prompt writer). */
  saveImages?: (dataUrls: string[]) => string[];
}

/** Messages a snapshot frame carries; the rest are counted in olderCount and paged with chat.page. */
export const SNAPSHOT_MESSAGES = 200;
export const PAGE_LIMIT = 200;
const MAX_IMAGES = 8;
const MAX_IMAGE_BYTES = 24 * 1024 * 1024;
const PROVIDERS = ['claude', 'codex', 'gemini', 'kimi'] as const;
const SETTINGS_KEYS = ['provider', 'model', 'permMode', 'effort', 'approvalMode', 'conversationMode'] as const;

interface Sub {
  /** Highest seq sent to the client. */
  last: number;
  /** False while catching up: live entries are buffered. */
  live: boolean;
  buffer: ChatLogEntry[];
  unsub: () => void;
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

export class ChatV2 {
  private readonly socks = new Map<V2Socket, Map<string, Sub>>();

  constructor(private readonly opts: ChatV2Opts) {}

  /** Handles one authenticated frame whose type is `chat.*` or `chats.list`. */
  async handle(ws: V2Socket, msg: Frame): Promise<void> {
    const chat = this.opts.chat();
    if (!chat) return this.error(ws, null, 'unavailable', 'chat log is not available');
    switch (msg.type) {
      case 'chat.subscribe': {
        const chatId = chatIdOf(msg.chatId);
        if (!chatId) return this.error(ws, null, 'bad_request', 'valid chatId required');
        const after = typeof msg.after === 'number' && Number.isInteger(msg.after) && msg.after > 0 ? msg.after : 0;
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
      case 'chat.page': {
        const chatId = chatIdOf(msg.chatId);
        if (!chatId) return this.error(ws, null, 'bad_request', 'valid chatId required');
        const state = chat.store.state(chatId);
        if (!state) return this.error(ws, chatId, 'unknown_chat', `unknown chat ${chatId}`);
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
    const subs = this.socks.get(ws);
    if (!subs) return;
    for (const sub of subs.values()) sub.unsub();
    this.socks.delete(ws);
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
    sub.unsub = this.opts.bus.subscribe(`chatlog:${chatId}`, (e) => {
      const entry = e as unknown as ChatLogEntry;
      if (!entry || typeof entry.seq !== 'number') return;
      if (!sub.live) sub.buffer.push(entry);
      else this.deliver(ws, chatId, sub, entry);
    });

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
      default:
        throw new Error(`unknown command ${String(raw.kind)}`);
    }
  }

  // ─── frames ────────────────────────────────────────────────────────────────

  private ack(ws: V2Socket, result: CommandResult): void {
    this.send(ws, { type: 'chat.ack', result });
  }

  private error(ws: V2Socket, chatId: string | null, code: string, message: string): void {
    this.send(ws, { type: 'chat.error', ...(chatId ? { chatId } : {}), code, message });
  }

  private send(ws: V2Socket, frame: Record<string, unknown>): void {
    try { ws.send(JSON.stringify({ v: 2, ...frame })); } catch { /* socket closed */ }
  }
}

function errText(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
