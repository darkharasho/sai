// Routes every chat event the backends emit (via emitChatMessage) into the
// durable per-chat log, then fans each appended entry out to the renderer
// (`chatlog:event`) and the remote bus (`chatlog:<chatId>`).
import fs from 'node:fs';
import path from 'node:path';
import type { IpcMain } from 'electron';
import type { ChatMessage } from '../../../src/types';
import type { ChatEvent, ChatLogEntry, ChatMeta, ChatSettings } from '../../../src/lib/chat/types';
import { CLIENT_EVENT_TYPES } from '../../../src/lib/chat/types';
import { TOOL_IMAGE_REF_RE, MODEL_KEY_REF_RE, modelKeyFromRef } from '../../../src/lib/chat/gcRefs';
import type { SessionBus } from '../remote/session-bus';
import type { ChatLogStore } from './store';

export interface ChatLogServiceOpts {
  store: ChatLogStore;
  sendToRenderer: (channel: 'chatlog:event', entry: ChatLogEntry) => void;
  bus: () => SessionBus | null;
  /** chat ids with a live backend scope for this provider (and project unless '*') */
  liveChats: (provider: string, projectPath: string | '*') => string[];
  providerOf: (projectPath: string, scope: string) => ChatSettings['provider'];
  devlog: (event: string, data: Record<string, unknown>) => void;
}

export interface TurnHooks {
  /** A streaming_start was appended. */
  started?(chatId: string): void;
  /** An append flipped the reduced turn from streaming to idle; `ev` is that event. */
  ended?(chatId: string, ev: ChatEvent): void;
  /** A done was appended while no turn was open (a turn that never started). */
  idleDone?(chatId: string): void;
  /** A client opened the chat (cold open or legacy-scope bind). */
  opened?(chatId: string): void;
}

const PROVIDERS: ReadonlyArray<ChatSettings['provider']> = ['claude', 'codex', 'gemini', 'kimi'];

/**
 * Backend events that may CREATE a chat's log: transcript content or a pending
 * prompt. Anything else (ready, session_id, commands_changed, init,
 * context_usage, rate_limit_event, auth_status, a stray done, …) is only
 * recorded for a chat that already has a log — a start-up `ready` must never
 * create an empty log ahead of the chat's IndexedDB import.
 */
const CREATING_TYPES = new Set([
  'streaming_start', 'user_message', 'assistant', 'user', 'result', 'error', 'reasoning_delta',
  'approval_needed', 'user_input_needed', 'mcp_elicitation_needed', 'sudo-prompt', 'subagent_activity',
]);
const CREATING_SYSTEM_SUBTYPES = new Set(['context_compacted', 'auto_compact', 'compact']);

function createsLog(msg: Record<string, unknown>): boolean {
  if (msg.type === 'system') return CREATING_SYSTEM_SUBTYPES.has(String(msg.subtype));
  return CREATING_TYPES.has(String(msg.type));
}
const CLIENT_TYPES = new Set<string>(CLIENT_EVENT_TYPES);
const SEEN_IDS_CAP = 2000;

/** Realpath with a path.resolve fallback (/home is a symlink to /var/home on some hosts). */
export function realPath(p: string): string {
  try { return fs.realpathSync.native(p); } catch { return path.resolve(p); }
}

function isProvider(v: unknown): v is ChatSettings['provider'] {
  return typeof v === 'string' && (PROVIDERS as readonly string[]).includes(v);
}

/**
 * Chat ids for a provider's live backend scopes, filtered to `projectPath`
 * (by realpath) unless it is '*'. The legacy `'chat'` scope maps through
 * `legacyFor` (the chat bound by bindLegacyScope); unbound ones drop out.
 */
export function liveChatIds(
  entries: Iterable<{ projectPath: string; scope: string }>,
  projectPath: string | '*',
  legacyFor: (projectPath: string) => string | null,
): string[] {
  const want = projectPath === '*' ? null : realPath(projectPath);
  const out = new Set<string>();
  for (const e of entries) {
    if (want !== null && e.projectPath !== '*' && realPath(e.projectPath) !== want) continue;
    const id = e.scope === 'chat' ? legacyFor(e.projectPath) : e.scope;
    if (id && id !== '*') out.add(id);
  }
  return [...out];
}

export class ChatLogService {
  private readonly store: ChatLogStore;
  private readonly opts: ChatLogServiceOpts;
  /** realpath(projectPath) → chat id that the legacy 'chat' scope stands for. */
  private readonly legacy = new Map<string, string>();
  /** `${chatId}\0${msg.id}` of fanned-out '*' events, so a re-emitted card isn't appended twice. */
  private readonly seenIds = new Set<string>();
  /** Turn edges for ChatCommands (queue drain, in-flight tracking). */
  private turnHooks: TurnHooks = {};

  constructor(opts: ChatLogServiceOpts) {
    this.opts = opts;
    this.store = opts.store;
  }

  setTurnHooks(hooks: TurnHooks): void {
    this.turnHooks = hooks ?? {};
  }

  /** The chat id bound to the legacy 'chat' scope for this project, if any. */
  legacyChatFor(projectPath: string): string | null {
    return this.legacy.get(realPath(projectPath)) ?? null;
  }

  bindLegacyScope(projectPath: string, chatId: string): void {
    if (typeof projectPath !== 'string' || !projectPath || typeof chatId !== 'string' || !chatId) return;
    this.legacy.set(realPath(projectPath), chatId);
  }

  /** Resolve chat ids from msg.scope, append, fan out. [] if unroutable. */
  record(msg: Record<string, unknown>): ChatLogEntry[] {
    const type = msg?.type;
    if (typeof type !== 'string') return [];
    // ChatCommands logged this user message before dispatching; the backend's
    // echo (stamped logged:true) only feeds v1 IPC and the bus.
    if (type === 'user_message' && msg.logged === true) return [];
    const withScope = (chatId: string): ChatEvent => ({ ...msg, type, scope: chatId });
    const scope = typeof msg.scope === 'string' && msg.scope ? msg.scope : 'chat';
    const projectPath = typeof msg.projectPath === 'string' ? msg.projectPath : '';
    const out: ChatLogEntry[] = [];

    if (scope === '*') {
      const provider = typeof msg.provider === 'string' ? msg.provider : '';
      const ids = new Set(this.opts.liveChats(provider, projectPath || '*'));
      const cardId = typeof msg.id === 'string' && msg.id ? msg.id : null;
      for (const chatId of ids) {
        // Fan-out only reaches chats that already exist: a live scope with no log
        // is a helper (commit/title) or something we can't place in a project.
        if (!this.store.meta(chatId)) continue;
        if (cardId) {
          const key = `${chatId}\0${cardId}`;
          if (this.seenIds.has(key)) continue;
          this.remember(key);
        }
        out.push(this.appendAndFanOut(chatId, withScope(chatId)));
      }
      return out;
    }

    let chatId = scope;
    if (scope === 'chat') {
      const bound = projectPath ? this.legacyChatFor(projectPath) : null;
      if (!bound) {
        this.opts.devlog('chatlog.unroutable', { type, projectPath, scope });
        return [];
      }
      chatId = bound;
    }

    let init: { projectPath: string; provider: ChatSettings['provider'] } | undefined;
    if (!this.store.meta(chatId)) {
      if (!createsLog(msg)) {
        this.opts.devlog('chatlog.skipNonTranscript', { type, projectPath, scope });
        return [];
      }
      if (!projectPath || projectPath === '*') {
        this.opts.devlog('chatlog.unroutable', { type, projectPath, scope, reason: 'no-project' });
        return [];
      }
      init = { projectPath, provider: isProvider(msg.provider) ? msg.provider : this.opts.providerOf(projectPath, scope) };
    }
    out.push(this.appendAndFanOut(chatId, withScope(chatId), init));
    return out;
  }

  /**
   * Append a client-originated event (Task 1 list). Throws on backend event
   * types. `init` (or ev.projectPath) creates the chat if it isn't logged yet.
   */
  appendClient(chatId: string, ev: ChatEvent, init?: { projectPath: string; provider?: ChatSettings['provider'] }): ChatLogEntry {
    if (typeof chatId !== 'string' || !chatId) throw new Error('appendClient: chatId required');
    if (!ev || typeof ev.type !== 'string' || !CLIENT_TYPES.has(ev.type)) {
      throw new Error(`appendClient: ${String(ev?.type)} is not a client event type`);
    }
    let storeInit: { projectPath: string; provider: ChatSettings['provider']; imported: boolean } | undefined;
    if (!this.store.meta(chatId)) {
      const projectPath = init?.projectPath ?? (typeof ev.projectPath === 'string' ? ev.projectPath : '');
      if (!projectPath) throw new Error(`appendClient: unknown chat ${chatId} and no projectPath`);
      // A client creates a chat only after checking IndexedDB (ensureChatInLog
      // imports any history first), so its log starts as the whole history.
      storeInit = { projectPath, provider: init?.provider ?? this.opts.providerOf(projectPath, chatId), imported: true };
    }
    return this.appendAndFanOut(chatId, ev, storeInit);
  }

  /**
   * Imports a chat's IndexedDB history (see ChatLogStore.importMessages). When
   * it was folded in front of an existing log, a `history_imported` entry
   * tells every open client to reload the chat from seq 0.
   */
  importMessages(
    chatId: string,
    init: { projectPath: string; provider: ChatSettings['provider']; title?: string; createdAt: number; updatedAt: number },
    messages: ChatMessage[],
  ): 'created' | 'folded' | 'marked' | false {
    const result = this.store.importMessages(chatId, init, messages);
    if (result === 'folded') this.appendAndFanOut(chatId, { type: 'history_imported' });
    return result;
  }

  /** For chats left mid-turn by a previous run with no live backend now: close the turn. */
  startupRepair(): void {
    for (const chatId of this.store.openTurnChatIds()) {
      try {
        const meta = this.store.meta(chatId);
        if (!meta) continue;
        if (this.opts.liveChats(meta.provider, meta.projectPath).includes(chatId)) continue;
        // The previous run's processes are gone: no child event can follow either.
        this.appendAndFanOut(chatId, { type: 'done', turnSeq: null, reason: 'app_restart', subagentsAborted: true });
      } catch (err) {
        this.opts.devlog('chatlog.repairError', { chatId, error: errText(err) });
      }
    }
  }

  /** Tool-result image basenames referenced anywhere in the log (for the image GC). */
  referencedImageFiles(): string[] {
    return [...this.store.referencedStrings(TOOL_IMAGE_REF_RE)];
  }

  /** Model-cache version keys referenced anywhere in the log (for the model GC). */
  referencedModelKeys(): string[] {
    return [...new Set([...this.store.referencedStrings(MODEL_KEY_REF_RE)].map(modelKeyFromRef))];
  }

  registerIpc(ipcMain: IpcMain): void {
    ipcMain.handle('chatlog:open', (_e, chatId: string, after: number) => {
      const from = Number.isFinite(after) ? Number(after) : 0;
      const res = this.store.read(String(chatId), from);
      if (from === 0) this.notifyOpened(String(chatId));
      return res;
    });
    ipcMain.handle('chatlog:appendClient', (_e, chatId: string, ev: ChatEvent, init?: { projectPath: string; provider?: ChatSettings['provider'] }) =>
      this.appendClient(chatId, ev, init));
    ipcMain.handle('chatlog:importMessages', (
      _e,
      chatId: string,
      init: { projectPath: string; provider: ChatSettings['provider']; title?: string; createdAt: number; updatedAt: number },
      messages: ChatMessage[],
    ) => this.importMessages(String(chatId), init, Array.isArray(messages) ? messages : []));
    ipcMain.handle('chatlog:list', (_e, projectPath: string): ChatMeta[] => this.store.list(String(projectPath)));
    ipcMain.handle('chatlog:delete', (_e, chatIds: string[]) => {
      for (const id of Array.isArray(chatIds) ? chatIds : []) if (typeof id === 'string' && id) this.store.delete(id);
    });
    ipcMain.handle('chatlog:bindLegacyScope', (_e, projectPath: string, chatId: string) => {
      this.bindLegacyScope(projectPath, chatId);
      this.notifyOpened(String(chatId));
    });
    ipcMain.handle('chatlog:patchMeta', (_e, chatId: string, patch: Partial<Pick<ChatMeta, 'title' | 'provider'>>) =>
      this.store.patchMeta(String(chatId), patch ?? {}));
  }

  /** Tells the turn hooks a client opened the chat; a hook failure never fails the open. */
  notifyOpened(chatId: string): void {
    try { this.turnHooks.opened?.(chatId); } catch (err) {
      this.opts.devlog('chatlog.turnHookError', { chatId, type: 'opened', error: errText(err) });
    }
  }

  private appendAndFanOut(chatId: string, ev: ChatEvent, init?: { projectPath: string; provider: ChatSettings['provider']; imported?: boolean }): ChatLogEntry {
    const wasStreaming = this.store.meta(chatId)?.openTurn === true;
    const entry = this.store.append(chatId, ev, init);
    try { this.opts.sendToRenderer('chatlog:event', entry); } catch (err) {
      this.opts.devlog('chatlog.sendError', { chatId, error: errText(err) });
    }
    try { this.opts.bus()?.publish(`chatlog:${chatId}`, entry as unknown as Record<string, unknown>); } catch (err) {
      this.opts.devlog('chatlog.busError', { chatId, error: errText(err) });
    }
    const isStreaming = this.store.meta(chatId)?.openTurn === true;
    const h = this.turnHooks;
    try {
      if (ev.type === 'streaming_start') h.started?.(chatId);
      if (wasStreaming && !isStreaming) h.ended?.(chatId, ev);
      else if (ev.type === 'done' && !wasStreaming) h.idleDone?.(chatId);
    } catch (err) {
      this.opts.devlog('chatlog.turnHookError', { chatId, type: ev.type, error: errText(err) });
    }
    return entry;
  }

  private remember(key: string): void {
    this.seenIds.add(key);
    if (this.seenIds.size > SEEN_IDS_CAP) {
      const oldest = this.seenIds.values().next().value;
      if (oldest !== undefined) this.seenIds.delete(oldest);
    }
  }
}

function errText(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
