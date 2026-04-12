import { describe, it, expect, vi } from 'vitest';

const { exposeInMainWorld, send } = vi.hoisted(() => ({
  exposeInMainWorld: vi.fn(),
  send: vi.fn(),
}));

vi.mock('electron', () => ({
  contextBridge: {
    exposeInMainWorld,
  },
  ipcRenderer: {
    send,
    invoke: vi.fn(),
    on: vi.fn(),
    removeListener: vi.fn(),
  },
}));

import '../../electron/preload';

describe('electron preload bridge', () => {
  it('exposes geminiSetSessionId and forwards the optional scope argument', () => {
    const exposed = exposeInMainWorld.mock.calls[0]?.[1] as Record<string, any>;

    expect(exposed).toBeTruthy();
    expect(typeof exposed.geminiSetSessionId).toBe('function');

    exposed.geminiSetSessionId('/project', 'gemini-session-123', 'chat');

    expect(send).toHaveBeenCalledWith('gemini:setSessionId', '/project', 'gemini-session-123', 'chat');
  });

  it('exposes geminiSend and forwards the optional scope argument', () => {
    const exposed = exposeInMainWorld.mock.calls[0]?.[1] as Record<string, any>;

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
