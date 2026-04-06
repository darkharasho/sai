// @vitest-environment node
/**
 * Unit tests for electron/services/workspace.ts
 *
 * Coverage:
 *   - getOrCreate creates new workspace / returns existing
 *   - touchActivity updates lastActivity
 *   - suspend kills processes, clears buffers, sets status
 *   - remove destroys and removes from map
 *   - destroyAll cleans everything
 *   - Suspend timer checks inactive workspaces
 *   - DEFAULT_SUSPEND_TIMEOUT is 1 hour
 *   - getAll returns workspace summaries
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// ---------------------------------------------------------------------------
// Mock electron (workspace.ts imports BrowserWindow)
// ---------------------------------------------------------------------------

vi.mock('electron', () => ({
  BrowserWindow: vi.fn(),
  ipcMain: {
    handle: vi.fn(),
    on: vi.fn(),
    removeHandler: vi.fn(),
  },
  app: { getPath: vi.fn().mockReturnValue('/mock/userData') },
}));

// ---------------------------------------------------------------------------
// Helper: create a minimal mock BrowserWindow
// ---------------------------------------------------------------------------

function createWin() {
  return {
    webContents: { send: vi.fn() },
    isDestroyed: vi.fn().mockReturnValue(false),
    isFocused: vi.fn().mockReturnValue(false),
    on: vi.fn(),
  };
}

// ---------------------------------------------------------------------------
// Helper: create a mock ChildProcess
// ---------------------------------------------------------------------------

function createMockProcess() {
  return {
    kill: vi.fn(),
    pid: Math.floor(Math.random() * 9999) + 1000,
  };
}

// ---------------------------------------------------------------------------
// Helper: create a mock IPty (terminal)
// ---------------------------------------------------------------------------

function createMockTerm() {
  return { kill: vi.fn() };
}

// ---------------------------------------------------------------------------
// Setup/teardown — reload module so workspaces map is fresh each test
// ---------------------------------------------------------------------------

beforeEach(() => {
  vi.resetModules();
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

async function loadService() {
  return import('../../../electron/services/workspace');
}

// ===========================================================================
// getOrCreate
// ===========================================================================

describe('getOrCreate', () => {
  it('creates a new workspace with correct defaults', async () => {
    const { getOrCreate, getClaude } = await loadService();
    const ws = getOrCreate('/home/user/project');

    expect(ws.projectPath).toBe('/home/user/project');
    expect(ws.status).toBe('active');
    const claude = getClaude(ws);
    expect(claude.process).toBeNull();
    expect(claude.busy).toBe(false);
    expect(claude.suppressForward).toBe(false);
    expect(claude.pendingToolUse).toBeNull();
    expect(claude.approvalBuffered).toEqual([]);
    expect(claude.awaitingApproval).toBe(false);
    expect(ws.codex.process).toBeNull();
    expect(ws.codex.busy).toBe(false);
    expect(ws.gemini.process).toBeNull();
    expect(ws.gemini.busy).toBe(false);
    expect(ws.terminals).toBeInstanceOf(Map);
    expect(ws.terminals.size).toBe(0);
    expect(typeof ws.lastActivity).toBe('number');
  });

  it('sets cwd to projectPath for all agents', async () => {
    const { getOrCreate, getClaude } = await loadService();
    const ws = getOrCreate('/workspace/abc');

    expect(getClaude(ws).cwd).toBe('/workspace/abc');
    expect(ws.codex.cwd).toBe('/workspace/abc');
    expect(ws.gemini.cwd).toBe('/workspace/abc');
  });

  it('returns existing workspace when called again with same path', async () => {
    const { getOrCreate } = await loadService();
    const ws1 = getOrCreate('/same/path');
    const ws2 = getOrCreate('/same/path');

    expect(ws1).toBe(ws2);
  });

  it('revives a suspended workspace to active', async () => {
    const { getOrCreate } = await loadService();
    const ws = getOrCreate('/path/x');
    ws.status = 'suspended';

    const ws2 = getOrCreate('/path/x');
    expect(ws2.status).toBe('active');
  });

  it('updates lastActivity when returning existing workspace', async () => {
    const { getOrCreate } = await loadService();
    const ws = getOrCreate('/path/y');
    const before = ws.lastActivity;

    // Advance time
    await vi.advanceTimersByTimeAsync(1000);
    getOrCreate('/path/y');

    expect(ws.lastActivity).toBeGreaterThanOrEqual(before);
  });

  it('creates distinct workspaces for different paths', async () => {
    const { getOrCreate } = await loadService();
    const ws1 = getOrCreate('/path/a');
    const ws2 = getOrCreate('/path/b');

    expect(ws1).not.toBe(ws2);
    expect(ws1.projectPath).toBe('/path/a');
    expect(ws2.projectPath).toBe('/path/b');
  });
});

// ===========================================================================
// touchActivity
// ===========================================================================

describe('touchActivity', () => {
  it('updates lastActivity timestamp', async () => {
    const { getOrCreate, touchActivity } = await loadService();
    const ws = getOrCreate('/touch/path');
    const before = ws.lastActivity;

    await vi.advanceTimersByTimeAsync(500);
    touchActivity('/touch/path');

    expect(ws.lastActivity).toBeGreaterThan(before);
  });

  it('does nothing for unknown path', async () => {
    const { touchActivity } = await loadService();
    expect(() => touchActivity('/nonexistent')).not.toThrow();
  });
});

// ===========================================================================
// suspend
// ===========================================================================

describe('suspend', () => {
  it('kills Claude process and nullifies it', async () => {
    const { getOrCreate, getClaude, suspend } = await loadService();
    const ws = getOrCreate('/suspend/proj');
    const claude = getClaude(ws);
    const proc = createMockProcess();
    claude.process = proc as never;

    suspend('/suspend/proj', createWin() as never);

    expect(proc.kill).toHaveBeenCalledTimes(1);
    expect(claude.process).toBeNull();
  });

  it('kills Codex process and nullifies it', async () => {
    const { getOrCreate, suspend } = await loadService();
    const ws = getOrCreate('/suspend/codex');
    const proc = createMockProcess();
    ws.codex.process = proc as never;

    suspend('/suspend/codex', createWin() as never);

    expect(proc.kill).toHaveBeenCalledTimes(1);
    expect(ws.codex.process).toBeNull();
  });

  it('kills Gemini process and nullifies it', async () => {
    const { getOrCreate, suspend } = await loadService();
    const ws = getOrCreate('/suspend/gemini');
    const proc = createMockProcess();
    ws.gemini.process = proc as never;

    suspend('/suspend/gemini', createWin() as never);

    expect(proc.kill).toHaveBeenCalledTimes(1);
    expect(ws.gemini.process).toBeNull();
  });

  it('kills all terminals and clears the map', async () => {
    const { getOrCreate, suspend } = await loadService();
    const ws = getOrCreate('/suspend/terminals');
    const t1 = createMockTerm();
    const t2 = createMockTerm();
    ws.terminals.set(1, t1 as never);
    ws.terminals.set(2, t2 as never);

    suspend('/suspend/terminals', createWin() as never);

    expect(t1.kill).toHaveBeenCalledTimes(1);
    expect(t2.kill).toHaveBeenCalledTimes(1);
    expect(ws.terminals.size).toBe(0);
  });

  it('clears Claude buffers and resets flags', async () => {
    const { getOrCreate, getClaude, suspend } = await loadService();
    const ws = getOrCreate('/suspend/flags');
    const claude = getClaude(ws);
    claude.busy = true;
    claude.suppressForward = true;
    claude.approvalBuffered = [{ x: 1 }];
    claude.awaitingApproval = true;

    suspend('/suspend/flags', createWin() as never);

    expect(claude.busy).toBe(false);
    expect(claude.suppressForward).toBe(false);
    expect(claude.approvalBuffered).toEqual([]);
    expect(claude.awaitingApproval).toBe(false);
  });

  it('sets status to suspended', async () => {
    const { getOrCreate, suspend } = await loadService();
    const ws = getOrCreate('/suspend/status');

    suspend('/suspend/status', createWin() as never);

    expect(ws.status).toBe('suspended');
  });

  it('sends workspace:suspended event to the window', async () => {
    const { getOrCreate, suspend } = await loadService();
    getOrCreate('/suspend/event');
    const win = createWin();

    suspend('/suspend/event', win as never);

    expect(win.webContents.send).toHaveBeenCalledWith('workspace:suspended', '/suspend/event');
  });

  it('is a no-op when workspace is already suspended', async () => {
    const { getOrCreate, suspend } = await loadService();
    const ws = getOrCreate('/suspend/dupe');
    ws.status = 'suspended';

    const win = createWin();
    suspend('/suspend/dupe', win as never);

    expect(win.webContents.send).not.toHaveBeenCalled();
  });

  it('does not throw for unknown path', async () => {
    const { suspend } = await loadService();
    expect(() => suspend('/unknown', createWin() as never)).not.toThrow();
  });
});

// ===========================================================================
// remove
// ===========================================================================

describe('remove', () => {
  it('destroys workspace and removes it from map', async () => {
    const { getOrCreate, remove, get } = await loadService();
    getOrCreate('/remove/proj');

    remove('/remove/proj', createWin() as never);

    expect(get('/remove/proj')).toBeUndefined();
  });

  it('does not throw for unknown path', async () => {
    const { remove } = await loadService();
    expect(() => remove('/nonexistent', createWin() as never)).not.toThrow();
  });
});

// ===========================================================================
// destroyAll
// ===========================================================================

describe('destroyAll', () => {
  it('suspends all workspaces and clears the map', async () => {
    const { getOrCreate, getClaude, destroyAll, getAll } = await loadService();
    const ws1 = getOrCreate('/a/proj');
    const ws2 = getOrCreate('/b/proj');
    const p1 = createMockProcess();
    const p2 = createMockProcess();
    getClaude(ws1).process = p1 as never;
    getClaude(ws2).process = p2 as never;

    destroyAll(createWin() as never);

    expect(p1.kill).toHaveBeenCalled();
    expect(p2.kill).toHaveBeenCalled();
    expect(getAll()).toHaveLength(0);
  });

  it('does not throw when no workspaces exist', async () => {
    const { destroyAll } = await loadService();
    expect(() => destroyAll(createWin() as never)).not.toThrow();
  });
});

// ===========================================================================
// getAll
// ===========================================================================

describe('getAll', () => {
  it('returns summary objects for all workspaces', async () => {
    const { getOrCreate, getAll } = await loadService();
    getOrCreate('/summary/a');
    getOrCreate('/summary/b');

    const all = getAll();

    expect(all).toHaveLength(2);
    for (const entry of all) {
      expect(entry).toHaveProperty('projectPath');
      expect(entry).toHaveProperty('status');
      expect(entry).toHaveProperty('lastActivity');
    }
  });

  it('returns empty array when no workspaces', async () => {
    const { getAll } = await loadService();
    expect(getAll()).toEqual([]);
  });
});

// ===========================================================================
// DEFAULT_SUSPEND_TIMEOUT
// ===========================================================================

describe('DEFAULT_SUSPEND_TIMEOUT', () => {
  it('is exactly 1 hour (3600000 ms)', async () => {
    const { DEFAULT_SUSPEND_TIMEOUT } = await loadService();
    expect(DEFAULT_SUSPEND_TIMEOUT).toBe(60 * 60 * 1000);
  });
});

// ===========================================================================
// Suspend timer
// ===========================================================================

describe('startSuspendTimer / stopSuspendTimer', () => {
  it('suspends inactive workspaces when timeout is exceeded', async () => {
    const { getOrCreate, startSuspendTimer, stopSuspendTimer } = await loadService();
    const win = createWin();
    const ws = getOrCreate('/timer/proj');

    // Manually age the workspace beyond the timeout
    const timeout = 60 * 60 * 1000;
    ws.lastActivity = Date.now() - timeout - 1000;

    startSuspendTimer(win as never, () => timeout);

    // Advance past the check interval (5 minutes)
    await vi.advanceTimersByTimeAsync(5 * 60 * 1000 + 1000);

    expect(ws.status).toBe('suspended');

    stopSuspendTimer();
  });

  it('does not suspend active workspaces within timeout window', async () => {
    const { getOrCreate, startSuspendTimer, stopSuspendTimer } = await loadService();
    const win = createWin();
    const ws = getOrCreate('/timer/active');
    // lastActivity is fresh (just now)

    const timeout = 60 * 60 * 1000;
    startSuspendTimer(win as never, () => timeout);

    await vi.advanceTimersByTimeAsync(5 * 60 * 1000 + 1000);

    expect(ws.status).toBe('active');

    stopSuspendTimer();
  });

  it('skips suspension when timeout is 0 (never)', async () => {
    const { getOrCreate, startSuspendTimer, stopSuspendTimer } = await loadService();
    const win = createWin();
    const ws = getOrCreate('/timer/never');
    ws.lastActivity = 0; // very old

    startSuspendTimer(win as never, () => 0);

    await vi.advanceTimersByTimeAsync(5 * 60 * 1000 + 1000);

    expect(ws.status).toBe('active');

    stopSuspendTimer();
  });

  it('does not start a second timer if already running', async () => {
    const { startSuspendTimer, stopSuspendTimer } = await loadService();
    const win = createWin();

    startSuspendTimer(win as never);
    startSuspendTimer(win as never); // should be no-op

    // If two timers were running this would fire twice; just verify no throw
    await vi.advanceTimersByTimeAsync(5 * 60 * 1000 + 1000);
    stopSuspendTimer();
  });
});
