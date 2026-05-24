// @vitest-environment node
/**
 * Integration test: two concurrent chat sessions stream independently
 * within the same workspace.
 *
 * After Task 6, regular Claude chats use `scope = session.id` so multiple
 * sessions in one workspace can stream concurrently.  This test verifies that
 * backend events for two scopes are routed and tracked independently from a
 * renderer-level perspective (Option A — pure bridge/IPC level).
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// ---------------------------------------------------------------------------
// vi.hoisted — shared state objects created before vi.mock factories run
// ---------------------------------------------------------------------------
const { mockIpcMain, workspaceState } = vi.hoisted(() => {
  type IpcHandler = (...args: unknown[]) => unknown;
  type IpcListener = (...args: unknown[]) => void;

  const handlers = new Map<string, IpcHandler>();
  const listeners = new Map<string, IpcListener[]>();

  const handle = vi.fn((ch: string, fn: IpcHandler) => { handlers.set(ch, fn); });
  const on = vi.fn((ch: string, fn: IpcListener) => {
    listeners.set(ch, [...(listeners.get(ch) ?? []), fn]);
  });
  const removeHandler = vi.fn((ch: string) => handlers.delete(ch));

  const mockIpcMain = {
    _handlers: handlers,
    _listeners: listeners,
    handle, on, removeHandler,
    async _invoke(ch: string, ...args: unknown[]): Promise<unknown> {
      const fn = handlers.get(ch);
      if (!fn) throw new Error(`No handler for "${ch}"`);
      return fn({ sender: {} } as unknown, ...args);
    },
    _emit(ch: string, ...args: unknown[]): void {
      for (const fn of listeners.get(ch) ?? []) fn({ sender: {} } as unknown, ...args);
    },
  };

  type WorkspaceClaude = {
    process: any | null;
    sessionId: string | undefined;
    buffer: string;
    cwd: string;
    processConfig: { permMode: string; effort: string; model: string } | null;
    busy: boolean;
    suppressForward: boolean;
    pendingToolUse: { toolName: string; toolUseId: string; input: Record<string, any> } | null;
    approvalBuffered: any[];
    awaitingApproval: boolean;
  };
  type Workspace = { projectPath: string; claudeScopes: Map<string, WorkspaceClaude> };

  const map = new Map<string, Workspace>();

  function makeClaude(): WorkspaceClaude {
    return {
      process: null, sessionId: undefined, buffer: '', cwd: '',
      processConfig: null, busy: false, suppressForward: false,
      pendingToolUse: null, approvalBuffered: [], awaitingApproval: false,
    };
  }

  function getClaude(ws: Workspace, scope: string = 'chat'): WorkspaceClaude {
    let c = ws.claudeScopes.get(scope);
    if (!c) { c = makeClaude(); ws.claudeScopes.set(scope, c); }
    return c;
  }

  const workspaceState = {
    map,
    getOrCreate(p: string): Workspace {
      if (!map.has(p)) map.set(p, { projectPath: p, claudeScopes: new Map([['chat', makeClaude()]]) });
      return map.get(p)!;
    },
    get(p: string): Workspace | undefined { return map.get(p); },
    clear() { map.clear(); },
    makeClaude,
    getClaude,
  };

  return { mockIpcMain, workspaceState };
});

// ---------------------------------------------------------------------------
// Module mocks
// ---------------------------------------------------------------------------

vi.mock('electron', () => ({
  ipcMain: mockIpcMain,
  app: { getPath: vi.fn().mockReturnValue('/tmp/sai-test') },
  BrowserWindow: vi.fn(),
}));

vi.mock('@electron/services/workspace', () => ({
  getOrCreate: vi.fn((p: string) => workspaceState.getOrCreate(p)),
  get: vi.fn((p: string) => workspaceState.get(p)),
  getClaude: vi.fn((ws: any, scope?: string) => workspaceState.getClaude(ws, scope)),
  touchActivity: vi.fn(),
}));

vi.mock('@electron/services/notify', () => ({ notifyCompletion: vi.fn() }));

vi.mock('node:fs', () => ({
  default: {
    existsSync: vi.fn().mockReturnValue(false),
    readFileSync: vi.fn().mockReturnValue('[]'),
    writeFileSync: vi.fn(),
    readdirSync: vi.fn().mockReturnValue([]),
    mkdirSync: vi.fn(),
  },
  existsSync: vi.fn().mockReturnValue(false),
  readFileSync: vi.fn().mockReturnValue('[]'),
  writeFileSync: vi.fn(),
  readdirSync: vi.fn().mockReturnValue([]),
  mkdirSync: vi.fn(),
}));

vi.mock('node:child_process', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:child_process')>();
  return {
    ...actual,
    spawn: vi.fn(),
    execFile: vi.fn((_cmd: string, _args: string[], _opts: object, cb: (...a: any[]) => void) => {
      process.nextTick(() => cb(null, 'mock-output', ''));
    }),
  };
});

// ---------------------------------------------------------------------------
// Imports (after mocks)
// ---------------------------------------------------------------------------
import { spawn } from 'node:child_process';
import { createMockBrowserWindow } from '../helpers/electron-mock';
import { MockChildProcess } from '../helpers/process-mock';
import { registerClaudeHandlers } from '@electron/services/claude';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
let spawnedProcesses: MockChildProcess[] = [];

function defaultSpawnImpl(): MockChildProcess {
  const proc = new MockChildProcess();
  spawnedProcesses.push(proc);
  return proc as any;
}

function pushLines(proc: MockChildProcess, ...jsons: object[]): void {
  for (const obj of jsons) proc.pushStdout(JSON.stringify(obj) + '\n');
}

/** All claude:message payloads sent to the renderer window. */
function sentMessages(win: ReturnType<typeof createMockBrowserWindow>) {
  return (win.webContents.send as ReturnType<typeof vi.fn>).mock.calls
    .filter(([ch]: [string]) => ch === 'claude:message')
    .map(([, msg]: [string, any]) => msg);
}

/** Messages matching a specific scope. */
function messagesForScope(win: ReturnType<typeof createMockBrowserWindow>, scope: string) {
  return sentMessages(win).filter(m => m.scope === scope);
}

async function flushAsync(): Promise<void> {
  await new Promise(r => setTimeout(r, 0));
  await new Promise(r => setTimeout(r, 0));
}

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------
let win: ReturnType<typeof createMockBrowserWindow>;
const PROJECT = '/test/concurrent-project';
const SCOPE_A = 'session-a';
const SCOPE_B = 'session-b';

beforeEach(() => {
  workspaceState.clear();
  spawnedProcesses = [];
  vi.mocked(spawn).mockImplementation(defaultSpawnImpl as any);
  win = createMockBrowserWindow();
  mockIpcMain._handlers.clear();
  mockIpcMain._listeners.clear();
  (mockIpcMain.handle as ReturnType<typeof vi.fn>).mockClear();
  (mockIpcMain.on as ReturnType<typeof vi.fn>).mockClear();
  registerClaudeHandlers(win as any);
});

afterEach(() => {
  vi.clearAllMocks();
  vi.mocked(spawn).mockImplementation(defaultSpawnImpl as any);
});

// ===========================================================================
// Tests
// ===========================================================================

describe('Concurrent chat streams in one workspace', () => {
  it('two scopes each receive their own streaming_start when both sessions send concurrently', async () => {
    // Register both scopes in the same workspace
    await mockIpcMain._invoke('claude:start', PROJECT, SCOPE_A);
    await mockIpcMain._invoke('claude:start', PROJECT, SCOPE_B);

    // Send a message on each scope — spawns one process per scope
    mockIpcMain._emit('claude:send', PROJECT, 'Hello from A', undefined, 'default', 'low', 'claude-3-5-sonnet-20241022', SCOPE_A);
    mockIpcMain._emit('claude:send', PROJECT, 'Hello from B', undefined, 'default', 'low', 'claude-3-5-sonnet-20241022', SCOPE_B);
    await flushAsync();

    expect(spawnedProcesses).toHaveLength(2);
    const [procA, procB] = spawnedProcesses;

    // Both processes emit an assistant chunk (triggers streaming_start per scope)
    pushLines(procA, { type: 'assistant', session_id: 'sess-a', message: { content: [{ type: 'text', text: 'Hi from A' }] } });
    pushLines(procB, { type: 'assistant', session_id: 'sess-b', message: { content: [{ type: 'text', text: 'Hi from B' }] } });
    await flushAsync();

    const msgsA = messagesForScope(win, SCOPE_A);
    const msgsB = messagesForScope(win, SCOPE_B);

    // Both scopes must have received a streaming_start
    expect(msgsA.map(m => m.type)).toContain('streaming_start');
    expect(msgsB.map(m => m.type)).toContain('streaming_start');

    // Events must be scoped — no cross-contamination
    expect(msgsA.every(m => m.scope === SCOPE_A)).toBe(true);
    expect(msgsB.every(m => m.scope === SCOPE_B)).toBe(true);
  });

  it('both scopes stream concurrently; done for one scope does not affect the other', async () => {
    await mockIpcMain._invoke('claude:start', PROJECT, SCOPE_A);
    await mockIpcMain._invoke('claude:start', PROJECT, SCOPE_B);

    mockIpcMain._emit('claude:send', PROJECT, 'Task A', undefined, 'default', 'low', 'claude-3-5-sonnet-20241022', SCOPE_A);
    mockIpcMain._emit('claude:send', PROJECT, 'Task B', undefined, 'default', 'low', 'claude-3-5-sonnet-20241022', SCOPE_B);
    await flushAsync();

    const [procA, procB] = spawnedProcesses;

    // Kick off streaming on both scopes
    pushLines(procA, { type: 'assistant', session_id: 'sess-a', message: { content: [{ type: 'text', text: 'Working...' }] } });
    pushLines(procB, { type: 'assistant', session_id: 'sess-b', message: { content: [{ type: 'text', text: 'Working...' }] } });
    await flushAsync();

    // Complete scope A only
    pushLines(procA,
      { type: 'result', duration_ms: 100, num_turns: 1, total_cost_usd: 0.001, result: 'done' },
    );
    await flushAsync();

    const msgsA = messagesForScope(win, SCOPE_A);
    const msgsB = messagesForScope(win, SCOPE_B);

    // Scope A should be done
    expect(msgsA.map(m => m.type)).toContain('done');

    // Scope B should still be streaming (streaming_start present, no done yet)
    expect(msgsB.map(m => m.type)).toContain('streaming_start');
    expect(msgsB.map(m => m.type)).not.toContain('done');

    // Workspace confirms: scope A is no longer busy, scope B is
    const ws = workspaceState.get(PROJECT)!;
    expect(ws.claudeScopes.get(SCOPE_A)!.busy).toBe(false);
    expect(ws.claudeScopes.get(SCOPE_B)!.busy).toBe(true);
  });

  it('stopping one scope does not send done to the other scope', async () => {
    await mockIpcMain._invoke('claude:start', PROJECT, SCOPE_A);
    await mockIpcMain._invoke('claude:start', PROJECT, SCOPE_B);

    mockIpcMain._emit('claude:send', PROJECT, 'Long task A', undefined, 'default', 'low', 'claude-3-5-sonnet-20241022', SCOPE_A);
    mockIpcMain._emit('claude:send', PROJECT, 'Long task B', undefined, 'default', 'low', 'claude-3-5-sonnet-20241022', SCOPE_B);
    await flushAsync();

    // Stop only scope A
    mockIpcMain._emit('claude:stop', PROJECT, SCOPE_A);
    await flushAsync();

    const msgsA = messagesForScope(win, SCOPE_A);
    const msgsB = messagesForScope(win, SCOPE_B);

    // Scope A receives done after stop
    expect(msgsA.map(m => m.type)).toContain('done');

    // Scope B should NOT have received a done
    expect(msgsB.map(m => m.type)).not.toContain('done');
  });

  it('scoped processes are independent objects in the workspace', async () => {
    await mockIpcMain._invoke('claude:start', PROJECT, SCOPE_A);
    await mockIpcMain._invoke('claude:start', PROJECT, SCOPE_B);

    mockIpcMain._emit('claude:send', PROJECT, 'Msg A', undefined, 'default', 'low', 'claude-3-5-sonnet-20241022', SCOPE_A);
    mockIpcMain._emit('claude:send', PROJECT, 'Msg B', undefined, 'default', 'low', 'claude-3-5-sonnet-20241022', SCOPE_B);
    await flushAsync();

    const ws = workspaceState.get(PROJECT)!;
    const claudeA = ws.claudeScopes.get(SCOPE_A)!;
    const claudeB = ws.claudeScopes.get(SCOPE_B)!;

    expect(claudeA).toBeDefined();
    expect(claudeB).toBeDefined();
    expect(claudeA).not.toBe(claudeB);
    expect(claudeA.process).not.toBe(claudeB.process);
  });
});
