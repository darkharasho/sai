// @vitest-environment node
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createMcpControl, type McpControlQuery } from '@electron/services/claudeBackend/mcpControl';
import {
  __resetMcpRuntimeStatusForTests,
  getMcpRuntimeStatus,
  recordMcpRuntimeStatus,
} from '@electron/services/claudeBackend/mcpRuntimeStatus';

function fakeQuery(over: Partial<McpControlQuery> = {}) {
  let list: any[] = [{ name: 'cf', status: 'needs-auth', config: { type: 'http', url: 'https://cf' } }];
  const q: McpControlQuery & { setList(l: any[]): void } = {
    mcpServerStatus: vi.fn(async () => list),
    reconnectMcpServer: vi.fn(async () => {}),
    toggleMcpServer: vi.fn(async () => {}),
    mcpAuthenticate: vi.fn(async () => ({ authUrl: 'https://auth/x', requiresUserAction: true, callbackExpected: true })),
    mcpClearAuth: vi.fn(async () => {}),
    mcpSubmitOAuthCallbackUrl: vi.fn(async () => {}),
    setList(l) { list = l; },
    ...over,
  };
  return q;
}

describe('mcpControl', () => {
  let now = 0;
  beforeEach(() => { __resetMcpRuntimeStatusForTests(); vi.useFakeTimers(); now = 0; });
  afterEach(() => vi.useRealTimers());

  const make = (q: McpControlQuery | null, extra: { markMcpStale?: (p: string, s: string | undefined, o: { restart: boolean; projectOnly: boolean }) => void } = {}) => {
    const push = vi.fn();
    const openExternal = vi.fn();
    const getQuery = vi.fn(() => q);
    const ctl = createMcpControl({ getQuery, push, openExternal, pollMs: 2000, timeoutMs: 10_000, now: () => now, ...extra });
    return { ctl, push, openExternal, getQuery };
  };

  it('status(): creates session, stores full entries, reports capabilities', async () => {
    const q = fakeQuery();
    const { ctl, getQuery, push } = make(q);
    const snap = await ctl.status('/p', 's1');
    expect(getQuery).toHaveBeenCalledWith('/p', 's1', true);
    expect(snap.available).toBe(true);
    expect(snap.servers.cf.status).toBe('needs-auth');
    expect(snap.capabilities).toEqual({ status: true, reconnect: true, toggle: true, authenticate: true, clearAuth: true, submitCallbackUrl: true });
    expect(push).toHaveBeenCalledWith(snap);
  });

  it('no live session → available:false, actions fail cleanly', async () => {
    const { ctl } = make(null);
    expect((await ctl.status('/p', 's1')).available).toBe(false);
    expect(await ctl.reconnect('/p', 's1', 'cf')).toEqual({ ok: false, error: 'Live status unavailable — no Claude session' });
  });

  it('missing untyped methods → capability false + clear error', async () => {
    const q = fakeQuery({ mcpAuthenticate: undefined });
    const { ctl } = make(q);
    expect((await ctl.status('/p', 's1')).capabilities.authenticate).toBe(false);
    expect(await ctl.authenticate('/p', 's1', 'cf')).toEqual({ ok: false, error: 'This Claude runtime does not support in-app sign-in' });
  });

  it('peek() never creates a session', () => {
    const { ctl, getQuery } = make(fakeQuery());
    ctl.peek('/p', 's1');
    expect(getQuery).toHaveBeenCalledWith('/p', 's1', false);
  });

  it('reconnect(): calls SDK, then refreshes; errors are surfaced', async () => {
    const q = fakeQuery({ reconnectMcpServer: vi.fn(async () => { throw new Error('Server not found: x'); }) });
    const { ctl } = make(q);
    expect(await ctl.reconnect('/p', 's1', 'x')).toEqual({ ok: false, error: 'Server not found: x' });
    expect(q.mcpServerStatus).toHaveBeenCalled();
  });

  it('authenticate(): opens browser, sets waiting, clears on connected', async () => {
    const q = fakeQuery();
    const { ctl, openExternal } = make(q);
    const res = await ctl.authenticate('/p', 's1', 'cf');
    expect(res).toEqual({ ok: true, state: 'awaiting-browser', authUrl: 'https://auth/x' });
    expect(openExternal).toHaveBeenCalledWith('https://auth/x');
    expect(getMcpRuntimeStatus('/p', 's1').auth.cf).toEqual({ phase: 'waiting', authUrl: 'https://auth/x' });

    q.setList([{ name: 'cf', status: 'connected' }]);
    await vi.advanceTimersByTimeAsync(2000);
    expect(getMcpRuntimeStatus('/p', 's1').auth.cf).toBeUndefined();
    expect(getMcpRuntimeStatus('/p', 's1').servers.cf.status).toBe('connected');
  });

  it('authenticate(): unwraps {response:{...}} shape', async () => {
    const q = fakeQuery({ mcpAuthenticate: vi.fn(async () => ({ response: { authUrl: 'https://w', requiresUserAction: true } })) });
    const { ctl } = make(q);
    expect(await ctl.authenticate('/p', 's1', 'cf')).toEqual({ ok: true, state: 'awaiting-browser', authUrl: 'https://w' });
  });

  it('authenticate(): already authorized → reconnect path, no browser', async () => {
    const q = fakeQuery({ mcpAuthenticate: vi.fn(async () => ({ requiresUserAction: false })) });
    const { ctl, openExternal } = make(q);
    expect(await ctl.authenticate('/p', 's1', 'cf')).toEqual({ ok: true, state: 'already-authorized' });
    expect(openExternal).not.toHaveBeenCalled();
  });

  it('authenticate(): times out', async () => {
    const { ctl } = make(fakeQuery());
    await ctl.authenticate('/p', 's1', 'cf');
    now = 10_001;
    await vi.advanceTimersByTimeAsync(2000);
    expect(getMcpRuntimeStatus('/p', 's1').auth.cf).toMatchObject({ phase: 'timeout' });
  });

  it('authenticate(): failed status → error phase', async () => {
    const q = fakeQuery();
    const { ctl } = make(q);
    await ctl.authenticate('/p', 's1', 'cf');
    q.setList([{ name: 'cf', status: 'failed', error: 'invalid_grant' }]);
    await vi.advanceTimersByTimeAsync(2000);
    expect(getMcpRuntimeStatus('/p', 's1').auth.cf).toEqual({ phase: 'error', error: 'invalid_grant' });
  });

  it('authenticate(): the session the sign-in started on is replaced → error, polling stops', async () => {
    const q = fakeQuery();
    const { ctl, getQuery, push } = make(q);
    await ctl.authenticate('/p', 's1', 'cf');
    const other = fakeQuery();
    getQuery.mockImplementation(() => other); // respawned (send, sweep, suspend…)
    await vi.advanceTimersByTimeAsync(2000);
    expect(getMcpRuntimeStatus('/p', 's1').auth.cf).toEqual({ phase: 'error', error: 'Session restarted during sign-in — try again' });
    expect(push).toHaveBeenLastCalledWith(expect.objectContaining({ auth: { cf: expect.objectContaining({ phase: 'error' }) } }));
    (other.mcpServerStatus as any).mockClear();
    await vi.advanceTimersByTimeAsync(6000);
    expect(other.mcpServerStatus).not.toHaveBeenCalled();
  });

  it('authenticate(): the session the sign-in started on is gone → error', async () => {
    const q = fakeQuery();
    const { ctl, getQuery } = make(q);
    await ctl.authenticate('/p', 's1', 'cf');
    getQuery.mockImplementation(() => null);
    await vi.advanceTimersByTimeAsync(2000);
    expect(getMcpRuntimeStatus('/p', 's1').auth.cf).toMatchObject({ phase: 'error' });
  });

  it('second authenticate() replaces the first poller', async () => {
    const q = fakeQuery();
    const { ctl } = make(q);
    await ctl.authenticate('/p', 's1', 'cf');
    now = 6000;
    await ctl.authenticate('/p', 's1', 'cf'); // restarts the 10s window at t=6000
    now = 12_000;                              // past first window, inside second
    await vi.advanceTimersByTimeAsync(2000);
    expect(getMcpRuntimeStatus('/p', 's1').auth.cf).toMatchObject({ phase: 'waiting' });
  });

  it('a stale poll whose status hung across a second authenticate() cannot end the new poller', async () => {
    const q = fakeQuery();
    const { ctl } = make(q);
    await ctl.authenticate('/p', 's1', 'cf');

    // First poller's tick hangs inside mcpServerStatus().
    let release!: (l: unknown[]) => void;
    (q.mcpServerStatus as any).mockImplementationOnce(() => new Promise<unknown[]>((r) => { release = r; }));
    await vi.advanceTimersByTimeAsync(2000);

    now = 11_000; // past the FIRST poller's 10s window
    await ctl.authenticate('/p', 's1', 'cf'); // new poller, window starts at 11_000

    // The hung tick resumes: without the handle guard it would see a 11s-old
    // window, mark timeout and stop the NEW poller.
    release([{ name: 'cf', status: 'needs-auth' }]);
    await vi.advanceTimersByTimeAsync(0);
    expect(getMcpRuntimeStatus('/p', 's1').auth.cf).toEqual({ phase: 'waiting', authUrl: 'https://auth/x' });

    // The new poller is still alive and completes normally.
    q.setList([{ name: 'cf', status: 'connected' }]);
    await vi.advanceTimersByTimeAsync(2000);
    expect(getMcpRuntimeStatus('/p', 's1').auth.cf).toBeUndefined();
  });

  it('a status call that never answers cannot hold the sign-in past the cap, and ticks never stack', async () => {
    const q = fakeQuery();
    const { ctl } = make(q);
    await ctl.authenticate('/p', 's1', 'cf');
    (q.mcpServerStatus as any).mockClear();
    (q.mcpServerStatus as any).mockImplementation(() => new Promise(() => {}));
    await vi.advanceTimersByTimeAsync(8000);
    expect(q.mcpServerStatus).toHaveBeenCalledTimes(1);
    expect(getMcpRuntimeStatus('/p', 's1').auth.cf).toMatchObject({ phase: 'waiting' });

    now = 10_001;
    await vi.advanceTimersByTimeAsync(2000);
    expect(getMcpRuntimeStatus('/p', 's1').auth.cf).toEqual({ phase: 'timeout', authUrl: 'https://auth/x' });
    await vi.advanceTimersByTimeAsync(6000);
    expect(q.mcpServerStatus).toHaveBeenCalledTimes(1);
  });

  it('cancelAuth() during an in-flight tick: the late status cannot set auth state', async () => {
    const q = fakeQuery();
    const { ctl } = make(q);
    await ctl.authenticate('/p', 's1', 'cf');
    let release!: (l: unknown[]) => void;
    (q.mcpServerStatus as any).mockImplementationOnce(() => new Promise<unknown[]>((r) => { release = r; }));
    await vi.advanceTimersByTimeAsync(2000);
    ctl.cancelAuth('/p', 's1', 'cf');
    release([{ name: 'cf', status: 'failed', error: 'late' }]);
    await vi.advanceTimersByTimeAsync(0);
    expect(getMcpRuntimeStatus('/p', 's1').auth.cf).toBeUndefined();
    (q.mcpServerStatus as any).mockClear();
    await vi.advanceTimersByTimeAsync(6000);
    expect(q.mcpServerStatus).not.toHaveBeenCalled();
  });

  it('dispose() stops every auth poller and pending watcher', async () => {
    recordMcpRuntimeStatus('/p', 's2', [{ name: 'cf', status: 'pending' }]);
    const q = fakeQuery();
    const { ctl } = make(q);
    await ctl.authenticate('/p', 's1', 'cf');
    ctl.watchPending('/p', 's2');
    ctl.dispose();
    (q.mcpServerStatus as any).mockClear();
    await vi.advanceTimersByTimeAsync(10_000);
    expect(q.mcpServerStatus).not.toHaveBeenCalled();
  });

  it('cancelAuth() stops polling and clears state', async () => {
    const q = fakeQuery();
    const { ctl } = make(q);
    await ctl.authenticate('/p', 's1', 'cf');
    ctl.cancelAuth('/p', 's1', 'cf');
    (q.mcpServerStatus as any).mockClear();
    await vi.advanceTimersByTimeAsync(6000);
    expect(q.mcpServerStatus).not.toHaveBeenCalled();
    expect(getMcpRuntimeStatus('/p', 's1').auth.cf).toBeUndefined();
  });

  it('submitCallbackUrl() rejects URLs without code/error', async () => {
    const { ctl } = make(fakeQuery());
    expect(await ctl.submitCallbackUrl('/p', 's1', 'cf', 'http://localhost:1234/cb')).toEqual({
      ok: false, error: 'That URL has no "code" or "error" parameter — copy the full address from the browser after approving',
    });
  });

  describe('watchPending()', () => {
    it('polls the existing query while any server is pending, pushes changes, stops when none pending', async () => {
      recordMcpRuntimeStatus('/p', 's1', [{ name: 'cf', status: 'pending' }]);
      const q = fakeQuery();
      q.setList([{ name: 'cf', status: 'pending' }]);
      const { ctl, push, getQuery } = make(q);

      ctl.watchPending('/p', 's1');
      await vi.advanceTimersByTimeAsync(2000);
      expect(getQuery).toHaveBeenCalledWith('/p', 's1', false);
      expect(getQuery).not.toHaveBeenCalledWith('/p', 's1', true);
      expect(push).not.toHaveBeenCalled(); // still pending — nothing changed

      q.setList([{ name: 'cf', status: 'needs-auth' }]);
      await vi.advanceTimersByTimeAsync(2000);
      expect(push).toHaveBeenCalledTimes(1);
      expect(push.mock.calls[0][0].servers.cf.status).toBe('needs-auth');

      (q.mcpServerStatus as any).mockClear();
      await vi.advanceTimersByTimeAsync(6000);
      expect(q.mcpServerStatus).not.toHaveBeenCalled();
    });

    it('gives up after 60s', async () => {
      recordMcpRuntimeStatus('/p', 's1', [{ name: 'cf', status: 'pending' }]);
      const q = fakeQuery();
      q.setList([{ name: 'cf', status: 'pending' }]);
      const { ctl } = make(q);

      ctl.watchPending('/p', 's1');
      now = 60_001;
      await vi.advanceTimersByTimeAsync(2000);
      (q.mcpServerStatus as any).mockClear();
      await vi.advanceTimersByTimeAsync(6000);
      expect(q.mcpServerStatus).not.toHaveBeenCalled();
    });

    it('status() keeps watching servers it read as pending — a session nobody has sent to emits no init frame', async () => {
      const q = fakeQuery();
      q.setList([{ name: 'cf', status: 'pending' }]);
      const { ctl, push } = make(q);
      await ctl.status('/p', 's1');
      q.setList([{ name: 'cf', status: 'connected' }]);
      await vi.advanceTimersByTimeAsync(2000);
      expect(getMcpRuntimeStatus('/p', 's1').servers.cf.status).toBe('connected');
      expect(push.mock.calls.at(-1)![0].servers.cf.status).toBe('connected');
    });

    it('reconnect() keeps watching a server it left pending', async () => {
      const q = fakeQuery();
      q.setList([{ name: 'cf', status: 'pending' }]);
      const { ctl } = make(q);
      await ctl.reconnect('/p', 's1', 'cf');
      q.setList([{ name: 'cf', status: 'failed', error: 'boom' }]);
      await vi.advanceTimersByTimeAsync(2000);
      expect(getMcpRuntimeStatus('/p', 's1').servers.cf.status).toBe('failed');
    });

    it('does nothing when no server is pending', async () => {
      recordMcpRuntimeStatus('/p', 's1', [{ name: 'cf', status: 'connected' }]);
      const q = fakeQuery();
      const { ctl } = make(q);
      ctl.watchPending('/p', 's1');
      await vi.advanceTimersByTimeAsync(6000);
      expect(q.mcpServerStatus).not.toHaveBeenCalled();
    });

    it('stops when the scope has no live query', async () => {
      recordMcpRuntimeStatus('/p', 's1', [{ name: 'cf', status: 'pending' }]);
      const { ctl, getQuery } = make(null);
      ctl.watchPending('/p', 's1');
      await vi.advanceTimersByTimeAsync(6000);
      expect(getQuery).toHaveBeenCalledTimes(1);
      expect(getQuery).toHaveBeenCalledWith('/p', 's1', false);
    });

    it('a hung status cannot extend the 60s cap, and ticks never stack', async () => {
      recordMcpRuntimeStatus('/p', 's1', [{ name: 'cf', status: 'pending' }]);
      const q = fakeQuery({ mcpServerStatus: vi.fn(() => new Promise<unknown[]>(() => {})) });
      const { ctl, getQuery } = make(q);
      ctl.watchPending('/p', 's1');
      await vi.advanceTimersByTimeAsync(8000);
      expect(q.mcpServerStatus).toHaveBeenCalledTimes(1);
      now = 60_001;
      await vi.advanceTimersByTimeAsync(2000);
      getQuery.mockClear();
      await vi.advanceTimersByTimeAsync(6000);
      expect(getQuery).not.toHaveBeenCalled(); // stopped
      expect(q.mcpServerStatus).toHaveBeenCalledTimes(1);
    });

    it('a second call while watching does not start a second poller', async () => {
      recordMcpRuntimeStatus('/p', 's1', [{ name: 'cf', status: 'pending' }]);
      const q = fakeQuery();
      q.setList([{ name: 'cf', status: 'pending' }]);
      const { ctl } = make(q);
      ctl.watchPending('/p', 's1');
      ctl.watchPending('/p', 's1');
      await vi.advanceTimersByTimeAsync(2000);
      expect(q.mcpServerStatus).toHaveBeenCalledTimes(1);
    });
  });

  describe('applyConfig()', () => {
    it('marks sessions stale, then refreshes the panel scope (creating it) and pushes', async () => {
      const q = fakeQuery();
      const markMcpStale = vi.fn();
      const { ctl, getQuery, push } = make(q, { markMcpStale });
      const snap = await ctl.applyConfig('/p', 's1');
      expect(markMcpStale).toHaveBeenCalledWith('/p', 's1', { restart: true, projectOnly: false });
      expect(markMcpStale.mock.invocationCallOrder[0]).toBeLessThan((getQuery.mock.invocationCallOrder.at(-1))!);
      expect(getQuery).toHaveBeenCalledWith('/p', 's1', true);
      expect(snap.servers.cf.status).toBe('needs-auth');
      expect(push).toHaveBeenCalledWith(snap);
    });

    it('a sign-in in progress on the panel scope asks for no restart', async () => {
      const q = fakeQuery();
      const markMcpStale = vi.fn();
      const { ctl } = make(q, { markMcpStale });
      await ctl.authenticate('/p', 's1', 'cf');
      await ctl.applyConfig('/p', 's1');
      expect(markMcpStale).toHaveBeenCalledWith('/p', 's1', { restart: false, projectOnly: false });
      await ctl.applyConfig('/p', 's2'); // other scope — not pinned
      expect(markMcpStale).toHaveBeenLastCalledWith('/p', 's2', { restart: true, projectOnly: false });
      await ctl.applyConfig('/p', 's2', { projectOnly: true });
      expect(markMcpStale).toHaveBeenLastCalledWith('/p', 's2', { restart: true, projectOnly: true });
    });

    it('watches servers still pending after the respawn', async () => {
      const q = fakeQuery();
      q.setList([{ name: 'cf', status: 'pending' }]);
      const { ctl } = make(q, { markMcpStale: vi.fn() });
      await ctl.applyConfig('/p', 's1');
      q.setList([{ name: 'cf', status: 'connected' }]);
      await vi.advanceTimersByTimeAsync(2000);
      expect(getMcpRuntimeStatus('/p', 's1').servers.cf.status).toBe('connected');
    });
  });
});
