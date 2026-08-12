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
    appServerConstructor: vi.fn(),
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
      approve: vi.fn().mockReturnValue({ ok: false, code: 'unsupported' }),
      suspendWorkspace: vi.fn(),
      isWorkspaceBusy: vi.fn(),
      destroy: vi.fn(),
    };
  }),
}));

vi.mock('@electron/services/codexBackend/appServerBackend', () => ({
  AppServerBackend: vi.fn().mockImplementation(function (deps: unknown) {
    mocks.appServerConstructor(deps);
    return {
      previewStatus: { available: true },
      start: vi.fn(), send: vi.fn(), interrupt: vi.fn(), reconcileScope: vi.fn(),
      setSessionId: vi.fn(), getModels: vi.fn(), suspendWorkspace: vi.fn(),
      isWorkspaceBusy: vi.fn().mockReturnValue(false), destroy: vi.fn(),
    };
  }),
}));

vi.mock('@electron/services/codexBackend/bundledModels', () => ({
  fetchBundledCodexModels: mocks.fetchBundledCodexModels,
}));

import {
  __setCodexBackendForTests,
  __setCodexBackendFactoriesForTests,
  destroyCodexBackendIfActive,
  getCodexAppServerPreviewStatus,
  getCodexSwarmStatus,
  getCodexBackend,
  getCodexBackendMode,
  setCodexBackendMode,
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
    approve: vi.fn().mockReturnValue({ ok: false, code: 'unsupported' }),
    answerUserInput: vi.fn().mockReturnValue({ ok: false, code: 'unsupported' }),
    resolveMcpElicitation: vi.fn().mockReturnValue({ ok: false, code: 'unsupported' }),
    suspendWorkspace: vi.fn(),
    isWorkspaceBusy: vi.fn().mockReturnValue(false),
    destroy: vi.fn(),
  };
}

beforeEach(() => {
  mocks.fetchBundledCodexModels.mockResolvedValue({ models: [], defaultModel: '' });
  __setCodexBackendFactoriesForTests();
  setCodexBackendMode('sdk');
});

afterEach(() => {
  destroyCodexBackendIfActive();
  __setCodexBackendFactoriesForTests();
  mocks.ipcMain.reset();
  vi.clearAllMocks();
});

describe('Codex backend selection', () => {
  it('keeps Swarm disabled on the SDK and probes only the selected App Server bridge', async () => {
    const sdk = backendStub();
    const appServer = {
      ...backendStub(),
      previewStatus: { available: true },
      getSwarmStatus: vi.fn().mockResolvedValue({ available: true }),
    };
    __setCodexBackendFactoriesForTests({ sdk: () => sdk, appServer: () => appServer });

    await expect(getCodexSwarmStatus()).resolves.toEqual(expect.objectContaining({
      available: false,
      reason: expect.stringMatching(/SDK backend is selected/i),
    }));
    expect(appServer.getSwarmStatus).not.toHaveBeenCalled();

    setCodexBackendMode('app-server');
    await expect(getCodexSwarmStatus()).resolves.toEqual({ available: true });
    expect(appServer.getSwarmStatus).toHaveBeenCalledOnce();
  });

  it('constructs and caches one SDK backend', () => {
    const first = getCodexBackend();
    const second = getCodexBackend();

    expect(first).toBe(second);
    expect(SdkCodexBackend).toHaveBeenCalledOnce();
    expect(mocks.sdkConstructor).toHaveBeenCalledWith(expect.objectContaining({
      emit: mocks.emitChatMessage,
      getModels: mocks.fetchBundledCodexModels,
      notifyCompletion: expect.any(Function),
    }));
  });

  it('registers Codex workspace hooks against the SDK singleton', () => {
    getCodexBackend();

    expect(registerWorkspaceBackendHooks).toHaveBeenCalledWith('codex', {
      suspend: expect.any(Function),
      isBusy: expect.any(Function),
    });
  });

  it('keeps an active scope on SDK after selecting App Server', () => {
    const sdk = backendStub();
    sdk.isScopeBusy = vi.fn().mockReturnValue(true);
    (sdk as CodexBackend & { isAnyWorkspaceBusy: ReturnType<typeof vi.fn> }).isAnyWorkspaceBusy = vi.fn().mockReturnValue(true);
    const appServer = backendStub();
    __setCodexBackendFactoriesForTests({ sdk: () => sdk, appServer: () => appServer });

    const backend = getCodexBackend();
    backend.start({ projectPath: '/project', scope: 'active' });
    setCodexBackendMode('app-server');
    backend.send({ projectPath: '/project', scope: 'active', message: 'continue' });
    expect(getCodexBackendMode()).toBe('app-server');
    expect(sdk.destroy).not.toHaveBeenCalled();
    expect(sdk.send).toHaveBeenCalledWith(expect.objectContaining({ scope: 'active' }));
    expect(appServer.send).not.toHaveBeenCalled();
  });

  it('keeps a settled SDK scope on SDK after selecting App Server', () => {
    const sdk = backendStub();
    const appServer = backendStub();
    __setCodexBackendFactoriesForTests({ sdk: () => sdk, appServer: () => appServer });

    const backend = getCodexBackend();
    backend.start({ projectPath: '/project', scope: 'settled-sdk' });
    setCodexBackendMode('app-server');
    backend.send({ projectPath: '/project', scope: 'settled-sdk', message: 'continue' });

    expect(sdk.send).toHaveBeenCalledWith(expect.objectContaining({ scope: 'settled-sdk' }));
    expect(appServer.send).not.toHaveBeenCalled();
  });

  it('keeps a settled App Server scope on App Server after selecting SDK', () => {
    const sdk = backendStub();
    const appServer = backendStub();
    __setCodexBackendFactoriesForTests({ sdk: () => sdk, appServer: () => appServer });
    setCodexBackendMode('app-server');

    const backend = getCodexBackend();
    backend.start({ projectPath: '/project', scope: 'settled-preview' });
    setCodexBackendMode('sdk');
    backend.send({ projectPath: '/project', scope: 'settled-preview', message: 'continue' });

    expect(appServer.send).toHaveBeenCalledWith(expect.objectContaining({ scope: 'settled-preview' }));
    expect(sdk.send).not.toHaveBeenCalled();
  });

  it('unassigns a reset settled scope so its next start uses the selected backend', () => {
    const sdk = backendStub();
    const appServer = backendStub();
    __setCodexBackendFactoriesForTests({ sdk: () => sdk, appServer: () => appServer });

    const backend = getCodexBackend();
    backend.start({ projectPath: '/project', scope: 'reset' });
    setCodexBackendMode('app-server');
    backend.setSessionId('/project', undefined, 'reset');
    backend.start({ projectPath: '/project', scope: 'reset' });

    expect(sdk.setSessionId).toHaveBeenCalledWith('/project', undefined, 'reset');
    expect(appServer.start).toHaveBeenCalledWith(expect.objectContaining({ scope: 'reset' }));
  });

  it('routes a fresh scope to the selected backend while another SDK scope is active', () => {
    const sdk = backendStub();
    (sdk as CodexBackend & { isAnyWorkspaceBusy: ReturnType<typeof vi.fn> }).isAnyWorkspaceBusy = vi.fn().mockReturnValue(true);
    const appServer = backendStub();
    __setCodexBackendFactoriesForTests({ sdk: () => sdk, appServer: () => appServer });

    getCodexBackend().start({ projectPath: '/project', scope: 'scope-a' });
    getCodexBackend().send({ projectPath: '/project', scope: 'scope-a', message: 'keep working' });
    setCodexBackendMode('app-server');
    getCodexBackend().start({ projectPath: '/project', scope: 'scope-b' });

    expect(sdk.start).toHaveBeenCalledWith(expect.objectContaining({ scope: 'scope-a' }));
    expect(sdk.send).toHaveBeenCalledWith(expect.objectContaining({ scope: 'scope-a' }));
    expect(appServer.start).toHaveBeenCalledWith(expect.objectContaining({ scope: 'scope-b' }));
    expect(sdk.destroy).not.toHaveBeenCalled();
  });

  it('falls back to SDK for new work after App Server becomes unavailable', () => {
    let available = true;
    const appServer = { ...backendStub(), get previewStatus() { return available ? { available: true } : { available: false, reason: 'Handshake failed' }; } };
    const sdk = backendStub();
    __setCodexBackendFactoriesForTests({ sdk: () => sdk, appServer: () => appServer });
    setCodexBackendMode('app-server');

    getCodexBackend().start({ projectPath: '/project', scope: 'preview' });
    expect(appServer.start).toHaveBeenCalledOnce();
    available = false;
    expect(getCodexAppServerPreviewStatus()).toEqual({ available: false, reason: 'Handshake failed' });
    getCodexBackend().start({ projectPath: '/project', scope: 'fallback' });
    expect(sdk.start).toHaveBeenCalledWith(expect.objectContaining({ scope: 'fallback' }));
    expect(getCodexAppServerPreviewStatus()).toEqual({ available: false, reason: 'Handshake failed' });
  });

  it('keeps a settled App Server scope on SDK after preview fallback', () => {
    let available = true;
    const appServer = { ...backendStub(), get previewStatus() { return available ? { available: true } : { available: false, reason: 'Handshake failed' }; } };
    const sdk = backendStub();
    __setCodexBackendFactoriesForTests({ sdk: () => sdk, appServer: () => appServer });
    setCodexBackendMode('app-server');
    const backend = getCodexBackend();

    backend.start({ projectPath: '/project', scope: 'preview' });
    available = false;
    backend.start({ projectPath: '/project', scope: 'preview' });
    available = true;
    backend.send({ projectPath: '/project', scope: 'preview', message: 'continue' });

    expect(sdk.start).toHaveBeenCalledWith(expect.objectContaining({ scope: 'preview' }));
    expect(sdk.send).toHaveBeenCalledWith(expect.objectContaining({ scope: 'preview' }));
    expect(appServer.send).not.toHaveBeenCalled();
  });

  it('does not move a busy App Server scope to SDK after preview fallback', () => {
    let available = true;
    const appServer = {
      ...backendStub(),
      isScopeBusy: vi.fn().mockReturnValue(true),
      get previewStatus() { return available ? { available: true } : { available: false, reason: 'Handshake failed' }; },
    };
    const sdk = backendStub();
    __setCodexBackendFactoriesForTests({ sdk: () => sdk, appServer: () => appServer });
    setCodexBackendMode('app-server');
    const backend = getCodexBackend();

    backend.start({ projectPath: '/project', scope: 'preview' });
    available = false;
    backend.send({ projectPath: '/project', scope: 'preview', message: 'continue' });

    expect(appServer.send).toHaveBeenCalledWith(expect.objectContaining({ scope: 'preview' }));
    expect(sdk.send).not.toHaveBeenCalled();
  });

  it('retries App Server for a fresh scope when preview mode is selected again', () => {
    let available = false;
    const firstAppServer = { ...backendStub(), get previewStatus() { return available ? { available: true } : { available: false, reason: 'Handshake failed' }; } };
    const retryAppServer = { ...backendStub(), previewStatus: { available: true } };
    const sdk = backendStub();
    const makeAppServer = vi.fn()
      .mockReturnValueOnce(firstAppServer)
      .mockReturnValueOnce(retryAppServer);
    __setCodexBackendFactoriesForTests({ sdk: () => sdk, appServer: makeAppServer });

    setCodexBackendMode('app-server');
    getCodexBackend().start({ projectPath: '/project', scope: 'failed' });
    expect(getCodexAppServerPreviewStatus()).toEqual({ available: false, reason: 'Handshake failed' });

    setCodexBackendMode('app-server');
    getCodexBackend().start({ projectPath: '/project', scope: 'retry' });

    expect(retryAppServer.start).toHaveBeenCalledWith(expect.objectContaining({ scope: 'retry' }));
  });

  it('wires workspace hooks to the active backend and neutralizes them after destroy', () => {
    const sdk = backendStub();
    __setCodexBackendFactoriesForTests({ sdk: () => sdk });
    const backend = getCodexBackend();
    const registration = mocks.registerWorkspaceBackendHooks.mock.calls.at(-1);

    expect(registration?.[0]).toBe('codex');
    const hooks = registration?.[1] as {
      suspend(projectPath: string): void;
      isBusy(projectPath: string): boolean;
    };
    hooks.suspend('/project');
    hooks.isBusy('/project');
    expect(sdk.suspendWorkspace).toHaveBeenCalledWith('/project');
    expect(sdk.isWorkspaceBusy).toHaveBeenCalledWith('/project');

    destroyCodexBackendIfActive();
    expect(() => hooks.suspend('/project')).not.toThrow();
    expect(hooks.isBusy('/project')).toBe(false);
    expect(sdk.suspendWorkspace).toHaveBeenCalledTimes(1);
    expect(sdk.isWorkspaceBusy).toHaveBeenCalledTimes(1);
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
  it('never imports the CLI backend', () => {
    const source = fs.readFileSync(
      path.join(__dirname, '../../../electron/services/codexBackend/index.ts'),
      'utf-8',
    );

    expect(source).not.toMatch(/CliCodexBackend/);
  });
});

describe('Codex IPC dispatch', () => {
  it('adapts the legacy preload argument shapes without shifting preamble or model fields', async () => {
    const backend = backendStub();
    __setCodexBackendForTests(backend);
    registerCodexHandlers();

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
    __setCodexBackendForTests(backend);
    registerCodexHandlers();

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
    registerCodexHandlers();
    mocks.ipcMain.emit('codex:send', '/project', 'prompt', [], 'auto', 'future', 'gpt-5', 'chat');
    expect(backend.send).toHaveBeenCalledWith(expect.objectContaining({ effort: undefined, model: 'gpt-5' }));
  });

  it('coerces a missing model refresh flag to false', async () => {
    const backend = backendStub();
    __setCodexBackendForTests(backend);
    registerCodexHandlers();

    await mocks.ipcMain.invoke('codex:models');

    expect(backend.getModels).toHaveBeenCalledWith(false);
  });

  it('accepts only the narrow typed Codex approval payload and delegates it with scope', async () => {
    const backend = backendStub();
    vi.mocked(backend.approve).mockReturnValue({ ok: true });
    __setCodexBackendForTests(backend);
    registerCodexHandlers();

    await expect(mocks.ipcMain.invoke('codex:appServerApprove', '/project', 'task:7', 'request-7', {
      type: 'decision', value: 'accept',
    })).resolves.toEqual({ ok: true });
    expect(backend.approve).toHaveBeenCalledWith('/project', 'task:7', 'request-7', { type: 'decision', value: 'accept' });

    await expect(mocks.ipcMain.invoke('codex:appServerApprove', '/project', 'task:7', 'request-8', {
      type: 'permissions', scope: 'turn', permissions: [{ kind: 'network', host: 'api.openai.com' }],
    })).resolves.toEqual({ ok: true });
    expect(backend.approve).toHaveBeenLastCalledWith('/project', 'task:7', 'request-8', {
      type: 'permissions', scope: 'turn', permissions: [{ kind: 'network', host: 'api.openai.com' }],
    });

    await expect(mocks.ipcMain.invoke('codex:appServerApprove', '/project', 'task:7', 'request-7', {
      type: 'permissions', scope: 'everywhere', permissions: [],
    })).resolves.toEqual({ ok: false, code: 'invalid-decision' });
    expect(backend.approve).toHaveBeenCalledTimes(2);
  });

  it('routes only bounded App Server input and MCP-elicitation responses through dedicated IPC channels', async () => {
    const backend = backendStub();
    backend.answerUserInput = vi.fn().mockReturnValue({ ok: true });
    backend.resolveMcpElicitation = vi.fn().mockReturnValue({ ok: true });
    __setCodexBackendForTests(backend);
    registerCodexHandlers();

    await expect(mocks.ipcMain.invoke('codex:appServerAnswerUserInput', '/project', 'task:7', 'question-7', {
      type: 'answers', answers: { format: { answers: ['json'] }, target: { answers: ['other'] } },
    })).resolves.toEqual({ ok: true });
    expect(backend.answerUserInput).toHaveBeenCalledWith('/project', 'task:7', 'question-7', {
      type: 'answers', answers: { format: { answers: ['json'] }, target: { answers: ['other'] } },
    });

    await expect(mocks.ipcMain.invoke('codex:appServerAnswerUserInput', '/project', 'task:7', 'question-cancel', {
      type: 'cancel',
    })).resolves.toEqual({ ok: true });
    expect(backend.answerUserInput).toHaveBeenLastCalledWith('/project', 'task:7', 'question-cancel', { type: 'cancel' });

    await expect(mocks.ipcMain.invoke('codex:appServerResolveMcpElicitation', '/project', 'task:7', 'mcp-7', {
      action: 'accept', content: { calendar: 'primary' },
    })).resolves.toEqual({ ok: true });
    expect(backend.resolveMcpElicitation).toHaveBeenCalledWith('/project', 'task:7', 'mcp-7', {
      action: 'accept', content: { calendar: 'primary' },
    });

    await expect(mocks.ipcMain.invoke('codex:appServerAnswerUserInput', '/project', 'task:7', 'question-7', {
      type: 'answers', answers: { format: { answers: ['json', 1] } },
    })).resolves.toEqual({ ok: false, code: 'invalid-decision' });
    await expect(mocks.ipcMain.invoke('codex:appServerResolveMcpElicitation', '/project', 'task:7', 'mcp-7', {
      action: 'accept', content: { redirect: 'https://untrusted.test' }, navigate: true,
    })).resolves.toEqual({ ok: false, code: 'invalid-decision' });
    await expect(mocks.ipcMain.invoke('codex:appServerResolveMcpElicitation', '/project', 'task:7', 'mcp-7', {
      action: 'accept', content: null,
    })).resolves.toEqual({ ok: true });
    expect(backend.answerUserInput).toHaveBeenCalledTimes(2);
    expect(backend.resolveMcpElicitation).toHaveBeenCalledTimes(2);
  });

  it('keeps App Server input replies with the transport that owns the scoped conversation', async () => {
    const sdk = backendStub();
    const appServer = backendStub();
    appServer.answerUserInput = vi.fn().mockReturnValue({ ok: true });
    appServer.resolveMcpElicitation = vi.fn().mockReturnValue({ ok: true });
    __setCodexBackendFactoriesForTests({ sdk: () => sdk, appServer: () => appServer });
    setCodexBackendMode('app-server');
    const dispatcher = getCodexBackend();
    await dispatcher.start({ projectPath: '/project', scope: 'task:7' });
    registerCodexHandlers();

    await expect(mocks.ipcMain.invoke('codex:appServerAnswerUserInput', '/project', 'task:7', 'question-7', {
      type: 'answers', answers: { answer: { answers: ['yes'] } },
    })).resolves.toEqual({ ok: true });
    expect(appServer.answerUserInput).toHaveBeenCalledOnce();

    setCodexBackendMode('sdk');
    await expect(mocks.ipcMain.invoke('codex:appServerResolveMcpElicitation', '/project', 'task:7', 'mcp-7', {
      action: 'cancel',
    })).resolves.toEqual({ ok: true });
    expect(appServer.resolveMcpElicitation).toHaveBeenCalledOnce();
    expect(sdk.resolveMcpElicitation).not.toHaveBeenCalled();
  });

  it('routes codex:usage to the injected telemetry singleton with a forced refresh', async () => {
    const telemetry = {
      readRateLimits: vi.fn().mockResolvedValue({ provider: 'codex', fetchedAt: 0, stale: false, primary: null, secondary: null }),
      destroy: vi.fn(),
    } as unknown as CodexTelemetryService;
    __setCodexTelemetryForTests(telemetry);
    registerCodexHandlers();

    const result = await mocks.ipcMain.invoke('codex:usage', { force: true });

    expect(telemetry.readRateLimits).toHaveBeenCalledWith({ force: true });
    expect(result.provider).toBe('codex');
  });

  it('destroys the previously injected telemetry singleton when replaced', () => {
    const a = { readRateLimits: vi.fn(), destroy: vi.fn() } as unknown as CodexTelemetryService;
    const b = { readRateLimits: vi.fn(), destroy: vi.fn() } as unknown as CodexTelemetryService;

    __setCodexTelemetryForTests(a);
    __setCodexTelemetryForTests(b);

    expect(a.destroy).toHaveBeenCalledOnce();
    expect(b.destroy).not.toHaveBeenCalled();
  });
});
