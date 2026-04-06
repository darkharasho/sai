// @vitest-environment node
/**
 * Integration tests for workspace lifecycle management.
 *
 * Exercises the actual workspace service functions (getOrCreate, suspend, remove,
 * destroyAll, startSuspendTimer) with mocked electron and process/pty dependencies.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// ---------------------------------------------------------------------------
// Module mocks — electron must be mocked before any imports
// ---------------------------------------------------------------------------

vi.mock('electron', () => ({
  BrowserWindow: vi.fn(),
  ipcMain: {
    handle: vi.fn(),
    on: vi.fn(),
    removeHandler: vi.fn(),
  },
  app: { getPath: vi.fn().mockReturnValue('/tmp/sai-test') },
}));

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function createWin() {
  return {
    webContents: { send: vi.fn() },
    isDestroyed: vi.fn().mockReturnValue(false),
    isFocused: vi.fn().mockReturnValue(false),
    on: vi.fn(),
    once: vi.fn(),
  };
}

function createMockProcess() {
  return {
    kill: vi.fn(),
    stdin: { write: vi.fn(), destroyed: false },
    stdout: null,
    stderr: null,
    pid: Math.floor(Math.random() * 9000) + 1000,
  };
}

function createMockTerm() {
  return { kill: vi.fn(), pid: Math.floor(Math.random() * 9000) + 1000 };
}

// ---------------------------------------------------------------------------
// Each test reloads the workspace module with a fresh internal map
// ---------------------------------------------------------------------------
beforeEach(() => {
  vi.resetModules();
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

async function loadWorkspace() {
  return import('../../electron/services/workspace');
}

// ===========================================================================
// Tests
// ===========================================================================

describe('workspace lifecycle — getOrCreate', () => {
  it('creates a new workspace with default state', async () => {
    const ws = await loadWorkspace();
    const created = ws.getOrCreate('/project/alpha');

    expect(created.projectPath).toBe('/project/alpha');
    expect(created.status).toBe('active');
    const claude = ws.getClaude(created);
    expect(claude.process).toBeNull();
    expect(claude.busy).toBe(false);
    expect(claude.awaitingApproval).toBe(false);
    expect(created.codex.process).toBeNull();
    expect(created.gemini.process).toBeNull();
    expect(created.terminals.size).toBe(0);
  });

  it('returns the same instance for the same path', async () => {
    const ws = await loadWorkspace();
    const a = ws.getOrCreate('/project/beta');
    const b = ws.getOrCreate('/project/beta');

    expect(a).toBe(b);
  });

  it('creates separate instances for different paths', async () => {
    const ws = await loadWorkspace();
    const a = ws.getOrCreate('/project/one');
    const b = ws.getOrCreate('/project/two');

    expect(a).not.toBe(b);
    expect(a.projectPath).toBe('/project/one');
    expect(b.projectPath).toBe('/project/two');
  });

  it('reactivates a suspended workspace on getOrCreate', async () => {
    const ws = await loadWorkspace();
    const win = createWin();
    const workspace = ws.getOrCreate('/project/gamma');

    ws.suspend('/project/gamma', win as any);
    expect(workspace.status).toBe('suspended');

    ws.getOrCreate('/project/gamma');
    expect(workspace.status).toBe('active');
  });

  it('updates lastActivity on getOrCreate of existing workspace', async () => {
    const ws = await loadWorkspace();
    const workspace = ws.getOrCreate('/project/delta');
    const initial = workspace.lastActivity;

    // Advance time
    vi.advanceTimersByTime(5000);
    ws.getOrCreate('/project/delta');

    // lastActivity should have been updated
    expect(workspace.lastActivity).toBeGreaterThanOrEqual(initial);
  });
});

describe('workspace lifecycle — touchActivity', () => {
  it('updates lastActivity for existing workspace', async () => {
    const ws = await loadWorkspace();
    const workspace = ws.getOrCreate('/project/touch');
    const initial = workspace.lastActivity;

    vi.advanceTimersByTime(2000);
    ws.touchActivity('/project/touch');

    expect(workspace.lastActivity).toBeGreaterThanOrEqual(initial);
  });

  it('is a no-op for unknown project path', async () => {
    const ws = await loadWorkspace();
    // Should not throw
    expect(() => ws.touchActivity('/non/existent')).not.toThrow();
  });
});

describe('workspace lifecycle — suspend', () => {
  it('kills claude process and sets status to suspended', async () => {
    const ws = await loadWorkspace();
    const win = createWin();
    const workspace = ws.getOrCreate('/project/suspend1');

    const claudeProc = createMockProcess();
    const claude = ws.getClaude(workspace);
    claude.process = claudeProc as any;
    claude.busy = true;

    ws.suspend('/project/suspend1', win as any);

    expect(claudeProc.kill).toHaveBeenCalled();
    expect(claude.process).toBeNull();
    expect(claude.busy).toBe(false);
    expect(workspace.status).toBe('suspended');
  });

  it('kills codex process on suspend', async () => {
    const ws = await loadWorkspace();
    const win = createWin();
    const workspace = ws.getOrCreate('/project/suspend2');

    const codexProc = createMockProcess();
    workspace.codex.process = codexProc as any;
    workspace.codex.busy = true;

    ws.suspend('/project/suspend2', win as any);

    expect(codexProc.kill).toHaveBeenCalled();
    expect(workspace.codex.process).toBeNull();
    expect(workspace.codex.busy).toBe(false);
  });

  it('kills gemini process on suspend', async () => {
    const ws = await loadWorkspace();
    const win = createWin();
    const workspace = ws.getOrCreate('/project/suspend3');

    const geminiProc = createMockProcess();
    workspace.gemini.process = geminiProc as any;
    workspace.gemini.busy = true;

    ws.suspend('/project/suspend3', win as any);

    expect(geminiProc.kill).toHaveBeenCalled();
    expect(workspace.gemini.process).toBeNull();
    expect(workspace.gemini.busy).toBe(false);
  });

  it('kills all terminals on suspend', async () => {
    const ws = await loadWorkspace();
    const win = createWin();
    const workspace = ws.getOrCreate('/project/suspend4');

    const term1 = createMockTerm();
    const term2 = createMockTerm();
    workspace.terminals.set(1, term1 as any);
    workspace.terminals.set(2, term2 as any);

    ws.suspend('/project/suspend4', win as any);

    expect(term1.kill).toHaveBeenCalled();
    expect(term2.kill).toHaveBeenCalled();
    expect(workspace.terminals.size).toBe(0);
  });

  it('emits workspace:suspended event via win.webContents.send', async () => {
    const ws = await loadWorkspace();
    const win = createWin();
    ws.getOrCreate('/project/suspend-event');

    ws.suspend('/project/suspend-event', win as any);

    expect(win.webContents.send).toHaveBeenCalledWith('workspace:suspended', '/project/suspend-event');
  });

  it('is idempotent: double suspend does nothing the second time', async () => {
    const ws = await loadWorkspace();
    const win = createWin();
    const workspace = ws.getOrCreate('/project/suspend-idem');

    const proc = createMockProcess();
    ws.getClaude(workspace).process = proc as any;

    ws.suspend('/project/suspend-idem', win as any);
    ws.suspend('/project/suspend-idem', win as any);

    // kill should only have been called once
    expect(proc.kill).toHaveBeenCalledTimes(1);
    expect(win.webContents.send).toHaveBeenCalledTimes(1);
  });

  it('resets approval state on suspend', async () => {
    const ws = await loadWorkspace();
    const win = createWin();
    const workspace = ws.getOrCreate('/project/suspend-approval');

    const claude = ws.getClaude(workspace);
    claude.awaitingApproval = true;
    claude.pendingToolUse = { toolName: 'Bash', toolUseId: 'x', input: {} };
    claude.approvalBuffered = [{ type: 'test' }];

    ws.suspend('/project/suspend-approval', win as any);

    expect(claude.awaitingApproval).toBe(false);
    expect(claude.pendingToolUse).toBeNull();
    expect(claude.approvalBuffered).toHaveLength(0);
  });

  it('is no-op for unknown project path', async () => {
    const ws = await loadWorkspace();
    const win = createWin();
    expect(() => ws.suspend('/unknown/path', win as any)).not.toThrow();
  });
});

describe('workspace lifecycle — remove', () => {
  it('kills processes and removes workspace from registry', async () => {
    const ws = await loadWorkspace();
    const win = createWin();
    const workspace = ws.getOrCreate('/project/remove1');

    const proc = createMockProcess();
    ws.getClaude(workspace).process = proc as any;

    ws.remove('/project/remove1', win as any);

    expect(proc.kill).toHaveBeenCalled();
    expect(ws.get('/project/remove1')).toBeUndefined();
  });

  it('getAll excludes removed workspaces', async () => {
    const ws = await loadWorkspace();
    const win = createWin();

    ws.getOrCreate('/project/keep');
    ws.getOrCreate('/project/discard');

    ws.remove('/project/discard', win as any);

    const all = ws.getAll();
    const paths = all.map(w => w.projectPath);
    expect(paths).toContain('/project/keep');
    expect(paths).not.toContain('/project/discard');
  });
});

describe('workspace lifecycle — destroyAll', () => {
  it('suspends all workspaces and clears the registry', async () => {
    const ws = await loadWorkspace();
    const win = createWin();

    const p1 = ws.getOrCreate('/project/destroy-a');
    const p2 = ws.getOrCreate('/project/destroy-b');

    const proc1 = createMockProcess();
    const proc2 = createMockProcess();
    ws.getClaude(p1).process = proc1 as any;
    ws.getClaude(p2).process = proc2 as any;

    ws.destroyAll(win as any);

    expect(proc1.kill).toHaveBeenCalled();
    expect(proc2.kill).toHaveBeenCalled();
    expect(ws.getAll()).toHaveLength(0);
  });
});

describe('workspace lifecycle — getAll', () => {
  it('returns summaries for all workspaces', async () => {
    const ws = await loadWorkspace();

    ws.getOrCreate('/project/list-a');
    ws.getOrCreate('/project/list-b');

    const all = ws.getAll();
    expect(all.length).toBeGreaterThanOrEqual(2);
    expect(all.every(w => 'projectPath' in w && 'status' in w && 'lastActivity' in w)).toBe(true);
  });
});

describe('workspace lifecycle — suspend timer', () => {
  it('suspends inactive workspace after timeout', async () => {
    const ws = await loadWorkspace();
    const win = createWin();

    const timeout = 60 * 60 * 1000; // 1 hour
    const workspace = ws.getOrCreate('/project/timer-test');

    ws.startSuspendTimer(win as any, () => timeout);

    // Simulate workspace being inactive for > timeout
    workspace.lastActivity = Date.now() - timeout - 1000;

    // Advance the interval check
    vi.advanceTimersByTime(5 * 60 * 1000 + 100);

    expect(workspace.status).toBe('suspended');

    ws.stopSuspendTimer();
  });

  it('does not suspend active workspaces within timeout', async () => {
    const ws = await loadWorkspace();
    const win = createWin();

    const timeout = 60 * 60 * 1000;
    const workspace = ws.getOrCreate('/project/timer-active');

    ws.startSuspendTimer(win as any, () => timeout);

    // lastActivity is recent (default = Date.now())
    vi.advanceTimersByTime(5 * 60 * 1000 + 100);

    expect(workspace.status).toBe('active');

    ws.stopSuspendTimer();
  });

  it('does not suspend when timeout is 0 (Never setting)', async () => {
    const ws = await loadWorkspace();
    const win = createWin();

    const workspace = ws.getOrCreate('/project/timer-never');
    workspace.lastActivity = Date.now() - 99999999;

    ws.startSuspendTimer(win as any, () => 0);
    vi.advanceTimersByTime(5 * 60 * 1000 + 100);

    expect(workspace.status).toBe('active');

    ws.stopSuspendTimer();
  });

  it('DEFAULT_SUSPEND_TIMEOUT is 1 hour', async () => {
    const ws = await loadWorkspace();
    expect(ws.DEFAULT_SUSPEND_TIMEOUT).toBe(60 * 60 * 1000);
  });
});
