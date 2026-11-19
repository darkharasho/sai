// @vitest-environment node
// Task 4: Gemini and Kimi emit the real chat id as scope, and every direct
// claude:message send (acpProvider, gemini, workspace suspend) goes through
// emitChatMessage so the durable chat log records it (ruling R6).
import { EventEmitter } from 'node:events';
import os from 'node:os';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const { handlers, listeners, mockIpcMain, mockSpawn, spawned, acp } = vi.hoisted(() => {
  const handlers = new Map<string, (...args: any[]) => any>();
  const listeners = new Map<string, Array<(...args: any[]) => void>>();
  const mockIpcMain = {
    handle: vi.fn((channel: string, h: (...args: any[]) => any) => { handlers.set(channel, h); }),
    on: vi.fn((channel: string, l: (...args: any[]) => void) => { listeners.set(channel, [...(listeners.get(channel) || []), l]); }),
    removeHandler: vi.fn(),
    removeAllListeners: vi.fn(),
  };
  const spawned: any[] = [];
  const mockSpawn = vi.fn(() => {
    const child = Object.assign(new EventEmitter(), {
      stdout: new EventEmitter(), stderr: new EventEmitter(), kill: vi.fn(), pid: 4242,
    });
    spawned.push(child);
    return child;
  });
  // Scripted ACP client: session/prompt streams one chunk tagged with the
  // session id and one untagged chunk, then resolves.
  const acp = {
    events: new Set<(e: any) => void>(),
    sessionSeq: 0,
    requests: [] as Array<{ method: string; params: any }>,
    emit(e: any) { for (const l of [...acp.events]) l(e); },
    client: null as any,
  };
  acp.client = {
    start: vi.fn(async () => {}),
    dispose: vi.fn(),
    onEvent: (cb: (e: any) => void) => { acp.events.add(cb); return () => acp.events.delete(cb); },
    request: vi.fn(async (method: string, params: any) => {
      acp.requests.push({ method, params });
      if (method === 'session/new') return { sessionId: `kimi-s${++acp.sessionSeq}` };
      if (method === 'session/prompt') {
        acp.emit({ method: 'session/update', params: { sessionId: params.sessionId, update: { sessionUpdate: 'agent_message_chunk', content: { text: 'hi ' } } } });
        acp.emit({ method: 'session/update', params: { update: { sessionUpdate: 'agent_message_chunk', content: { text: 'there' } } } });
        return { usage: { input_tokens: 1, output_tokens: 2 } };
      }
      return {};
    }),
  };
  return { handlers, listeners, mockIpcMain, mockSpawn, spawned, acp };
});

vi.mock('electron', () => ({
  ipcMain: mockIpcMain,
  app: { getPath: vi.fn().mockReturnValue(os.tmpdir()), isPackaged: false },
  BrowserWindow: vi.fn(),
  Notification: Object.assign(vi.fn(), { isSupported: () => false }),
}));
vi.mock('node:child_process', async importOriginal => ({
  ...(await importOriginal<typeof import('node:child_process')>()),
  spawn: mockSpawn,
}));
vi.mock('@electron/services/notify', () => ({
  notifyCompletion: vi.fn(), notifyApproval: vi.fn(), notifyQuestion: vi.fn(), notifyPlanReview: vi.fn(),
}));
vi.mock('@electron/services/acp', () => ({ createAcpClient: vi.fn(() => acp.client) }));

import { registerClaudeHandlers, setChatLog, destroyClaude } from '@electron/services/claude';
import { __setClaudeBackendForTests } from '@electron/services/claudeBackend';
import { registerGeminiHandlers } from '@electron/services/gemini';
import { registerKimiHandlers } from '@electron/services/kimi';
import { getOrCreate, getClaude, suspend } from '@electron/services/workspace';
import { createMockBrowserWindow } from '../../helpers/electron-mock';

const tick = () => new Promise(resolve => setTimeout(resolve, 0));

let win: ReturnType<typeof createMockBrowserWindow>;
let recorded: any[];

function v1Sent(): any[] {
  return win.webContents.send.mock.calls.filter(([ch]) => ch === 'claude:message').map(([, m]) => m);
}

beforeEach(() => {
  handlers.clear();
  listeners.clear();
  spawned.length = 0;
  acp.events.clear();
  acp.requests.length = 0;
  win = createMockBrowserWindow();
  recorded = [];
  __setClaudeBackendForTests({ destroy: () => {} } as never);
  registerClaudeHandlers(win as never);
  registerGeminiHandlers(win as never);
  registerKimiHandlers(win as never);
  setChatLog({ record: (msg: Record<string, unknown>) => { recorded.push(msg); } });
});

afterEach(() => {
  setChatLog(null);
  destroyClaude();
  __setClaudeBackendForTests(null);
  vi.clearAllMocks();
});

describe('Gemini (Antigravity) scope', () => {
  const PROJECT = '/test/gemini-scope';

  beforeEach(() => {
    const ws = getOrCreate(PROJECT);
    ws.gemini.cwd = PROJECT;
    ws.gemini.busy = false;
    ws.gemini.turnSeq = 0;
  });

  it('gemini emits use the scope passed to gemini:send', async () => {
    listeners.get('gemini:send')![0]({}, PROJECT, 'hello', [], 'default', 'fast', '', 'chat-g1');
    await tick();
    const child = spawned[0];
    child.stdout.emit('data', Buffer.from([
      '{"type":"init","conversation_id":"agy-1"}',
      '{"type":"step_update","content":{"text":"Hi"}}',
      '',
    ].join('\n')));
    child.emit('exit', 0);
    await tick();

    const events = v1Sent().filter(m => m.projectPath === PROJECT);
    expect(events.map(m => m.type)).toEqual(['streaming_start', 'session_id', 'assistant', 'result', 'done']);
    expect(events.every(m => m.scope === 'chat-g1')).toBe(true);
    // The chat's conversation is keyed by its own chat id, not the legacy slot.
    const ws = getOrCreate(PROJECT);
    expect(ws.gemini.terminalSessions.get('chat-g1')).toBe('agy-1');
    // Routed through emitChatMessage: the log saw every one of them.
    expect(recorded.filter(m => m.projectPath === PROJECT)).toEqual(events);
  });

  it('gemini:stop with a chat id stops that chat', async () => {
    listeners.get('gemini:send')![0]({}, PROJECT, 'hello', [], 'default', 'fast', '', 'chat-g2');
    await tick();
    const child = spawned[0];
    listeners.get('gemini:stop')![0]({}, PROJECT, 'chat-g2');
    expect(child.kill).toHaveBeenCalledOnce();
    const done = { type: 'done', projectPath: PROJECT, scope: 'chat-g2', turnSeq: 1 };
    expect(v1Sent()).toContainEqual(done);
    expect(recorded).toContainEqual(done);
  });

  it('the commit one-shot never reaches the chat log', async () => {
    const { promptAntigravityOneShot } = await import('@electron/services/gemini');
    const p = promptAntigravityOneShot(PROJECT, 'write a commit message');
    await tick();
    const child = spawned[0];
    child.stdout.emit('data', Buffer.from('{"type":"init","conversation_id":"agy-commit"}\n{"type":"step_update","content":{"text":"fix: x"}}\n'));
    child.emit('exit', 0);
    await expect(p).resolves.toBe('fix: x');
    expect(recorded.filter(m => m.scope === 'commit')).toEqual([]);
  });
});

describe('Kimi (ACP) scope', () => {
  const PROJECT = '/test/kimi-scope';

  beforeEach(() => {
    const ws = getOrCreate(PROJECT);
    ws.kimi.cwd = PROJECT;
    ws.kimi.busy = false;
    ws.kimi.turnSeq = 0;
    ws.kimi.transport = null;
    ws.kimi.availability = 'available';
  });

  it("kimi emits use the last send's scope", async () => {
    listeners.get('kimi:send')![0]({}, PROJECT, 'hello', [], 'auto_edit', undefined, 'kimi-k3', 'chat-k1');
    for (let i = 0; i < 5; i++) await tick();

    const events = v1Sent().filter(m => m.projectPath === PROJECT);
    expect(events.map(m => m.type)).toEqual(['session_id', 'streaming_start', 'assistant', 'assistant', 'result', 'done']);
    // Including the untagged chunk: it takes the scope of the send that started the turn.
    expect(events.every(m => m.scope === 'chat-k1')).toBe(true);
    // acpProvider emits go through emitChatMessage and land in the log.
    expect(recorded.filter(m => m.projectPath === PROJECT)).toEqual(events);
  });

  it('kimi:stop with a chat id ends that chat', async () => {
    const ws = getOrCreate(PROJECT);
    ws.kimi.terminalSessions.set('chat-k2', 'kimi-sx');
    ws.kimi.turnSeq = 3;
    await listeners.get('kimi:stop')![0]({}, PROJECT, 'chat-k2');
    const done = { type: 'done', projectPath: PROJECT, scope: 'chat-k2', turnSeq: 3 };
    expect(v1Sent()).toContainEqual(done);
    expect(recorded).toContainEqual(done);
  });
});

describe('workspace suspend routes its done events through emitChatMessage', () => {
  it('records the scoped Claude suspend done', () => {
    const PROJECT = '/test/suspend-claude';
    const ws = getOrCreate(PROJECT);
    const claude = getClaude(ws, 'chat-c1');
    claude.busy = true;
    claude.turnSeq = 7;
    suspend(PROJECT, win as never);
    expect(ws.status).toBe('suspended');
    const done = { type: 'done', projectPath: PROJECT, scope: 'chat-c1', turnSeq: 7 };
    expect(v1Sent()).toContainEqual(done);
    expect(recorded).toContainEqual(done);
  });

  it('records the Codex suspend done', () => {
    const PROJECT = '/test/suspend-codex';
    const ws = getOrCreate(PROJECT);
    ws.codex.busy = true;
    ws.codex.turnSeq = 4;
    suspend(PROJECT, win as never);
    const done = { type: 'done', projectPath: PROJECT, turnSeq: 4 };
    expect(v1Sent()).toContainEqual(done);
    expect(recorded).toContainEqual(done);
  });

  it('stamps the last send scope on an ACP provider suspend done', () => {
    const PROJECT = '/test/suspend-kimi';
    const ws = getOrCreate(PROJECT);
    ws.kimi.busy = true;
    ws.kimi.turnSeq = 2;
    ws.kimi.lastSendScope = 'chat-k9';
    suspend(PROJECT, win as never);
    const done = { type: 'done', projectPath: PROJECT, scope: 'chat-k9', turnSeq: 2 };
    expect(v1Sent()).toContainEqual(done);
    expect(recorded).toContainEqual(done);
  });
});
