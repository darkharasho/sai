import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const { backend, mcpConfig, win } = vi.hoisted(() => ({
  win: { current: null as null | { isDestroyed: () => boolean; webContents: { send: (...a: any[]) => void } } },
  backend: {
    getLiveQuery: vi.fn(),
    markMcpStale: vi.fn(),
  },
  mcpConfig: {
    listMcpServers: vi.fn(() => []),
    upsertMcpServer: vi.fn(),
    removeMcpServer: vi.fn(),
    setMcpServerDisabled: vi.fn(),
  },
}));

vi.mock('electron', () => ({ ipcMain: { handle: vi.fn() }, shell: { openExternal: vi.fn() } }));

vi.mock('node:fs', () => ({
  default: {
    existsSync: vi.fn(),
    readFileSync: vi.fn(),
    writeFileSync: vi.fn(),
    mkdirSync: vi.fn(),
  },
  existsSync: vi.fn(),
  readFileSync: vi.fn(),
  writeFileSync: vi.fn(),
  mkdirSync: vi.fn(),
}));
vi.mock('../../../electron/services/claudeBackend/index', () => ({ getClaudeBackend: () => backend }));
vi.mock('../../../electron/services/claude', () => ({ getMainWin: () => win.current }));
vi.mock('../../../electron/services/mcpConfig', () => mcpConfig);

import { ipcMain } from 'electron';
import { registerMcpHandlers } from '../../../electron/services/mcp';
import {
  __resetMcpRuntimeStatusForTests,
  notifyMcpInitFrame,
  recordMcpRuntimeStatus,
} from '../../../electron/services/claudeBackend/mcpRuntimeStatus';

function liveQuery() {
  return {
    mcpServerStatus: vi.fn(async () => [{ name: 'gh', status: 'connected' }]),
    toggleMcpServer: vi.fn(async (_name: string, _enabled: boolean) => {}),
  };
}

const handler = (ch: string) => {
  const call = (ipcMain.handle as ReturnType<typeof vi.fn>).mock.calls.find((c: any[]) => c[0] === ch);
  if (!call) throw new Error(`${ch} not registered`);
  return (...args: any[]) => call[1]({}, ...args);
};
const flush = () => new Promise((r) => setTimeout(r, 0));

describe('mcp service', () => {
  let q: ReturnType<typeof liveQuery>;
  beforeEach(() => {
    vi.clearAllMocks();
    win.current = null;
    __resetMcpRuntimeStatusForTests();
    q = liveQuery();
    backend.getLiveQuery.mockImplementation(() => q);
    registerMcpHandlers();
  });

  it('registers all expected IPC handlers', () => {
    const handle = ipcMain.handle as ReturnType<typeof vi.fn>;
    const channels = handle.mock.calls.map((c: any[]) => c[0]);
    expect(channels).toContain('mcp:list');
    expect(channels).toContain('mcp:add');
    expect(channels).toContain('mcp:remove');
    expect(channels).not.toContain('mcp:update');
    expect(channels).toContain('mcp:registryList');
    for (const ch of ['mcp:runtimeStatus', 'mcp:status', 'mcp:reconnect', 'mcp:toggle', 'mcp:authenticate',
      'mcp:authCancel', 'mcp:submitCallbackUrl', 'mcp:signOut']) {
      expect(channels).toContain(ch);
    }
  });

  describe('config writes apply by respawn', () => {
    it('add persists, then applies to the panel scope (user source → every project)', async () => {
      const config = { name: 'gh', transport: 'stdio', command: 'gh-mcp' };
      expect(await handler('mcp:add')(config, '/p', 's1')).toEqual({ success: true });
      await flush();
      expect(mcpConfig.upsertMcpServer).toHaveBeenCalledWith(expect.objectContaining({ projectPath: '/p' }), config);
      expect(backend.markMcpStale).toHaveBeenCalledWith('/p', 's1', { restart: true, projectOnly: false });
      expect(mcpConfig.upsertMcpServer.mock.invocationCallOrder[0]).toBeLessThan(backend.markMcpStale.mock.invocationCallOrder[0]);
      expect(backend.getLiveQuery).toHaveBeenCalledWith('/p', 's1', { create: true });
    });

    it('a project-source edit marks only that project stale', async () => {
      await handler('mcp:add')({ name: 'gh', transport: 'stdio', command: 'x', source: 'project' }, '/p', 's1');
      await handler('mcp:remove')('gh', 'project', '/p', 's1');
      await flush();
      expect(backend.markMcpStale).toHaveBeenCalledTimes(2);
      for (const call of backend.markMcpStale.mock.calls) expect(call).toEqual(['/p', 's1', { restart: true, projectOnly: true }]);
    });

    it('remove persists, then applies', async () => {
      expect(await handler('mcp:remove')('gh', 'user', '/p', 's1')).toEqual({ success: true });
      await flush();
      expect(mcpConfig.removeMcpServer).toHaveBeenCalledWith(expect.anything(), 'gh', 'user');
      expect(backend.markMcpStale).toHaveBeenCalledTimes(1);
    });

    it('a failed write returns { error } and applies nothing', async () => {
      mcpConfig.upsertMcpServer.mockImplementationOnce(() => { throw new Error('Cannot update /h/.claude.json: file is not valid JSON'); });
      expect(await handler('mcp:add')({ name: 'gh', transport: 'stdio' }, '/p', 's1'))
        .toEqual({ error: 'Cannot update /h/.claude.json: file is not valid JSON' });
      await flush();
      expect(backend.markMcpStale).not.toHaveBeenCalled();
      expect(backend.getLiveQuery).not.toHaveBeenCalled();
    });

    it('config-only (live:false, a non-Claude chat): edits and toggles only flag sessions — nothing is spawned or restarted', async () => {
      await handler('mcp:add')({ name: 'gh', transport: 'stdio', command: 'x', source: 'project' }, '/p', 's1', false);
      await handler('mcp:remove')('gh', 'user', '/p', 's1', false);
      expect(await handler('mcp:toggle')('/p', 's1', 'gh', true, 'user', 'gh', false)).toEqual({ ok: true });
      await flush();
      expect(backend.markMcpStale.mock.calls).toEqual([
        ['/p', undefined, { restart: false, projectOnly: true }],
        ['/p', undefined, { restart: false, projectOnly: false }],
        ['/p', undefined, { restart: false, projectOnly: false }],
      ]);
      expect(mcpConfig.setMcpServerDisabled).toHaveBeenCalledWith(expect.anything(), 'gh', 'user', false);
      expect(backend.getLiveQuery).not.toHaveBeenCalled();
    });

    it('with no project open, sessions are only flagged — nothing is spawned', async () => {
      await handler('mcp:add')({ name: 'gh', transport: 'stdio' });
      await flush();
      expect(backend.markMcpStale).toHaveBeenCalledWith('', undefined, { restart: false });
      expect(backend.getLiveQuery).not.toHaveBeenCalled();
    });
  });

  describe('mcp:toggle', () => {
    it('disable: persists by config name, toggles live by control name, flags other scopes without restart', async () => {
      const res = await handler('mcp:toggle')('/p', 's1', 'tools-beta', false, 'plugin', 'plugin:tools:beta');
      expect(res).toEqual({ ok: true });
      expect(mcpConfig.setMcpServerDisabled).toHaveBeenCalledWith(expect.anything(), 'tools-beta', 'plugin', true);
      expect(q.toggleMcpServer).toHaveBeenCalledWith('plugin:tools:beta', false);
      expect(backend.markMcpStale).toHaveBeenCalledWith('/p', 's1', { restart: false, projectOnly: false });
    });

    it('disable with no live session only persists and flags', async () => {
      backend.getLiveQuery.mockImplementation(() => null);
      expect(await handler('mcp:toggle')('/p', 's1', 'gh', false, 'project')).toEqual({ ok: true });
      expect(mcpConfig.setMcpServerDisabled).toHaveBeenCalledWith(expect.anything(), 'gh', 'project', true);
      expect(backend.markMcpStale).toHaveBeenCalledWith('/p', 's1', { restart: false, projectOnly: true });
      expect(backend.getLiveQuery).not.toHaveBeenCalledWith('/p', 's1', { create: true });
    });

    it('enable: persists, then applies; "Server not found" from the live toggle is not an error', async () => {
      q.toggleMcpServer.mockRejectedValueOnce(new Error('Server not found: gh'));
      const res = await handler('mcp:toggle')('/p', 's1', 'gh', true, 'user');
      expect(res).toEqual({ ok: true });
      expect(mcpConfig.setMcpServerDisabled).toHaveBeenCalledWith(expect.anything(), 'gh', 'user', false);
      expect(backend.markMcpStale).toHaveBeenCalledWith('/p', 's1', { restart: true, projectOnly: false });
    });

    it('surfaces other live toggle errors', async () => {
      q.toggleMcpServer.mockRejectedValueOnce(new Error('boom'));
      expect(await handler('mcp:toggle')('/p', 's1', 'gh', false, 'user')).toEqual({ ok: false, error: 'boom' });
    });

    it('a failed persist returns the error and touches no session', async () => {
      mcpConfig.setMcpServerDisabled.mockImplementationOnce(() => { throw new Error('Cannot update x: file is not valid JSON'); });
      expect(await handler('mcp:toggle')('/p', 's1', 'gh', false, 'user'))
        .toEqual({ ok: false, error: 'Cannot update x: file is not valid JSON' });
      expect(q.toggleMcpServer).not.toHaveBeenCalled();
      expect(backend.markMcpStale).not.toHaveBeenCalled();
    });

    it('claude.ai connectors are toggled live only', async () => {
      expect(await handler('mcp:toggle')('/p', 's1', 'claude.ai Gmail', false, 'claudeai')).toEqual({ ok: true });
      expect(mcpConfig.setMcpServerDisabled).not.toHaveBeenCalled();
      expect(q.toggleMcpServer).toHaveBeenCalledWith('claude.ai Gmail', false);
    });
  });

  describe('init-frame hook', () => {
    beforeEach(() => vi.useFakeTimers());
    afterEach(() => vi.useRealTimers());

    it('every init-frame report starts watching pending servers on the existing query', async () => {
      recordMcpRuntimeStatus('/p', 's1', [{ name: 'gh', status: 'pending' }]);
      notifyMcpInitFrame('/p', 's1');
      await vi.advanceTimersByTimeAsync(2000);
      expect(backend.getLiveQuery).toHaveBeenCalledWith('/p', 's1', { create: false });
      expect(q.mcpServerStatus).toHaveBeenCalled();
    });

    it('pushes a FULL snapshot (available + capabilities) so a nudge mounted before the session sees it', () => {
      const send = vi.fn();
      win.current = { isDestroyed: () => false, webContents: { send } };
      (q as any).mcpAuthenticate = vi.fn();
      recordMcpRuntimeStatus('/p', 's1', [{ name: 'cf', status: 'needs-auth' }]);
      notifyMcpInitFrame('/p', 's1');
      expect(backend.getLiveQuery).toHaveBeenCalledWith('/p', 's1', { create: false });
      expect(send).toHaveBeenCalledWith('mcp:runtime-status', expect.objectContaining({
        projectPath: '/p', scope: 's1', available: true,
        capabilities: expect.objectContaining({ authenticate: true }),
        servers: { cf: { name: 'cf', status: 'needs-auth' } },
      }));
    });

    it('never sends to a destroyed window', async () => {
      const send = vi.fn(() => { throw new Error('Object has been destroyed'); });
      win.current = { isDestroyed: () => true, webContents: { send } };
      recordMcpRuntimeStatus('/p', 's1', [{ name: 'gh', status: 'pending' }]);
      expect(() => notifyMcpInitFrame('/p', 's1')).not.toThrow();
      await vi.advanceTimersByTimeAsync(2000);
      expect(send).not.toHaveBeenCalled();
    });
  });
});
