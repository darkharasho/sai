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
