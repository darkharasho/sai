// @vitest-environment node
/**
 * Integration tests for IPC streaming lifecycle.
 *
 * These tests exercise the full handler registration → invocation path using
 * real service logic (registerClaudeHandlers) with mocked electron and child_process.
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
  type Workspace = { projectPath: string; claude: WorkspaceClaude };

  const map = new Map<string, Workspace>();

  function makeClaude(): WorkspaceClaude {
    return {
      process: null, sessionId: undefined, buffer: '', cwd: '',
      processConfig: null, busy: false, suppressForward: false,
      pendingToolUse: null, approvalBuffered: [], awaitingApproval: false,
    };
  }

  const workspaceState = {
    map,
    getOrCreate(p: string): Workspace {
      if (!map.has(p)) map.set(p, { projectPath: p, claude: makeClaude() });
      return map.get(p)!;
    },
    get(p: string): Workspace | undefined { return map.get(p); },
    clear() { map.clear(); },
    makeClaude,
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

function getLatest(): MockChildProcess {
  if (!spawnedProcesses.length) throw new Error('No processes spawned');
  return spawnedProcesses[spawnedProcesses.length - 1];
}

function pushLines(proc: MockChildProcess, ...jsons: object[]): void {
  for (const obj of jsons) proc.pushStdout(JSON.stringify(obj) + '\n');
}

function sentMessages(win: ReturnType<typeof createMockBrowserWindow>) {
  return (win.webContents.send as ReturnType<typeof vi.fn>).mock.calls
    .filter(([ch]: [string]) => ch === 'claude:message')
    .map(([, msg]: [string, any]) => msg);
}

async function flushAsync(): Promise<void> {
  await new Promise(r => setTimeout(r, 0));
  await new Promise(r => setTimeout(r, 0));
}

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------
let win: ReturnType<typeof createMockBrowserWindow>;
const PROJECT = '/test/streaming-project';

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

describe('IPC streaming lifecycle', () => {
  it('full lifecycle: start → streaming_start → chunks → result → done', async () => {
    // Register workspace via claude:start
    await mockIpcMain._invoke('claude:start', PROJECT);

    // Send a message — this spawns the process
    mockIpcMain._emit('claude:send', PROJECT, 'Hello', undefined, 'default', 'low', 'claude-3-5-sonnet-20241022');
    await flushAsync();

    const proc = getLatest();

    // Emit streaming chunks then result
    pushLines(proc,
      { type: 'assistant', session_id: 'sess-1', message: { content: [{ type: 'text', text: 'Hi' }] } },
      { type: 'result', duration_ms: 100, num_turns: 1, total_cost_usd: 0.001, result: 'done' },
    );
    await flushAsync();

    const msgs = sentMessages(win);
    const types = msgs.map(m => m.type);

    expect(types).toContain('ready');
    expect(types).toContain('streaming_start');
    expect(types).toContain('result');
    expect(types).toContain('done');

    // streaming_start comes before result
    const siIdx = types.indexOf('streaming_start');
    const resIdx = types.indexOf('result');
    const doneIdx = types.indexOf('done');
    expect(siIdx).toBeLessThan(resIdx);
    expect(resIdx).toBeLessThan(doneIdx);
  });

  it('session_id captured and forwarded on first message', async () => {
    await mockIpcMain._invoke('claude:start', PROJECT);
    mockIpcMain._emit('claude:send', PROJECT, 'Hey', undefined, 'default');
    await flushAsync();

    pushLines(getLatest(),
      { session_id: 'abc-123', type: 'system', subtype: 'init', slash_commands: [] },
    );
    await flushAsync();

    const msgs = sentMessages(win);
    const sessionMsg = msgs.find(m => m.type === 'session_id');
    expect(sessionMsg).toBeDefined();
    expect(sessionMsg?.sessionId).toBe('abc-123');

    // Workspace session id should be captured
    const ws = workspaceState.get(PROJECT)!;
    expect(ws.claude.sessionId).toBe('abc-123');
  });

  it('abort mid-stream: claude:stop kills process and sends done', async () => {
    await mockIpcMain._invoke('claude:start', PROJECT);
    mockIpcMain._emit('claude:send', PROJECT, 'Long task');
    await flushAsync();

    const proc = getLatest();
    // Don't emit exit yet — process is mid-stream

    // Stop the stream
    mockIpcMain._emit('claude:stop', PROJECT);
    await flushAsync();

    expect(proc.kill).toHaveBeenCalled();
    const msgs = sentMessages(win);
    const doneMsg = msgs.find(m => m.type === 'done');
    expect(doneMsg).toBeDefined();
  });

  it('stream error on stderr delivers error event', async () => {
    await mockIpcMain._invoke('claude:start', PROJECT);
    mockIpcMain._emit('claude:send', PROJECT, 'Trigger error');
    await flushAsync();

    const proc = getLatest();
    proc.pushStderr('something went wrong\n');
    await flushAsync();

    const msgs = sentMessages(win);
    const errMsg = msgs.find(m => m.type === 'error');
    expect(errMsg).toBeDefined();
    expect(errMsg?.text).toContain('something went wrong');
  });

  it('process spawn error delivers error + done events', async () => {
    await mockIpcMain._invoke('claude:start', PROJECT);
    mockIpcMain._emit('claude:send', PROJECT, 'Trigger spawn error');
    await flushAsync();

    const proc = getLatest();
    // Simulate a process error event
    proc.emit('error', new Error('ENOENT: spawn failed'));
    await flushAsync();

    const msgs = sentMessages(win);
    const errMsg = msgs.find(m => m.type === 'error');
    const doneMsg = msgs.find(m => m.type === 'done');
    expect(errMsg).toBeDefined();
    expect(errMsg?.text).toContain('Claude process error');
    expect(doneMsg).toBeDefined();
  });

  it('process reuse: same config does not respawn', async () => {
    await mockIpcMain._invoke('claude:start', PROJECT);

    // First send
    mockIpcMain._emit('claude:send', PROJECT, 'First', undefined, 'default', '', '');
    await flushAsync();
    const firstProc = getLatest();

    // Emit result to mark turn done
    pushLines(firstProc, { type: 'result', duration_ms: 50 });
    await flushAsync();

    // Second send with same config
    mockIpcMain._emit('claude:send', PROJECT, 'Second', undefined, 'default', '', '');
    await flushAsync();

    // Should reuse — only one process spawned
    expect(spawnedProcesses).toHaveLength(1);
    expect(getLatest()).toBe(firstProc);
  });

  it('config change causes process respawn', async () => {
    await mockIpcMain._invoke('claude:start', PROJECT);

    mockIpcMain._emit('claude:send', PROJECT, 'First', undefined, 'default', 'low', 'sonnet');
    await flushAsync();

    // Change model — should respawn
    mockIpcMain._emit('claude:send', PROJECT, 'Second', undefined, 'default', 'low', 'haiku');
    await flushAsync();

    expect(spawnedProcesses.length).toBeGreaterThanOrEqual(2);
  });

  it('multiple rapid requests with different projects do not interleave', async () => {
    const PROJECT_A = '/test/project-a';
    const PROJECT_B = '/test/project-b';

    await mockIpcMain._invoke('claude:start', PROJECT_A);
    await mockIpcMain._invoke('claude:start', PROJECT_B);

    mockIpcMain._emit('claude:send', PROJECT_A, 'Task A');
    mockIpcMain._emit('claude:send', PROJECT_B, 'Task B');
    await flushAsync();

    expect(spawnedProcesses).toHaveLength(2);

    // Each project has its own process
    const wsA = workspaceState.get(PROJECT_A)!;
    const wsB = workspaceState.get(PROJECT_B)!;
    expect(wsA.claude.process).not.toBe(wsB.claude.process);
  });

  it('workspace switch mid-stream: old process is killed', async () => {
    await mockIpcMain._invoke('claude:start', PROJECT);
    mockIpcMain._emit('claude:send', PROJECT, 'Ongoing task');
    await flushAsync();

    const oldProc = getLatest();

    // Simulate a model change (forces respawn = workspace switch scenario)
    mockIpcMain._emit('claude:send', PROJECT, 'New task', undefined, 'bypass', '', '');
    await flushAsync();

    expect(oldProc.kill).toHaveBeenCalled();
    expect(spawnedProcesses.length).toBeGreaterThanOrEqual(2);
  });

  it('claude:start returns cached slash commands', async () => {
    const result = await mockIpcMain._invoke('claude:start', PROJECT) as { slashCommands: string[] };
    expect(result).toBeDefined();
    expect(Array.isArray(result.slashCommands)).toBe(true);
  });

  it('init message slash_commands are written to cache', async () => {
    const fs = await import('node:fs');
    await mockIpcMain._invoke('claude:start', PROJECT);
    mockIpcMain._emit('claude:send', PROJECT, 'Hi');
    await flushAsync();

    pushLines(getLatest(), {
      type: 'system',
      subtype: 'init',
      session_id: 'sess-init',
      slash_commands: ['/help', '/clear'],
    });
    await flushAsync();

    expect(vi.mocked(fs.writeFileSync)).toHaveBeenCalled();
  });
});
