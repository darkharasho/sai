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
    /** Override session/prompt (e.g. a deferred promise) for concurrency tests. */
    onPrompt: null as null | ((params: any) => Promise<any>),
  };
  acp.client = {
    start: vi.fn(async () => {}),
    dispose: vi.fn(),
    onEvent: (cb: (e: any) => void) => { acp.events.add(cb); return () => acp.events.delete(cb); },
    request: vi.fn(async (method: string, params: any) => {
      acp.requests.push({ method, params });
      if (method === 'session/new') return { sessionId: `kimi-s${++acp.sessionSeq}` };
      if (method === 'session/prompt') {
        if (acp.onPrompt) return acp.onPrompt(params);
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
import { getOrCreate, getClaude, suspend, listAcpLiveScopes } from '@electron/services/workspace';
import { ChatLogStore } from '@electron/services/chatlog/store';
import { ChatLogService, realPath } from '@electron/services/chatlog/service';
import fs from 'node:fs';
import path from 'node:path';
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
  acp.onPrompt = null;
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
    ws.kimi.scopeTurns.set('chat-k2', { turnSeq: 3 });
    ws.kimi.busy = true;
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

function deferred<T = any>() {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}

const flush = async () => { for (let i = 0; i < 6; i++) await tick(); };

describe('fix round 1: overlapping chats in one project', () => {
  it('I1: a fresh Gemini chat is live from streaming_start and its log meta is gemini', async () => {
    const PROJECT = '/test/gemini-fresh';
    const ws = getOrCreate(PROJECT);
    ws.gemini.cwd = PROJECT;
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'chatlog-'));
    const store = new ChatLogStore({ dir });
    // Same providerOf as main.ts initChatLog.
    const providerOf = (projectPath: string, scope: string) => {
      const want = realPath(projectPath);
      for (const provider of ['gemini', 'kimi'] as const) {
        if (listAcpLiveScopes(provider).some(e => e.scope === scope && realPath(e.projectPath) === want)) return provider;
      }
      return 'claude' as const;
    };
    setChatLog(new ChatLogService({
      store, sendToRenderer: () => {}, bus: () => null,
      liveChats: () => [], providerOf, devlog: () => {},
    }));
    try {
      listeners.get('gemini:send')![0]({}, PROJECT, 'hello', [], 'default', 'fast', '', 'chat-fresh');
      // streaming_start is out; the conversation id hasn't arrived yet.
      expect(listAcpLiveScopes('gemini').filter(e => e.projectPath === PROJECT).map(e => e.scope)).toEqual(['chat-fresh']);
      expect(store.meta('chat-fresh')?.provider).toBe('gemini');
      await tick();
      spawned[0].emit('exit', 0);
      await flush();
    } finally {
      setChatLog(null);
      store.close();
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('I2: Kimi chat A erroring after B has sent ends with A\'s own turnSeq', async () => {
    const PROJECT = '/test/kimi-overlap-error';
    const ws = getOrCreate(PROJECT);
    ws.kimi.cwd = PROJECT;
    ws.kimi.transport = null;
    ws.kimi.availability = 'available';
    ws.kimi.turnSeq = 0;
    const prompts = new Map<string, ReturnType<typeof deferred>>();
    acp.onPrompt = (params) => { const d = deferred(); prompts.set(params.scope, d); return d.promise; };

    listeners.get('kimi:send')![0]({}, PROJECT, 'a', [], 'auto_edit', undefined, 'kimi-k3', 'chat-A');
    await flush();
    listeners.get('kimi:send')![0]({}, PROJECT, 'b', [], 'auto_edit', undefined, 'kimi-k3', 'chat-B');
    await flush();
    const starts = v1Sent().filter(m => m.projectPath === PROJECT && m.type === 'streaming_start');
    expect(starts.map(m => [m.scope, m.turnSeq])).toEqual([['chat-A', 1], ['chat-B', 2]]);

    prompts.get('chat-A')!.reject(new Error('bad image'));
    await flush();
    const doneA = v1Sent().find(m => m.projectPath === PROJECT && m.type === 'done' && m.scope === 'chat-A');
    expect(doneA).toEqual({ type: 'done', projectPath: PROJECT, scope: 'chat-A', turnSeq: 1 });
    expect(recorded).toContainEqual(doneA);
    // B is still running.
    expect(ws.kimi.busy).toBe(true);
    expect([...ws.kimi.scopeTurns.keys()]).toEqual(['chat-B']);

    prompts.get('chat-B')!.resolve({ usage: {} });
    await flush();
    expect(v1Sent()).toContainEqual({ type: 'done', projectPath: PROJECT, scope: 'chat-B', turnSeq: 2 });
    expect(ws.kimi.busy).toBe(false);
  });

  it('I2: stopping Kimi chat A after B has sent emits done{A, seqA} and cancels only A', async () => {
    const PROJECT = '/test/kimi-overlap-stop';
    const ws = getOrCreate(PROJECT);
    ws.kimi.cwd = PROJECT;
    ws.kimi.transport = null;
    ws.kimi.availability = 'available';
    ws.kimi.turnSeq = 0;
    acp.onPrompt = () => deferred().promise;

    listeners.get('kimi:send')![0]({}, PROJECT, 'a', [], 'auto_edit', undefined, 'kimi-k3', 'chat-A');
    await flush();
    listeners.get('kimi:send')![0]({}, PROJECT, 'b', [], 'auto_edit', undefined, 'kimi-k3', 'chat-B');
    await flush();

    await listeners.get('kimi:stop')![0]({}, PROJECT, 'chat-A');
    await flush();
    const done = { type: 'done', projectPath: PROJECT, scope: 'chat-A', turnSeq: 1 };
    expect(v1Sent()).toContainEqual(done);
    expect(recorded).toContainEqual(done);
    const cancels = acp.requests.filter(r => r.method === 'session/cancel');
    expect(cancels).toHaveLength(1);
    expect(cancels[0].params).toMatchObject({ scope: 'chat-A', sessionId: ws.kimi.terminalSessions.get('chat-A') });
    expect(ws.kimi.busy).toBe(true);
    expect([...ws.kimi.scopeTurns.keys()]).toEqual(['chat-B']);
  });

  it('I3: Gemini Stop in chat A kills only A\'s process and emits done{A, seqA}', async () => {
    const PROJECT = '/test/gemini-overlap-stop';
    const ws = getOrCreate(PROJECT);
    ws.gemini.cwd = PROJECT;
    ws.gemini.turnSeq = 0;

    listeners.get('gemini:send')![0]({}, PROJECT, 'a', [], 'default', 'fast', '', 'chat-A');
    await tick();
    listeners.get('gemini:send')![0]({}, PROJECT, 'b', [], 'default', 'fast', '', 'chat-B');
    await tick();
    const [childA, childB] = spawned;

    listeners.get('gemini:stop')![0]({}, PROJECT, 'chat-A');
    expect(childA.kill).toHaveBeenCalledOnce();
    expect(childB.kill).not.toHaveBeenCalled();
    const done = { type: 'done', projectPath: PROJECT, scope: 'chat-A', turnSeq: 1 };
    expect(v1Sent()).toContainEqual(done);
    expect(recorded).toContainEqual(done);
    expect(ws.gemini.busy).toBe(true);
    expect([...ws.gemini.scopeTurns.keys()]).toEqual(['chat-B']);

    // B keeps streaming and finishes with its own turnSeq.
    childB.stdout.emit('data', Buffer.from('{"type":"step_update","content":{"text":"still here"}}\n'));
    childB.emit('exit', 0);
    await flush();
    expect(v1Sent()).toContainEqual(expect.objectContaining({ type: 'assistant', scope: 'chat-B' }));
    expect(v1Sent()).toContainEqual({ type: 'done', projectPath: PROJECT, scope: 'chat-B', turnSeq: 2 });
    expect(ws.gemini.busy).toBe(false);
  });

  it('suspend ends every overlapping ACP turn with its own turnSeq', () => {
    const PROJECT = '/test/suspend-overlap';
    const ws = getOrCreate(PROJECT);
    ws.kimi.scopeTurns.set('chat-A', { turnSeq: 1 });
    ws.kimi.scopeTurns.set('chat-B', { turnSeq: 2 });
    ws.kimi.busy = true;
    suspend(PROJECT, win as never);
    expect(recorded).toContainEqual({ type: 'done', projectPath: PROJECT, scope: 'chat-A', turnSeq: 1 });
    expect(recorded).toContainEqual({ type: 'done', projectPath: PROJECT, scope: 'chat-B', turnSeq: 2 });
    expect(ws.kimi.busy).toBe(false);
  });
});
