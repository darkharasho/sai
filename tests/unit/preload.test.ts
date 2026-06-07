import { describe, it, expect, vi, beforeEach } from 'vitest';

const { exposeInMainWorld, send, invoke } = vi.hoisted(() => ({
  exposeInMainWorld: vi.fn(),
  send: vi.fn(),
  invoke: vi.fn(),
}));

vi.mock('electron', () => ({
  contextBridge: {
    exposeInMainWorld,
  },
  ipcRenderer: {
    send,
    invoke,
    on: vi.fn(),
    removeListener: vi.fn(),
  },
}));

import '../../electron/preload';

// Get the exposed sai object once after preload import
const exposed = exposeInMainWorld.mock.calls[0]?.[1] as Record<string, any>;

describe('electron preload bridge', () => {
  beforeEach(() => {
    send.mockClear();
    invoke.mockClear();
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
  });

  it('claudeSend forwards to claude:send with all positional args', () => {
    exposed.claudeSend('/proj', 'hi', ['/img.png'], 'default', 'medium', 'sonnet', 'chat');
    expect(send).toHaveBeenCalledWith(
      'claude:send', '/proj', 'hi', ['/img.png'], 'default', 'medium', 'sonnet', 'chat'
    );
  });

  it('codexSend forwards to codex:send with all positional args', () => {
    exposed.codexSend('/proj', 'hi', [], 'auto', 'codex-mini');
    expect(send).toHaveBeenCalledWith(
      'codex:send', '/proj', 'hi', [], 'auto', 'codex-mini'
    );
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
        imagePaths: [], permMode: 'auto', model: 'codex-mini',
      });
      expect(send).toHaveBeenCalledWith(
        'codex:send', '/proj', 'hello', [], 'auto', 'codex-mini'
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

    it('routes gemini to gemini:start', () => {
      exposed.provider.start('gemini', '/proj', { metaPreamble: 'meta' });
      expect(invoke).toHaveBeenCalledWith('gemini:start', '/proj', 'meta');
    });

    it('routes codex to codex:start', () => {
      exposed.provider.start('codex', '/proj', { metaPreamble: 'meta' });
      expect(invoke).toHaveBeenCalledWith('codex:start', '/proj', 'meta');
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
      exposed.provider.stop('codex', '/proj');
      expect(send).toHaveBeenCalledWith('codex:stop', '/proj');
    });
  });
});
