import { describe, it, expect, vi, beforeEach } from 'vitest';

const { exposeInMainWorld, send, invoke, on, removeListener } = vi.hoisted(() => ({
  exposeInMainWorld: vi.fn(),
  send: vi.fn(),
  invoke: vi.fn(),
  on: vi.fn(),
  removeListener: vi.fn(),
}));

vi.mock('electron', () => ({
  contextBridge: {
    exposeInMainWorld,
  },
  ipcRenderer: {
    send,
    invoke,
    on,
    removeListener,
  },
}));

import '../../electron/preload';

// Get the exposed sai object once after preload import
const exposed = exposeInMainWorld.mock.calls[0]?.[1] as Record<string, any>;

describe('electron preload bridge', () => {
  beforeEach(() => {
    send.mockClear();
    invoke.mockClear();
    on.mockClear();
    removeListener.mockClear();
  });

  it('exposes geminiSetSessionId and forwards the optional scope argument', () => {
    expect(exposed).toBeTruthy();
    expect(typeof exposed.geminiSetSessionId).toBe('function');

    exposed.geminiSetSessionId('/project', 'gemini-session-123', 'chat');

    expect(send).toHaveBeenCalledWith('gemini:setSessionId', '/project', 'gemini-session-123', 'chat');
  });

  it('exposes geminiSend and forwards the optional scope argument', () => {
    expect(exposed).toBeTruthy();
    expect(typeof exposed.geminiSend).toBe('function');

    exposed.geminiSend('/project', 'hello', undefined, 'default', 'planning', 'auto-gemini-3', 'chat');

    expect(send).toHaveBeenCalledWith(
      'gemini:send',
      '/project',
      'hello',
      undefined,
      'default',
      'planning',
      'auto-gemini-3',
      'chat',
    );
  });
});

describe('characterization: existing IPC routing', () => {
  beforeEach(() => {
    send.mockClear();
    invoke.mockClear();
    on.mockClear();
    removeListener.mockClear();
  });

  it('claudeSend forwards to claude:send with all positional args', () => {
    exposed.claudeSend('/proj', 'hi', ['/img.png'], 'default', 'medium', 'sonnet', 'chat');
    expect(send).toHaveBeenCalledWith(
      'claude:send', '/proj', 'hi', ['/img.png'], 'default', 'medium', 'sonnet', 'chat'
    );
  });

  it('codexStart forwards the complete scoped tuple to codex:start', () => {
    const context = { workspaceName: 'SAI' };
    exposed.codexStart('/proj', 'scope-a', 'orchestrator', context, '/proj/worktree', 'meta', ['/repos/a']);
    expect(invoke).toHaveBeenCalledWith(
      'codex:start', '/proj', 'scope-a', 'orchestrator', context, '/proj/worktree', 'meta', ['/repos/a']
    );
  });

  it('codexSend forwards the complete tuple, including an undefined origin', () => {
    exposed.codexSend('/proj', 'hi', [], 'auto', 'high', 'codex-mini', 'scope-a');
    expect(send).toHaveBeenCalledWith(
      'codex:send', '/proj', 'hi', [], 'auto', 'high', 'codex-mini', 'scope-a', undefined
    );
  });

  it('codex stop, session, and reconcile methods preserve scope', () => {
    exposed.codexStop('/proj', 'scope-a');
    exposed.codexSetSessionId('/proj', 'sess-1', 'scope-a');
    exposed.codexReconcileScope('/proj', 'scope-a');

    expect(send).toHaveBeenNthCalledWith(1, 'codex:stop', '/proj', 'scope-a');
    expect(send).toHaveBeenNthCalledWith(2, 'codex:setSessionId', '/proj', 'sess-1', 'scope-a');
    expect(send).toHaveBeenNthCalledWith(3, 'codex:reconcileScope', '/proj', 'scope-a');
  });

  it('reads provider-tagged Codex usage with an optional forced refresh', async () => {
    invoke.mockResolvedValue({ provider: 'codex', primary: null, secondary: null });
    await exposed.codexUsageFetch(true);
    expect(invoke).toHaveBeenCalledWith('codex:usage', { force: true });
  });

  it('exposes the narrow Codex App Server preview mode and status bridge', async () => {
    await exposed.codexBackendModeGet();
    await exposed.codexBackendModeSet('app-server');
    await exposed.codexAppServerPreviewStatus();

    expect(invoke).toHaveBeenNthCalledWith(1, 'codex:backendMode:get');
    expect(invoke).toHaveBeenNthCalledWith(2, 'codex:backendMode:set', 'app-server');
    expect(invoke).toHaveBeenNthCalledWith(3, 'codex:appServerPreviewStatus');
  });

  it('exposes isolated confirmed Codex MCP config IPC methods', async () => {
    const request = { expectedVersion: 'v1', servers: [], confirmationToken: 'confirm-global-user-mcp-config' };
    await exposed.codexMcpConfigGet();
    await exposed.codexMcpConfigReplace(request);
    expect(invoke).toHaveBeenNthCalledWith(1, 'codex:mcpConfig:get');
    expect(invoke).toHaveBeenNthCalledWith(2, 'codex:mcpConfig:replace', request);
  });

  it('keeps the legacy Swarm Codex approval call isolated from App Server decisions', async () => {
    expect(exposed.codexApprove).toBeUndefined();

    await exposed.codexAppServerApprove('/proj', 'scope-a', 'request-1', {
      type: 'decision', value: 'accept',
    });

    expect(invoke).toHaveBeenCalledWith(
      'codex:appServerApprove',
      '/proj',
      'scope-a',
      'request-1',
      { type: 'decision', value: 'accept' },
    );
  });

  it('codexUsageFetch defaults to a non-forced refresh when called with no argument', async () => {
    invoke.mockResolvedValue({ provider: 'codex', primary: null, secondary: null });
    await exposed.codexUsageFetch();
    expect(invoke).toHaveBeenCalledWith('codex:usage', { force: false });
  });

  it('geminiStart forwards to gemini:start', () => {
    exposed.geminiStart('/proj', 'meta');
    expect(invoke).toHaveBeenCalledWith('gemini:start', '/proj', 'meta');
  });

  it('claudeStart forwards to claude:start', () => {
    exposed.claudeStart('/proj', 'chat', 'chat', undefined, undefined, 'meta');
    expect(invoke).toHaveBeenCalledWith(
      'claude:start', '/proj', 'chat', 'chat', undefined, undefined, 'meta'
    );
  });
});

describe('window.sai.provider routing', () => {
  beforeEach(() => {
    send.mockClear();
    invoke.mockClear();
  });

  describe('provider.send', () => {
    it('routes claude to claude:send with mapped args', () => {
      exposed.provider.send('claude', '/proj', 'hello', {
        imagePaths: ['/a.png'], permMode: 'default', effortLevel: 'high',
        model: 'sonnet', scope: 'chat',
      });
      expect(send).toHaveBeenCalledWith(
        'claude:send', '/proj', 'hello', ['/a.png'], 'default', 'high', 'sonnet', 'chat'
      );
    });

    it('routes gemini to gemini:send with mapped args', () => {
      exposed.provider.send('gemini', '/proj', 'hello', {
        imagePaths: [], approvalMode: 'auto_edit', conversationMode: 'fast',
        model: 'gemini-2.5-flash', scope: 'chat',
      });
      expect(send).toHaveBeenCalledWith(
        'gemini:send', '/proj', 'hello', [], 'auto_edit', 'fast', 'gemini-2.5-flash', 'chat'
      );
    });

    it('routes codex to codex:send with mapped args', () => {
      exposed.provider.send('codex', '/proj', 'hello', {
        imagePaths: [], permMode: 'auto', effortLevel: 'xhigh', model: 'codex-mini',
        scope: 'scope-a', origin: 'remote',
      });
      expect(send).toHaveBeenCalledWith(
        'codex:send', '/proj', 'hello', [], 'auto', 'xhigh', 'codex-mini', 'scope-a', 'remote'
      );
    });
  });

  describe('provider.start', () => {
    it('routes claude to claude:start', () => {
      exposed.provider.start('claude', '/proj', { scope: 'chat', kind: 'chat', metaPreamble: 'meta' });
      expect(invoke).toHaveBeenCalledWith(
        'claude:start', '/proj', 'chat', 'chat', undefined, undefined, 'meta'
      );
    });

    it('routes Antigravity to the scoped gemini:start compatibility bridge', () => {
      exposed.provider.start('gemini', '/proj', { metaPreamble: 'meta' });
      expect(invoke).toHaveBeenCalledWith('gemini:start', '/proj', undefined, undefined, undefined, undefined, 'meta');
    });

    it('routes codex to codex:start', () => {
      const orchestratorContext = { workspaceName: 'SAI' };
      exposed.provider.start('codex', '/proj', {
        scope: 'scope-a', kind: 'orchestrator', orchestratorContext,
        scopeCwd: '/proj/worktree', metaPreamble: 'meta', additionalDirectories: ['/repos/a'],
      });
      expect(invoke).toHaveBeenCalledWith(
        'codex:start', '/proj', 'scope-a', 'orchestrator', orchestratorContext, '/proj/worktree', 'meta', ['/repos/a']
      );
    });
  });

  describe('provider.stop', () => {
    it('routes claude to claude:stop', () => {
      exposed.provider.stop('claude', '/proj');
      expect(send).toHaveBeenCalledWith('claude:stop', '/proj', undefined);
    });

    it('routes gemini to gemini:stop', () => {
      exposed.provider.stop('gemini', '/proj', 'chat');
      expect(send).toHaveBeenCalledWith('gemini:stop', '/proj', 'chat');
    });

    it('routes codex to codex:stop', () => {
      exposed.provider.stop('codex', '/proj', 'scope-a');
      expect(send).toHaveBeenCalledWith('codex:stop', '/proj', 'scope-a');
    });
  });

  describe('provider.setSessionId', () => {
    it('routes claude to claude:setSessionId with scope', () => {
      (exposed as any).provider.setSessionId('claude', '/proj', 'sess-1', 'chat');
      expect(send).toHaveBeenCalledWith('claude:setSessionId', '/proj', 'sess-1', 'chat');
    });

    it('routes gemini to gemini:setSessionId with scope', () => {
      (exposed as any).provider.setSessionId('gemini', '/proj', 'sess-2', 'chat');
      expect(send).toHaveBeenCalledWith('gemini:setSessionId', '/proj', 'sess-2', 'chat');
    });

    it('routes codex to codex:setSessionId with scope', () => {
      (exposed as any).provider.setSessionId('codex', '/proj', 'sess-3', 'scope-a');
      expect(send).toHaveBeenCalledWith('codex:setSessionId', '/proj', 'sess-3', 'scope-a');
    });
  });

  describe('brainstorm API', () => {
    beforeEach(() => {
      send.mockClear();
      invoke.mockClear();
      on.mockClear();
      removeListener.mockClear();
    });

    it('brainstormGetBrief invokes brainstorm:getBrief', async () => {
      await exposed.brainstormGetBrief('sid-1');
      expect(invoke).toHaveBeenCalledWith('brainstorm:getBrief', 'sid-1');
    });

    it('brainstormEditBrief invokes brainstorm:editBrief with the patch', async () => {
      await exposed.brainstormEditBrief('sid-1', { projectName: 'x' });
      expect(invoke).toHaveBeenCalledWith('brainstorm:editBrief', 'sid-1', { projectName: 'x' });
    });

    it('brainstormOnBrief subscribes and unsubscribes brainstorm:brief:<sid>', () => {
      const un = exposed.brainstormOnBrief('sid-1', () => {});
      expect(on).toHaveBeenCalledWith('brainstorm:brief:sid-1', expect.any(Function));
      un();
      expect(removeListener).toHaveBeenCalledWith('brainstorm:brief:sid-1', expect.any(Function));
    });

    it('brainstormSynthesize is gone', () => {
      expect((exposed as any).brainstormSynthesize).toBeUndefined();
    });
  });
});

describe('electron preload bridge — home directory', () => {
  it('exposes homeDir and forwards it to the app:homeDir channel', () => {
    expect(typeof exposed.homeDir).toBe('function');
    exposed.homeDir();
    expect(invoke).toHaveBeenCalledWith('app:homeDir');
  });
});
