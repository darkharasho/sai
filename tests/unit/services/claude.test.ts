// @vitest-environment node
/**
 * Unit tests for electron/services/claude.ts
 *
 * Design notes:
 * - @vitest-environment node: required so vi.mock('node:child_process') applies
 *   to modules loaded via the @electron alias (jsdom env doesn't mock node builtins
 *   for aliased modules).
 * - vi.hoisted() creates stable objects that vi.mock factories close over. These
 *   objects must NOT be mutated in tests if the factory uses them — instead we
 *   use vi.mocked(spawn).mockImplementation() directly in tests.
 * - The mockIpcMain and workspaceState are created via vi.hoisted() and shared
 *   between mock factories and test code safely because they're closed over by
 *   reference.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// ---------------------------------------------------------------------------
// vi.hoisted — shared objects created before vi.mock factories execute
// ---------------------------------------------------------------------------
const {
  mockIpcMain,
  workspaceState,
  mockEnsureGeminiTransport,
  mockEnsureGeminiCommitSession,
  mockPromptGeminiText,
} = vi.hoisted(() => {
  // ---- Minimal IPC main mock ----
  type IpcHandler = (...args: unknown[]) => unknown;
  type IpcListener = (...args: unknown[]) => void;

  const handlers = new Map<string, IpcHandler>();
  const listeners = new Map<string, IpcListener[]>();

  const handle = vi.fn((channel: string, fn: IpcHandler) => {
    handlers.set(channel, fn);
  });
  const on = vi.fn((channel: string, fn: IpcListener) => {
    const existing = listeners.get(channel) ?? [];
    listeners.set(channel, [...existing, fn]);
  });
  const removeHandler = vi.fn((channel: string) => handlers.delete(channel));

  const mockIpcMain = {
    _handlers: handlers,
    _listeners: listeners,
    handle,
    on,
    removeHandler,
    async _invoke(channel: string, ...args: unknown[]): Promise<unknown> {
      const fn = handlers.get(channel);
      if (!fn) throw new Error(`No handler for "${channel}"`);
      return fn({ sender: {} } as unknown, ...args);
    },
    _emit(channel: string, ...args: unknown[]): void {
      for (const fn of listeners.get(channel) ?? []) {
        fn({ sender: {} } as unknown, ...args);
      }
    },
  };

  // ---- Workspace state map ----
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

  type Workspace = {
    projectPath: string;
    claudeScopes: Map<string, WorkspaceClaude>;
    gemini: {
      cwd: string;
    };
  };

  const map = new Map<string, Workspace>();

  function makeClaude(): WorkspaceClaude {
    return {
      process: null,
      sessionId: undefined,
      buffer: '',
      cwd: '',
      processConfig: null,
      busy: false,
      suppressForward: false,
      pendingToolUse: null,
      approvalBuffered: [],
      awaitingApproval: false,
    };
  }

  function getClaude(ws: Workspace, scope: string = 'chat'): WorkspaceClaude {
    let c = ws.claudeScopes.get(scope);
    if (!c) {
      c = makeClaude();
      ws.claudeScopes.set(scope, c);
    }
    return c;
  }

  const workspaceState = {
    map,
    getOrCreate(projectPath: string): Workspace {
      if (!map.has(projectPath)) {
        map.set(projectPath, {
          projectPath,
          claudeScopes: new Map([['chat', makeClaude()]]),
          gemini: { cwd: projectPath },
        });
      }
      return map.get(projectPath)!;
    },
    get(projectPath: string): Workspace | undefined {
      return map.get(projectPath);
    },
    clear() {
      map.clear();
    },
    makeClaude,
    getClaude,
  };

  return {
    mockIpcMain,
    workspaceState,
    mockEnsureGeminiTransport: vi.fn().mockResolvedValue(undefined),
    mockEnsureGeminiCommitSession: vi.fn().mockResolvedValue('gemini-commit-session'),
    mockPromptGeminiText: vi.fn().mockResolvedValue('gemini commit message'),
  };
});

// ---------------------------------------------------------------------------
// Module mocks
// ---------------------------------------------------------------------------

vi.mock('electron', () => ({
  ipcMain: mockIpcMain,
  app: {
    getPath: vi.fn().mockReturnValue('/tmp/sai-test-userdata'),
  },
  BrowserWindow: vi.fn(),
}));

vi.mock('@electron/services/workspace', () => ({
  getOrCreate: vi.fn((p: string) => workspaceState.getOrCreate(p)),
  get: vi.fn((p: string) => workspaceState.get(p)),
  getClaude: vi.fn((ws: any, scope?: string) => workspaceState.getClaude(ws, scope)),
  touchActivity: vi.fn(),
}));

vi.mock('@electron/services/notify', () => ({
  notifyCompletion: vi.fn(),
}));

vi.mock('@electron/services/gemini', () => ({
  ensureGeminiTransport: mockEnsureGeminiTransport,
  ensureGeminiCommitSession: mockEnsureGeminiCommitSession,
  promptGeminiText: mockPromptGeminiText,
}));

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
    spawn: vi.fn(), // Implementation set per-test via vi.mocked(spawn).mockImplementation(...)
    execFile: vi.fn(
      (_cmd: string, _args: string[], _opts: object, cb: (...a: any[]) => void) => {
        process.nextTick(() => cb(null, 'mock-output', ''));
      },
    ),
  };
});

// ---------------------------------------------------------------------------
// Imports (after vi.mock declarations)
// ---------------------------------------------------------------------------
import { spawn } from 'node:child_process';
import { createMockBrowserWindow } from '../../helpers/electron-mock';
import { MockChildProcess } from '../../helpers/process-mock';
import { registerClaudeHandlers } from '@electron/services/claude';

// ---------------------------------------------------------------------------
// Per-test process registry
// ---------------------------------------------------------------------------
let spawnedProcesses: MockChildProcess[] = [];

function getLatestProcess(): MockChildProcess {
  if (spawnedProcesses.length === 0) throw new Error('No processes spawned yet');
  return spawnedProcesses[spawnedProcesses.length - 1];
}

/** Default spawn implementation: creates a MockChildProcess and registers it. */
function defaultSpawnImpl(_cmd: string, _args?: string[], _opts?: object): MockChildProcess {
  const proc = new MockChildProcess();
  spawnedProcesses.push(proc);
  return proc as any;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function pushLines(proc: MockChildProcess, ...jsons: object[]): void {
  for (const obj of jsons) {
    proc.pushStdout(JSON.stringify(obj) + '\n');
  }
}

function sentMessages(win: ReturnType<typeof createMockBrowserWindow>) {
  return (win.webContents.send as ReturnType<typeof vi.fn>).mock.calls
    .filter(([ch]: [string]) => ch === 'claude:message')
    .map(([, msg]: [string, any]) => msg);
}

async function flushAsync(): Promise<void> {
  await new Promise((r) => setTimeout(r, 0));
  await new Promise((r) => setTimeout(r, 0));
}

// ---------------------------------------------------------------------------
// Test setup / teardown
// ---------------------------------------------------------------------------

let win: ReturnType<typeof createMockBrowserWindow>;

beforeEach(() => {
  workspaceState.clear();
  spawnedProcesses = [];

  // Set default spawn implementation via vi.mocked
  vi.mocked(spawn).mockImplementation(defaultSpawnImpl as any);

  win = createMockBrowserWindow();
  mockEnsureGeminiTransport.mockResolvedValue(undefined);
  mockEnsureGeminiCommitSession.mockResolvedValue('gemini-commit-session');
  mockPromptGeminiText.mockResolvedValue('gemini commit message');

  // Reset ipcMain mock state and re-register handlers
  mockIpcMain._handlers.clear();
  mockIpcMain._listeners.clear();
  (mockIpcMain.handle as ReturnType<typeof vi.fn>).mockClear();
  (mockIpcMain.on as ReturnType<typeof vi.fn>).mockClear();

  registerClaudeHandlers(win as any);
});

afterEach(() => {
  vi.clearAllMocks();
  // Restore default spawn impl (clearAllMocks resets the vi.fn() implementation)
  vi.mocked(spawn).mockImplementation(defaultSpawnImpl as any);
});

// ===========================================================================
// buildArgs — tested by observing spawn call arguments
// ===========================================================================

describe('buildArgs (via ensureProcess, observed from spawn calls)', () => {
  const PROJECT = '/test/project';

  async function sendAndGetArgs(opts: {
    permMode?: string;
    effort?: string;
    model?: string;
  } = {}): Promise<string[]> {
    workspaceState.getOrCreate(PROJECT).claudeScopes.get('chat')!.cwd = PROJECT;
    mockIpcMain._emit('claude:send', PROJECT, 'hello', [], opts.permMode, opts.effort, opts.model);
    await flushAsync();

    const spawnMock = vi.mocked(spawn);
    const claudeCall = spawnMock.mock.calls.find(([cmd]) => cmd === 'claude');
    expect(claudeCall).toBeDefined();
    return claudeCall![1] as string[];
  }

  it('always includes stream-json flags', async () => {
    const args = await sendAndGetArgs();
    expect(args).toContain('--input-format');
    expect(args).toContain('stream-json');
    expect(args).toContain('--output-format');
    expect(args).toContain('stream-json');
    expect(args).toContain('--verbose');
    expect(args).toContain('--include-partial-messages');
  });

  it('defaults to acceptEdits permission mode', async () => {
    const args = await sendAndGetArgs();
    const idx = args.indexOf('--permission-mode');
    expect(idx).toBeGreaterThan(-1);
    expect(args[idx + 1]).toBe('acceptEdits');
  });

  it('uses bypassPermissions when permMode is "bypass"', async () => {
    const args = await sendAndGetArgs({ permMode: 'bypass' });
    expect(args[args.indexOf('--permission-mode') + 1]).toBe('bypassPermissions');
  });

  it.each(['low', 'medium', 'high', 'max'])('adds --effort flag for effort=%s', async (effort) => {
    workspaceState.clear();
    spawnedProcesses = [];
    vi.mocked(spawn).mockClear();
    const args = await sendAndGetArgs({ effort });
    expect(args).toContain('--effort');
    expect(args[args.indexOf('--effort') + 1]).toBe(effort);
  });

  it('does not add --effort for unknown values', async () => {
    const args = await sendAndGetArgs({ effort: 'turbo' });
    expect(args).not.toContain('--effort');
  });

  it('adds --model when model is specified', async () => {
    const args = await sendAndGetArgs({ model: 'claude-opus-4' });
    expect(args).toContain('--model');
    expect(args[args.indexOf('--model') + 1]).toBe('claude-opus-4');
  });

  it('omits --model when not specified', async () => {
    const args = await sendAndGetArgs();
    expect(args).not.toContain('--model');
  });

  it('adds --resume flag when session_id is already cached', async () => {
    const ws = workspaceState.getOrCreate(PROJECT);
    ws.claudeScopes.get('chat')!.sessionId = 'existing-session-123';
    const args = await sendAndGetArgs();
    expect(args).toContain('--resume');
    expect(args[args.indexOf('--resume') + 1]).toBe('existing-session-123');
  });
});

// ===========================================================================
// NDJSON parsing
// ===========================================================================

describe('NDJSON parsing', () => {
  const PROJECT = '/ndjson/project';

  beforeEach(async () => {
    workspaceState.getOrCreate(PROJECT).claudeScopes.get('chat')!.cwd = PROJECT;
    mockIpcMain._emit('claude:send', PROJECT, 'hello', []);
    await flushAsync();
  });

  it('parses a complete NDJSON line and forwards to renderer', async () => {
    const proc = getLatestProcess();
    pushLines(proc, { type: 'assistant', message: { content: [] } });
    await flushAsync();
    expect(sentMessages(win).some((m) => m.type === 'assistant')).toBe(true);
  });

  it('handles partial lines — buffers until newline arrives', async () => {
    const proc = getLatestProcess();
    const full = JSON.stringify({ type: 'assistant', message: { content: [] } });

    proc.pushStdout(full.slice(0, 20));
    await flushAsync();
    const before = sentMessages(win).filter((m) => m.type === 'assistant').length;

    proc.pushStdout(full.slice(20) + '\n');
    await flushAsync();
    const after = sentMessages(win).filter((m) => m.type === 'assistant').length;
    expect(after).toBeGreaterThan(before);
  });

  it('silently ignores malformed JSON lines without stopping valid messages', async () => {
    const proc = getLatestProcess();
    proc.pushStdout('NOT_JSON_AT_ALL\n');
    pushLines(proc, { type: 'assistant', message: { content: [] } });
    await flushAsync();
    expect(sentMessages(win).some((m) => m.type === 'assistant')).toBe(true);
  });

  it('extracts and caches session_id from first message', async () => {
    const proc = getLatestProcess();
    pushLines(proc, { type: 'system', subtype: 'init', session_id: 'sess-abc' });
    await flushAsync();
    expect(workspaceState.get(PROJECT)!.claudeScopes.get('chat')!.sessionId).toBe('sess-abc');
  });

  it('does not overwrite session_id once set', async () => {
    const ws = workspaceState.get(PROJECT)!;
    ws.claudeScopes.get('chat')!.sessionId = 'original-session';
    const proc = getLatestProcess();
    pushLines(proc, { type: 'system', subtype: 'init', session_id: 'new-session' });
    await flushAsync();
    expect(ws.claudeScopes.get('chat')!.sessionId).toBe('original-session');
  });

  it('sends session_id message to renderer when first captured', async () => {
    const proc = getLatestProcess();
    pushLines(proc, { type: 'system', subtype: 'init', session_id: 'sess-xyz' });
    await flushAsync();
    const sessionMsg = sentMessages(win).find((m) => m.type === 'session_id');
    expect(sessionMsg?.sessionId).toBe('sess-xyz');
  });

  it('flushes buffered remainder on process exit', async () => {
    const proc = getLatestProcess();
    const ws = workspaceState.get(PROJECT)!;
    ws.claudeScopes.get('chat')!.buffer = JSON.stringify({ type: 'assistant', message: { content: [] } });
    proc.emitExit(0);
    await flushAsync();
    expect(sentMessages(win).some((m) => m.type === 'assistant')).toBe(true);
  });
});

// ===========================================================================
// Session management
// ===========================================================================

describe('Session management', () => {
  const PROJECT = '/session/project';

  it('caches session_id and passes --resume on subsequent spawns', async () => {
    const ws = workspaceState.getOrCreate(PROJECT);
    ws.claudeScopes.get('chat')!.cwd = PROJECT;

    mockIpcMain._emit('claude:send', PROJECT, 'msg1', []);
    await flushAsync();

    const proc1 = getLatestProcess();
    pushLines(proc1, { session_id: 'sess-cached', type: 'system', subtype: 'init' });
    await flushAsync();

    expect(ws.claudeScopes.get('chat')!.sessionId).toBe('sess-cached');

    // Force respawn by clearing process state
    ws.claudeScopes.get('chat')!.process = null;
    ws.claudeScopes.get('chat')!.processConfig = null;

    vi.mocked(spawn).mockClear();
    mockIpcMain._emit('claude:send', PROJECT, 'msg2', [], 'bypass');
    await flushAsync();

    const allCalls = vi.mocked(spawn).mock.calls;
    const claudeCall = allCalls.find(([cmd]) => cmd === 'claude');
    expect(claudeCall).toBeDefined();
    const lastArgs = claudeCall![1] as string[];
    expect(lastArgs).toContain('--resume');
    expect(lastArgs[lastArgs.indexOf('--resume') + 1]).toBe('sess-cached');
  });

  it('respawns process when config changes', async () => {
    const ws = workspaceState.getOrCreate(PROJECT);
    ws.claudeScopes.get('chat')!.cwd = PROJECT;

    mockIpcMain._emit('claude:send', PROJECT, 'msg1', [], undefined, 'low');
    await flushAsync();
    const count1 = spawnedProcesses.length;

    mockIpcMain._emit('claude:send', PROJECT, 'msg2', [], undefined, 'high');
    await flushAsync();
    expect(spawnedProcesses.length).toBeGreaterThan(count1);
  });

  it('reuses process when config unchanged', async () => {
    const ws = workspaceState.getOrCreate(PROJECT);
    ws.claudeScopes.get('chat')!.cwd = PROJECT;

    mockIpcMain._emit('claude:send', PROJECT, 'msg1', [], undefined, 'low');
    await flushAsync();
    const count1 = spawnedProcesses.length;

    mockIpcMain._emit('claude:send', PROJECT, 'msg2', [], undefined, 'low');
    await flushAsync();
    expect(spawnedProcesses.length).toBe(count1);
  });

  it('claude:setSessionId kills process and stores new session_id', async () => {
    const ws = workspaceState.getOrCreate(PROJECT);
    ws.claudeScopes.get('chat')!.cwd = PROJECT;

    mockIpcMain._emit('claude:send', PROJECT, 'hi', []);
    await flushAsync();
    const proc = getLatestProcess();

    mockIpcMain._emit('claude:setSessionId', PROJECT, 'new-session-id');
    await flushAsync();

    expect(proc.kill).toHaveBeenCalled();
    expect(ws.claudeScopes.get('chat')!.sessionId).toBe('new-session-id');
    expect(ws.claudeScopes.get('chat')!.process).toBeNull();
  });

  it('claude:setSessionId can clear session_id with undefined', async () => {
    const ws = workspaceState.getOrCreate(PROJECT);
    ws.claudeScopes.get('chat')!.sessionId = 'existing';
    mockIpcMain._emit('claude:setSessionId', PROJECT, undefined);
    await flushAsync();
    expect(ws.claudeScopes.get('chat')!.sessionId).toBeUndefined();
  });
});

// ===========================================================================
// claude:start handler
// ===========================================================================

describe('claude:start handler', () => {
  it('sends ready message and returns cached slash commands', async () => {
    const result = await mockIpcMain._invoke('claude:start', '/my/project');
    expect(win.webContents.send).toHaveBeenCalledWith(
      'claude:message',
      expect.objectContaining({ type: 'ready' }),
    );
    expect((result as any).slashCommands).toBeDefined();
  });

  it('sets cwd on the workspace', async () => {
    await mockIpcMain._invoke('claude:start', '/start/project');
    expect(workspaceState.get('/start/project')?.claudeScopes.get('chat')!.cwd).toBe('/start/project');
  });

  it('returns early when cwd is empty', async () => {
    const result = await mockIpcMain._invoke('claude:start', '');
    expect(result).toBeUndefined();
  });
});

// ===========================================================================
// claude:stop handler
// ===========================================================================

describe('claude:stop handler', () => {
  const PROJECT = '/stop/project';

  async function startProcess() {
    const ws = workspaceState.getOrCreate(PROJECT);
    ws.claudeScopes.get('chat')!.cwd = PROJECT;
    mockIpcMain._emit('claude:send', PROJECT, 'hi', []);
    await flushAsync();
    return { ws, proc: getLatestProcess() };
  }

  it('kills the running process and sends done', async () => {
    const { ws, proc } = await startProcess();
    mockIpcMain._emit('claude:stop', PROJECT);
    await flushAsync();

    expect(proc.kill).toHaveBeenCalled();
    expect(sentMessages(win).some((m) => m.type === 'done')).toBe(true);
    expect(ws.claudeScopes.get('chat')!.process).toBeNull();
    expect(ws.claudeScopes.get('chat')!.busy).toBe(false);
    expect(ws.claudeScopes.get('chat')!.awaitingApproval).toBe(false);
  });

  it('clears all approval state on stop', async () => {
    const { ws } = await startProcess();
    ws.claudeScopes.get('chat')!.awaitingApproval = true;
    ws.claudeScopes.get('chat')!.approvalBuffered = [{ type: 'assistant' }];
    ws.claudeScopes.get('chat')!.pendingToolUse = { toolName: 'Bash', toolUseId: 'tu1', input: {} };

    mockIpcMain._emit('claude:stop', PROJECT);
    await flushAsync();

    expect(ws.claudeScopes.get('chat')!.awaitingApproval).toBe(false);
    expect(ws.claudeScopes.get('chat')!.approvalBuffered).toHaveLength(0);
    expect(ws.claudeScopes.get('chat')!.pendingToolUse).toBeNull();
  });
});

// ===========================================================================
// Approval flow state machine
// ===========================================================================

describe('Approval flow', () => {
  const PROJECT = '/approval/project';

  async function startProcess() {
    const ws = workspaceState.getOrCreate(PROJECT);
    ws.claudeScopes.get('chat')!.cwd = PROJECT;
    mockIpcMain._emit('claude:send', PROJECT, 'do something', []);
    await flushAsync();
    return { ws, proc: getLatestProcess() };
  }

  it('detects tool_use in assistant message and stores pendingToolUse', async () => {
    const { ws, proc } = await startProcess();
    pushLines(proc, {
      type: 'assistant',
      message: {
        content: [
          { type: 'tool_use', id: 'tu-001', name: 'Bash', input: { command: 'rm -rf /tmp/test' } },
        ],
      },
    });
    await flushAsync();

    expect(ws.claudeScopes.get('chat')!.pendingToolUse).toMatchObject({
      toolName: 'Bash',
      toolUseId: 'tu-001',
      input: { command: 'rm -rf /tmp/test' },
    });
  });

  it('transitions to awaitingApproval on CLI denial and sends approval_needed', async () => {
    const { ws, proc } = await startProcess();

    // 1. Assistant announces a tool_use
    pushLines(proc, {
      type: 'assistant',
      message: {
        content: [{ type: 'tool_use', id: 'tu-002', name: 'Bash', input: { command: 'ls /etc' } }],
      },
    });
    await flushAsync();

    // 2. CLI denies it — use the exact denial phrase from claude.ts
    pushLines(proc, {
      type: 'user',
      message: {
        content: [{
          type: 'tool_result',
          tool_use_id: 'tu-002',
          is_error: true,
          content: "This tool haven't granted permission for this operation",
        }],
      },
    });
    await flushAsync();

    expect(ws.claudeScopes.get('chat')!.awaitingApproval).toBe(true);
    const approvalMsg = sentMessages(win).find((m) => m.type === 'approval_needed');
    expect(approvalMsg).toBeDefined();
    expect(approvalMsg?.toolName).toBe('Bash');
    expect(approvalMsg?.toolUseId).toBe('tu-002');
  });

  it('detects "requested permissions" denial pattern', async () => {
    const { ws, proc } = await startProcess();
    ws.claudeScopes.get('chat')!.pendingToolUse = { toolName: 'Bash', toolUseId: 'tu-req', input: { command: 'whoami' } };

    pushLines(proc, {
      type: 'user',
      message: {
        content: [{
          type: 'tool_result',
          is_error: true,
          content: 'Tool requested permissions that were not granted',
        }],
      },
    });
    await flushAsync();
    expect(ws.claudeScopes.get('chat')!.awaitingApproval).toBe(true);
  });

  it('detects "was blocked" denial pattern', async () => {
    const { ws, proc } = await startProcess();
    ws.claudeScopes.get('chat')!.pendingToolUse = { toolName: 'Bash', toolUseId: 'tu-blk', input: { command: 'cat /etc/passwd' } };

    pushLines(proc, {
      type: 'user',
      message: {
        content: [{
          type: 'tool_result',
          is_error: true,
          content: 'This operation was blocked by security policy',
        }],
      },
    });
    await flushAsync();
    expect(ws.claudeScopes.get('chat')!.awaitingApproval).toBe(true);
  });

  it('buffers messages arriving while awaitingApproval without forwarding them', async () => {
    const { ws, proc } = await startProcess();
    ws.claudeScopes.get('chat')!.pendingToolUse = { toolName: 'Bash', toolUseId: 'tu-buf', input: { command: 'echo hi' } };

    pushLines(proc, {
      type: 'user',
      message: {
        content: [{ type: 'tool_result', is_error: true, content: 'requested permissions not granted' }],
      },
    });
    await flushAsync();
    expect(ws.claudeScopes.get('chat')!.awaitingApproval).toBe(true);

    const sendCountBefore = (win.webContents.send as ReturnType<typeof vi.fn>).mock.calls.length;

    pushLines(proc, { type: 'assistant', message: { content: [{ type: 'text', text: 'buffered' }] } });
    await flushAsync();

    const newMsgs = (win.webContents.send as ReturnType<typeof vi.fn>).mock.calls
      .slice(sendCountBefore)
      .map(([, m]: [string, any]) => m)
      .filter((m: any) => m?.type === 'assistant');

    expect(newMsgs).toHaveLength(0);
    expect(ws.claudeScopes.get('chat')!.approvalBuffered).toHaveLength(1);
  });

  it('deny path: flushes buffered messages to renderer and clears state', async () => {
    const { ws } = await startProcess();
    ws.claudeScopes.get('chat')!.awaitingApproval = true;
    ws.claudeScopes.get('chat')!.pendingToolUse = { toolName: 'Bash', toolUseId: 'tu-deny', input: { command: 'ls' } };
    ws.claudeScopes.get('chat')!.approvalBuffered = [
      { type: 'assistant', message: { content: [] } },
      { type: 'result', duration_ms: 1000 },
    ];

    await mockIpcMain._invoke('claude:approve', PROJECT, 'tu-deny', false);
    await flushAsync();

    const msgs = sentMessages(win);
    expect(msgs.some((m) => m.type === 'assistant')).toBe(true);
    expect(msgs.some((m) => m.type === 'done')).toBe(true);
    expect(ws.claudeScopes.get('chat')!.awaitingApproval).toBe(false);
    expect(ws.claudeScopes.get('chat')!.approvalBuffered).toHaveLength(0);
    expect(ws.claudeScopes.get('chat')!.pendingToolUse).toBeNull();
  });

  it('deny path: sets busy=false when result is in buffered messages', async () => {
    const { ws } = await startProcess();
    ws.claudeScopes.get('chat')!.awaitingApproval = true;
    ws.claudeScopes.get('chat')!.busy = true;
    ws.claudeScopes.get('chat')!.pendingToolUse = { toolName: 'Bash', toolUseId: 'tu-deny2', input: { command: 'ls' } };
    ws.claudeScopes.get('chat')!.approvalBuffered = [{ type: 'result', duration_ms: 500 }];

    await mockIpcMain._invoke('claude:approve', PROJECT, 'tu-deny2', false);
    await flushAsync();
    expect(ws.claudeScopes.get('chat')!.busy).toBe(false);
  });

  it('approve path (Read): clears state, reports error for nonexistent file', async () => {
    const { ws } = await startProcess();
    ws.claudeScopes.get('chat')!.awaitingApproval = true;
    ws.claudeScopes.get('chat')!.pendingToolUse = {
      toolName: 'Read',
      toolUseId: 'tu-read',
      input: { file_path: '/tmp/nonexistent-file-sai-test.txt' },
    };
    ws.claudeScopes.get('chat')!.approvalBuffered = [];

    const result = await mockIpcMain._invoke('claude:approve', PROJECT, 'tu-read', true) as any;
    await flushAsync();

    expect(ws.claudeScopes.get('chat')!.awaitingApproval).toBe(false);
    expect(ws.claudeScopes.get('chat')!.pendingToolUse).toBeNull();
    expect(ws.claudeScopes.get('chat')!.approvalBuffered).toHaveLength(0);
    expect(result?.isError).toBe(true);
  });

  it('approve path: discards buffered denial response', async () => {
    const { ws } = await startProcess();
    ws.claudeScopes.get('chat')!.awaitingApproval = true;
    ws.claudeScopes.get('chat')!.pendingToolUse = {
      toolName: 'Read',
      toolUseId: 'tu-read2',
      input: { file_path: '/tmp/gone.txt' },
    };
    ws.claudeScopes.get('chat')!.approvalBuffered = [
      { type: 'assistant', message: { content: [{ type: 'text', text: 'I cannot do that' }] } },
    ];

    await mockIpcMain._invoke('claude:approve', PROJECT, 'tu-read2', true);
    await flushAsync();
    expect(ws.claudeScopes.get('chat')!.approvalBuffered).toHaveLength(0);
  });

  it('regression 4a11646: approval state does not leak between turns', async () => {
    const { ws, proc } = await startProcess();

    // Turn 1: user denies
    ws.claudeScopes.get('chat')!.pendingToolUse = { toolName: 'Bash', toolUseId: 'tu-leak1', input: { command: 'ls' } };
    ws.claudeScopes.get('chat')!.awaitingApproval = true;
    ws.claudeScopes.get('chat')!.approvalBuffered = [{ type: 'assistant', message: { content: [] } }];

    await mockIpcMain._invoke('claude:approve', PROJECT, 'tu-leak1', false);
    await flushAsync();

    expect(ws.claudeScopes.get('chat')!.awaitingApproval).toBe(false);
    expect(ws.claudeScopes.get('chat')!.approvalBuffered).toHaveLength(0);
    expect(ws.claudeScopes.get('chat')!.pendingToolUse).toBeNull();

    // Turn 2: new tool_use should be independent
    pushLines(proc, {
      type: 'assistant',
      message: {
        content: [{ type: 'tool_use', id: 'tu-leak2', name: 'Write', input: { file_path: '/tmp/x' } }],
      },
    });
    await flushAsync();

    expect(ws.claudeScopes.get('chat')!.pendingToolUse?.toolUseId).toBe('tu-leak2');
    expect(ws.claudeScopes.get('chat')!.awaitingApproval).toBe(false);
  });

  it('does nothing when approve is called with no pending tool use', async () => {
    const { ws } = await startProcess();
    ws.claudeScopes.get('chat')!.awaitingApproval = false;
    ws.claudeScopes.get('chat')!.pendingToolUse = null;

    const before = (win.webContents.send as ReturnType<typeof vi.fn>).mock.calls.length;
    await mockIpcMain._invoke('claude:approve', PROJECT, 'tu-none', true);
    const after = (win.webContents.send as ReturnType<typeof vi.fn>).mock.calls.length;
    expect(after).toBe(before);
  });
});

// ===========================================================================
// Streaming state regression tests
// ===========================================================================

describe('Streaming state (regression tests)', () => {
  const PROJECT = '/streaming/project';

  async function startProcess() {
    const ws = workspaceState.getOrCreate(PROJECT);
    ws.claudeScopes.get('chat')!.cwd = PROJECT;
    mockIpcMain._emit('claude:send', PROJECT, 'do work', []);
    await flushAsync();
    return { ws, proc: getLatestProcess() };
  }

  it('regression e96d1c1: busy resets to false when result message arrives', async () => {
    const { ws, proc } = await startProcess();
    expect(ws.claudeScopes.get('chat')!.busy).toBe(true);

    pushLines(proc, { type: 'result', duration_ms: 500, num_turns: 1, total_cost_usd: 0.001, result: 'done' });
    await flushAsync();

    expect(ws.claudeScopes.get('chat')!.busy).toBe(false);
  });

  it('regression f476162: no false positive done during active stream', async () => {
    const { ws, proc } = await startProcess();

    pushLines(proc,
      { type: 'assistant', message: { content: [{ type: 'text', text: 'thinking...' }] } },
      { type: 'assistant', message: { content: [{ type: 'text', text: 'still working...' }] } },
    );
    await flushAsync();

    expect(sentMessages(win).filter((m) => m.type === 'done')).toHaveLength(0);
    expect(ws.claudeScopes.get('chat')!.busy).toBe(true);
  });

  it('regression f476162: done is sent exactly once after result message', async () => {
    const { ws, proc } = await startProcess();

    pushLines(proc,
      { type: 'assistant', message: { content: [{ type: 'text', text: 'response' }] } },
      { type: 'result', duration_ms: 800 },
    );
    await flushAsync();

    expect(sentMessages(win).filter((m) => m.type === 'done')).toHaveLength(1);
  });

  it('regression fbb9a5d: thinking animation — assistant messages forwarded while streaming', async () => {
    const { ws, proc } = await startProcess();

    pushLines(proc, {
      type: 'assistant',
      message: {
        content: [
          { type: 'thinking', thinking: 'internal reasoning' },
          { type: 'text', text: 'partial response' },
        ],
      },
    });
    await flushAsync();

    expect(sentMessages(win).filter((m) => m.type === 'assistant')).toHaveLength(1);
    expect(ws.claudeScopes.get('chat')!.busy).toBe(true);
  });

  it('regression dd4d6a0: process exit clears all state', async () => {
    const { ws, proc } = await startProcess();
    ws.claudeScopes.get('chat')!.awaitingApproval = true;
    ws.claudeScopes.get('chat')!.approvalBuffered = [{ type: 'assistant' }];
    ws.claudeScopes.get('chat')!.pendingToolUse = { toolName: 'Bash', toolUseId: 'tu-x', input: {} };

    proc.emitExit(0);
    await flushAsync();

    expect(ws.claudeScopes.get('chat')!.busy).toBe(false);
    expect(ws.claudeScopes.get('chat')!.awaitingApproval).toBe(false);
    expect(ws.claudeScopes.get('chat')!.approvalBuffered).toHaveLength(0);
    expect(ws.claudeScopes.get('chat')!.pendingToolUse).toBeNull();
    expect(ws.claudeScopes.get('chat')!.process).toBeNull();
    expect(ws.claudeScopes.get('chat')!.suppressForward).toBe(false);
  });

  it('regression dd4d6a0: process error event clears all state', async () => {
    const { ws, proc } = await startProcess();
    ws.claudeScopes.get('chat')!.awaitingApproval = true;
    ws.claudeScopes.get('chat')!.approvalBuffered = [{ type: 'assistant' }];
    ws.claudeScopes.get('chat')!.pendingToolUse = { toolName: 'Bash', toolUseId: 'tu-y', input: {} };

    proc.emit('error', new Error('spawn ENOENT'));
    await flushAsync();

    expect(ws.claudeScopes.get('chat')!.busy).toBe(false);
    expect(ws.claudeScopes.get('chat')!.awaitingApproval).toBe(false);
    expect(ws.claudeScopes.get('chat')!.approvalBuffered).toHaveLength(0);
    expect(ws.claudeScopes.get('chat')!.pendingToolUse).toBeNull();
    expect(ws.claudeScopes.get('chat')!.process).toBeNull();
    expect(ws.claudeScopes.get('chat')!.suppressForward).toBe(false);

    const msgs = sentMessages(win);
    expect(msgs.some((m) => m.type === 'error')).toBe(true);
    expect(msgs.some((m) => m.type === 'done')).toBe(true);
  });

  it('sends streaming_start immediately when claude:send is called', async () => {
    await startProcess();
    expect(sentMessages(win).some((m) => m.type === 'streaming_start')).toBe(true);
  });

  it('does not forward messages from a replaced (stale) process', async () => {
    const { ws, proc: oldProc } = await startProcess();

    // Simulate process replacement
    const fakeNewProc = new MockChildProcess();
    ws.claudeScopes.get('chat')!.process = fakeNewProc as any;

    const sendCountBefore = (win.webContents.send as ReturnType<typeof vi.fn>).mock.calls.length;

    pushLines(oldProc, { type: 'assistant', message: { content: [] } });
    await flushAsync();

    const newMsgs = (win.webContents.send as ReturnType<typeof vi.fn>).mock.calls
      .slice(sendCountBefore)
      .map(([, m]: [string, any]) => m)
      .filter((m: any) => m?.type === 'assistant');

    expect(newMsgs).toHaveLength(0);
  });

  it('result message sends both result and done payloads to renderer', async () => {
    const { ws, proc } = await startProcess();
    pushLines(proc, { type: 'result', duration_ms: 500 });
    await flushAsync();

    const msgs = sentMessages(win);
    expect(msgs.some((m) => m.type === 'result')).toBe(true);
    expect(msgs.some((m) => m.type === 'done')).toBe(true);
  });
});

// ===========================================================================
// Commit message generation
// ===========================================================================

describe('claude:generateCommitMessage', () => {
  /**
   * Set up vi.mocked(spawn) to simulate git diff + commit tool output.
   * Uses setImmediate (macrotask) instead of process.nextTick to avoid
   * ordering issues with Readable stream flowing mode.
   */
  function mockSpawnForCommit(opts: {
    stagedDiff?: string;
    unstagedDiff?: string;
    commitOutput?: string;
    captureCmd?: (cmd: string, args: string[]) => void;
  }) {
    vi.mocked(spawn).mockImplementation((_cmd: string, _args?: any, _opts?: any) => {
      const proc = new MockChildProcess();
      const cmd = _cmd as string;
      const args = (_args as string[]) || [];

      if (cmd === 'git') {
        setImmediate(() => {
          const isStaged = args.includes('--staged');
          const diff = isStaged
            ? (opts.stagedDiff ?? 'diff --git a/f b/f\n+change\n')
            : (opts.unstagedDiff ?? '');
          if (diff) proc.pushStdout(diff);
          proc.emitExit(0);
        });
      } else {
        if (opts.captureCmd) opts.captureCmd(cmd, args);
        setImmediate(() => {
          proc.pushStdout(opts.commitOutput ?? 'feat: mock commit\n');
          proc.emitExit(0);
        });
      }
      return proc as any;
    });
  }

  it('spawns claude with haiku model and text output-format by default', async () => {
    let capturedCmd = '';
    let capturedArgs: string[] = [];
    mockSpawnForCommit({
      captureCmd: (cmd, args) => { capturedCmd = cmd; capturedArgs = args; },
    });

    await mockIpcMain._invoke('claude:generateCommitMessage', '/my/project', undefined);

    expect(capturedCmd).toBe('claude');
    expect(capturedArgs).toContain('--model');
    expect(capturedArgs[capturedArgs.indexOf('--model') + 1]).toBe('haiku');
    expect(capturedArgs).toContain('--output-format');
    expect(capturedArgs[capturedArgs.indexOf('--output-format') + 1]).toBe('text');
    expect(capturedArgs).toContain('--max-turns');
  });

  it('returns the trimmed commit message output from claude', async () => {
    mockSpawnForCommit({ commitOutput: 'feat: add new feature\n' });
    const result = await mockIpcMain._invoke('claude:generateCommitMessage', '/my/project', undefined);
    expect(result).toBe('feat: add new feature');
  });

  it('truncates diff to 8000 chars before passing to claude', async () => {
    const longDiff = 'x'.repeat(10_000);
    let capturedArgs: string[] = [];

    vi.mocked(spawn).mockImplementation((_cmd: string, _args?: any, _opts?: any) => {
      const proc = new MockChildProcess();
      const cmd = _cmd as string;
      const args = (_args as string[]) || [];

      if (cmd === 'git') {
        setImmediate(() => {
          if (args.includes('--staged')) proc.pushStdout(longDiff);
          proc.emitExit(0);
        });
      } else {
        capturedArgs = args;
        setImmediate(() => {
          proc.pushStdout('fix: truncated\n');
          proc.emitExit(0);
        });
      }
      return proc as any;
    });

    await mockIpcMain._invoke('claude:generateCommitMessage', '/my/project', undefined);

    // prompt is the second arg: claude -p <prompt>
    const prompt = capturedArgs[1] as string;
    expect(prompt).toContain('... (diff truncated)');
    const xChars = (prompt.match(/x+/) || [''])[0].length;
    expect(xChars).toBeLessThanOrEqual(8000);
  });

  it('returns empty string when no diff is available', async () => {
    vi.mocked(spawn).mockImplementation((_cmd: string, _args?: any, _opts?: any) => {
      const proc = new MockChildProcess();
      const cmd = _cmd as string;
      if (cmd === 'git') {
        setImmediate(() => { proc.pushStdout(''); proc.emitExit(0); });
      }
      return proc as any;
    });

    const result = await mockIpcMain._invoke('claude:generateCommitMessage', '/my/project', undefined);
    expect(result).toBe('');
  });

  it('falls back to unstaged diff when staged diff is empty', async () => {
    mockSpawnForCommit({ stagedDiff: '', unstagedDiff: 'diff --git a/g b/g\n+unstaged\n' });
    const result = await mockIpcMain._invoke('claude:generateCommitMessage', '/my/project', undefined);
    expect(result).toBe('feat: mock commit');
  });

  it('spawns codex CLI when provider is codex', async () => {
    let calledCmd = '';
    let capturedArgs: string[] = [];

    mockSpawnForCommit({
      commitOutput: JSON.stringify({ type: 'item.completed', item: { type: 'agent_message', text: 'codex commit' } }) + '\n',
      captureCmd: (cmd, args) => { calledCmd = cmd; capturedArgs = args; },
    });

    await mockIpcMain._invoke('claude:generateCommitMessage', '/my/project', 'codex');

    expect(calledCmd).toBe('codex');
    expect(capturedArgs).toContain('exec');
    expect(capturedArgs).toContain('codex-mini');
  });

  it('uses a hidden Gemini ACP session for commit generation', async () => {
    mockSpawnForCommit({});
    const result = await mockIpcMain._invoke('claude:generateCommitMessage', '/my/project', 'gemini');

    expect(result).toBe('gemini commit message');
    expect(mockEnsureGeminiTransport).toHaveBeenCalled();
    expect(mockEnsureGeminiCommitSession).toHaveBeenCalled();
    expect(mockPromptGeminiText).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      expect.objectContaining({
        scope: 'commit',
        prompt: expect.stringContaining('Generate a concise commit message for this diff'),
        model: 'gemini-2.5-flash',
        approvalMode: 'plan',
      }),
    );
  });

  it('does not reuse the active Gemini chat session for commit generation', async () => {
    mockSpawnForCommit({});
    mockEnsureGeminiCommitSession.mockResolvedValueOnce('gemini-hidden-commit');

    await mockIpcMain._invoke('claude:generateCommitMessage', '/my/project', 'gemini');

    expect(mockPromptGeminiText).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      expect.objectContaining({
        sessionId: 'gemini-hidden-commit',
        scope: 'commit',
      }),
    );
  });
});

// ===========================================================================
// claude:alwaysAllow handler
// ===========================================================================

describe('claude:alwaysAllow handler', () => {
  it('writes tool pattern to settings.local.json', async () => {
    const fs = await import('node:fs');
    (fs.readFileSync as ReturnType<typeof vi.fn>).mockReturnValue(
      JSON.stringify({ permissions: { allow: [] } }),
    );

    const result = await mockIpcMain._invoke('claude:alwaysAllow', '/my/project', 'Bash(git *)');

    expect(result).toBe(true);
    const calls = (fs.writeFileSync as ReturnType<typeof vi.fn>).mock.calls;
    const settingsCall = calls.find(([p]: [string]) => p.endsWith('settings.local.json'));
    expect(settingsCall).toBeDefined();
    expect(JSON.parse(settingsCall![1]).permissions.allow).toContain('Bash(git *)');
  });

  it('creates settings file if it does not exist', async () => {
    const fs = await import('node:fs');
    (fs.readFileSync as ReturnType<typeof vi.fn>).mockImplementation(() => {
      throw new Error('ENOENT');
    });

    const result = await mockIpcMain._invoke('claude:alwaysAllow', '/my/project', 'Write(*)');

    expect(result).toBe(true);
    const calls = (fs.writeFileSync as ReturnType<typeof vi.fn>).mock.calls;
    const settingsCall = calls.find(([p]: [string]) => p.endsWith('settings.local.json'));
    expect(settingsCall).toBeDefined();
    expect(JSON.parse(settingsCall![1]).permissions.allow).toContain('Write(*)');
  });

  it('does not add duplicate patterns', async () => {
    const fs = await import('node:fs');
    (fs.readFileSync as ReturnType<typeof vi.fn>).mockReturnValue(
      JSON.stringify({ permissions: { allow: ['Bash(echo *)'] } }),
    );

    await mockIpcMain._invoke('claude:alwaysAllow', '/my/project', 'Bash(echo *)');

    const calls = (fs.writeFileSync as ReturnType<typeof vi.fn>).mock.calls;
    const settingsCall = calls.find(([p]: [string]) => p.endsWith('settings.local.json'));
    if (settingsCall) {
      const count = JSON.parse(settingsCall![1]).permissions.allow.filter(
        (p: string) => p === 'Bash(echo *)',
      ).length;
      expect(count).toBe(1);
    }
  });
});
