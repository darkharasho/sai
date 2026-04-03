import { vi } from 'vitest';

/**
 * Typed mock interface matching the full window.sai preload bridge.
 * Every method is a vi.fn() so tests can assert calls and control return values.
 */
export interface MockSai {
  platform: string;

  // Terminal
  terminalCreate: ReturnType<typeof vi.fn>;
  terminalWrite: ReturnType<typeof vi.fn>;
  terminalResize: ReturnType<typeof vi.fn>;
  terminalKill: ReturnType<typeof vi.fn>;
  terminalGetProcess: ReturnType<typeof vi.fn>;
  terminalOnData: ReturnType<typeof vi.fn>;

  // Claude
  claudeStart: ReturnType<typeof vi.fn>;
  claudeSend: ReturnType<typeof vi.fn>;
  claudeGenerateCommitMessage: ReturnType<typeof vi.fn>;
  claudeStop: ReturnType<typeof vi.fn>;
  claudeSetSessionId: ReturnType<typeof vi.fn>;
  claudeApprove: ReturnType<typeof vi.fn>;
  claudeAlwaysAllow: ReturnType<typeof vi.fn>;
  claudeOnMessage: ReturnType<typeof vi.fn>;

  // Codex
  codexModels: ReturnType<typeof vi.fn>;
  codexStart: ReturnType<typeof vi.fn>;
  codexSend: ReturnType<typeof vi.fn>;
  codexStop: ReturnType<typeof vi.fn>;

  // Gemini
  geminiModels: ReturnType<typeof vi.fn>;
  geminiStart: ReturnType<typeof vi.fn>;
  geminiSend: ReturnType<typeof vi.fn>;
  geminiStop: ReturnType<typeof vi.fn>;

  // Git
  gitStatus: ReturnType<typeof vi.fn>;
  gitStage: ReturnType<typeof vi.fn>;
  gitUnstage: ReturnType<typeof vi.fn>;
  gitCommit: ReturnType<typeof vi.fn>;
  gitPush: ReturnType<typeof vi.fn>;
  gitPull: ReturnType<typeof vi.fn>;
  gitFetch: ReturnType<typeof vi.fn>;
  gitLog: ReturnType<typeof vi.fn>;
  gitBranches: ReturnType<typeof vi.fn>;
  gitCheckout: ReturnType<typeof vi.fn>;
  gitCreateBranch: ReturnType<typeof vi.fn>;
  gitDiff: ReturnType<typeof vi.fn>;
  gitDiscard: ReturnType<typeof vi.fn>;

  // FS
  fsReadDir: ReturnType<typeof vi.fn>;
  fsReadFile: ReturnType<typeof vi.fn>;
  fsMtime: ReturnType<typeof vi.fn>;
  fsWriteFile: ReturnType<typeof vi.fn>;
  fsRename: ReturnType<typeof vi.fn>;
  fsDelete: ReturnType<typeof vi.fn>;
  fsCreateFile: ReturnType<typeof vi.fn>;
  fsCreateDir: ReturnType<typeof vi.fn>;
  fsCheckIgnored: ReturnType<typeof vi.fn>;

  // Settings
  settingsGet: ReturnType<typeof vi.fn>;
  settingsSet: ReturnType<typeof vi.fn>;

  // Workspace
  workspaceSetActive: ReturnType<typeof vi.fn>;
  workspaceGetAll: ReturnType<typeof vi.fn>;
  workspaceClose: ReturnType<typeof vi.fn>;
  workspaceSuspend: ReturnType<typeof vi.fn>;
  onWorkspaceSuspended: ReturnType<typeof vi.fn>;

  // Navigation / project
  saveImage: ReturnType<typeof vi.fn>;
  getCwd: ReturnType<typeof vi.fn>;
  selectFolder: ReturnType<typeof vi.fn>;
  selectFile: ReturnType<typeof vi.fn>;
  getRecentProjects: ReturnType<typeof vi.fn>;
  openRecentProject: ReturnType<typeof vi.fn>;
  openExternal: ReturnType<typeof vi.fn>;

  // Usage
  usageFetch: ReturnType<typeof vi.fn>;
  usageMode: ReturnType<typeof vi.fn>;
  onUsageUpdate: ReturnType<typeof vi.fn>;

  // Updater
  updateCheck: ReturnType<typeof vi.fn>;
  updateInstall: ReturnType<typeof vi.fn>;
  updateGetVersion: ReturnType<typeof vi.fn>;
  onUpdateStatus: ReturnType<typeof vi.fn>;
  onUpdateAvailable: ReturnType<typeof vi.fn>;
  onUpdateProgress: ReturnType<typeof vi.fn>;
  onUpdateDownloaded: ReturnType<typeof vi.fn>;
  onUpdateError: ReturnType<typeof vi.fn>;

  // GitHub
  githubGetUser: ReturnType<typeof vi.fn>;
  githubStartAuth: ReturnType<typeof vi.fn>;
  githubCancelAuth: ReturnType<typeof vi.fn>;
  githubLogout: ReturnType<typeof vi.fn>;
  githubOnAuthComplete: ReturnType<typeof vi.fn>;
  githubOnAuthError: ReturnType<typeof vi.fn>;
  githubSyncNow: ReturnType<typeof vi.fn>;
  githubOnSyncStatus: ReturnType<typeof vi.fn>;
  githubOnSettingsApplied: ReturnType<typeof vi.fn>;
}

/**
 * Returns a MockSai where every method is a vi.fn() with sensible default
 * resolved values (most resolve to undefined; listener registrations return a
 * no-op unsubscribe function).
 */
export function createMockSai(): MockSai {
  const noopUnsubscribe = vi.fn(() => () => {});

  return {
    platform: 'linux',

    // Terminal
    terminalCreate: vi.fn().mockResolvedValue(1),
    terminalWrite: vi.fn(),
    terminalResize: vi.fn(),
    terminalKill: vi.fn(),
    terminalGetProcess: vi.fn().mockResolvedValue('bash'),
    terminalOnData: noopUnsubscribe,

    // Claude
    claudeStart: vi.fn().mockResolvedValue(undefined),
    claudeSend: vi.fn(),
    claudeGenerateCommitMessage: vi.fn().mockResolvedValue(''),
    claudeStop: vi.fn(),
    claudeSetSessionId: vi.fn(),
    claudeApprove: vi.fn().mockResolvedValue(undefined),
    claudeAlwaysAllow: vi.fn().mockResolvedValue(undefined),
    claudeOnMessage: noopUnsubscribe,

    // Codex
    codexModels: vi.fn().mockResolvedValue([]),
    codexStart: vi.fn().mockResolvedValue(undefined),
    codexSend: vi.fn(),
    codexStop: vi.fn(),

    // Gemini
    geminiModels: vi.fn().mockResolvedValue([]),
    geminiStart: vi.fn().mockResolvedValue(undefined),
    geminiSend: vi.fn(),
    geminiStop: vi.fn(),

    // Git
    gitStatus: vi.fn().mockResolvedValue({ files: [], ahead: 0, behind: 0 }),
    gitStage: vi.fn().mockResolvedValue(undefined),
    gitUnstage: vi.fn().mockResolvedValue(undefined),
    gitCommit: vi.fn().mockResolvedValue(undefined),
    gitPush: vi.fn().mockResolvedValue(undefined),
    gitPull: vi.fn().mockResolvedValue(undefined),
    gitFetch: vi.fn().mockResolvedValue(undefined),
    gitLog: vi.fn().mockResolvedValue([]),
    gitBranches: vi.fn().mockResolvedValue({ current: 'main', all: ['main'] }),
    gitCheckout: vi.fn().mockResolvedValue(undefined),
    gitCreateBranch: vi.fn().mockResolvedValue(undefined),
    gitDiff: vi.fn().mockResolvedValue(''),
    gitDiscard: vi.fn().mockResolvedValue(undefined),

    // FS
    fsReadDir: vi.fn().mockResolvedValue([]),
    fsReadFile: vi.fn().mockResolvedValue(''),
    fsMtime: vi.fn().mockResolvedValue(0),
    fsWriteFile: vi.fn().mockResolvedValue(undefined),
    fsRename: vi.fn().mockResolvedValue(undefined),
    fsDelete: vi.fn().mockResolvedValue(undefined),
    fsCreateFile: vi.fn().mockResolvedValue(undefined),
    fsCreateDir: vi.fn().mockResolvedValue(undefined),
    fsCheckIgnored: vi.fn().mockResolvedValue([]),

    // Settings
    settingsGet: vi.fn().mockResolvedValue(undefined),
    settingsSet: vi.fn().mockResolvedValue(undefined),

    // Workspace
    workspaceSetActive: vi.fn(),
    workspaceGetAll: vi.fn().mockResolvedValue([]),
    workspaceClose: vi.fn().mockResolvedValue(undefined),
    workspaceSuspend: vi.fn().mockResolvedValue(undefined),
    onWorkspaceSuspended: noopUnsubscribe,

    // Navigation / project
    saveImage: vi.fn().mockResolvedValue(''),
    getCwd: vi.fn().mockResolvedValue('/tmp'),
    selectFolder: vi.fn().mockResolvedValue(undefined),
    selectFile: vi.fn().mockResolvedValue(undefined),
    getRecentProjects: vi.fn().mockResolvedValue([]),
    openRecentProject: vi.fn().mockResolvedValue(undefined),
    openExternal: vi.fn().mockResolvedValue(undefined),

    // Usage
    usageFetch: vi.fn().mockResolvedValue(null),
    usageMode: vi.fn().mockResolvedValue(''),
    onUsageUpdate: noopUnsubscribe,

    // Updater
    updateCheck: vi.fn(),
    updateInstall: vi.fn(),
    updateGetVersion: vi.fn().mockResolvedValue('0.0.0'),
    onUpdateStatus: noopUnsubscribe,
    onUpdateAvailable: noopUnsubscribe,
    onUpdateProgress: noopUnsubscribe,
    onUpdateDownloaded: noopUnsubscribe,
    onUpdateError: noopUnsubscribe,

    // GitHub
    githubGetUser: vi.fn().mockResolvedValue(null),
    githubStartAuth: vi.fn().mockResolvedValue(undefined),
    githubCancelAuth: vi.fn().mockResolvedValue(undefined),
    githubLogout: vi.fn().mockResolvedValue(undefined),
    githubOnAuthComplete: noopUnsubscribe,
    githubOnAuthError: noopUnsubscribe,
    githubSyncNow: vi.fn().mockResolvedValue(undefined),
    githubOnSyncStatus: noopUnsubscribe,
    githubOnSettingsApplied: noopUnsubscribe,
  };
}

/**
 * Installs a MockSai (or a freshly created one) onto globalThis.window.sai so
 * that component code calling window.sai.* works during tests.
 */
export function installMockSai(mock?: MockSai): MockSai {
  const m = mock ?? createMockSai();
  // Ensure window exists (jsdom creates it, but be safe in node env)
  if (typeof globalThis.window === 'undefined') {
    (globalThis as Record<string, unknown>).window = {};
  }
  // @ts-expect-error — sai is not in the standard Window type
  globalThis.window.sai = m;
  return m;
}
