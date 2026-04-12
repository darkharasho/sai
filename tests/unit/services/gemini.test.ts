import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';

const {
  mockIpcMain,
  mockHandlers,
  mockListeners,
  acpListeners,
  mockCreateGeminiAcpClient,
  mockAcpClient,
} = vi.hoisted(() => {
  const mockHandlers = new Map<string, (...args: unknown[]) => unknown>();
  const mockListeners = new Map<string, Array<(...args: unknown[]) => void>>();
  const acpListeners: Array<(event: unknown) => void> = [];

  const mockAcpClient = {
    start: vi.fn().mockResolvedValue(undefined),
    request: vi.fn(),
    notify: vi.fn(),
    onEvent: vi.fn((listener: (event: unknown) => void) => {
      acpListeners.push(listener);
      return () => {
        const idx = acpListeners.indexOf(listener);
        if (idx >= 0) acpListeners.splice(idx, 1);
      };
    }),
    dispose: vi.fn(),
  };

  const mockCreateGeminiAcpClient = vi.fn(() => mockAcpClient);

  const mockIpcMain = {
    handle: vi.fn((channel: string, handler: (...args: unknown[]) => unknown) => {
      mockHandlers.set(channel, handler);
    }),
    on: vi.fn((channel: string, listener: (...args: unknown[]) => void) => {
      const existing = mockListeners.get(channel) ?? [];
      mockListeners.set(channel, [...existing, listener]);
    }),
    async _invoke(channel: string, ...args: unknown[]) {
      const handler = mockHandlers.get(channel);
      if (!handler) throw new Error(`No handler for channel "${channel}"`);
      return handler({ sender: {} }, ...args);
    },
    _emit(channel: string, ...args: unknown[]) {
      const listeners = mockListeners.get(channel) ?? [];
      for (const listener of listeners) listener({ sender: {} }, ...args);
    },
  };

  return {
    mockIpcMain,
    mockHandlers,
    mockListeners,
    acpListeners,
    mockCreateGeminiAcpClient,
    mockAcpClient,
  };
});

vi.mock('electron', () => ({
  ipcMain: mockIpcMain,
  app: {
    getPath: vi.fn().mockReturnValue('/tmp/sai-test-userdata'),
  },
  BrowserWindow: vi.fn(),
}));

vi.mock('@electron/services/gemini-acp', () => ({
  createGeminiAcpClient: mockCreateGeminiAcpClient,
}));

vi.mock('@electron/services/notify', () => ({
  notifyCompletion: vi.fn(),
}));

vi.mock('node:child_process', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:child_process')>();
  return {
    ...actual,
    spawn: vi.fn(),
    execFile: vi.fn(),
  };
});

import { registerGeminiHandlers } from '@electron/services/gemini';
import { registerClaudeHandlers } from '@electron/services/claude';
import { getOrCreate, get } from '@electron/services/workspace';
import { createMockBrowserWindow } from '../../helpers/electron-mock';

const PROJECT = '/workspace/myproject';

function tick() {
  return new Promise<void>(resolve => process.nextTick(resolve));
}

function collectSentEvents(win: ReturnType<typeof createMockBrowserWindow>) {
  return (win.webContents.send as ReturnType<typeof vi.fn>).mock.calls
    .filter(([channel]: [string]) => channel === 'claude:message')
    .map(([, event]: [string, unknown]) => event);
}

function emitAcpEvent(event: unknown) {
  for (const listener of acpListeners) listener(event);
}

describe('gemini service', () => {
  let mockWin: ReturnType<typeof createMockBrowserWindow>;

  beforeEach(() => {
    vi.clearAllMocks();
    mockHandlers.clear();
    mockListeners.clear();
    acpListeners.length = 0;
    mockAcpClient.start.mockResolvedValue(undefined);
    mockAcpClient.request.mockReset();
    mockAcpClient.notify.mockReset();
    mockAcpClient.dispose.mockReset();

    mockWin = createMockBrowserWindow();
    registerGeminiHandlers(mockWin as unknown as import('electron').BrowserWindow);
    registerClaudeHandlers(mockWin as unknown as import('electron').BrowserWindow);

    const ws = getOrCreate(PROJECT);
    ws.gemini.cwd = PROJECT;
    ws.gemini.busy = false;
    ws.gemini.turnSeq = 0;
    ws.gemini.loadedSessionIds.clear();
    ws.gemini.bootstrappedSessionIds.clear();
    ws.gemini.suppressedScopes.clear();
    ws.gemini.chatSessionId = undefined;
    ws.gemini.activeRequestId = undefined;
    ws.gemini.availability = 'available';
    ws.gemini.lastError = undefined;
    ws.gemini.transport = null;
    ws.gemini.pendingApproval = null;
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('gemini:models handler', () => {
    it('returns the hardcoded model list', async () => {
      const result = await mockIpcMain._invoke('gemini:models') as {
        models: { id: string; name: string }[];
      };
      expect(result.models.length).toBeGreaterThan(0);
      expect(result.models.map(m => m.id)).toContain('auto-gemini-3');
    });
  });

  it('creates the ACP transport on gemini:start and emits ready', async () => {
    await mockIpcMain._invoke('gemini:start', PROJECT);

    expect(mockCreateGeminiAcpClient).toHaveBeenCalledTimes(1);
    expect(mockAcpClient.start).toHaveBeenCalledTimes(1);
    expect(collectSentEvents(mockWin)).toContainEqual(
      expect.objectContaining({ type: 'ready', projectPath: PROJECT }),
    );
  });

  it('creates a new Gemini chat session on first send and emits session_id', async () => {
    const promptCalls: Array<Record<string, any>> = [];
    mockAcpClient.request.mockImplementation(async (method: string) => {
      if (method === 'session/new') return { sessionId: 'gemini-chat-1' };
      if (method === 'session/prompt') {
        const params = mockAcpClient.request.mock.calls.at(-1)?.[1] as Record<string, any>;
        promptCalls.push(params);
        return {
          requestId: 'req-1',
          usage: { input_tokens: 100, output_tokens: 25, cached: 7 },
        };
      }
      throw new Error(`Unexpected method ${method}`);
    });

    mockIpcMain._emit('gemini:send', PROJECT, 'Hello', undefined, 'auto_edit', 'planning', 'auto-gemini-3', 'chat');
    await tick();

    emitAcpEvent({
      method: 'session/update',
      params: {
        sessionId: 'gemini-chat-1',
        update: {
          sessionUpdate: 'agent_message_chunk',
          content: { type: 'text', text: 'Hello back' },
        },
      },
    });
    await tick();

    const ws = get(PROJECT)!;
    expect(ws.gemini.chatSessionId).toBe('gemini-chat-1');
    expect(mockAcpClient.request).toHaveBeenCalledWith(
      'session/new',
      expect.objectContaining({ cwd: PROJECT, scope: 'chat', mcpServers: [] }),
    );
    expect(promptCalls).toHaveLength(1);
    expect(promptCalls[0]).toMatchObject({
      sessionId: 'gemini-chat-1',
    });
    expect((promptCalls[0].prompt as Array<Record<string, any>>)[0].text).toContain('Project bootstrap context for this repository.');
    expect((promptCalls[0].prompt as Array<Record<string, any>>)[1]).toMatchObject({ type: 'text', text: 'Hello' });

    const events = collectSentEvents(mockWin);
    expect(events).toContainEqual(expect.objectContaining({ type: 'session_id', sessionId: 'gemini-chat-1' }));
    expect(events).toContainEqual(expect.objectContaining({
      type: 'assistant',
      message: { content: [{ type: 'text', text: 'Hello back', delta: true }] },
    }));
    expect(events).toContainEqual(expect.objectContaining({
      type: 'result',
      usage: {
        input_tokens: 100,
        cache_read_input_tokens: 7,
        cache_creation_input_tokens: 0,
        output_tokens: 25,
      },
    }));
    expect(events).toContainEqual(expect.objectContaining({ type: 'done', projectPath: PROJECT }));
  });

  it('loads an existing Gemini chat session before prompting', async () => {
    const promptCalls: Array<Record<string, any>> = [];
    mockIpcMain._emit('gemini:setSessionId', PROJECT, 'gemini-existing-1', 'chat');
    mockAcpClient.request.mockImplementation(async (method: string) => {
      if (method === 'session/load') return { sessionId: 'gemini-existing-1' };
      if (method === 'session/prompt') {
        const params = mockAcpClient.request.mock.calls.at(-1)?.[1] as Record<string, any>;
        promptCalls.push(params);
        return { requestId: 'req-2', usage: { input_tokens: 20, output_tokens: 4, cached: 0 } };
      }
      throw new Error(`Unexpected method ${method}`);
    });

    mockIpcMain._emit('gemini:send', PROJECT, 'Continue', undefined, 'plan', 'planning', 'auto-gemini-3', 'chat');
    await tick();

    expect(mockAcpClient.request).toHaveBeenCalledWith(
      'session/load',
      expect.objectContaining({ sessionId: 'gemini-existing-1', mcpServers: [] }),
    );
    expect(promptCalls).toHaveLength(1);
    expect((promptCalls[0].prompt as Array<Record<string, any>>)[0].text).toContain('Project bootstrap context for this repository.');
    expect((promptCalls[0].prompt as Array<Record<string, any>>)[1]).toMatchObject({ type: 'text', text: 'Continue' });
  });

  it('does not reload an already loaded Gemini session on subsequent sends', async () => {
    const promptCalls: Array<Record<string, any>> = [];
    mockIpcMain._emit('gemini:setSessionId', PROJECT, 'gemini-existing-1', 'chat');
    mockAcpClient.request.mockImplementation(async (method: string) => {
      if (method === 'session/load') return { sessionId: 'gemini-existing-1' };
      if (method === 'session/prompt') {
        const params = mockAcpClient.request.mock.calls.at(-1)?.[1] as Record<string, any>;
        promptCalls.push(params);
        return { requestId: 'req-2', usage: { input_tokens: 20, output_tokens: 4, cached: 0 } };
      }
      throw new Error(`Unexpected method ${method}`);
    });

    mockIpcMain._emit('gemini:send', PROJECT, 'Continue', undefined, 'plan', 'planning', 'auto-gemini-3', 'chat');
    await tick();
    mockIpcMain._emit('gemini:send', PROJECT, 'Keep going', undefined, 'plan', 'planning', 'auto-gemini-3', 'chat');
    await tick();

    const loadCalls = mockAcpClient.request.mock.calls.filter(([method]) => method === 'session/load');
    expect(loadCalls).toHaveLength(1);
    expect(promptCalls).toHaveLength(2);
    expect((promptCalls[0].prompt as Array<Record<string, any>>)[0].text).toContain('Project bootstrap context for this repository.');
    expect((promptCalls[0].prompt as Array<Record<string, any>>)[1]).toMatchObject({ type: 'text', text: 'Continue' });
    expect(promptCalls[1]).toMatchObject({
      sessionId: 'gemini-existing-1',
      prompt: [{ type: 'text', text: 'Keep going' }],
    });
  });

  it('sends attached images as inline ACP image parts', async () => {
    vi.spyOn(fs, 'readFileSync').mockReturnValue(Buffer.from('image-bytes'));
    const promptCalls: Array<Record<string, any>> = [];
    mockAcpClient.request.mockImplementation(async (method: string) => {
      if (method === 'session/new') return { sessionId: 'gemini-chat-1' };
      if (method === 'session/prompt') {
        const params = mockAcpClient.request.mock.calls.at(-1)?.[1] as Record<string, any>;
        promptCalls.push(params);
        return { requestId: 'req-1', usage: { input_tokens: 10, output_tokens: 2, cached: 0 } };
      }
      throw new Error(`Unexpected method ${method}`);
    });

    mockIpcMain._emit('gemini:send', PROJECT, 'Describe this image', ['/tmp/photo.png'], 'auto_edit', 'planning', 'auto-gemini-3', 'chat');
    await tick();

    expect(promptCalls).toHaveLength(1);
    expect(promptCalls[0]).toMatchObject({
      prompt: [
        expect.objectContaining({ type: 'text' }),
        { type: 'text', text: 'Describe this image' },
        { type: 'image', mimeType: 'image/png', data: Buffer.from('image-bytes').toString('base64') },
      ],
    });
  });

  it('cancels the active Gemini request on gemini:stop and emits done', async () => {
    const ws = get(PROJECT)!;
    ws.gemini.transport = mockAcpClient as any;
    ws.gemini.chatSessionId = 'gemini-chat-1';
    ws.gemini.activeRequestId = 'req-3';
    ws.gemini.busy = true;
    ws.gemini.turnSeq = 4;

    mockIpcMain._emit('gemini:stop', PROJECT, 'chat');
    await tick();

    expect(mockAcpClient.request).toHaveBeenCalledWith(
      'session/cancel',
      expect.objectContaining({ sessionId: 'gemini-chat-1', requestId: 'req-3', scope: 'chat' }),
    );
    expect(collectSentEvents(mockWin)).toContainEqual(
      expect.objectContaining({ type: 'done', projectPath: PROJECT, turnSeq: 4 }),
    );
    expect(ws.gemini.busy).toBe(false);
    expect(ws.gemini.activeRequestId).toBeUndefined();
  });

  it('disables Gemini and emits error + done when an ACP request fails', async () => {
    mockAcpClient.request.mockRejectedValue(new Error('handshake failed'));

    mockIpcMain._emit('gemini:send', PROJECT, 'Hello', undefined, 'auto_edit', 'planning', 'auto-gemini-3', 'chat');
    await tick();
    await tick();

    const ws = get(PROJECT)!;
    const events = collectSentEvents(mockWin);
    expect(ws.gemini.availability).toBe('disabled');
    expect(ws.gemini.lastError).toBe('handshake failed');
    expect(events).toContainEqual(
      expect.objectContaining({ type: 'error', text: 'Gemini unavailable: handshake failed' }),
    );
    expect(events).toContainEqual(expect.objectContaining({ type: 'done', projectPath: PROJECT }));
  });

  it('blocks new Gemini sends after disablement until an explicit restart', async () => {
    mockAcpClient.request.mockRejectedValue(new Error('handshake failed'));

    mockIpcMain._emit('gemini:send', PROJECT, 'Hello', undefined, 'auto_edit', 'planning', 'auto-gemini-3', 'chat');
    await tick();
    await tick();

    mockAcpClient.request.mockClear();

    mockIpcMain._emit('gemini:send', PROJECT, 'Hello again', undefined, 'auto_edit', 'planning', 'auto-gemini-3', 'chat');
    await tick();

    expect(mockAcpClient.request).not.toHaveBeenCalled();
    expect(collectSentEvents(mockWin)).toContainEqual(expect.objectContaining({
      type: 'error',
      text: 'Gemini unavailable: handshake failed',
    }));
  });

  it('retries Gemini successfully after an explicit gemini:start', async () => {
    mockAcpClient.request.mockRejectedValueOnce(new Error('boom'));

    mockIpcMain._emit('gemini:send', PROJECT, 'Hello', undefined, 'auto_edit', 'planning', 'auto-gemini-3', 'chat');
    await tick();
    await tick();

    mockAcpClient.start.mockResolvedValue(undefined);
    mockAcpClient.request.mockImplementation(async (method: string) => {
      if (method === 'session/new') return { sessionId: 'gemini-chat-2' };
      if (method === 'session/prompt') return { requestId: 'req-2', usage: { input_tokens: 5, output_tokens: 1, cached: 0 } };
      throw new Error(`Unexpected method ${method}`);
    });

    await mockIpcMain._invoke('gemini:start', PROJECT);
    mockIpcMain._emit('gemini:send', PROJECT, 'Recovered', undefined, 'auto_edit', 'planning', 'auto-gemini-3', 'chat');
    await tick();

    const ws = get(PROJECT)!;
    expect(ws.gemini.availability).toBe('available');
    expect(mockAcpClient.dispose).toHaveBeenCalled();
    expect(mockAcpClient.request).toHaveBeenCalledWith(
      'session/new',
      expect.objectContaining({ cwd: PROJECT, scope: 'chat', mcpServers: [] }),
    );
    expect(collectSentEvents(mockWin)).toContainEqual(expect.objectContaining({
      type: 'streaming_start',
      projectPath: PROJECT,
      scope: 'chat',
    }));
  });

  it('emits approval_needed when Gemini ACP requests tool approval', async () => {
    await mockIpcMain._invoke('gemini:start', PROJECT);

    emitAcpEvent({
      method: 'tool.approvalRequired',
      params: {
        scope: 'chat',
        id: 'tool-1',
        name: 'Bash',
        input: { command: 'rm -rf /tmp/test' },
        description: 'Run a shell command',
      },
    });
    await tick();

    const ws = get(PROJECT)!;
    expect(ws.gemini.pendingApproval).toMatchObject({
      toolUseId: 'tool-1',
      toolName: 'Bash',
      input: { command: 'rm -rf /tmp/test' },
      description: 'Run a shell command',
      scope: 'chat',
    });

    expect(collectSentEvents(mockWin)).toContainEqual(expect.objectContaining({
      type: 'approval_needed',
      projectPath: PROJECT,
      scope: 'chat',
      toolUseId: 'tool-1',
      toolName: 'Bash',
      command: 'rm -rf /tmp/test',
      description: 'Run a shell command',
    }));
  });

  it('routes Gemini approvals through claude:approve and clears pending state', async () => {
    const ws = get(PROJECT)!;
    ws.gemini.transport = mockAcpClient as any;
    ws.gemini.chatSessionId = 'gemini-chat-1';
    ws.gemini.pendingApproval = {
      toolUseId: 'tool-2',
      toolName: 'Bash',
      input: { command: 'ls' },
      description: 'Run ls',
      scope: 'chat',
    };

    mockAcpClient.request.mockResolvedValue({ ok: true });

    const result = await mockIpcMain._invoke('claude:approve', PROJECT, 'tool-2', true, 'pwd', 'chat');

    expect(result).toBe(true);
    expect(mockAcpClient.request).toHaveBeenCalledWith('tool/approve', expect.objectContaining({
      sessionId: 'gemini-chat-1',
      scope: 'chat',
      toolUseId: 'tool-2',
      approved: true,
      modifiedCommand: 'pwd',
    }));
    expect(ws.gemini.pendingApproval).toBeNull();
    expect(collectSentEvents(mockWin)).toContainEqual(expect.objectContaining({
      type: 'approval_resolved',
      projectPath: PROJECT,
      scope: 'chat',
    }));
  });
});
