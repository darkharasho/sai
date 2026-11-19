// One idempotent command path for chats (desktop and phone). A send logs the
// user message first, then queues it or dispatches it to the chat's provider.
// The per-chat queue lives in the log (queue_added/queue_removed) and drains
// one item per turn end. Repeats of a clientId are acked from the ledger
// without side effects.
import type { ChatEvent, ChatSettings, QueuedItem } from '../../../src/lib/chat/types';
import type { PermMode } from '../remote/clamp';
import { capSettings } from './remoteCap';
import type { ChatLogService } from './service';
import type { ChatLogStore } from './store';

type Origin = 'desktop' | 'remote';
type Provider = ChatSettings['provider'];

export type ChatCommand =
  | {
    kind: 'send'; chatId: string; clientId: string; text: string; images?: string[]; imagePaths?: string[];
    origin: Origin; projectPath: string; now?: boolean; taskId?: string; promptOverride?: string;
    /** The chat's provider: creates a new chat with it, or switches an existing chat before this message. */
    provider?: Provider;
  }
  | { kind: 'approve'; chatId: string; clientId: string; toolUseId: string; approved: boolean; modifiedCommand?: string }
  | { kind: 'answer'; chatId: string; clientId: string; toolUseId: string; answers: Record<string, string | string[]> }
  | { kind: 'planReview'; chatId: string; clientId: string; toolUseId: string; approved: boolean }
  | { kind: 'interrupt'; chatId: string; clientId: string }
  | {
    kind: 'settings'; chatId: string; clientId: string; settings: Partial<ChatSettings>; origin?: Origin;
    /** With settings.provider, creates the chat if it isn't logged yet. */
    projectPath?: string;
  }
  | { kind: 'queueRemove'; chatId: string; clientId: string; target: string }
  /** Moves a queued item to the front (it drains next). */
  | { kind: 'queuePromote'; chatId: string; clientId: string; target: string }
  | { kind: 'queueClear'; chatId: string; clientId: string };

export interface CommandResult { clientId: string; ok: boolean; duplicate: boolean; seq?: number; error?: string }

export interface ProviderDispatch {
  send(p: Provider, a: { projectPath: string; scope: string; prompt: string; imagePaths?: string[]; settings: ChatSettings; origin: Origin }): void;
  stop(p: Provider, projectPath: string, scope: string): void;
  approve(p: Provider, a: { projectPath: string; scope: string; toolUseId: string; approved: boolean; modifiedCommand?: string }): Promise<void>;
  answer(a: { projectPath: string; scope: string; toolUseId: string; answers: Record<string, string | string[]> }): Promise<void>;
  planReview(a: { projectPath: string; scope: string; toolUseId: string; approved: boolean }): Promise<void>;
  isBusy(projectPath: string, scope: string): boolean;
  isLoadPaused(): boolean;
  /** False when the provider can't take a send for this chat yet (e.g. no workspace); sends wait in the queue. Default true. */
  canDispatch?(p: Provider, projectPath: string, scope: string): boolean;
}

/** A queued send keeps what the drain needs to dispatch it like the original send. */
export interface QueuedSend extends QueuedItem { prompt?: string; imagePaths?: string[]; origin?: Origin }

export interface Timers {
  set(fn: () => void, ms: number): unknown;
  clear(handle: unknown): void;
}

export interface ChatCommandsOpts {
  log: ChatLogService;
  store: ChatLogStore;
  dispatch: ProviderDispatch;
  /** LRU size of the clientId → result ledger. */
  ledgerSize?: number;
  /** Remote permission ceiling (claude.ts getRemoteCeiling); null = no cap. */
  getRemoteCeiling?: () => PermMode | null;
  timers?: Timers;
  /** First retry delay for a drain blocked by a busy backend with no open logged turn (doubles per retry). */
  retryBaseMs?: number;
  /** Retries before a blocked drain gives up (the next turn end or send retries). */
  maxRetries?: number;
  /** A dispatch with no streaming_start after this long stops counting as busy. */
  inFlightTimeoutMs?: number;
  devlog?: (event: string, data: Record<string, unknown>) => void;
}

const defaultTimers: Timers = {
  set: (fn, ms) => setTimeout(fn, ms),
  clear: (h) => clearTimeout(h as ReturnType<typeof setTimeout>),
};

export class ChatCommands {
  private readonly log: ChatLogService;
  private readonly store: ChatLogStore;
  private readonly dispatch: ProviderDispatch;
  private readonly ledgerSize: number;
  private readonly getRemoteCeiling: () => PermMode | null;
  private readonly timers: Timers;
  private readonly retryBaseMs: number;
  private readonly maxRetries: number;
  private readonly inFlightTimeoutMs: number;
  private readonly devlog: (event: string, data: Record<string, unknown>) => void;
  private readonly ledger = new Map<string, Promise<CommandResult>>();
  /** Chats with a stop-then-send in progress: the stopped turn's end must not drain. Cleared by the next streaming_start. */
  private readonly suppressDrain = new Set<string>();
  /** Chats that queued something in this process (onLoadResumed walks these). */
  private readonly queuedChats = new Set<string>();
  /** Dispatched, no streaming_start logged yet → busy (async providers start their turn late). Value: timeout handle. */
  private readonly inFlight = new Map<string, unknown>();
  /** At most one scheduled drain per chat (the earliest wins). */
  private readonly pendingDrain = new Map<string, { handle: unknown; due: number }>();

  constructor(opts: ChatCommandsOpts) {
    this.log = opts.log;
    this.store = opts.store;
    this.dispatch = opts.dispatch;
    this.ledgerSize = opts.ledgerSize ?? 2000;
    this.getRemoteCeiling = opts.getRemoteCeiling ?? (() => null);
    this.timers = opts.timers ?? defaultTimers;
    this.retryBaseMs = opts.retryBaseMs ?? 250;
    this.maxRetries = opts.maxRetries ?? 6;
    this.inFlightTimeoutMs = opts.inFlightTimeoutMs ?? 60_000;
    this.devlog = opts.devlog ?? (() => {});
  }

  run(cmd: ChatCommand): Promise<CommandResult> {
    const clientId = typeof cmd?.clientId === 'string' ? cmd.clientId : '';
    if (!clientId) return Promise.resolve({ clientId, ok: false, duplicate: false, error: 'clientId required' });
    if (typeof cmd.chatId !== 'string' || !cmd.chatId) {
      return Promise.resolve({ clientId, ok: false, duplicate: false, error: 'chatId required' });
    }
    const prior = this.ledger.get(clientId);
    if (prior) {
      this.ledger.delete(clientId);
      this.ledger.set(clientId, prior);
      return prior.then((r) => ({ ...r, duplicate: true }));
    }
    const result = this.exec(cmd).then(
      (r): CommandResult => ({ clientId, ok: true, duplicate: false, ...r }),
      (err): CommandResult => ({ clientId, ok: false, duplicate: false, error: err instanceof Error ? err.message : String(err) }),
    );
    this.ledger.set(clientId, result);
    while (this.ledger.size > this.ledgerSize) {
      const oldest = this.ledger.keys().next().value;
      if (oldest === undefined) break;
      this.ledger.delete(oldest);
    }
    return result;
  }

  // ─── log hooks (ChatLogService.setTurnHooks) ───────────────────────────────

  /** A streaming_start was logged for the chat: a dispatch landed, and any stopped turn is over. */
  onTurnStarted(chatId: string): void {
    this.clearInFlight(chatId);
    this.suppressDrain.delete(chatId);
  }

  /**
   * A logged turn ended (streaming went true → false). Drains one queued item.
   * Turns startup repair closes (reason app_restart) drain too: what was queued
   * before quitting sends on relaunch, gated by canDispatch and the bounded
   * retry like any drain (a provider with no workspace yet keeps its queue).
   */
  onTurnEnded(chatId: string, _ev?: ChatEvent): void {
    if (this.suppressDrain.delete(chatId)) return;
    this.scheduleDrain(chatId, 0, 0);
  }

  /**
   * Startup, once backends are registered: chats that kept a queue from the
   * previous run with no turn left open (startup repair only wakes the chats
   * it closes) get one drain attempt each.
   */
  resumeQueues(chatIds: string[]): void {
    for (const chatId of chatIds) {
      if (!this.store.meta(chatId)) continue;
      this.queuedChats.add(chatId);
      this.scheduleDrain(chatId, 0, 0);
    }
  }

  /** A done was logged with no turn open: a dispatch that failed before it started. */
  onIdleDone(chatId: string): void {
    this.clearInFlight(chatId);
  }

  /** The load guard un-paused: drain one item for every chat holding a queue. */
  onLoadResumed(): void {
    for (const chatId of [...this.queuedChats]) this.scheduleDrain(chatId, 0, 0);
  }

  // ─── commands ──────────────────────────────────────────────────────────────

  private async exec(cmd: ChatCommand): Promise<{ seq?: number }> {
    switch (cmd.kind) {
      case 'send': return this.send(cmd);
      case 'approve': {
        const { provider, projectPath } = this.chat(cmd.chatId);
        await this.dispatch.approve(provider, {
          projectPath, scope: cmd.chatId, toolUseId: cmd.toolUseId, approved: cmd.approved,
          ...(cmd.modifiedCommand !== undefined ? { modifiedCommand: cmd.modifiedCommand } : {}),
        });
        return {};
      }
      case 'answer': {
        const { projectPath } = this.chat(cmd.chatId);
        await this.dispatch.answer({ projectPath, scope: cmd.chatId, toolUseId: cmd.toolUseId, answers: cmd.answers });
        return {};
      }
      case 'planReview': {
        const { projectPath } = this.chat(cmd.chatId);
        await this.dispatch.planReview({ projectPath, scope: cmd.chatId, toolUseId: cmd.toolUseId, approved: cmd.approved });
        return {};
      }
      case 'interrupt': {
        const { provider, projectPath } = this.chat(cmd.chatId);
        this.dispatch.stop(provider, projectPath, cmd.chatId);
        return {};
      }
      case 'settings': return this.settings(cmd);
      case 'queueRemove': {
        this.chat(cmd.chatId);
        return { seq: this.log.appendClient(cmd.chatId, { type: 'queue_removed', clientId: cmd.target }).seq };
      }
      case 'queuePromote': {
        this.chat(cmd.chatId);
        return { seq: this.log.appendClient(cmd.chatId, { type: 'queue_promoted', clientId: cmd.target }).seq };
      }
      case 'queueClear': {
        this.chat(cmd.chatId);
        return { seq: this.log.appendClient(cmd.chatId, { type: 'queue_cleared' }).seq };
      }
      default:
        throw new Error(`unknown command ${(cmd as { kind?: unknown }).kind as string}`);
    }
  }

  private settings(cmd: Extract<ChatCommand, { kind: 'settings' }>): { seq: number } {
    const patch: Partial<ChatSettings> = { ...(cmd.settings ?? {}) };
    let init: { projectPath: string; provider: Provider } | undefined;
    if (!this.store.meta(cmd.chatId)) {
      if (!cmd.projectPath || !patch.provider) throw new Error(`unknown chat ${cmd.chatId} (needs projectPath and settings.provider to create it)`);
      init = { projectPath: cmd.projectPath, provider: patch.provider };
    }
    if (cmd.origin === 'remote') {
      // Cap only what the phone changes, judged against the chat's resulting settings.
      const current = init ? { provider: init.provider } : this.chat(cmd.chatId).state.settings;
      const merged = { ...current, ...patch } as ChatSettings;
      const capped = capSettings(merged, merged.provider, this.getRemoteCeiling());
      for (const k of Object.keys(patch) as Array<keyof ChatSettings>) {
        (patch as Record<string, unknown>)[k] = capped[k];
      }
    }
    const entry = this.log.appendClient(cmd.chatId, { type: 'settings_changed', settings: patch }, init);
    if (patch.provider && !init) this.store.patchMeta(cmd.chatId, { provider: patch.provider });
    return { seq: entry.seq };
  }

  private send(cmd: Extract<ChatCommand, { kind: 'send' }>): { seq: number } {
    const exists = !!this.store.meta(cmd.chatId);
    if (!exists && !cmd.projectPath) throw new Error(`unknown chat ${cmd.chatId} and no projectPath`);
    const origin: Origin = cmd.origin === 'remote' ? 'remote' : 'desktop';
    const text = typeof cmd.text === 'string' ? cmd.text : '';
    const images = Array.isArray(cmd.images) && cmd.images.length > 0 ? cmd.images : undefined;

    if (exists && cmd.provider && cmd.provider !== this.chat(cmd.chatId).provider) {
      this.log.appendClient(cmd.chatId, { type: 'settings_changed', settings: { provider: cmd.provider } });
      this.store.patchMeta(cmd.chatId, { provider: cmd.provider });
    }
    const entry = this.log.appendClient(cmd.chatId, {
      type: 'user_message', clientId: cmd.clientId, text, origin,
      ...(images ? { images } : {}),
      ...(typeof cmd.taskId === 'string' ? { taskId: cmd.taskId } : {}),
    }, exists ? undefined : { projectPath: cmd.projectPath, ...(cmd.provider ? { provider: cmd.provider } : {}) });

    const { projectPath, provider, state } = this.chat(cmd.chatId);
    const prompt = typeof cmd.promptOverride === 'string' ? cmd.promptOverride : text;
    const imagePaths = Array.isArray(cmd.imagePaths) && cmd.imagePaths.length > 0 ? cmd.imagePaths : undefined;
    const paused = this.dispatch.isLoadPaused();
    const ready = this.canDispatch(provider, projectPath, cmd.chatId);
    const busy = this.isBusy(projectPath, cmd.chatId);

    // Paused holds every send (send-now too, like the desktop composer). A busy
    // chat, or one with items already waiting, queues unless this is send-now.
    if (paused || !ready || (!cmd.now && (busy || state.queue.length > 0))) {
      const item: QueuedSend = {
        clientId: cmd.clientId, text, queuedAt: Date.now(), origin,
        ...(images ? { images } : {}),
        ...(typeof cmd.taskId === 'string' ? { taskId: cmd.taskId } : {}),
        ...(prompt !== text ? { prompt } : {}),
        ...(imagePaths ? { imagePaths } : {}),
      };
      this.log.appendClient(cmd.chatId, { type: 'queue_added', item });
      this.queuedChats.add(cmd.chatId);
      if (!ready) {
        // Nothing logs an event when the workspace appears: poll with the bounded backoff.
        this.devlog('chatcmd.notReady', { chatId: cmd.chatId, provider });
        if (!paused) this.scheduleDrain(cmd.chatId, this.retryBaseMs, 1);
      } else if (!paused && !busy) {
        // Queued behind other items while idle: nothing else will wake the drain.
        this.scheduleDrain(cmd.chatId, 0, 0);
      }
      return { seq: entry.seq };
    }

    if (cmd.now && busy) {
      // The stopped turn's end must not drain the queue ahead of this message.
      // Only armed when the log has a turn to end; the next streaming_start disarms it.
      if (state.turn.streaming) this.suppressDrain.add(cmd.chatId);
      this.dispatch.stop(provider, projectPath, cmd.chatId);
    }
    this.dispatchSend(cmd.chatId, { prompt, imagePaths, origin });
    return { seq: entry.seq };
  }

  // ─── dispatch + queue drain ────────────────────────────────────────────────

  /** Marks the chat in flight, then dispatches with its current (remote-capped) settings. Throws if dispatch throws. */
  private dispatchSend(chatId: string, a: { prompt: string; imagePaths?: string[]; origin: Origin }): void {
    const { projectPath, provider, state } = this.chat(chatId);
    const settings = a.origin === 'remote' ? capSettings(state.settings, provider, this.getRemoteCeiling()) : state.settings;
    // Marked first: a synchronous backend logs streaming_start inside send(), which clears it.
    this.markInFlight(chatId);
    try {
      this.dispatch.send(provider, { projectPath, scope: chatId, prompt: a.prompt, imagePaths: a.imagePaths, settings, origin: a.origin });
    } catch (err) {
      this.clearInFlight(chatId);
      throw err;
    }
  }

  private scheduleDrain(chatId: string, delayMs: number, attempt: number): void {
    const due = Date.now() + delayMs;
    const pending = this.pendingDrain.get(chatId);
    if (pending) {
      if (pending.due <= due) return;
      this.timers.clear(pending.handle); // a sooner trigger (turn end) replaces a backoff retry
    }
    const handle = this.timers.set(() => {
      this.pendingDrain.delete(chatId);
      this.drainOne(chatId, attempt);
    }, delayMs);
    this.pendingDrain.set(chatId, { handle, due });
  }

  private drainOne(chatId: string, attempt: number): void {
    try {
      const meta = this.store.meta(chatId);
      const state = this.store.state(chatId);
      if (!meta || !state || state.queue.length === 0) {
        this.queuedChats.delete(chatId);
        return;
      }
      if (this.dispatch.isLoadPaused()) return; // onLoadResumed drains
      const { projectPath, provider } = this.chat(chatId);
      if (!this.canDispatch(provider, projectPath, chatId)) {
        // Bounded backoff; after it gives up, the chat's next send or turn end retries.
        if (attempt < this.maxRetries) this.scheduleDrain(chatId, this.retryBaseMs * 2 ** attempt, attempt + 1);
        else this.devlog('chatcmd.drainGaveUp', { chatId, attempts: attempt, reason: 'notReady' });
        this.devlog('chatcmd.drainNotReady', { chatId, provider, attempt });
        return;
      }
      if (this.isBusy(projectPath, chatId)) {
        // An open logged turn drains on its own end. With none, the backend is
        // finishing up (or the dispatch hasn't started): retry with backoff.
        if (!state.turn.streaming) {
          if (attempt < this.maxRetries) this.scheduleDrain(chatId, this.retryBaseMs * 2 ** attempt, attempt + 1);
          else this.devlog('chatcmd.drainGaveUp', { chatId, attempts: attempt });
        }
        return;
      }
      const item = state.queue[0] as QueuedSend;
      try {
        this.dispatchSend(chatId, {
          prompt: typeof item.prompt === 'string' ? item.prompt : item.text,
          imagePaths: Array.isArray(item.imagePaths) && item.imagePaths.length > 0 ? item.imagePaths : undefined,
          origin: item.origin === 'remote' ? 'remote' : 'desktop',
        });
      } catch (err) {
        // Leave it queued: removing it first would lose the message.
        this.devlog('chatcmd.drainDispatchError', { chatId, clientId: item.clientId, error: err instanceof Error ? err.message : String(err) });
        return;
      }
      // sent: the bubble joins the transcript (a user's queueRemove drops it instead).
      this.log.appendClient(chatId, { type: 'queue_removed', clientId: item.clientId, sent: true });
      if (this.store.state(chatId)?.queue.length === 0) this.queuedChats.delete(chatId);
    } catch (err) {
      this.devlog('chatlog.drainError', { chatId, error: err instanceof Error ? err.message : String(err) });
    }
  }

  private isBusy(projectPath: string, chatId: string): boolean {
    return this.inFlight.has(chatId) || this.dispatch.isBusy(projectPath, chatId);
  }

  private canDispatch(provider: Provider, projectPath: string, chatId: string): boolean {
    try { return this.dispatch.canDispatch?.(provider, projectPath, chatId) ?? true; } catch { return false; }
  }

  private markInFlight(chatId: string): void {
    this.clearInFlight(chatId);
    const handle = this.timers.set(() => {
      this.inFlight.delete(chatId);
      this.devlog('chatcmd.inFlightTimeout', { chatId, ms: this.inFlightTimeoutMs });
      this.scheduleDrain(chatId, 0, 0);
    }, this.inFlightTimeoutMs);
    this.inFlight.set(chatId, handle);
  }

  private clearInFlight(chatId: string): void {
    const handle = this.inFlight.get(chatId);
    if (handle === undefined) return;
    this.timers.clear(handle);
    this.inFlight.delete(chatId);
  }

  /** The chat's project (as logged — backends key workspaces by that path), provider and state. */
  private chat(chatId: string) {
    const meta = this.store.meta(chatId);
    const state = this.store.state(chatId);
    if (!meta || !state) throw new Error(`unknown chat ${chatId}`);
    return { projectPath: meta.projectPath, provider: state.settings.provider ?? meta.provider, state };
  }
}
