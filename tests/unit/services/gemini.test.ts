// @vitest-environment node
import { EventEmitter } from 'node:events';
import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mockIpcMain, handlers, listeners, mockSpawn, spawned } = vi.hoisted(() => {
  const handlers = new Map<string, (...args: any[]) => any>();
  const listeners = new Map<string, Array<(...args: any[]) => void>>();
  const mockIpcMain = {
    handle: vi.fn((channel: string, handler: (...args: any[]) => any) => handlers.set(channel, handler)),
    on: vi.fn((channel: string, listener: (...args: any[]) => void) => listeners.set(channel, [...(listeners.get(channel) || []), listener])),
  };
  const spawned: any[] = [];
  const mockSpawn = vi.fn(() => {
    const child = Object.assign(new EventEmitter(), {
      stdout: new EventEmitter(), stderr: new EventEmitter(), kill: vi.fn(),
    });
    spawned.push(child);
    return child;
  });
  return { mockIpcMain, handlers, listeners, mockSpawn, spawned };
});

vi.mock('electron', () => ({ ipcMain: mockIpcMain, BrowserWindow: vi.fn() }));
vi.mock('node:child_process', async importOriginal => ({
  ...(await importOriginal<typeof import('node:child_process')>()),
  spawn: mockSpawn,
}));
vi.mock('@electron/services/notify', () => ({ notifyCompletion: vi.fn() }));

import { registerGeminiHandlers } from '@electron/services/gemini';
import { getOrCreate } from '@electron/services/workspace';
import { createMockBrowserWindow } from '../../helpers/electron-mock';

const PROJECT = '/workspace/antigravity-project';
const tick = () => new Promise(resolve => process.nextTick(resolve));

function sent(win: ReturnType<typeof createMockBrowserWindow>) {
  return (win.webContents.send as ReturnType<typeof vi.fn>).mock.calls
    .filter(([channel]) => channel === 'claude:message')
    .map(([, event]) => event);
}

describe('Antigravity provider', () => {
  let win: ReturnType<typeof createMockBrowserWindow>;

  beforeEach(() => {
    vi.clearAllMocks();
    handlers.clear();
    listeners.clear();
    spawned.length = 0;
    win = createMockBrowserWindow();
    registerGeminiHandlers(win as unknown as import('electron').BrowserWindow);
    const ws = getOrCreate(PROJECT);
    ws.gemini.cwd = PROJECT;
    ws.gemini.chatSessionId = undefined;
    ws.gemini.busy = false;
    ws.gemini.turnSeq = 0;
  });

  it('discovers models from agy instead of shipping Gemini model IDs', async () => {
    const promise = handlers.get('gemini:models')!({}, PROJECT);
    expect(mockSpawn).toHaveBeenCalledWith('agy', ['models'], expect.any(Object));
    const child = spawned[0];
    child.stdout.emit('data', Buffer.from('{"id":"antigravity-pro","display_name":"Antigravity Pro"}\n'));
    child.emit('exit', 0);
    await expect(promise).resolves.toEqual({
      models: [{ id: 'antigravity-pro', name: 'Antigravity Pro' }],
      defaultModel: 'antigravity-pro',
    });
  });

  it('runs agy print mode, streams NDJSON, and persists its conversation ID', async () => {
    listeners.get('gemini:send')![0]({}, PROJECT, 'Explain this file', ['/tmp/image.png'], 'auto_edit', 'fast', 'antigravity-pro', 'chat');
    await tick();
    expect(mockSpawn).toHaveBeenCalledWith('agy', expect.arrayContaining([
      '--print', '--output-format', 'stream-json', '--model', 'antigravity-pro', '--effort', 'low', '--mode', 'accept-edits',
    ]), expect.objectContaining({ cwd: PROJECT }));

    const child = spawned[0];
    child.stdout.emit('data', Buffer.from([
      '{"type":"init","conversation_id":"agy-chat-1"}',
      '{"type":"step_update","content":{"text":"Hello "}}',
      '{"type":"step_update","content":{"text":"world"}}',
      '{"type":"result","result":{"text":"Hello world"}}',
      '',
    ].join('\n')));
    child.emit('exit', 0);
    await tick();

    const args = mockSpawn.mock.calls[0][1] as string[];
    expect(args.at(-1)).toContain('[Attached image: /tmp/image.png]');
    expect(sent(win)).toContainEqual(expect.objectContaining({ type: 'session_id', sessionId: 'agy-chat-1' }));
    expect(sent(win)).toContainEqual(expect.objectContaining({
      type: 'assistant', message: { content: [{ type: 'text', text: 'Hello ', delta: true }] },
    }));
    expect(sent(win)).toContainEqual(expect.objectContaining({ type: 'done', projectPath: PROJECT, scope: 'chat' }));
    expect(getOrCreate(PROJECT).gemini.chatSessionId).toBe('agy-chat-1');
  });

  it('resumes a saved Antigravity conversation and stop kills its process', async () => {
    listeners.get('gemini:setSessionId')![0]({}, PROJECT, 'agy-existing', 'chat');
    listeners.get('gemini:send')![0]({}, PROJECT, 'Continue', [], 'default', 'planning', '', 'chat');
    await tick();
    const child = spawned[0];
    expect(mockSpawn.mock.calls[0][1]).toEqual(expect.arrayContaining(['--conversation', 'agy-existing', '--mode', 'plan', '--effort', 'high']));
    listeners.get('gemini:stop')![0]({}, PROJECT, 'chat');
    expect(child.kill).toHaveBeenCalledOnce();
    expect(sent(win)).toContainEqual(expect.objectContaining({ type: 'done', projectPath: PROJECT, scope: 'chat' }));
  });
});
