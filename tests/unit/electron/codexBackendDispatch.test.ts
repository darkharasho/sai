import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => {
  type IpcCallback = (...args: any[]) => unknown;
  const handlers = new Map<string, IpcCallback>();
  const listeners = new Map<string, IpcCallback[]>();

  const ipcMain = {
    handle: vi.fn((channel: string, callback: IpcCallback) => handlers.set(channel, callback)),
    on: vi.fn((channel: string, callback: IpcCallback) => {
      listeners.set(channel, [...(listeners.get(channel) ?? []), callback]);
    }),
    removeHandler: vi.fn((channel: string) => handlers.delete(channel)),
    async invoke(channel: string, ...args: unknown[]) {
      const callback = handlers.get(channel);
      if (!callback) throw new Error(`Missing IPC handler: ${channel}`);
      return callback({ sender: {} }, ...args);
    },
    emit(channel: string, ...args: unknown[]) {
      for (const callback of listeners.get(channel) ?? []) callback({ sender: {} }, ...args);
    },
    reset() {
      handlers.clear();
      listeners.clear();
    },
  };

  return {
    ipcMain,
    readFileSync: vi.fn(),
    writeFileSync: vi.fn(),
    emitChatMessage: vi.fn(),
    readSaiSetting: vi.fn(),
    fetchCodexModels: vi.fn(),
    fetchBundledCodexModels: vi.fn(),
    sdkConstructor: vi.fn(),
    cliConstructor: vi.fn(),
    registerWorkspaceBackendHooks: vi.fn(),
  };
});

vi.mock('electron', () => ({
  app: { getPath: vi.fn(() => '/sai-user-data') },
  ipcMain: mocks.ipcMain,
  BrowserWindow: vi.fn(),
}));

vi.mock('node:fs', () => ({
  default: {
    readFileSync: mocks.readFileSync,
    writeFileSync: mocks.writeFileSync,
  },
}));

vi.mock('@electron/services/claude', () => ({
  emitChatMessage: mocks.emitChatMessage,
  readSaiSetting: mocks.readSaiSetting,
}));

vi.mock('@electron/services/workspace', () => ({
  registerWorkspaceBackendHooks: mocks.registerWorkspaceBackendHooks,
}));

vi.mock('@electron/services/codexBackend/cliBackend', () => ({
  fetchCodexModels: mocks.fetchCodexModels,
  CliCodexBackend: class MockCliCodexBackend {
    start = vi.fn();
    send = vi.fn();
    interrupt = vi.fn();
    reconcileScope = vi.fn();
    setSessionId = vi.fn();
    getModels = vi.fn();
    suspendWorkspace = vi.fn();
    isWorkspaceBusy = vi.fn();
    destroy = vi.fn();

    constructor(win: unknown) {
      mocks.cliConstructor(win);
    }
  },
}));

vi.mock('@electron/services/codexBackend/sdkBackend', () => ({
  SdkCodexBackend: class MockSdkCodexBackend {
    start = vi.fn();
    send = vi.fn();
    interrupt = vi.fn();
    reconcileScope = vi.fn();
    setSessionId = vi.fn();
    getModels = vi.fn();
    suspendWorkspace = vi.fn();
    isWorkspaceBusy = vi.fn();
    destroy = vi.fn();

    constructor(deps: unknown) {
      mocks.sdkConstructor(deps);
    }
  },
}));

vi.mock('@electron/services/codexBackend/bundledModels', () => ({
  fetchBundledCodexModels: mocks.fetchBundledCodexModels,
}));

import {
  __setCodexBackendForTests,
  configureCodexBackendWindow,
  destroyCodexBackendIfActive,
  getCodexBackend,
  getCodexBackendSetting,
} from '@electron/services/codexBackend';
import type { CodexBackend } from '@electron/services/codexBackend';
import { __setCodexTelemetryForTests, registerCodexHandlers } from '@electron/services/codex';
import type { CodexTelemetryService } from '@electron/services/codexTelemetry';

function backendStub(): CodexBackend {
  return {
    start: vi.fn(),
    send: vi.fn(),
    interrupt: vi.fn(),
    reconcileScope: vi.fn(),
    setSessionId: vi.fn(),
    getModels: vi.fn().mockResolvedValue({ models: [], defaultModel: '' }),
    suspendWorkspace: vi.fn(),
    isWorkspaceBusy: vi.fn().mockReturnValue(false),
    destroy: vi.fn(),
  };
}

beforeEach(() => {
  mocks.readFileSync.mockReturnValue('{}');
  mocks.fetchCodexModels.mockResolvedValue({ models: [], defaultModel: '' });
  mocks.fetchBundledCodexModels.mockResolvedValue({ models: [], defaultModel: '' });
  configureCodexBackendWindow(null);
});

afterEach(() => {
  destroyCodexBackendIfActive();
  configureCodexBackendWindow(null);
  mocks.ipcMain.reset();
  vi.clearAllMocks();
});

describe('Codex backend selection', () => {
  it("defaults to the SDK when settings.json is absent or unreadable", () => {
    mocks.readFileSync.mockImplementation(() => { throw new Error('ENOENT'); });

    expect(getCodexBackendSetting()).toBe('sdk');
    expect(mocks.readFileSync).toHaveBeenCalledWith('/sai-user-data/settings.json', 'utf-8');
  });

  it("selects the CLI only for the explicit rollback setting", () => {
    mocks.readFileSync.mockReturnValue(JSON.stringify({ codexBackend: 'cli' }));
    expect(getCodexBackendSetting()).toBe('cli');
  });

  it("uses the SDK for unset, sdk, and unknown values without consulting or changing the default provider", () => {
    for (const value of [undefined, 'sdk', 'future-backend']) {
      mocks.readFileSync.mockReturnValue(JSON.stringify({
        aiProvider: 'claude',
        ...(value === undefined ? {} : { codexBackend: value }),
      }));
      expect(getCodexBackendSetting()).toBe('sdk');
    }

    expect(mocks.readSaiSetting).not.toHaveBeenCalled();
    expect(mocks.writeFileSync).not.toHaveBeenCalled();
  });

  it('constructs and caches the SDK lazily with the chat emitter and model loader', () => {
    expect(mocks.sdkConstructor).not.toHaveBeenCalled();

    const first = getCodexBackend();
    const second = getCodexBackend();

    expect(first).toBe(second);
    expect(mocks.sdkConstructor).toHaveBeenCalledTimes(1);
    expect(mocks.sdkConstructor).toHaveBeenCalledWith({
      emit: mocks.emitChatMessage,
      getModels: mocks.fetchBundledCodexModels,
    });
    expect(mocks.fetchCodexModels).not.toHaveBeenCalled();
    expect(mocks.registerWorkspaceBackendHooks).toHaveBeenCalledWith('codex', {
      suspend: expect.any(Function),
      isBusy: expect.any(Function),
    });
  });

  it('registers CLI lifecycle hooks and neutralizes them after destroy', () => {
    const win = { isDestroyed: () => false, webContents: { send: vi.fn() } } as any;
    mocks.readFileSync.mockReturnValue(JSON.stringify({ codexBackend: 'cli' }));
    configureCodexBackendWindow(win);
    const backend = getCodexBackend();
    const registration = mocks.registerWorkspaceBackendHooks.mock.calls.at(-1);

    expect(registration?.[0]).toBe('codex');
    const hooks = registration?.[1] as {
      suspend(projectPath: string): void;
      isBusy(projectPath: string): boolean;
    };
    hooks.suspend('/project');
    hooks.isBusy('/project');
    expect(backend.suspendWorkspace).toHaveBeenCalledWith('/project');
    expect(backend.isWorkspaceBusy).toHaveBeenCalledWith('/project');

    destroyCodexBackendIfActive();
    expect(() => hooks.suspend('/project')).not.toThrow();
    expect(hooks.isBusy('/project')).toBe(false);
    expect(backend.suspendWorkspace).toHaveBeenCalledTimes(1);
    expect(backend.isWorkspaceBusy).toHaveBeenCalledTimes(1);
  });

  it('never constructs the CLI without a configured BrowserWindow', () => {
    mocks.readFileSync.mockReturnValue(JSON.stringify({ codexBackend: 'cli' }));

    expect(() => getCodexBackend()).toThrow(/BrowserWindow/i);
    expect(mocks.cliConstructor).not.toHaveBeenCalled();
  });

  it('constructs the CLI with the BrowserWindow configured by IPC registration', () => {
    const win = { isDestroyed: () => false, webContents: { send: vi.fn() } } as any;
    mocks.readFileSync.mockReturnValue(JSON.stringify({ codexBackend: 'cli' }));

    registerCodexHandlers(win);
    getCodexBackend();

    expect(mocks.cliConstructor).toHaveBeenCalledWith(win);
  });

  it('destroys replaced, reset, and active injected backends exactly once', () => {
    const first = backendStub();
    const second = backendStub();
    const third = backendStub();

    __setCodexBackendForTests(first);
    __setCodexBackendForTests(second);
    expect(first.destroy).toHaveBeenCalledOnce();

    __setCodexBackendForTests(null);
    expect(second.destroy).toHaveBeenCalledOnce();

    __setCodexBackendForTests(third);
    destroyCodexBackendIfActive();
    destroyCodexBackendIfActive();
    expect(third.destroy).toHaveBeenCalledOnce();
  });

  it('clears the active backend even when destroy throws so shutdown retries are safe', () => {
    const backend = backendStub();
    vi.mocked(backend.destroy).mockImplementation(() => { throw new Error('already down'); });
    __setCodexBackendForTests(backend);

    expect(() => destroyCodexBackendIfActive()).toThrow('already down');
    expect(() => destroyCodexBackendIfActive()).not.toThrow();
    expect(backend.destroy).toHaveBeenCalledOnce();
  });
});

describe('Codex IPC dispatch', () => {
  it('adapts the legacy preload argument shapes without shifting preamble or model fields', async () => {
    const backend = backendStub();
    __setCodexBackendForTests(backend);
    registerCodexHandlers({} as any);

    await mocks.ipcMain.invoke('codex:start', '/legacy', 'legacy preamble');
    mocks.ipcMain.emit(
      'codex:send',
      '/legacy',
      'continue',
      ['/tmp/legacy.png'],
      'full-access',
      'gpt-legacy',
    );

    expect(backend.start).toHaveBeenCalledWith({
      projectPath: '/legacy',
      scope: undefined,
      kind: undefined,
      orchestratorContext: undefined,
      scopeCwd: undefined,
      metaPreamble: 'legacy preamble',
      additionalDirectories: undefined,
    });
    expect(backend.send).toHaveBeenCalledWith({
      projectPath: '/legacy',
      message: 'continue',
      imagePaths: ['/tmp/legacy.png'],
      permission: 'full-access',
      effort: undefined,
      model: 'gpt-legacy',
      scope: undefined,
      origin: undefined,
    });
  });

  it('delegates every channel and positional field to the active backend contract', async () => {
    const backend = backendStub();
    const win = { isDestroyed: () => false, webContents: { send: vi.fn() } } as any;
    __setCodexBackendForTests(backend);
    registerCodexHandlers(win);

    await mocks.ipcMain.invoke('codex:models', 1);
    await mocks.ipcMain.invoke(
      'codex:start',
      '/project',
      'task:7',
      'orchestrator',
      { taskId: '7' },
      '/project/.worktrees/7',
      'coordinate carefully',
      ['/repos/a', '', '/repos/a', '/repos/b'],
    );
    mocks.ipcMain.emit(
      'codex:send',
      '/project',
      'implement it',
      ['/tmp/reference.png'],
      'read-only',
      'high',
      'gpt-5.4',
      'task:7',
      'remote',
    );
    mocks.ipcMain.emit('codex:stop', '/project', 'task:7');
    mocks.ipcMain.emit('codex:setSessionId', '/project', 'thread-7', 'task:7');
    mocks.ipcMain.emit('codex:reconcileScope', '/project', 'task:7');

    expect(backend.getModels).toHaveBeenCalledWith(true);
    expect(backend.start).toHaveBeenCalledWith({
      projectPath: '/project',
      scope: 'task:7',
      kind: 'orchestrator',
      orchestratorContext: { taskId: '7' },
      scopeCwd: '/project/.worktrees/7',
      metaPreamble: 'coordinate carefully',
      additionalDirectories: ['/repos/a', '/repos/b'],
    });
    expect(backend.send).toHaveBeenCalledWith({
      projectPath: '/project',
      message: 'implement it',
      imagePaths: ['/tmp/reference.png'],
      permission: 'read-only',
      effort: 'high',
      model: 'gpt-5.4',
      scope: 'task:7',
      origin: 'remote',
    });
    expect(backend.interrupt).toHaveBeenCalledWith('/project', 'task:7');
    expect(backend.setSessionId).toHaveBeenCalledWith('/project', 'thread-7', 'task:7');
    expect(backend.reconcileScope).toHaveBeenCalledWith('/project', 'task:7');
  });

  it('drops invalid runtime reasoning effort before backend dispatch', () => {
    const backend = backendStub();
    __setCodexBackendForTests(backend);
    registerCodexHandlers({} as any);
    mocks.ipcMain.emit('codex:send', '/project', 'prompt', [], 'auto', 'future', 'gpt-5', 'chat');
    expect(backend.send).toHaveBeenCalledWith(expect.objectContaining({ effort: undefined, model: 'gpt-5' }));
  });

  it('coerces a missing model refresh flag to false', async () => {
    const backend = backendStub();
    __setCodexBackendForTests(backend);
    registerCodexHandlers({} as any);

    await mocks.ipcMain.invoke('codex:models');

    expect(backend.getModels).toHaveBeenCalledWith(false);
  });

  it('routes codex:usage to the injected telemetry singleton with a forced refresh', async () => {
    const telemetry = {
      readRateLimits: vi.fn().mockResolvedValue({ provider: 'codex', fetchedAt: 0, stale: false, primary: null, secondary: null }),
      destroy: vi.fn(),
    } as unknown as CodexTelemetryService;
    __setCodexTelemetryForTests(telemetry);
    registerCodexHandlers({} as any);

    const result = await mocks.ipcMain.invoke('codex:usage', { force: true });

    expect(telemetry.readRateLimits).toHaveBeenCalledWith({ force: true });
    expect(result.provider).toBe('codex');
  });
});
