/**
 * E2E test setup — runs against the Vite dev server in a regular browser.
 *
 * NOTE: Playwright's Electron launch support is broken with Electron 33
 * (require('electron').app is undefined in the -r preload context).
 * Instead, we test the renderer via a regular Chromium browser pointing
 * at the Vite dev server. This covers all UI interactions. Electron-specific
 * features (native menus, file dialogs) are tested via unit/integration tests.
 *
 * Since window.sai (the Electron preload bridge) doesn't exist in a browser,
 * we inject a mock before the page loads. Per-test overrides are supported
 * via the `saiMock` fixture option (see SaiMockOverrides below).
 */

import { test as base, expect, Page } from '@playwright/test';
import path from 'path';
import { version as APP_VERSION } from '../../package.json';

const FIXTURE_PROJECT = path.resolve(__dirname, 'fixtures/test-project');

/**
 * Build the default window.sai mock. Returns a fresh object on every call so
 * tests cannot mutate each other's state.
 */
export function buildDefaultSaiMock(fixturePath: string): Record<string, any> {
  const noop = () => () => {};
  const mock: Record<string, any> = {
    platform: 'linux',
    getCwd: () => Promise.resolve(fixturePath),
    getRecentProjects: () => Promise.resolve([fixturePath]),
    selectFolder: () => Promise.resolve(null),
    selectFile: () => Promise.resolve(null),
    openRecentProject: () => {},
    settingsGet: (key: string, defaultVal?: any) => {
      // Suppress the What's New modal in tests by pretending the user has already
      // seen the current version. useWhatsNew compares lastSeenVersion against
      // package.json's version with strict !==, so this MUST track the real
      // version or the modal renders a full-screen overlay that blocks clicks.
      if (key === 'lastSeenVersion') return Promise.resolve(APP_VERSION);
      return Promise.resolve(defaultVal ?? null);
    },
    settingsSet: () => Promise.resolve(),
    claudeStart: () => Promise.resolve({ slashCommands: ['/help', '/clear', '/compact'] }),
    claudeSend: () => {},
    claudeStop: () => {},
    claudeSetSessionId: () => {},
    claudeApprove: () => Promise.resolve(),
    claudeAlwaysAllow: () => Promise.resolve(),
    claudeGenerateCommitMessage: () => Promise.resolve('fix: test'),
    claudeOnMessage: (_cb: any) => noop(),
    codexModels: () => Promise.resolve({ models: [], defaultModel: '' }),
    codexStart: () => Promise.resolve({ message: 'ready' }),
    codexSend: () => {},
    codexStop: () => {},
    codexOnMessage: (_cb: any) => noop(),
    geminiModels: () => Promise.resolve({ models: [], defaultModel: 'auto-gemini-3' }),
    geminiStart: () => Promise.resolve({ message: 'ready' }),
    geminiSend: () => {},
    geminiStop: () => {},
    geminiSetSessionId: () => {},
    codexSetSessionId: () => {},
    geminiOnMessage: (_cb: any) => noop(),
    terminalCreate: () => Promise.resolve(1),
    terminalWrite: () => {},
    terminalResize: () => {},
    terminalOnData: (_cb: any) => noop(),
    terminalOnCtrlC: (_cb: any) => noop(),
    terminalSignal: () => {},
    terminalKill: () => Promise.resolve(),
    terminalGetProcess: () => Promise.resolve(null),
    terminalIsAwaitingInput: () => Promise.resolve(false),
    openExternal: () => {},
    gitStatus: () => Promise.resolve({ branch: 'main', staged: [], modified: [], created: [], deleted: [], not_added: [], ahead: 0, behind: 0 }),
    gitStage: () => Promise.resolve(),
    gitUnstage: () => Promise.resolve(),
    gitCommit: () => Promise.resolve(),
    gitPush: () => Promise.resolve(),
    gitPull: () => Promise.resolve(),
    gitFetch: () => Promise.resolve(),
    gitLog: () => Promise.resolve([]),
    gitBranches: () => Promise.resolve([]),
    gitCheckout: () => Promise.resolve(),
    gitCreateBranch: () => Promise.resolve(),
    gitDiff: () => Promise.resolve(''),
    gitDiscard: () => Promise.resolve(),
    gitShow: () => Promise.resolve(''),
    fsReadDir: () => Promise.resolve([
      { name: 'src', path: fixturePath + '/src', type: 'directory' },
      { name: 'package.json', path: fixturePath + '/package.json', type: 'file' },
      { name: 'README.md', path: fixturePath + '/README.md', type: 'file' },
    ]),
    fsReadFile: () => Promise.resolve('// test content'),
    fsReadFileBase64: () => Promise.resolve("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='80' height='80'%3E%3Crect width='80' height='80' fill='%2300a000'/%3E%3C/svg%3E"),
    fsReadFileBase: () => Promise.resolve(''),
    fsMtime: () => Promise.resolve({ mtime: Date.now() }),
    fsWriteFile: () => Promise.resolve(),
    fsRename: () => Promise.resolve(),
    fsDelete: () => Promise.resolve(),
    fsCreateFile: () => Promise.resolve(),
    fsCreateDir: () => Promise.resolve(),
    fsCheckIgnored: () => Promise.resolve([]),
    fsWalkFiles: () => Promise.resolve([]),
    searchRun: () => Promise.resolve({ files: [], truncated: false, durationMs: 0 }),
    searchReplaceFile: () => Promise.resolve(),
    workspaceSetActive: () => {},
    workspaceGetAll: () => Promise.resolve([{ projectPath: fixturePath, status: 'active', lastActivity: Date.now() }]),
    workspaceClose: () => Promise.resolve(),
    workspaceSuspend: () => Promise.resolve(),
    onWorkspaceSuspended: (_cb: any) => noop(),
    usageFetch: () => Promise.resolve(null),
    usageMode: () => Promise.resolve('api'),
    onUsageUpdate: (_cb: any) => noop(),
    updateCheck: () => Promise.resolve(),
    updateInstall: () => {},
    updateGetVersion: () => Promise.resolve('0.3.17'),
    onUpdateStatus: (_cb: any) => noop(),
    onUpdateAvailable: (_cb: any) => noop(),
    onUpdateProgress: (_cb: any) => noop(),
    onUpdateDownloaded: (_cb: any) => noop(),
    onUpdateError: (_cb: any) => noop(),
    setBadgeCount: () => {},
    githubGetUser: () => Promise.resolve({ login: 'test-user', avatar_url: 'data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg"/>', name: 'Test User' }),
    githubStartAuth: () => {},
    githubCancelAuth: () => {},
    githubLogout: () => Promise.resolve(),
    githubOnAuthComplete: (_cb: any) => noop(),
    githubOnAuthError: (_cb: any) => noop(),
    githubSyncNow: () => Promise.resolve(),
    githubOnSyncStatus: (_cb: any) => noop(),
    githubOnSettingsApplied: (_cb: any) => noop(),
    saveImage: () => Promise.resolve('/tmp/test.png'),
    brainstormConsumeSeed: () => Promise.resolve({ ok: false }),
    claudeGenerateTitle: () => Promise.resolve(''),
    claudeAnswerQuestion: () => Promise.resolve(),
    claudeAnswerPlanReview: () => Promise.resolve(),
    claudeCompact: () => Promise.resolve(),
    metaWorkspaceList: () => Promise.resolve([]),
    metaWorkspaceActivate: () => Promise.resolve(),
    metaWorkspaceCreate: () => Promise.resolve(),
    metaWorkspaceDelete: () => Promise.resolve(),
    metaWorkspaceUpdate: () => Promise.resolve(),
    windowMinimize: () => {},
    windowMaximizeToggle: () => {},
    windowClose: () => {},
    windowIsMaximized: () => Promise.resolve(false),
    windowOnMaximizedChange: (_cb: any) => noop(),
    windowIsFramelessRounded: () => Promise.resolve(false),
    scaffoldProject: () => Promise.resolve({ ok: false }),
    selectFile: () => Promise.resolve(null),
    remote: () => Promise.resolve(null),
  };
  installE2EChatlog(mock);
  return mock;
}

/**
 * In-memory `window.sai.chatlog` for the browser e2e (the renderer renders
 * chats from main's durable log). Self-contained — its source is shipped into
 * the page by addInitScript — so it may not reference anything outside itself.
 *
 * - `command` logs like main's ChatCommands (send → user_message, settings →
 *   settings_changed, …) and dispatches through the legacy mock methods
 *   (claudeSend, codexStop, …) the way providerDispatch does.
 * - Backend events a test fires through the captured claudeOnMessage callback
 *   are logged first (once per event), as main does before the v1 IPC; events
 *   without a scope land in the chat that last sent, else the one the panel
 *   last opened (the legacy binding).
 */
export function installE2EChatlog(sai: Record<string, any>): void {
  type Entry = { chatId: string; seq: number; ts: number; ev: Record<string, any> };
  const chats = new Map<string, { meta: Record<string, any>; snapshot: any; entries: Entry[]; settings: Record<string, any> }>();
  const listeners = new Set<(e: Entry) => void>();
  const ledger = new Map<string, Promise<any>>();
  let lastSent: string | null = null;
  let lastOpened: string | null = null;
  const ensure = (chatId: string, init?: { projectPath?: string; provider?: string }) => {
    let c = chats.get(chatId);
    if (!c) {
      const now = Date.now();
      const provider = init?.provider ?? 'claude';
      c = {
        meta: { chatId, projectPath: init?.projectPath ?? '', createdAt: now, updatedAt: now, headSeq: 0, snapshotSeq: 0, provider, openTurn: false },
        snapshot: null, entries: [], settings: { provider },
      };
      chats.set(chatId, c);
    } else if (init?.projectPath && !c.meta.projectPath) {
      c.meta.projectPath = init.projectPath;
    }
    return c;
  };
  const append = (chatId: string, ev: Record<string, any>, init?: { projectPath?: string; provider?: string }): Entry => {
    const c = ensure(chatId, init);
    const entry = { chatId, seq: c.meta.headSeq + 1, ts: Date.now(), ev };
    c.meta.headSeq = entry.seq;
    c.meta.updatedAt = entry.ts;
    c.entries.push(entry);
    if (ev.type === 'settings_changed' && ev.settings) c.settings = { ...c.settings, ...ev.settings };
    for (const l of [...listeners]) { try { l(entry); } catch { /* a listener's own problem */ } }
    return entry;
  };
  const dispatch = (chatId: string, kind: 'send' | 'stop', prompt?: string, imagePaths?: string[]) => {
    const c = chats.get(chatId)!;
    const s = c.settings;
    const pp = c.meta.projectPath;
    const p = s.provider ?? c.meta.provider;
    if (kind === 'stop') {
      (p === 'gemini' ? sai.geminiStop : p === 'kimi' ? sai.kimiStop : p === 'codex' ? sai.codexStop : sai.claudeStop)?.(pp, chatId);
      return;
    }
    if (p === 'gemini') sai.geminiSend?.(pp, prompt, imagePaths, s.approvalMode, s.conversationMode, s.model, chatId);
    else if (p === 'kimi') sai.kimiSend?.(pp, prompt, imagePaths, s.approvalMode, s.model, chatId);
    else if (p === 'codex') sai.codexSend?.(pp, prompt, imagePaths, s.permMode, s.effort, s.model, chatId, undefined);
    else sai.claudeSend?.(pp, prompt, imagePaths, s.permMode, s.effort, s.model, chatId);
  };
  const exec = async (cmd: any): Promise<{ seq?: number }> => {
    const known = (id: string) => { const c = chats.get(id); if (!c) throw new Error(`unknown chat ${id}`); return c; };
    switch (cmd.kind) {
      case 'send': {
        if (!chats.has(cmd.chatId) && !cmd.projectPath) throw new Error('unknown chat and no projectPath');
        const e = append(cmd.chatId, {
          type: 'user_message', clientId: cmd.clientId, text: cmd.text ?? '', origin: cmd.origin ?? 'desktop',
          ...(cmd.images?.length ? { images: cmd.images } : {}), ...(cmd.taskId ? { taskId: cmd.taskId } : {}),
        }, { projectPath: cmd.projectPath, provider: cmd.provider });
        lastSent = cmd.chatId;
        if (cmd.now) dispatch(cmd.chatId, 'stop');
        dispatch(cmd.chatId, 'send', typeof cmd.promptOverride === 'string' ? cmd.promptOverride : cmd.text, cmd.imagePaths);
        return { seq: e.seq };
      }
      case 'settings':
        return { seq: append(cmd.chatId, { type: 'settings_changed', settings: cmd.settings }, { projectPath: cmd.projectPath, provider: cmd.settings?.provider }).seq };
      case 'interrupt': known(cmd.chatId); dispatch(cmd.chatId, 'stop'); return {};
      case 'approve': {
        const c = known(cmd.chatId);
        const p = c.settings.provider;
        await (p === 'kimi' ? sai.kimiApprove : p === 'gemini' ? sai.geminiApprove : sai.claudeApprove)?.(c.meta.projectPath, cmd.toolUseId, cmd.approved, cmd.modifiedCommand, cmd.chatId);
        return {};
      }
      case 'answer': { const c = known(cmd.chatId); await sai.claudeAnswerQuestion?.(c.meta.projectPath, cmd.toolUseId, cmd.answers, cmd.chatId); return {}; }
      case 'planReview': { const c = known(cmd.chatId); await sai.claudeAnswerPlanReview?.(c.meta.projectPath, cmd.toolUseId, cmd.approved, cmd.chatId); return {}; }
      case 'queueRemove': known(cmd.chatId); return { seq: append(cmd.chatId, { type: 'queue_removed', clientId: cmd.target }).seq };
      case 'queueClear': known(cmd.chatId); return { seq: append(cmd.chatId, { type: 'queue_cleared' }).seq };
      default: throw new Error(`unknown command ${cmd.kind}`);
    }
  };
  const recorded = new WeakSet<object>();
  const record = (msg: any) => {
    if (!msg || typeof msg !== 'object' || typeof msg.type !== 'string' || recorded.has(msg)) return;
    recorded.add(msg);
    if (msg.type === 'user_message' && msg.logged === true) return;
    if (msg.scope === '*') {
      for (const c of chats.values()) {
        if (typeof msg.provider === 'string' && c.meta.provider !== msg.provider) continue;
        append(c.meta.chatId, { ...msg, scope: c.meta.chatId });
      }
      return;
    }
    const chatId = msg.scope && msg.scope !== 'chat' ? msg.scope : (lastSent ?? lastOpened);
    if (!chatId) return;
    append(chatId, { ...msg, scope: chatId }, { projectPath: msg.projectPath });
  };
  sai.chatlog = {
    open: async (chatId: string, after: number) => {
      if (after === 0) lastOpened = chatId;
      const c = chats.get(chatId);
      if (!c) return { snapshot: null, entries: [], headSeq: 0, meta: null };
      const snap = c.snapshot && (after === 0 || after < c.snapshot.seq) ? c.snapshot : null;
      const from = snap ? snap.seq : after;
      return { snapshot: snap, entries: c.entries.filter(e => e.seq > from), headSeq: c.meta.headSeq, meta: { ...c.meta } };
    },
    onEvent: (cb: (e: Entry) => void) => { listeners.add(cb); return () => { listeners.delete(cb); }; },
    appendClient: async (chatId: string, ev: Record<string, any>, init?: { projectPath: string; provider?: string }) => {
      if (!chats.has(chatId) && !init?.projectPath) throw new Error(`appendClient: unknown chat ${chatId}`);
      return append(chatId, ev, init);
    },
    importMessages: async (chatId: string, init: { projectPath: string; provider: string }, messages: any[]) => {
      if (chats.has(chatId)) return false;
      const c = ensure(chatId, init);
      // The renderer reduces from a snapshot; an imported chat is a seq-0 snapshot of idle state.
      c.snapshot = { chatId, seq: 0, state: {
        messages, pendingApproval: null, pendingSudo: null, pendingCodexUserInput: null, pendingCodexMcpElicitation: null,
        activeSubagents: {}, streamHint: null, promptSuggestion: null, settings: { provider: init.provider }, queue: [], lastSeq: 0,
        turn: { streaming: false, turnSeq: -1, startedAt: null, startIndex: null, forceNewBubble: true, nextSegmentStart: null,
          reasoningActive: false, loadGuardQuietUntil: null, loadGuardEnded: false },
      } };
      return true;
    },
    list: async (projectPath: string) => [...chats.values()].filter(c => c.meta.projectPath === projectPath).map(c => ({ ...c.meta })),
    delete: async (ids: string[]) => { for (const id of ids) chats.delete(id); },
    bindLegacyScope: async (_projectPath: string, chatId: string) => { lastSent = lastSent ?? chatId; },
    patchMeta: async (chatId: string, patch: Record<string, any>) => { const c = chats.get(chatId); if (c) Object.assign(c.meta, patch); },
    command: (cmd: any) => {
      const clientId = typeof cmd?.clientId === 'string' ? cmd.clientId : '';
      if (!clientId) return Promise.resolve({ clientId, ok: false, duplicate: false, error: 'clientId required' });
      const prior = ledger.get(clientId);
      if (prior) return prior.then(r => ({ ...r, duplicate: true }));
      const result = exec(cmd).then(
        r => ({ clientId, ok: true, duplicate: false, ...r }),
        err => ({ clientId, ok: false, duplicate: false, error: err instanceof Error ? err.message : String(err) }),
      );
      ledger.set(clientId, result);
      return result;
    },
  };
  // Backend events reach the panel through the log: wrap every registered
  // claudeOnMessage callback so whatever a test fires is logged first.
  const onMessage = sai.claudeOnMessage;
  sai.claudeOnMessage = (cb: (msg: unknown) => void) => onMessage((msg: unknown) => { record(msg); cb(msg); });
}

/**
 * Per-test mock overrides. Pass via `test.use({ saiMock: { ... } })`.
 * Values are shallow-merged onto the default mock at page-init time.
 */
export type SaiMockOverrides = Record<string, any>;

export const test = base.extend<{ window: Page; saiMock: SaiMockOverrides }>({
  saiMock: [{}, { option: true }],
  window: async ({ page, saiMock }, use) => {
    await page.addInitScript(
      ({ fixturePath, appVersion, overrides, chatlogSource }: { fixturePath: string; appVersion: string; overrides: Record<string, string>; chatlogSource: string }) => {
        const noop = () => () => {};
        // NOTE: This object is a deliberate duplicate of buildDefaultSaiMock() above.
        // The structured-clone boundary prevents passing live functions across addInitScript,
        // so the default mock must be inlined here. If you add or remove a key in
        // buildDefaultSaiMock(), you MUST make the same change here.
        const base: Record<string, any> = {
          platform: 'linux',
          getCwd: () => Promise.resolve(fixturePath),
          getRecentProjects: () => Promise.resolve([fixturePath]),
          selectFolder: () => Promise.resolve(null),
          selectFile: () => Promise.resolve(null),
          openRecentProject: () => {},
          settingsGet: (key: string, defaultVal?: any) => {
            // Suppress the What's New modal in tests by pretending the user has already
            // seen the current version. useWhatsNew compares lastSeenVersion against
            // package.json's version with strict !==, so this MUST track the real
            // version or the modal renders a full-screen overlay that blocks clicks.
            if (key === 'lastSeenVersion') return Promise.resolve(appVersion);
            return Promise.resolve(defaultVal ?? null);
          },
          settingsSet: () => Promise.resolve(),
          claudeStart: () => Promise.resolve({ slashCommands: ['/help', '/clear', '/compact'] }),
          claudeSend: () => {},
          claudeStop: () => {},
          claudeSetSessionId: () => {},
          claudeApprove: () => Promise.resolve(),
          claudeAlwaysAllow: () => Promise.resolve(),
          claudeGenerateCommitMessage: () => Promise.resolve('fix: test'),
          claudeOnMessage: (_cb: any) => noop(),
          codexModels: () => Promise.resolve({ models: [], defaultModel: '' }),
          codexStart: () => Promise.resolve({ message: 'ready' }),
          codexSend: () => {},
          codexStop: () => {},
          codexOnMessage: (_cb: any) => noop(),
          geminiModels: () => Promise.resolve({ models: [], defaultModel: 'auto-gemini-3' }),
          geminiStart: () => Promise.resolve({ message: 'ready' }),
          geminiSend: () => {},
          geminiStop: () => {},
          geminiSetSessionId: () => {},
          codexSetSessionId: () => {},
          geminiOnMessage: (_cb: any) => noop(),
          terminalCreate: () => Promise.resolve(1),
          terminalWrite: () => {},
          terminalResize: () => {},
          terminalOnData: (_cb: any) => noop(),
          terminalOnCtrlC: (_cb: any) => noop(),
          terminalSignal: () => {},
          terminalKill: () => Promise.resolve(),
          terminalGetProcess: () => Promise.resolve(null),
          terminalIsAwaitingInput: () => Promise.resolve(false),
          openExternal: () => {},
          gitStatus: () => Promise.resolve({ branch: 'main', staged: [], modified: [], created: [], deleted: [], not_added: [], ahead: 0, behind: 0 }),
          gitStage: () => Promise.resolve(),
          gitUnstage: () => Promise.resolve(),
          gitCommit: () => Promise.resolve(),
          gitPush: () => Promise.resolve(),
          gitPull: () => Promise.resolve(),
          gitFetch: () => Promise.resolve(),
          gitLog: () => Promise.resolve([]),
          gitBranches: () => Promise.resolve([]),
          gitCheckout: () => Promise.resolve(),
          gitCreateBranch: () => Promise.resolve(),
          gitDiff: () => Promise.resolve(''),
          gitDiscard: () => Promise.resolve(),
          gitShow: () => Promise.resolve(''),
          fsReadDir: () => Promise.resolve([
            { name: 'src', path: fixturePath + '/src', type: 'directory' },
            { name: 'package.json', path: fixturePath + '/package.json', type: 'file' },
            { name: 'README.md', path: fixturePath + '/README.md', type: 'file' },
          ]),
          fsReadFile: () => Promise.resolve('// test content'),
          fsReadFileBase64: () => Promise.resolve("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='80' height='80'%3E%3Crect width='80' height='80' fill='%2300a000'/%3E%3C/svg%3E"),
          fsReadFileBase: () => Promise.resolve(''),
          fsMtime: () => Promise.resolve({ mtime: Date.now() }),
          fsWriteFile: () => Promise.resolve(),
          fsRename: () => Promise.resolve(),
          fsDelete: () => Promise.resolve(),
          fsCreateFile: () => Promise.resolve(),
          fsCreateDir: () => Promise.resolve(),
          fsCheckIgnored: () => Promise.resolve([]),
          fsWalkFiles: () => Promise.resolve([]),
          searchRun: () => Promise.resolve({ files: [], truncated: false, durationMs: 0 }),
          searchReplaceFile: () => Promise.resolve(),
          workspaceSetActive: () => {},
          workspaceGetAll: () => Promise.resolve([{ projectPath: fixturePath, status: 'active', lastActivity: Date.now() }]),
          workspaceClose: () => Promise.resolve(),
          workspaceSuspend: () => Promise.resolve(),
          onWorkspaceSuspended: (_cb: any) => noop(),
          usageFetch: () => Promise.resolve(null),
          usageMode: () => Promise.resolve('api'),
          onUsageUpdate: (_cb: any) => noop(),
          updateCheck: () => Promise.resolve(),
          updateInstall: () => {},
          updateGetVersion: () => Promise.resolve('0.3.17'),
          onUpdateStatus: (_cb: any) => noop(),
          onUpdateAvailable: (_cb: any) => noop(),
          onUpdateProgress: (_cb: any) => noop(),
          onUpdateDownloaded: (_cb: any) => noop(),
          onUpdateError: (_cb: any) => noop(),
          setBadgeCount: () => {},
          githubGetUser: () => Promise.resolve({ login: 'test-user', avatar_url: 'data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg"/>', name: 'Test User' }),
          githubStartAuth: () => {},
          githubCancelAuth: () => {},
          githubLogout: () => Promise.resolve(),
          githubOnAuthComplete: (_cb: any) => noop(),
          githubOnAuthError: (_cb: any) => noop(),
          githubSyncNow: () => Promise.resolve(),
          githubOnSyncStatus: (_cb: any) => noop(),
          githubOnSettingsApplied: (_cb: any) => noop(),
          saveImage: () => Promise.resolve('/tmp/test.png'),
          brainstormConsumeSeed: () => Promise.resolve({ ok: false }),
          claudeGenerateTitle: () => Promise.resolve(''),
          claudeAnswerQuestion: () => Promise.resolve(),
          claudeAnswerPlanReview: () => Promise.resolve(),
          claudeCompact: () => Promise.resolve(),
          metaWorkspaceList: () => Promise.resolve([]),
          metaWorkspaceActivate: () => Promise.resolve(),
          metaWorkspaceCreate: () => Promise.resolve(),
          metaWorkspaceDelete: () => Promise.resolve(),
          metaWorkspaceUpdate: () => Promise.resolve(),
          windowMinimize: () => {},
          windowMaximizeToggle: () => {},
          windowClose: () => {},
          windowIsMaximized: () => Promise.resolve(false),
          windowOnMaximizedChange: (_cb: any) => noop(),
          windowIsFramelessRounded: () => Promise.resolve(false),
          scaffoldProject: () => Promise.resolve({ ok: false }),
          remote: () => Promise.resolve(null),
        };
        // Apply overrides — each value is a function source string we eval back into a function.
        for (const [key, fnSource] of Object.entries(overrides)) {
          // eslint-disable-next-line no-new-func
          base[key] = new Function('return (' + fnSource + ')')();
        }
        // The durable chat log (see installE2EChatlog) — after overrides, so a
        // test's claudeSend/claudeOnMessage are what it dispatches through.
        // eslint-disable-next-line no-new-func
        new Function('return (' + chatlogSource + ')')()(base);
        (window as any).sai = base;
        // Expose the real app version so per-test settingsGet overrides can
        // suppress the What's New modal without hardcoding a version that goes
        // stale on the next release bump.
        (window as any).__APP_VERSION = appVersion;
        // Expose helper to fire saved event-listener callbacks from tests.
        (window as any).__saiTriggers = (window as any).__saiTriggers || {};
      },
      {
        fixturePath: FIXTURE_PROJECT,
        appVersion: APP_VERSION,
        chatlogSource: installE2EChatlog.toString(),
        // Serialize each override function to source so it survives the structured-clone boundary.
        overrides: Object.fromEntries(
          Object.entries(saiMock).map(([k, v]) => [k, typeof v === 'function' ? v.toString() : `() => (${JSON.stringify(v)})`])
        ),
      }
    );

    await page.goto('http://localhost:5173');
    await page.waitForLoadState('domcontentloaded');
    await page.waitForSelector('.project-selector', { timeout: 15000 });
    await use(page);
  },
});

export { expect } from '@playwright/test';
