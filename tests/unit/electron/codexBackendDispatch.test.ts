import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import path from 'node:path';
import fs from 'node:fs';

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
    emitChatMessage: vi.fn(),
    fetchBundledCodexModels: vi.fn(),
    sdkConstructor: vi.fn(),
    registerWorkspaceBackendHooks: vi.fn(),
  };
});

vi.mock('electron', () => ({
  app: { getPath: vi.fn(() => '/sai-user-data') },
  ipcMain: mocks.ipcMain,
  BrowserWindow: vi.fn(),
}));

vi.mock('@electron/services/claude', () => ({
  emitChatMessage: mocks.emitChatMessage,
}));

vi.mock('@electron/services/workspace', () => ({
  registerWorkspaceBackendHooks: mocks.registerWorkspaceBackendHooks,
}));

vi.mock('@electron/services/codexBackend/sdkBackend', () => ({
  SdkCodexBackend: vi.fn().mockImplementation(function (deps: unknown) {
    mocks.sdkConstructor(deps);
    return {
      start: vi.fn(),
      send: vi.fn(),
      interrupt: vi.fn(),
      reconcileScope: vi.fn(),
      setSessionId: vi.fn(),
      getModels: vi.fn(),
      suspendWorkspace: vi.fn(),
      isWorkspaceBusy: vi.fn(),
      destroy: vi.fn(),
    };
  }),
}));

vi.mock('@electron/services/codexBackend/bundledModels', () => ({
  fetchBundledCodexModels: mocks.fetchBundledCodexModels,
}));

import {
  __setCodexBackendForTests,
  destroyCodexBackendIfActive,
  getCodexBackend,
} from '@electron/services/codexBackend';
import type { CodexBackend } from '@electron/services/codexBackend';
import { SdkCodexBackend } from '@electron/services/codexBackend/sdkBackend';
import { registerWorkspaceBackendHooks } from '@electron/services/workspace';
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
  mocks.fetchBundledCodexModels.mockResolvedValue({ models: [], defaultModel: '' });
});

afterEach(() => {
  destroyCodexBackendIfActive();
  mocks.ipcMain.reset();
  vi.clearAllMocks();
});

describe('Codex backend selection', () => {
  it('constructs and caches one SDK backend', () => {
    const first = getCodexBackend();
    const second = getCodexBackend();

    expect(first).toBe(second);
    expect(SdkCodexBackend).toHaveBeenCalledOnce();
    expect(mocks.sdkConstructor).toHaveBeenCalledWith({
      emit: mocks.emitChatMessage,
      getModels: mocks.fetchBundledCodexModels,
    });
  });

  it('registers Codex workspace hooks against the SDK singleton', () => {
    getCodexBackend();

    expect(registerWorkspaceBackendHooks).toHaveBeenCalledWith('codex', {
      suspend: expect.any(Function),
      isBusy: expect.any(Function),
    });
  });

  it('wires workspace hooks to the active backend and neutralizes them after destroy', () => {
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

describe('Codex backend source regression', () => {
  it('never reads the codexBackend setting or imports the CLI backend', () => {
    const source = fs.readFileSync(
      path.join(__dirname, '../../../electron/services/codexBackend/index.ts'),
      'utf-8',
    );

    expect(source).not.toMatch(/codexBackend\s*(setting|===|:)/i);
    expect(source).not.toMatch(/CliCodexBackend/);
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
