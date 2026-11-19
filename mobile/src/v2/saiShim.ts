// The phone's window.sai: the surface the desktop's ChatPanel subtree calls
// (see .superpowers/sdd/2026-11-19-sai-ios-app-part2/recon.md, "Chat subtree
// window.sai surface"), mapped onto protocol v2 through a V2Client.
//
// - chatlog.* → chat.subscribe / chat.command / chat.page / chats.subscribe.
// - Side-effect events (claudeOnMessage) are the live log entries' events;
//   nothing is fabricated.
// - No phone-side cache of chats (ruling P7): the shim's in-memory state is
//   all there is, and a reconnect catches up from `after`.
// - Desktop-only calls are stubs returning their documented empty value
//   (ruling P2: no always-allow, sudo answers, Codex App Server prompts or
//   form submits from the phone). Unknown names fall back to a logging no-op.
import type { ChatEvent, ChatLogEntry, ChatMeta, ChatSettings, ChatState } from '../../../src/lib/chat/types';
import type { ChatMessage } from '../../../src/types';
import type { ChatCommand, CommandResult } from '../../../electron/services/chatlog/commands';
import { normalizeChatState } from '../../../src/lib/chat/reducer';
import type { SaiChatLogApi } from '../../../src/types';
import type { V2Client } from './client';
import type { ChatEntriesFrame, ChatEntryFrame, ChatErrorFrame, ChatSnapshotFrame, ChatsListFrame, ConnState, NativeApi } from './types';
import { CHAT_LOG_UNAVAILABLE_MESSAGE } from './types';
import { newClientId } from '../../../src/lib/clientId';

type Provider = ChatSettings['provider'];

export interface SaiShimOpts {
  native: NativeApi;
  /** The desktop's phone-visible settings (fed by app.settings / app.settings.changed). */
  settings: () => Record<string, unknown>;
}

/** A command the desktop refused as `unavailable` (chat log starting) is resent after this long. */
export const COMMAND_RETRY_MS = 1_000;

/** The sudo stub's toast. */
export const SUDO_TOAST = 'Answer sudo prompts on the desktop';

/** chat-v2.ts chatIdOf: anything else gets no reply from the server. */
const CHAT_ID = /^[A-Za-z0-9_-]{1,128}$/;
const validChatId = (v: string): boolean => CHAT_ID.test(v) && !(v in Object.prototype);

/** Client event types appendClient may send as a clientEvent command (ChatCommands checks them again). */
const CLIENT_EVENT_TYPES = new Set(['local_note', 'watcher_snapshot']);

/** A fresh client id (crypto.randomUUID needs iOS 15.4; the app targets 15.0). */
export { newClientId };

function dataUrlToArrayBuffer(dataUrl: string): ArrayBuffer | null {
  const comma = dataUrl.indexOf(',');
  if (comma < 0 || !dataUrl.slice(0, comma).endsWith(';base64')) return null;
  const bin = atob(dataUrl.slice(comma + 1));
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out.buffer;
}

interface PendingOpen {
  after: number;
  resolve: (r: OpenResult) => void;
  reject: (err: Error) => void;
}

type OpenResult = {
  snapshot: { chatId: string; seq: number; state: ChatState } | null;
  entries: ChatLogEntry[];
  headSeq: number;
  meta: null;
  olderCount: number;
};

interface PendingCommand {
  frame: Record<string, unknown>;
  retry: ReturnType<typeof setTimeout> | null;
  waiters: Array<{ resolve: (r: CommandResult) => void; reject: (err: Error) => void }>;
}

const resolved = <T,>(v: T) => () => Promise.resolve(v);
const noop = () => undefined;
const noUnsub = () => () => {};

export function createSaiShim(client: V2Client, opts: SaiShimOpts): SaiBridge {
  const { native } = opts;
  const entryListeners = new Set<(e: ChatLogEntry) => void>();
  const messageListeners = new Set<(ev: unknown) => void>();
  const resyncListeners = new Set<(chatId: string) => void>();
  const backgroundListeners = new Set<(p: { projectPath: string; scope: string; tasks: unknown[] }) => void>();
  /**
   * chatId → the chat.subscribes awaiting their chat.entries, in send order
   * (the server answers them in order): an open, or null for a reconnect's
   * replay of a live subscription.
   */
  const expects = new Map<string, Array<PendingOpen | null>>();
  const nextExpect = (chatId: string): PendingOpen | null | undefined => {
    const q = expects.get(chatId);
    const x = q?.shift();
    if (q && q.length === 0) expects.delete(chatId);
    return x;
  };
  /** chatId → the chat.snapshot that precedes its chat.entries. */
  const snaps = new Map<string, { seq: number; state: ChatState; olderCount: number }>();
  /** chatId → highest seq whose event went to claudeOnMessage (no double side effects). */
  const emitted = new Map<string, number>();
  /** clientId → command awaiting its chat.ack. */
  const commands = new Map<string, PendingCommand>();
  /** projectPath → its chat list, kept current by chats.changed. */
  const lists = new Map<string, ChatMeta[]>();
  const listLoads = new Map<string, Promise<ChatMeta[]>>();
  /** chatId → projectPath, learned from chat lists and commands (for background-task payloads). */
  const projectOf = new Map<string, string>();

  const isConnected = (s: ConnState) => s === 'open' || s === 'catching_up';
  let wasConnected = isConnected(client.state);

  const emit = <A,>(set: Set<(a: A) => void>, a: A, what: string) => {
    for (const cb of [...set]) { try { cb(a); } catch (err) { console.error(`[sai-shim] ${what} listener failed`, err); } }
  };

  const markEmitted = (chatId: string, seq: number) => {
    if (seq > (emitted.get(chatId) ?? 0)) emitted.set(chatId, seq);
  };

  /** A live (or caught-up live) entry: to the chat reader, then its event to side-effect consumers. */
  const fanOut = (entry: ChatLogEntry) => {
    if (!entry || typeof entry.seq !== 'number' || typeof entry.chatId !== 'string') return;
    emit(entryListeners, entry, 'chatlog');
    if (entry.seq > (emitted.get(entry.chatId) ?? 0)) {
      emitted.set(entry.chatId, entry.seq);
      emit(messageListeners, entry.ev as unknown, 'claudeOnMessage');
    }
  };

  const learnProjects = (chats: unknown) => {
    if (!Array.isArray(chats)) return;
    for (const m of chats as ChatMeta[]) if (m && typeof m.chatId === 'string' && typeof m.projectPath === 'string') projectOf.set(m.chatId, m.projectPath);
  };

  // ─── v2 frames ─────────────────────────────────────────────────────────────

  client.on('chat.snapshot', (f: ChatSnapshotFrame) => {
    if (typeof f.chatId !== 'string' || !f.state) return;
    snaps.set(f.chatId, { seq: f.seq, state: normalizeChatState(f.state), olderCount: typeof f.olderCount === 'number' ? f.olderCount : 0 });
  });

  client.on('chat.entries', (f: ChatEntriesFrame) => {
    if (typeof f.chatId !== 'string') return;
    const entries = Array.isArray(f.entries) ? f.entries : [];
    const snap = snaps.get(f.chatId) ?? null;
    snaps.delete(f.chatId);
    const open = nextExpect(f.chatId);
    const top = entries.length ? entries[entries.length - 1].seq : 0;
    if (open) {
      // History: never re-emitted as side effects.
      markEmitted(f.chatId, Math.max(top, snap?.seq ?? 0));
      open.resolve({
        snapshot: snap ? { chatId: f.chatId, seq: snap.seq, state: snap.state } : null,
        entries,
        headSeq: Math.max(top, snap?.seq ?? 0, open.after),
        meta: null,
        olderCount: snap?.olderCount ?? 0,
      });
      return;
    }
    // A subscription replayed after a reconnect.
    if (snap) {
      // Entries were folded into a snapshot meanwhile: the reader must re-open.
      markEmitted(f.chatId, Math.max(top, snap.seq));
      emit(resyncListeners, f.chatId, 'resync');
      return;
    }
    for (const e of entries) fanOut(e);
  });

  client.on('chat.entry', (f: ChatEntryFrame) => { if (f && f.entry) fanOut(f.entry); });

  /**
   * Resends a pending command soon. Never rejected for `unavailable`: the
   * desktop may have run it (an older desktop's error doesn't say which frame
   * failed), and a resend with the same clientId is acked as a duplicate.
   */
  const retryCommand = (clientId: string) => {
    const c = commands.get(clientId);
    if (!c || c.retry) return;
    c.retry = setTimeout(() => {
      c.retry = null;
      if (commands.get(clientId) === c && client.connected) client.send(c.frame);
    }, COMMAND_RETRY_MS);
  };

  const settleCommand = (clientId: string): PendingCommand | null => {
    const c = commands.get(clientId);
    if (!c) return null;
    commands.delete(clientId);
    if (c.retry) clearTimeout(c.retry);
    return c;
  };

  /** Rejects every pending open and command: nothing will be sent again. */
  const failAll = (err: Error) => {
    for (const q of expects.values()) for (const o of q) o?.reject(err);
    expects.clear();
    snaps.clear();
    for (const id of [...commands.keys()]) for (const w of settleCommand(id)!.waiters) w.reject(err);
  };

  client.onStop((reason) => failAll(new Error(reason === 'unpaired' ? 'This desktop is no longer paired' : 'Disconnected from the desktop')));

  client.on('chat.error', (f: ChatErrorFrame & { clientId?: unknown }) => {
    if (f.reqId !== undefined) return; // a request's own error (V2Client rejects it)
    if (typeof f.clientId === 'string') {
      if (f.code === 'unavailable') retryCommand(f.clientId);
      return;
    }
    if (typeof f.chatId === 'string' && (f.code === 'read_failed' || f.code === 'unavailable')) {
      const open = nextExpect(f.chatId);
      snaps.delete(f.chatId);
      if (open) open.reject(new Error(f.message || 'chat read failed'));
      // A failed replay left the chat without a live subscription: the reader re-opens.
      else if (open === null) emit(resyncListeners, f.chatId, 'resync');
    } else if (!f.chatId && f.message === CHAT_LOG_UNAVAILABLE_MESSAGE) {
      // Main's chat log isn't built yet: nothing sent on this socket ran.
      const err = new Error(CHAT_LOG_UNAVAILABLE_MESSAGE);
      const replayed: string[] = [];
      for (const [chatId, q] of expects) for (const o of q) { if (o) o.reject(err); else replayed.push(chatId); }
      expects.clear();
      snaps.clear();
      for (const chatId of new Set(replayed)) emit(resyncListeners, chatId, 'resync');
      for (const id of commands.keys()) retryCommand(id);
    }
  });

  client.on('chat.ack', (f: { result?: CommandResult }) => {
    const r = f.result;
    if (!r || typeof r.clientId !== 'string') return;
    const c = settleCommand(r.clientId);
    if (c) for (const w of c.waiters) w.resolve(r);
  });

  const onList = (f: ChatsListFrame) => {
    if (typeof f.projectPath !== 'string' || !Array.isArray(f.chats)) return;
    lists.set(f.projectPath, f.chats);
    learnProjects(f.chats);
  };
  client.on('chats.list.result', onList);
  client.on('chats.changed', onList);

  client.on('chat.background', (f: { chatId?: string; tasks?: unknown[] }) => {
    if (typeof f.chatId !== 'string') return;
    emit(backgroundListeners, { projectPath: projectOf.get(f.chatId) ?? '', scope: f.chatId, tasks: Array.isArray(f.tasks) ? f.tasks : [] }, 'background');
  });

  client.onResubscribe((chatId) => {
    let q = expects.get(chatId);
    if (!q) { q = []; expects.set(chatId, q); }
    q.push(null);
    snaps.delete(chatId);
  });

  // Un-acked commands go out again on every (re)connect with the same clientId:
  // the desktop's ledger answers a repeat with duplicate:true instead of running it twice.
  client.onState((s) => {
    const now = isConnected(s);
    if (now && !wasConnected) {
      snaps.clear(); // a snapshot only pairs with the chat.entries that follow it on the same socket
      for (const c of commands.values()) client.send(c.frame);
    }
    wasConnected = now;
  });

  // ─── chatlog ───────────────────────────────────────────────────────────────

  const runCommand = (cmd: ChatCommand): Promise<CommandResult> => new Promise((resolve, reject) => {
    if (!cmd || typeof cmd.clientId !== 'string' || !cmd.clientId) { reject(new Error('command needs a clientId')); return; }
    if (client.halted) { reject(new Error('Not connected to a desktop')); return; }
    const existing = commands.get(cmd.clientId);
    if (existing) { existing.waiters.push({ resolve, reject }); return; }
    if ('projectPath' in cmd && typeof cmd.projectPath === 'string' && cmd.projectPath && !projectOf.has(cmd.chatId)) projectOf.set(cmd.chatId, cmd.projectPath);
    const frame = { type: 'chat.command', command: cmd };
    commands.set(cmd.clientId, { frame, retry: null, waiters: [{ resolve, reject }] });
    if (isConnected(client.state)) client.send(frame);
  });

  const chatlog: SaiChatLogApi = {
    open(chatId: string, after: number): Promise<any> {
      if (typeof chatId !== 'string' || !validChatId(chatId)) return Promise.reject(new Error(`invalid chat id ${String(chatId)}`));
      if (client.halted) return Promise.reject(new Error('Not connected to a desktop'));
      const from = typeof after === 'number' && Number.isInteger(after) && after > 0 ? after : 0;
      return new Promise<OpenResult>((resolve, reject) => {
        let q = expects.get(chatId);
        if (!q) { q = []; expects.set(chatId, q); }
        q.push({ after: from, resolve, reject });
        client.send({ type: 'chat.subscribe', chatId, after: from });
      });
    },

    page(chatId: string, beforeIndex: number, limit: number) {
      return client.request<{ messages?: ChatMessage[]; olderCount?: number }>({ type: 'chat.page', chatId, beforeIndex, limit })
        .then((r) => ({ messages: Array.isArray(r.messages) ? r.messages : [], olderCount: typeof r.olderCount === 'number' ? r.olderCount : 0 }));
    },

    close(chatId: string) {
      if (typeof chatId !== 'string') return;
      // Settle this chat's opens and the client's record together, online or
      // offline, so a later open can't be paired with a stale answer.
      const q = expects.get(chatId);
      expects.delete(chatId);
      snaps.delete(chatId);
      if (q) for (const o of q) o?.reject(new Error(`chat ${chatId} closed`));
      client.send({ type: 'chat.unsubscribe', chatId });
    },

    onEvent(cb) {
      entryListeners.add(cb);
      return () => { entryListeners.delete(cb); };
    },

    onResync(cb) {
      resyncListeners.add(cb);
      return () => { resyncListeners.delete(cb); };
    },

    async appendClient(chatId: string, ev: ChatEvent, init?: { projectPath: string; provider?: Provider }): Promise<ChatLogEntry> {
      const type = (ev as { type?: unknown })?.type;
      const clientId = newClientId();
      let cmd: ChatCommand;
      if (type === 'cleared') {
        cmd = { kind: 'clear', chatId, clientId };
      } else if (CLIENT_EVENT_TYPES.has(type as string) || (type === 'user_message' && (ev as { local?: unknown }).local === true)) {
        cmd = {
          kind: 'clientEvent', chatId, clientId, ev,
          ...(init?.projectPath ? { projectPath: init.projectPath } : {}),
          ...(init?.provider ? { provider: init.provider } : {}),
        };
      } else {
        throw new Error(`appendClient: ${String(type)} can't be sent from the phone`);
      }
      const r = await runCommand(cmd);
      if (!r.ok) throw new Error(r.error || `appendClient ${String(type)} failed`);
      // The logged entry itself arrives through chat.entry.
      return { chatId, seq: r.seq ?? 0, ts: Date.now(), ev };
    },

    command: runCommand,

    importMessages: () => Promise.resolve('marked' as const),

    list(projectPath: string) {
      const cached = lists.get(projectPath);
      if (cached) return Promise.resolve(cached);
      const loading = listLoads.get(projectPath);
      if (loading) return loading;
      const p = client.request<{ chats?: ChatMeta[] }>({ type: 'chats.subscribe', projectPath })
        .then((r) => {
          const chats = Array.isArray(r.chats) ? r.chats : [];
          lists.set(projectPath, chats);
          learnProjects(chats);
          return chats;
        })
        .finally(() => { listLoads.delete(projectPath); });
      listLoads.set(projectPath, p);
      return p;
    },

    delete: () => Promise.resolve(),
    bindLegacyScope: () => Promise.resolve(),
    patchMeta: () => Promise.resolve(),
  };

  // ─── mapped calls ──────────────────────────────────────────────────────────

  const models = (provider: Provider) => () =>
    client.request<{ models?: unknown }>({ type: 'models.list', provider }).then((r) => r.models ?? []);

  const readFile = (kind: 'toolImage' | 'model', ref: string) =>
    client.request<{ dataUrl?: string; error?: string }>({ type: 'file.read', kind, ref }, 30_000);

  const started = () => Promise.resolve({ slashCommands: [] as unknown[] });

  const loadGuardState = {
    level: 'normal', paused: false, override: false, saiCaused: false, saiAppHeavy: false,
    memUsedPct: 0, swapUsedPct: 0, game: null, recoveredAt: null, enabled: false,
  };
  const noIssue = () => Promise.resolve({ ok: false, status: 0, body: null });
  const desktopOnly = () => Promise.resolve({ ok: false, code: 'unsupported' as const });

  const target: Record<string, unknown> = {
    platform: 'ios',
    chatlog,

    // Provider sessions live on the desktop: the composer is ready at once.
    claudeStart: started,
    codexStart: started,
    geminiStart: started,
    kimiStart: started,

    claudeOnMessage(cb: (msg: unknown) => void) {
      messageListeners.add(cb);
      return () => { messageListeners.delete(cb); };
    },
    claudeOnBackgroundTasks(cb: (p: { projectPath: string; scope: string; tasks: unknown[] }) => void) {
      backgroundListeners.add(cb);
      return () => { backgroundListeners.delete(cb); };
    },
    claudeStopTask(_projectPath: string, scope: string | undefined, taskId: string): Promise<boolean> {
      if (!scope) return Promise.resolve(false);
      // ok:false means the task already ended: not retried.
      return runCommand({ kind: 'stopTask', chatId: scope, clientId: newClientId(), taskId })
        .then((r) => !!r.ok, () => false);
    },
    claudeCompact(_projectPath: string, _permMode?: string, _effort?: string, _model?: string, scope?: string): void {
      if (!scope) return;
      // queue: waits behind a busy turn and the load-guard pause, like the desktop composer.
      void runCommand({ kind: 'compact', chatId: scope, clientId: newClientId(), queue: true })
        .then((r) => { if (!r.ok) native.toast(r.error ? `Compact failed: ${r.error}` : 'Compact failed'); }, () => {});
    },
    claudeRefreshSlashCommands(projectPath: string, scope?: string) {
      if (!scope || !projectPath) return Promise.resolve([]);
      return client.request<{ commands?: unknown[] }>({ type: 'slash.list', projectPath, chatId: scope })
        .then((r) => (Array.isArray(r.commands) ? r.commands : []));
    },

    claudeModels: models('claude'),
    codexModels: models('codex'),
    geminiModels: models('gemini'),
    kimiModels: models('kimi'),

    settingsGet(key: string, defaultValue?: unknown) {
      let v: unknown;
      try { v = opts.settings()[key]; } catch { v = undefined; }
      return Promise.resolve(v === undefined ? defaultValue : v);
    },
    // Desktop settings are the desktop's: the phone never writes them.
    settingsSet: resolved(undefined),

    async fsReadFileBase64(filePath: string): Promise<string> {
      const r = await readFile('toolImage', filePath);
      if (typeof r.dataUrl !== 'string') throw new Error(r.error || 'read_failed');
      return r.dataUrl;
    },
    async modelReadCached(versionKey: string): Promise<ArrayBuffer | null> {
      try {
        const r = await readFile('model', versionKey);
        return typeof r.dataUrl === 'string' ? dataUrlToArrayBuffer(r.dataUrl) : null;
      } catch { return null; }
    },

    async openExternal(url: string) { await native.openUrl(url); },
    async clipboardWrite(text: string) {
      try { await native.copyText(text); return true; } catch { return false; }
    },
    clipboardReadImage: resolved(null),
    // Images ride on the send command as data URLs; there is no local file.
    saveImage: resolved(''),

    // ─── stubs: desktop-only ─────────────────────────────────────────────────
    devlog: noop,
    devlogInfo: resolved({ enabled: false, path: null }),
    brainstormConsumeSeed: resolved(null),
    claudeSudoPending: resolved(null),
    claudeSudoReply() { native.toast(SUDO_TOAST); return Promise.resolve(false); },
    claudeSudoState: resolved(null),
    claudeSudoLock: resolved(undefined),
    claudeReconcileScope: noop,
    codexReconcileScope: noop,
    claudeAlwaysAllow: resolved(undefined),
    codexAppServerApprove: desktopOnly,
    codexAppServerAnswerUserInput: desktopOnly,
    codexAppServerResolveMcpElicitation: desktopOnly,
    codexUsageFetch: resolved(null),
    onUsageUpdate: noUnsub,
    usageFetch: resolved(null),
    usageMode: resolved(null),
    loadGuardOnState: noUnsub,
    loadGuardGetState: () => Promise.resolve({ ...loadGuardState }),
    loadGuardTopUsers: resolved([]),
    loadGuardResume: resolved(undefined),
    mcpRuntimeStatus: resolved(null),
    mcpStatus: resolved(null),
    codexMcpRuntimeStatus: resolved(null),
    onMcpRuntimeStatus: noUnsub,
    claudeSubagentTranscript: resolved(null),
    selectFile: resolved(null),
    terminalWrite: noop,
    githubApiGet: noIssue,
    jiraGetIssue: noIssue,
    linearGetIssue: noIssue,
    jiraConfigured: resolved(false),
    linearConfigured: resolved(false),
    renderMintFileUrl: resolved({ ok: false, error: 'Open this render on the desktop' }),
    renderReleaseFileUrl: resolved(false),
    setTitleBarOverlay: noop,
    claudeStop: noop,
    // Feature-detected by callers (`sai?.x`): absent is the right answer.
    renderOpenInBrowser: undefined,
    storeToolResultImage: undefined,
    modelSnapshot: undefined,
  };

  const warned = new Set<string>();
  return new Proxy(target, {
    get(t, name, receiver) {
      if (typeof name === 'symbol' || name in t) return Reflect.get(t, name, receiver);
      // Not thenable, not a React element, not serializable-special.
      if (name === 'then' || name === 'toJSON' || name === '$$typeof' || name === 'constructor') return undefined;
      return (...args: unknown[]) => {
        if (!warned.has(name)) {
          warned.add(name);
          console.warn(`[sai-shim] window.sai.${name} is not available on the phone`, args.length ? `(${args.length} args)` : '');
        }
        return undefined;
      };
    },
  }) as SaiBridge;
}

/** NativeApi over the Capacitor Browser and Clipboard plugins (loaded on first use). */
export function capacitorNative(toast: (message: string) => void): NativeApi {
  return {
    async openUrl(url: string) {
      const { Browser } = await import('@capacitor/browser');
      await Browser.open({ url });
    },
    async copyText(text: string) {
      const { Clipboard } = await import('@capacitor/clipboard');
      await Clipboard.write({ string: text });
    },
    toast,
  };
}
