import { vi } from 'vitest';
import { act } from '@testing-library/react';
import { reduceMany, emptyChatState, stateFromMessages, persistableState } from '../../src/lib/chat/reducer';
import { CLIENT_EVENT_TYPES } from '../../src/lib/chat/types';
import type { ChatEvent, ChatLogEntry, ChatMeta, ChatSettings, ChatSnapshot, ChatState } from '../../src/lib/chat/types';
import type { ChatMessage } from '../../src/types';

/**
 * In-memory stand-in for main's chat log (ChatLogStore + ChatLogService +
 * ChatCommands) behind `window.sai.chatlog`. `record(msg)` routes a backend
 * event the way ChatLogService.record does; `command` logs the client events
 * and then "dispatches" by calling the legacy window.sai provider methods
 * (claudeSend, codexStop, …) the way providerDispatch.ts does, so tests can
 * keep asserting on those. Like ChatCommands, a send queues (queue_added)
 * while the chat's logged turn is open, items are already waiting or the
 * mock is load-paused (`setPaused`), and a turn end drains one item
 * (queue_removed sent:true, then the dispatch).
 */
type Provider = ChatSettings['provider'];

interface Chat { meta: ChatMeta; snapshot: ChatSnapshot | null; entries: ChatLogEntry[]; head: number }

const CLIENT = new Set<string>(CLIENT_EVENT_TYPES);

export interface MockChatlog {
  open: ReturnType<typeof vi.fn>;
  onEvent: ReturnType<typeof vi.fn>;
  appendClient: ReturnType<typeof vi.fn>;
  importMessages: ReturnType<typeof vi.fn>;
  list: ReturnType<typeof vi.fn>;
  delete: ReturnType<typeof vi.fn>;
  bindLegacyScope: ReturnType<typeof vi.fn>;
  patchMeta: ReturnType<typeof vi.fn>;
  command: ReturnType<typeof vi.fn>;
  /** Route a backend event into the log (ChatLogService.record). */
  record(msg: Record<string, unknown>): ChatLogEntry[];
  /** Seed a chat with history as an imported seq-0 snapshot. */
  seed(chatId: string, messages: ChatMessage[], init?: { projectPath?: string; provider?: Provider }): void;
  /** Append raw events (client or backend) to a chat without routing. */
  append(chatId: string, ev: ChatEvent, init?: { projectPath?: string; provider?: Provider }): ChatLogEntry;
  entries(chatId: string): ChatLogEntry[];
  state(chatId: string): ChatState | null;
  /** Commands of one kind, in order. */
  commands(kind?: string): any[];
  /** Live delivery pauses while false (entries still append). */
  setLive(on: boolean): void;
  /** Load guard: sends queue while paused; un-pausing drains one item per queued chat. */
  setPaused(on: boolean): void;
}

export function createMockChatlog(sai: Record<string, any> = {}): MockChatlog {
  const chats = new Map<string, Chat>();
  const listeners = new Set<(e: ChatLogEntry) => void>();
  const legacy = new Map<string, string>();
  const ledger = new Map<string, Promise<unknown>>();
  const seenCards = new Set<string>();
  let live = true;
  let paused = false;
  /** A send-now stopped this chat's turn: that turn's end must not drain (cleared by streaming_start). */
  const suppressDrain = new Set<string>();

  const ensure = (chatId: string, init?: { projectPath?: string; provider?: Provider }): Chat => {
    let c = chats.get(chatId);
    if (!c) {
      const now = Date.now();
      c = {
        meta: {
          chatId, projectPath: init?.projectPath ?? '/project', createdAt: now, updatedAt: now,
          headSeq: 0, snapshotSeq: 0, provider: init?.provider ?? 'claude', openTurn: false, imported: true,
        },
        snapshot: null, entries: [], head: 0,
      };
      chats.set(chatId, c);
    }
    return c;
  };

  const stateOf = (chatId: string): ChatState | null => {
    const c = chats.get(chatId);
    if (!c) return null;
    const base = c.snapshot ? c.snapshot.state : emptyChatState({ provider: c.meta.provider });
    return reduceMany(base, c.entries);
  };

  const append = (chatId: string, ev: ChatEvent, init?: { projectPath?: string; provider?: Provider }): ChatLogEntry => {
    const wasStreaming = chats.has(chatId) && stateOf(chatId)!.turn.streaming;
    const c = ensure(chatId, init);
    c.head += 1;
    // Main stamps entries with its wall clock.
    const entry: ChatLogEntry = { chatId, seq: c.head, ts: Date.now(), ev };
    c.entries.push(entry);
    c.meta = { ...c.meta, headSeq: c.head, updatedAt: entry.ts, openTurn: stateOf(chatId)?.turn.streaming === true };
    if (live) for (const l of [...listeners]) l(entry);
    if (ev.type === 'streaming_start') suppressDrain.delete(chatId);
    if (wasStreaming && !stateOf(chatId)!.turn.streaming && !suppressDrain.delete(chatId)) drainOne(chatId);
    return entry;
  };

  /** ChatCommands.drainOne, synchronously. */
  function drainOne(chatId: string): void {
    const st = stateOf(chatId);
    if (paused || !st || st.queue.length === 0 || st.turn.streaming) return;
    const item = st.queue[0] as typeof st.queue[0] & { prompt?: string; imagePaths?: string[] };
    dispatchSend(chatId, typeof item.prompt === 'string' ? item.prompt : item.text, item.imagePaths);
    append(chatId, { type: 'queue_removed', clientId: item.clientId, sent: true });
  }

  const record = (msg: Record<string, unknown>): ChatLogEntry[] => {
    const type = msg?.type;
    if (typeof type !== 'string') return [];
    if (type === 'user_message' && msg.logged === true) return [];
    const scope = typeof msg.scope === 'string' && msg.scope ? msg.scope : 'chat';
    const projectPath = typeof msg.projectPath === 'string' ? msg.projectPath : '';
    if (scope === '*') {
      const out: ChatLogEntry[] = [];
      const cardId = typeof msg.id === 'string' && msg.id ? msg.id : null;
      for (const c of chats.values()) {
        if (typeof msg.provider === 'string' && c.meta.provider !== msg.provider) continue;
        if (projectPath && projectPath !== '*' && c.meta.projectPath !== projectPath) continue;
        if (cardId) {
          const key = `${c.meta.chatId}\0${cardId}`;
          if (seenCards.has(key)) continue;
          seenCards.add(key);
        }
        out.push(append(c.meta.chatId, { ...msg, type, scope: c.meta.chatId } as ChatEvent));
      }
      return out;
    }
    let chatId = scope;
    let home = projectPath && projectPath !== '*' ? projectPath : '';
    if (scope === 'chat') {
      const entry = projectPath ? [projectPath, legacy.get(projectPath)] : [...legacy.entries()][0];
      if (!entry?.[1]) return [];
      chatId = entry[1] as string;
      home = home || (entry[0] as string);
    }
    // Lenient where main is strict: a scoped event with no project still lands
    // (tests omit it), and any type may create the log. A backend-created log
    // is not "imported" (see ChatLogStore.importMessages).
    const created = !chats.has(chatId);
    const out = [append(chatId, { ...msg, type, scope: chatId } as ChatEvent, {
      projectPath: home || '/project', ...(typeof msg.provider === 'string' ? { provider: msg.provider as Provider } : {}),
    })];
    if (created) chats.get(chatId)!.meta.imported = false;
    return out;
  };

  /** providerDispatch.ts, routed to the legacy preload methods. */
  const dispatchSend = (chatId: string, prompt: string, imagePaths?: string[]) => {
    const c = chats.get(chatId)!;
    const s = stateOf(chatId)!.settings;
    const p = s.provider ?? c.meta.provider;
    const pp = c.meta.projectPath;
    if (p === 'gemini') sai.geminiSend?.(pp, prompt, imagePaths, s.approvalMode, s.conversationMode, s.model, chatId);
    else if (p === 'kimi') sai.kimiSend?.(pp, prompt, imagePaths, s.approvalMode, s.model, chatId);
    else if (p === 'codex') sai.codexSend?.(pp, prompt, imagePaths, s.permMode, s.effort, s.model, chatId, undefined);
    else sai.claudeSend?.(pp, prompt, imagePaths, s.permMode, s.effort, s.model, chatId);
  };
  const dispatchStop = (chatId: string) => {
    const c = chats.get(chatId)!;
    const p = stateOf(chatId)!.settings.provider ?? c.meta.provider;
    const pp = c.meta.projectPath;
    if (p === 'gemini') sai.geminiStop?.(pp, chatId);
    else if (p === 'kimi') sai.kimiStop?.(pp, chatId);
    else if (p === 'codex') sai.codexStop?.(pp, chatId);
    else sai.claudeStop?.(pp, chatId);
  };

  const exec = async (cmd: any): Promise<{ seq?: number }> => {
    const known = (id: string) => { if (!chats.has(id)) throw new Error(`unknown chat ${id}`); return chats.get(id)!; };
    switch (cmd.kind) {
      case 'send': {
        const exists = chats.has(cmd.chatId);
        if (!exists && !cmd.projectPath) throw new Error(`unknown chat ${cmd.chatId} and no projectPath`);
        if (exists && cmd.provider && cmd.provider !== stateOf(cmd.chatId)!.settings.provider) {
          append(cmd.chatId, { type: 'settings_changed', settings: { provider: cmd.provider } });
          chats.get(cmd.chatId)!.meta.provider = cmd.provider;
        }
        const entry = append(cmd.chatId, {
          type: 'user_message', clientId: cmd.clientId, text: cmd.text ?? '', origin: cmd.origin ?? 'desktop',
          ...(cmd.images?.length ? { images: cmd.images } : {}),
          ...(typeof cmd.taskId === 'string' ? { taskId: cmd.taskId } : {}),
        }, { projectPath: cmd.projectPath, ...(cmd.provider ? { provider: cmd.provider } : {}) });
        const prompt = typeof cmd.promptOverride === 'string' ? cmd.promptOverride : cmd.text;
        const st = stateOf(cmd.chatId)!;
        if (paused || (!cmd.now && (st.turn.streaming || st.queue.length > 0))) {
          append(cmd.chatId, { type: 'queue_added', item: {
            clientId: cmd.clientId, text: cmd.text ?? '', queuedAt: Date.now(), origin: cmd.origin ?? 'desktop',
            ...(cmd.images?.length ? { images: cmd.images } : {}),
            ...(typeof cmd.taskId === 'string' ? { taskId: cmd.taskId } : {}),
            ...(prompt !== cmd.text ? { prompt } : {}),
            ...(cmd.imagePaths?.length ? { imagePaths: cmd.imagePaths } : {}),
          } });
          // Queued behind other items while idle: nothing else wakes the drain.
          if (!paused && !st.turn.streaming) drainOne(cmd.chatId);
          return { seq: entry.seq };
        }
        if (cmd.now) {
          if (st.turn.streaming) suppressDrain.add(cmd.chatId);
          dispatchStop(cmd.chatId);
        }
        dispatchSend(cmd.chatId, prompt, cmd.imagePaths);
        return { seq: entry.seq };
      }
      case 'settings': {
        if (!chats.has(cmd.chatId) && (!cmd.projectPath || !cmd.settings?.provider)) throw new Error(`unknown chat ${cmd.chatId}`);
        const entry = append(cmd.chatId, { type: 'settings_changed', settings: cmd.settings }, { projectPath: cmd.projectPath, provider: cmd.settings?.provider });
        if (cmd.settings?.provider) chats.get(cmd.chatId)!.meta.provider = cmd.settings.provider;
        return { seq: entry.seq };
      }
      case 'interrupt': known(cmd.chatId); dispatchStop(cmd.chatId); return {};
      case 'approve': {
        const c = known(cmd.chatId);
        const p = stateOf(cmd.chatId)!.settings.provider;
        const fn = p === 'kimi' ? sai.kimiApprove : p === 'gemini' ? sai.geminiApprove : sai.claudeApprove;
        await fn?.(c.meta.projectPath, cmd.toolUseId, cmd.approved, cmd.modifiedCommand, cmd.chatId);
        return {};
      }
      case 'answer': {
        const c = known(cmd.chatId);
        await sai.claudeAnswerQuestion?.(c.meta.projectPath, cmd.toolUseId, cmd.answers, cmd.chatId);
        return {};
      }
      case 'planReview': {
        const c = known(cmd.chatId);
        await sai.claudeAnswerPlanReview?.(c.meta.projectPath, cmd.toolUseId, cmd.approved, cmd.chatId);
        return {};
      }
      case 'queueRemove': known(cmd.chatId); return { seq: append(cmd.chatId, { type: 'queue_removed', clientId: cmd.target }).seq };
      case 'queuePromote': known(cmd.chatId); return { seq: append(cmd.chatId, { type: 'queue_promoted', clientId: cmd.target }).seq };
      case 'queueClear': known(cmd.chatId); return { seq: append(cmd.chatId, { type: 'queue_cleared' }).seq };
      default: throw new Error(`unknown command ${cmd.kind}`);
    }
  };

  const api: MockChatlog = {
    open: vi.fn(async (chatId: string, after: number) => {
      const c = chats.get(chatId);
      if (!c) return { snapshot: null, entries: [], headSeq: 0, meta: null };
      const snap = c.snapshot && (after === 0 || after < c.snapshot.seq) ? c.snapshot : null;
      const from = snap ? snap.seq : after;
      return { snapshot: snap, entries: c.entries.filter(e => e.seq > from), headSeq: c.head, meta: { ...c.meta } };
    }),
    onEvent: vi.fn((cb: (e: ChatLogEntry) => void) => { listeners.add(cb); return () => { listeners.delete(cb); }; }),
    appendClient: vi.fn(async (chatId: string, ev: ChatEvent, init?: { projectPath: string; provider?: Provider }) => {
      if (!ev || !CLIENT.has(ev.type)) throw new Error(`appendClient: ${String(ev?.type)} is not a client event type`);
      if (!chats.has(chatId) && !init?.projectPath) throw new Error(`appendClient: unknown chat ${chatId} and no projectPath`);
      return append(chatId, ev, init);
    }),
    importMessages: vi.fn(async (chatId: string, init: { projectPath: string; provider: Provider }, messages: ChatMessage[]) => {
      const c = chats.get(chatId);
      if (c) {
        // ChatLogStore.importMessages: fold into a never-imported log, by id.
        if (c.meta.imported) return false;
        c.meta.imported = true;
        const state = stateOf(chatId)!;
        const have = new Set(state.messages.map(m => m.id));
        const prefix = messages.filter(m => !have.has(m.id));
        if (prefix.length === 0) return 'marked';
        const turn = state.turn.startIndex != null ? { ...state.turn, startIndex: state.turn.startIndex + prefix.length } : state.turn;
        c.snapshot = { chatId, seq: c.head, state: { ...state, messages: [...prefix, ...state.messages], turn } };
        c.entries = [];
        append(chatId, { type: 'history_imported' });
        return 'folded';
      }
      if (!init?.projectPath) return false;
      api.seed(chatId, messages, init);
      return 'created';
    }),
    list: vi.fn(async (projectPath: string) => [...chats.values()].filter(c => c.meta.projectPath === projectPath).map(c => ({ ...c.meta }))),
    delete: vi.fn(async (ids: string[]) => { for (const id of ids) chats.delete(id); }),
    bindLegacyScope: vi.fn(async (projectPath: string, chatId: string) => { legacy.set(projectPath, chatId); }),
    patchMeta: vi.fn(async (chatId: string, patch: Partial<ChatMeta>) => {
      const c = chats.get(chatId);
      if (c) c.meta = { ...c.meta, ...patch };
    }),
    command: vi.fn((cmd: any) => {
      const clientId = typeof cmd?.clientId === 'string' ? cmd.clientId : '';
      if (!clientId) return Promise.resolve({ clientId, ok: false, duplicate: false, error: 'clientId required' });
      const prior = ledger.get(clientId);
      if (prior) return prior.then((r: any) => ({ ...r, duplicate: true }));
      const result = exec(cmd).then(
        r => ({ clientId, ok: true, duplicate: false, ...r }),
        err => ({ clientId, ok: false, duplicate: false, error: err instanceof Error ? err.message : String(err) }),
      );
      ledger.set(clientId, result);
      return result;
    }),
    record,
    seed(chatId, messages, init) {
      const c = ensure(chatId, init);
      const state = stateFromMessages(messages, { provider: init?.provider ?? c.meta.provider });
      c.snapshot = { chatId, seq: 0, state: persistableState(state) };
    },
    append,
    entries: (chatId) => [...(chats.get(chatId)?.entries ?? [])],
    state: stateOf,
    commands: (kind) => api.command.mock.calls.map(([c]) => c).filter((c: any) => !kind || c.kind === kind),
    setLive(on) { live = on; },
    setPaused(on) {
      const resumed = paused && !on;
      paused = on;
      if (resumed) for (const id of chats.keys()) drainOne(id);
    },
  };
  return api;
}

/** Installs a fresh in-memory chat log on `sai` (window.sai mock) and returns it. */
export function installMockChatlog(sai: Record<string, any>): MockChatlog {
  const chatlog = createMockChatlog(sai);
  sai.chatlog = chatlog;
  return chatlog;
}

/** Let the log hook's per-frame batch (and any pending opens) apply. */
export async function flushChatlog(): Promise<void> {
  await act(async () => {
    if (vi.isFakeTimers()) await vi.advanceTimersByTimeAsync(20);
    else await new Promise(r => setTimeout(r, 20));
  });
}

/**
 * Deliver one backend event the way main does: logged (chatlog:event) first,
 * then fanned out to every claudeOnMessage listener (the v1 side-effect path).
 */
export async function emitChat(sai: Record<string, any>, msg: Record<string, unknown>): Promise<void> {
  await act(async () => {
    (sai.chatlog as MockChatlog).record(msg);
    for (const [handler] of sai.claudeOnMessage.mock.calls) (handler as (m: unknown) => void)(msg);
  });
  await flushChatlog();
}

/**
 * For suites written against the v1 path (they invoke the panel's
 * claudeOnMessage handler directly): wraps every handler `mock.calls` hands
 * out so each event is also logged first, exactly once per tick even when a
 * suite calls every registered handler with the same event, so content still
 * reaches the panel through the log.
 */
export function bridgeClaudeOnMessageToLog(sai: Record<string, any>): void {
  const target = sai.claudeOnMessage;
  const wrappers = new WeakMap<(m: unknown) => void, (m: unknown) => void>();
  let seen = new Set<string>();
  const recordOnce = (msg: Record<string, unknown>) => {
    const key = JSON.stringify(msg);
    if (seen.has(key)) return;
    if (seen.size === 0) void Promise.resolve().then(() => { seen = new Set(); });
    seen.add(key);
    (sai.chatlog as MockChatlog).record(msg);
  };
  const wrap = (cb: unknown) => {
    if (typeof cb !== 'function') return cb;
    let w = wrappers.get(cb as (m: unknown) => void);
    if (!w) {
      w = (msg: unknown) => {
        if (msg && typeof msg === 'object') recordOnce(msg as Record<string, unknown>);
        (cb as (m: unknown) => void)(msg);
      };
      wrappers.set(cb as (m: unknown) => void, w);
    }
    return w;
  };
  // The panel's registration is wrapped before the mock records it, so every
  // handler a suite pulls out of mock.calls logs first. Everything else
  // (mock, mockImplementation, matchers) is the original vi.fn.
  const entry = function claudeOnMessage() {} as unknown as (...a: unknown[]) => unknown;
  sai.claudeOnMessage = new Proxy(entry, {
    apply(_t, thisArg, args: unknown[]) { return target.apply(thisArg, [wrap(args[0]), ...args.slice(1)]); },
    has(_t, prop) { return Reflect.has(target, prop); },
    get(_t, prop) {
      const v = Reflect.get(target, prop);
      return typeof v === 'function' && prop !== 'constructor' ? v.bind(target) : v;
    },
  });
}

/**
 * Synchronous frames for log-driven suites: the hook's per-frame batch applies
 * inside the same act() as the event. Returns null so a scheduler that
 * stores the handle sees "no frame pending" afterwards.
 */
export function installSyncFrames(): void {
  Object.defineProperty(window, 'requestAnimationFrame', {
    writable: true, configurable: true,
    value: (cb: FrameRequestCallback) => { cb(0); return null; },
  });
  Object.defineProperty(window, 'cancelAnimationFrame', { writable: true, configurable: true, value: () => {} });
}

/**
 * Suites that still describe history as ChatPanel's old `initialMessages`
 * prop: seeds it into the log as an imported chat (once, before the panel's
 * first open), which is what the panel now renders from.
 */
export function seedPanelHistory(props: { claudeScope?: string; sessionId?: string; projectPath?: string; aiProvider?: string; initialMessages?: ChatMessage[] }): void {
  const chatlog = (window as any).sai?.chatlog as MockChatlog | undefined;
  const chatId = props.claudeScope && props.claudeScope !== 'chat' ? props.claudeScope : props.sessionId;
  if (!chatlog || !chatId || !props.initialMessages?.length || chatlog.state(chatId)) return;
  chatlog.seed(chatId, props.initialMessages, { projectPath: props.projectPath, provider: props.aiProvider as Provider | undefined });
}
