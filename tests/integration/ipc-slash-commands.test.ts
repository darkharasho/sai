// @vitest-environment node
/**
 * Integration tests for slash commands via the claude:start IPC handler.
 *
 * Regression: 044bb07 — claude:start must return cached slash commands immediately
 * so the renderer can display them before the persistent process sends its init message.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// ---------------------------------------------------------------------------
// vi.hoisted
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
    pendingToolUse: any | null;
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
      if (!map.has(p)) {
        map.set(p, {
          projectPath: p,
          claudeScopes: new Map([['chat', makeClaude()]]),
        });
      }
      return map.get(p)!;
    },
    get(p: string): Workspace | undefined { return map.get(p); },
    clear() { map.clear(); },
    getClaude,
  };

  return { mockIpcMain, workspaceState };
});

// ---------------------------------------------------------------------------
// Shared mock state for node:fs so tests can control cached commands
// ---------------------------------------------------------------------------
const { fsMock } = vi.hoisted(() => {
  const store = new Map<string, string>();

  const fsMock = {
    store,
    existsSync: vi.fn().mockReturnValue(false),
    readFileSync: vi.fn((p: string) => {
      if (store.has(p)) return store.get(p)!;
      return '[]';
    }),
    writeFileSync: vi.fn((p: string, content: string) => {
      store.set(p, content);
    }),
    readdirSync: vi.fn().mockReturnValue([]),
    mkdirSync: vi.fn(),
  };

  return { fsMock };
});

// ---------------------------------------------------------------------------
// Module mocks
// ---------------------------------------------------------------------------

vi.mock('electron', () => ({
  ipcMain: mockIpcMain,
  app: { getPath: vi.fn().mockReturnValue('/tmp/sai-slash-test') },
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
  default: fsMock,
  existsSync: fsMock.existsSync,
  readFileSync: fsMock.readFileSync,
  writeFileSync: fsMock.writeFileSync,
  readdirSync: fsMock.readdirSync,
  mkdirSync: fsMock.mkdirSync,
}));

vi.mock('node:child_process', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:child_process')>();
  return {
    ...actual,
    spawn: vi.fn(),
    execFile: vi.fn((_c: string, _a: string[], _o: object, cb: (...a: any[]) => void) => {
      process.nextTick(() => cb(null, '', ''));
    }),
  };
});

// ---------------------------------------------------------------------------
// Imports
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
const PROJECT = '/test/slash-project';
const CACHE_PATH = '/tmp/sai-slash-test/slash-commands-cache.json';

beforeEach(() => {
  workspaceState.clear();
  spawnedProcesses = [];
  fsMock.store.clear();
  fsMock.readFileSync.mockImplementation((p: string) => {
    if (fsMock.store.has(p)) return fsMock.store.get(p)!;
    return '[]';
  });
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

describe('IPC slash commands — regression 044bb07', () => {
  it('claude:start returns empty array when no cache exists', async () => {
    const result = await mockIpcMain._invoke('claude:start', PROJECT) as { slashCommands: string[] };
    expect(result).toBeDefined();
    expect(result.slashCommands).toEqual([]);
  });

  it('claude:start returns cached slash commands immediately (without waiting for process)', async () => {
    // Pre-populate cache
    fsMock.store.set(CACHE_PATH, JSON.stringify(['/help', '/clear', '/compact']));

    const result = await mockIpcMain._invoke('claude:start', PROJECT) as { slashCommands: string[] };

    // Must be returned synchronously from cache — no process spawn needed
    expect(spawnedProcesses).toHaveLength(0);
    expect(result.slashCommands).toEqual(['/help', '/clear', '/compact']);
  });

  it('slash commands from process init message update the cache', async () => {
    await mockIpcMain._invoke('claude:start', PROJECT);
    mockIpcMain._emit('claude:send', PROJECT, 'Hello');
    await flushAsync();

    const freshCommands = ['/help', '/new', '/bug', '/feature'];
    pushLines(getLatest(), {
      type: 'system',
      subtype: 'init',
      session_id: 'sess-slash-1',
      slash_commands: freshCommands,
    });
    await flushAsync();

    // writeFileSync should have been called with the new commands
    expect(fsMock.writeFileSync).toHaveBeenCalled();
    const writeCalls = fsMock.writeFileSync.mock.calls;
    const cacheWrite = writeCalls.find(([p]: [string]) => p.includes('slash-commands-cache'));
    expect(cacheWrite).toBeDefined();
    expect(JSON.parse(cacheWrite![1])).toEqual(freshCommands);
  });

  it('subsequent claude:start returns newly cached commands from previous init', async () => {
    // First session: process sends updated commands
    await mockIpcMain._invoke('claude:start', PROJECT);
    mockIpcMain._emit('claude:send', PROJECT, 'Hello');
    await flushAsync();

    const updatedCommands = ['/help', '/updated-cmd'];
    pushLines(getLatest(), {
      type: 'system',
      subtype: 'init',
      session_id: 'sess-refresh',
      slash_commands: updatedCommands,
    });
    await flushAsync();

    // Simulate restart: clear handlers & re-register
    mockIpcMain._handlers.clear();
    mockIpcMain._listeners.clear();
    workspaceState.clear();
    spawnedProcesses = [];
    win = createMockBrowserWindow();
    registerClaudeHandlers(win as any);

    // Second claude:start should return the updated commands (from cache)
    const result = await mockIpcMain._invoke('claude:start', PROJECT) as { slashCommands: string[] };
    expect(result.slashCommands).toEqual(updatedCommands);
  });

  it('init message without slash_commands does not overwrite cache', async () => {
    // Pre-populate cache
    const existing = ['/existing-cmd'];
    fsMock.store.set(CACHE_PATH, JSON.stringify(existing));

    await mockIpcMain._invoke('claude:start', PROJECT);
    mockIpcMain._emit('claude:send', PROJECT, 'Hi');
    await flushAsync();

    // Init without slash_commands field
    pushLines(getLatest(), {
      type: 'system',
      subtype: 'init',
      session_id: 'sess-no-cmds',
      // No slash_commands property
    });
    await flushAsync();

    // writeFileSync should NOT have been called (no slash_commands to write)
    const cacheWrites = fsMock.writeFileSync.mock.calls.filter(
      ([p]: [string]) => p.includes('slash-commands-cache'),
    );
    expect(cacheWrites).toHaveLength(0);
  });

  it('claude:start emits ready message to renderer', async () => {
    await mockIpcMain._invoke('claude:start', PROJECT);

    const msgs = sentMessages(win);
    const readyMsg = msgs.find(m => m.type === 'ready');
    expect(readyMsg).toBeDefined();
    expect(readyMsg?.projectPath).toBe(PROJECT);
  });

  it('claude:start with no cwd returns undefined without crashing', async () => {
    const result = await mockIpcMain._invoke('claude:start', '');
    expect(result).toBeUndefined();
  });

  it('empty slash_commands array is cached correctly', async () => {
    await mockIpcMain._invoke('claude:start', PROJECT);
    mockIpcMain._emit('claude:send', PROJECT, 'Hi');
    await flushAsync();

    pushLines(getLatest(), {
      type: 'system',
      subtype: 'init',
      session_id: 'sess-empty',
      slash_commands: [],
    });
    await flushAsync();

    const cacheWrites = fsMock.writeFileSync.mock.calls.filter(
      ([p]: [string]) => p.includes('slash-commands-cache'),
    );
    expect(cacheWrites).toHaveLength(1);
    expect(JSON.parse(cacheWrites[0][1])).toEqual([]);
  });
});
