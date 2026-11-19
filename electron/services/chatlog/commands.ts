// One idempotent command path for chats (desktop and phone). A send logs the
// user message first, then queues it or dispatches it to the chat's provider.
// The per-chat queue lives in the log (queue_added/queue_removed) and drains
// one item per turn end. Repeats of a clientId are acked from the ledger
// without side effects.
import type { ChatSettings, QueuedItem } from '../../../src/lib/chat/types';
import { clamp, type PermMode } from '../remote/clamp';
import type { ChatLogService } from './service';
import type { ChatLogStore } from './store';

type Origin = 'desktop' | 'remote';
type Provider = ChatSettings['provider'];

export type ChatCommand =
  | { kind: 'send'; chatId: string; clientId: string; text: string; images?: string[]; imagePaths?: string[]; origin: Origin; projectPath: string; now?: boolean; taskId?: string; promptOverride?: string }
  | { kind: 'approve'; chatId: string; clientId: string; toolUseId: string; approved: boolean; modifiedCommand?: string }
  | { kind: 'answer'; chatId: string; clientId: string; toolUseId: string; answers: Record<string, string | string[]> }
  | { kind: 'planReview'; chatId: string; clientId: string; toolUseId: string; approved: boolean }
  | { kind: 'interrupt'; chatId: string; clientId: string }
  | { kind: 'settings'; chatId: string; clientId: string; settings: Partial<ChatSettings>; origin?: Origin }
  | { kind: 'queueRemove'; chatId: string; clientId: string; target: string }
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
}

/** A queued send keeps what the drain needs to dispatch it like the original send. */
export interface QueuedSend extends QueuedItem { prompt?: string; imagePaths?: string[]; origin?: Origin }

export interface ChatCommandsOpts {
  log: ChatLogService;
  store: ChatLogStore;
  dispatch: ProviderDispatch;
  /** LRU size of the clientId → result ledger. */
  ledgerSize?: number;
  /** Remote permission ceiling (claude.ts getRemoteCeiling); null = no cap. */
  getRemoteCeiling?: () => PermMode | null;
  /** Schedules a queue drain after a turn end (default: next macrotask, so the backend finishes its own turn-end bookkeeping first). */
  defer?: (fn: () => void) => void;
  devlog?: (event: string, data: Record<string, unknown>) => void;
}

export class ChatCommands {
  private readonly log: ChatLogService;
  private readonly store: ChatLogStore;
  private readonly dispatch: ProviderDispatch;
  private readonly ledgerSize: number;
  private readonly getRemoteCeiling: () => PermMode | null;
  private readonly defer: (fn: () => void) => void;
  private readonly devlog: (event: string, data: Record<string, unknown>) => void;
  private readonly ledger = new Map<string, Promise<CommandResult>>();
  /** Chats whose next turn end must not drain: it is the done of a send-now stop. */
  private readonly suppressDrain = new Set<string>();
  /** Chats that queued something in this process (onLoadResumed walks these). */
  private readonly queuedChats = new Set<string>();

  constructor(opts: ChatCommandsOpts) {
    this.log = opts.log;
    this.store = opts.store;
    this.dispatch = opts.dispatch;
    this.ledgerSize = opts.ledgerSize ?? 2000;
    this.getRemoteCeiling = opts.getRemoteCeiling ?? (() => null);
    this.defer = opts.defer ?? ((fn) => { setTimeout(fn, 0); });
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

  /** A logged turn ended (service.record saw streaming go true → false). */
  onTurnEnded(chatId: string): void {
    if (this.suppressDrain.delete(chatId)) return;
    this.defer(() => this.drainOne(chatId));
  }

  /** The load guard un-paused: drain one item for every chat holding a queue. */
  onLoadResumed(): void {
    for (const chatId of [...this.queuedChats]) this.defer(() => this.drainOne(chatId));
  }

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
      case 'settings': {
        this.chat(cmd.chatId);
        const settings: Partial<ChatSettings> = { ...(cmd.settings ?? {}) };
        if (cmd.origin === 'remote' && 'permMode' in settings) {
          settings.permMode = clamp(settings.permMode as PermMode | undefined, this.getRemoteCeiling()) ?? settings.permMode;
        }
        const entry = this.log.appendClient(cmd.chatId, { type: 'settings_changed', settings });
        if (settings.provider) this.store.patchMeta(cmd.chatId, { provider: settings.provider });
        return { seq: entry.seq };
      }
      case 'queueRemove': {
        this.chat(cmd.chatId);
        return { seq: this.log.appendClient(cmd.chatId, { type: 'queue_removed', clientId: cmd.target }).seq };
      }
      case 'queueClear': {
        this.chat(cmd.chatId);
        return { seq: this.log.appendClient(cmd.chatId, { type: 'queue_cleared' }).seq };
      }
      default:
        throw new Error(`unknown command ${(cmd as { kind?: unknown }).kind as string}`);
    }
  }

  private send(cmd: Extract<ChatCommand, { kind: 'send' }>): { seq: number } {
    const exists = !!this.store.meta(cmd.chatId);
    if (!exists && !cmd.projectPath) throw new Error(`unknown chat ${cmd.chatId} and no projectPath`);
    const origin: Origin = cmd.origin === 'remote' ? 'remote' : 'desktop';
    const text = typeof cmd.text === 'string' ? cmd.text : '';
    const images = Array.isArray(cmd.images) && cmd.images.length > 0 ? cmd.images : undefined;
    const entry = this.log.appendClient(cmd.chatId, {
      type: 'user_message', clientId: cmd.clientId, text, origin,
      ...(images ? { images } : {}),
      ...(typeof cmd.taskId === 'string' ? { taskId: cmd.taskId } : {}),
    }, exists ? undefined : { projectPath: cmd.projectPath });

    const { projectPath, provider, state } = this.chat(cmd.chatId);
    const prompt = typeof cmd.promptOverride === 'string' ? cmd.promptOverride : text;
    const imagePaths = Array.isArray(cmd.imagePaths) && cmd.imagePaths.length > 0 ? cmd.imagePaths : undefined;
    const paused = this.dispatch.isLoadPaused();
    const busy = this.dispatch.isBusy(projectPath, cmd.chatId);

    // Paused holds every send (send-now too, like the desktop composer). A busy
    // chat, or one with items already waiting, queues unless this is send-now.
    if (paused || (!cmd.now && (busy || state.queue.length > 0))) {
      const item: QueuedSend = {
        clientId: cmd.clientId, text, queuedAt: Date.now(), origin,
        ...(images ? { images } : {}),
        ...(prompt !== text ? { prompt } : {}),
        ...(imagePaths ? { imagePaths } : {}),
      };
      this.log.appendClient(cmd.chatId, { type: 'queue_added', item });
      this.queuedChats.add(cmd.chatId);
      // Queued behind other items while idle: nothing else will wake the drain.
      if (!paused && !busy) this.defer(() => this.drainOne(cmd.chatId));
      return { seq: entry.seq };
    }

    if (cmd.now && busy) {
      // The stop's own done ends the logged turn; that end must not drain the
      // queue ahead of this message. Only arm when the log has a turn to end.
      if (state.turn.streaming) this.suppressDrain.add(cmd.chatId);
      this.dispatch.stop(provider, projectPath, cmd.chatId);
    }
    this.dispatch.send(provider, { projectPath, scope: cmd.chatId, prompt, imagePaths, settings: this.chat(cmd.chatId).state.settings, origin });
    return { seq: entry.seq };
  }

  private drainOne(chatId: string): void {
    try {
      const meta = this.store.meta(chatId);
      const state = this.store.state(chatId);
      if (!meta || !state || state.queue.length === 0) {
        this.queuedChats.delete(chatId);
        return;
      }
      if (this.dispatch.isLoadPaused()) return;
      if (this.dispatch.isBusy(meta.projectPath, chatId)) return;
      const item = state.queue[0] as QueuedSend;
      this.log.appendClient(chatId, { type: 'queue_removed', clientId: item.clientId });
      const after = this.chat(chatId);
      if (after.state.queue.length === 0) this.queuedChats.delete(chatId);
      this.dispatch.send(after.provider, {
        projectPath: after.projectPath,
        scope: chatId,
        prompt: typeof item.prompt === 'string' ? item.prompt : item.text,
        imagePaths: Array.isArray(item.imagePaths) && item.imagePaths.length > 0 ? item.imagePaths : undefined,
        settings: after.state.settings,
        origin: item.origin === 'remote' ? 'remote' : 'desktop',
      });
    } catch (err) {
      this.devlog('chatlog.drainError', { chatId, error: err instanceof Error ? err.message : String(err) });
    }
  }

  /** The chat's project (as logged — backends key workspaces by that path), provider and state. */
  private chat(chatId: string) {
    const meta = this.store.meta(chatId);
    const state = this.store.state(chatId);
    if (!meta || !state) throw new Error(`unknown chat ${chatId}`);
    return { projectPath: meta.projectPath, provider: state.settings.provider ?? meta.provider, state };
  }
}
