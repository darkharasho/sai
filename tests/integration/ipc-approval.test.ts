// @vitest-environment node
/**
 * Integration tests for the IPC approval / denial flow.
 *
 * The approval flow:
 *   1. CLI sends assistant message with tool_use block
 *   2. CLI sends user message with tool_result denial (is_error=true, content contains
 *      "requested permissions" / "was blocked")
 *   3. Service intercepts this, emits approval_needed to renderer
 *   4. Renderer calls claude:approve (approved=true|false)
 *   5a. If denied: buffered messages flushed; state reset
 *   5b. If approved: tool executed, result sent to renderer, follow-up written to stdin
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
      process.nextTick(() => cb(null, 'bash-output', ''));
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

/**
 * Drive the process through the tool_use → denial interception sequence.
 * After this helper, the workspace will be in awaitingApproval=true state.
 */
async function driveToApprovalNeeded(win: ReturnType<typeof createMockBrowserWindow>, project: string) {
  await mockIpcMain._invoke('claude:start', project);
  mockIpcMain._emit('claude:send', project, 'Run ls');
  await flushAsync();

  const proc = getLatest();

  // Step 1: assistant emits tool_use block
  pushLines(proc, {
    type: 'assistant',
    message: {
      role: 'assistant',
      content: [{
        type: 'tool_use',
        id: 'tool-abc',
        name: 'Bash',
        input: { command: 'ls -la /etc' },
      }],
    },
  });
  await flushAsync();

  // Step 2: CLI sends denial tool_result
  pushLines(proc, {
    type: 'user',
    message: {
      role: 'user',
      content: [{
        type: 'tool_result',
        tool_use_id: 'tool-abc',
        is_error: true,
        content: 'This tool call requested permissions that haven\'t been granted.',
      }],
    },
  });
  await flushAsync();

  return proc;
}

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------
let win: ReturnType<typeof createMockBrowserWindow>;
const PROJECT = '/test/approval-project';

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

describe('IPC approval flow', () => {
  it('tool_use followed by denial triggers approval_needed message', async () => {
    await driveToApprovalNeeded(win, PROJECT);

    const msgs = sentMessages(win);
    const approvalMsg = msgs.find(m => m.type === 'approval_needed');
    expect(approvalMsg).toBeDefined();
    expect(approvalMsg?.toolName).toBe('Bash');
    expect(approvalMsg?.toolUseId).toBe('tool-abc');
    expect(approvalMsg?.command).toContain('ls');
    expect(approvalMsg?.projectPath).toBe(PROJECT);
  });

  it('workspace enters awaitingApproval state after denial intercept', async () => {
    await driveToApprovalNeeded(win, PROJECT);

    const ws = workspaceState.get(PROJECT)!;
    expect(ws.claudeScopes.get('chat')!.awaitingApproval).toBe(true);
    expect(ws.claudeScopes.get('chat')!.pendingToolUse).toBeDefined();
    expect(ws.claudeScopes.get('chat')!.pendingToolUse?.toolUseId).toBe('tool-abc');
  });

  it('approval: execute bash, send tool_result to renderer, write follow-up to stdin', async () => {
    await driveToApprovalNeeded(win, PROJECT);

    // User approves
    const approveResult = await mockIpcMain._invoke('claude:approve', PROJECT, 'tool-abc', true);
    await flushAsync();

    expect(approveResult).toBeDefined();
    const result = approveResult as { result: string; isError: boolean };
    expect(result.result).toBe('bash-output');
    expect(result.isError).toBe(false);

    // Should have sent a tool_result user message to the renderer
    const msgs = sentMessages(win);
    const toolResultMsg = msgs.find(m =>
      m.type === 'user' &&
      m.message?.content?.[0]?.type === 'tool_result',
    );
    expect(toolResultMsg).toBeDefined();
    expect(toolResultMsg?.message.content[0].tool_use_id).toBe('tool-abc');
  });

  it('approval: state is reset after approving', async () => {
    await driveToApprovalNeeded(win, PROJECT);
    await mockIpcMain._invoke('claude:approve', PROJECT, 'tool-abc', true);
    await flushAsync();

    const ws = workspaceState.get(PROJECT)!;
    expect(ws.claudeScopes.get('chat')!.awaitingApproval).toBe(false);
    expect(ws.claudeScopes.get('chat')!.pendingToolUse).toBeNull();
    expect(ws.claudeScopes.get('chat')!.approvalBuffered).toHaveLength(0);
  });

  it('denial flow: buffered messages flushed to renderer', async () => {
    await driveToApprovalNeeded(win, PROJECT);

    const ws = workspaceState.get(PROJECT)!;
    // Manually add a buffered result message (would normally come from CLI while blocked)
    ws.claudeScopes.get('chat')!.approvalBuffered = [
      { type: 'assistant', message: { content: [] } },
      { type: 'result', duration_ms: 100 },
    ];

    // User denies
    await mockIpcMain._invoke('claude:approve', PROJECT, 'tool-abc', false);
    await flushAsync();

    const msgs = sentMessages(win);
    const types = msgs.map(m => m.type);
    expect(types).toContain('result');
    expect(types).toContain('done');
  });

  it('denial: state is fully reset after denying', async () => {
    await driveToApprovalNeeded(win, PROJECT);

    await mockIpcMain._invoke('claude:approve', PROJECT, 'tool-abc', false);
    await flushAsync();

    const ws = workspaceState.get(PROJECT)!;
    expect(ws.claudeScopes.get('chat')!.awaitingApproval).toBe(false);
    expect(ws.claudeScopes.get('chat')!.pendingToolUse).toBeNull();
    expect(ws.claudeScopes.get('chat')!.approvalBuffered).toHaveLength(0);
  });

  it('messages while awaiting approval are buffered, not forwarded', async () => {
    await driveToApprovalNeeded(win, PROJECT);

    const proc = getLatest();
    const sendCountBeforeBuffer = (win.webContents.send as ReturnType<typeof vi.fn>).mock.calls.length;

    // Push a message while in awaitingApproval state
    pushLines(proc, { type: 'assistant', message: { content: [{ type: 'text', text: 'Thinking...' }] } });
    await flushAsync();

    const sendCountAfter = (win.webContents.send as ReturnType<typeof vi.fn>).mock.calls.length;
    // The message should be buffered, not sent
    expect(sendCountAfter).toBe(sendCountBeforeBuffer);

    const ws = workspaceState.get(PROJECT)!;
    expect(ws.claudeScopes.get('chat')!.approvalBuffered).toHaveLength(1);
  });

  it('multiple sequential approvals each complete independently', async () => {
    // First approval cycle
    await driveToApprovalNeeded(win, PROJECT);
    await mockIpcMain._invoke('claude:approve', PROJECT, 'tool-abc', true);
    await flushAsync();

    // After first approval, workspace should be ready for another cycle
    const ws = workspaceState.get(PROJECT)!;
    expect(ws.claudeScopes.get('chat')!.awaitingApproval).toBe(false);

    // Simulate second tool_use denial cycle
    const proc = getLatest();
    pushLines(proc, {
      type: 'assistant',
      message: {
        role: 'assistant',
        content: [{ type: 'tool_use', id: 'tool-xyz', name: 'Bash', input: { command: 'pwd' } }],
      },
    });
    await flushAsync();

    pushLines(proc, {
      type: 'user',
      message: {
        role: 'user',
        content: [{
          type: 'tool_result',
          tool_use_id: 'tool-xyz',
          is_error: true,
          content: 'This tool call was blocked by the permission system.',
        }],
      },
    });
    await flushAsync();

    const ws2 = workspaceState.get(PROJECT)!;
    expect(ws2.claudeScopes.get('chat')!.awaitingApproval).toBe(true);
    expect(ws2.claudeScopes.get('chat')!.pendingToolUse?.toolUseId).toBe('tool-xyz');

    // Second approval
    await mockIpcMain._invoke('claude:approve', PROJECT, 'tool-xyz', true);
    await flushAsync();

    const ws3 = workspaceState.get(PROJECT)!;
    expect(ws3.claudeScopes.get('chat')!.awaitingApproval).toBe(false);
  });

  it('approve with no pending approval is a no-op', async () => {
    await mockIpcMain._invoke('claude:start', PROJECT);

    // Call approve without any pending state
    const result = await mockIpcMain._invoke('claude:approve', PROJECT, 'non-existent', true);
    expect(result).toBeUndefined();
  });

  it('approval_needed includes input and command fields', async () => {
    await mockIpcMain._invoke('claude:start', PROJECT);
    mockIpcMain._emit('claude:send', PROJECT, 'do something');
    await flushAsync();

    const proc = getLatest();
    pushLines(proc, {
      type: 'assistant',
      message: {
        role: 'assistant',
        content: [{
          type: 'tool_use',
          id: 'tool-detail',
          name: 'Bash',
          input: { command: 'cat /etc/passwd', description: 'Read system file' },
        }],
      },
    });
    await flushAsync();

    pushLines(proc, {
      type: 'user',
      message: {
        role: 'user',
        content: [{
          type: 'tool_result',
          tool_use_id: 'tool-detail',
          is_error: true,
          content: "This tool call requested permissions that haven't been granted.",
        }],
      },
    });
    await flushAsync();

    const msgs = sentMessages(win);
    const approvalMsg = msgs.find(m => m.type === 'approval_needed');
    expect(approvalMsg).toBeDefined();
    expect(approvalMsg?.command).toBe('cat /etc/passwd');
    expect(approvalMsg?.description).toBe('Read system file');
    expect(approvalMsg?.input).toEqual({ command: 'cat /etc/passwd', description: 'Read system file' });
  });
});
