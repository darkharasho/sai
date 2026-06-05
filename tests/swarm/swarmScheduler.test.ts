import { describe, it, expect, vi } from 'vitest';
import { SwarmScheduler, materializeIfNeeded, findStaleTasks } from '@/lib/swarmScheduler';

describe('SwarmScheduler', () => {
  it('promotes up to cap from queued to streaming and calls onStart', () => {
    const onStart = vi.fn();
    const s = new SwarmScheduler({ cap: 2, onStart });
    s.setTasks([
      { id: 'a', status: 'queued' }, { id: 'b', status: 'queued' },
      { id: 'c', status: 'queued' }, { id: 'd', status: 'streaming' },
    ] as any);
    // setTasks triggers tick() internally; cap 2 minus 1 streaming = 1 free slot.
    expect(onStart).toHaveBeenCalledTimes(1);
    expect(onStart).toHaveBeenCalledWith(expect.objectContaining({ id: 'a' }));
  });
  it('does not promote when at cap', () => {
    const onStart = vi.fn();
    const s = new SwarmScheduler({ cap: 2, onStart });
    s.setTasks([{ id: 'a', status: 'streaming' }, { id: 'b', status: 'streaming' }, { id: 'c', status: 'queued' }] as any);
    expect(onStart).not.toHaveBeenCalled();
  });
});

describe('SwarmScheduler — slot accounting', () => {
  it('counts a pending (not-yet-streaming) start against the cap', () => {
    const onStart = vi.fn(() => new Promise<void>(() => { /* never resolves */ }));
    const s = new SwarmScheduler({ cap: 1, onStart });
    s.setTasks([{ id: 'a', status: 'queued' }, { id: 'b', status: 'queued' }] as any);
    // Only one slot: 'a' is promoted (pending), 'b' must wait even though
    // 'a' has not yet flipped to 'streaming' in external state.
    expect(onStart).toHaveBeenCalledTimes(1);
    expect(onStart).toHaveBeenCalledWith(expect.objectContaining({ id: 'a' }));
  });

  it('does not double-promote a task already pending across re-ticks', () => {
    const onStart = vi.fn(() => new Promise<void>(() => {}));
    const s = new SwarmScheduler({ cap: 2, onStart });
    s.setTasks([{ id: 'a', status: 'queued' }] as any);
    // Same still-queued task list arrives again (e.g. unrelated state change).
    s.setTasks([{ id: 'a', status: 'queued' }] as any);
    expect(onStart).toHaveBeenCalledTimes(1);
  });

  it('stops counting a pending task once external state reports it streaming', () => {
    const onStart = vi.fn(() => new Promise<void>(() => {}));
    const s = new SwarmScheduler({ cap: 1, onStart });
    s.setTasks([{ id: 'a', status: 'queued' }, { id: 'b', status: 'queued' }] as any);
    expect(onStart).toHaveBeenCalledTimes(1); // a pending
    // a is now confirmed streaming; b still queued. Cap 1 is full → no new start.
    s.setTasks([{ id: 'a', status: 'streaming' }, { id: 'b', status: 'queued' }] as any);
    expect(onStart).toHaveBeenCalledTimes(1);
  });

  it('frees the slot after a synchronous onStart throw (promotes on the next tick)', () => {
    const onStart = vi.fn()
      .mockImplementationOnce(() => { throw new Error('boom'); }) // a fails
      .mockImplementation(() => new Promise<void>(() => {}));      // later tasks hang
    const s = new SwarmScheduler({ cap: 1, onStart });
    s.setTasks([{ id: 'a', status: 'queued' }, { id: 'b', status: 'queued' }] as any);
    // a was attempted and threw, releasing its reserved slot.
    expect(onStart).toHaveBeenCalledTimes(1);
    // App removes the failed task from state; the next tick fills the free slot.
    s.setTasks([{ id: 'b', status: 'queued' }] as any);
    expect(onStart).toHaveBeenCalledTimes(2);
    expect(onStart).toHaveBeenNthCalledWith(2, expect.objectContaining({ id: 'b' }));
  });

  it('frees the slot when onStart rejects, promoting another on the next tick', async () => {
    const onStart = vi.fn()
      .mockImplementationOnce(() => Promise.reject(new Error('async boom'))) // a
      .mockImplementation(() => new Promise<void>(() => {}));                 // b hangs
    const s = new SwarmScheduler({ cap: 1, onStart });
    s.setTasks([{ id: 'a', status: 'queued' }, { id: 'b', status: 'queued' }] as any);
    // a is pending; b waits until a's rejection frees the slot.
    expect(onStart).toHaveBeenCalledTimes(1);
    await Promise.resolve(); await Promise.resolve(); // flush microtasks
    // Mirror real App behavior: failed task is removed from state, scheduler re-ticked.
    s.setTasks([{ id: 'b', status: 'queued' }] as any);
    expect(onStart).toHaveBeenCalledWith(expect.objectContaining({ id: 'b' }));
  });
});

describe('findStaleTasks', () => {
  const mk = (id: string, status: string, lastActivityAt: number) =>
    ({ id, status, lastActivityAt } as any);

  it('flags streaming tasks idle longer than the threshold', () => {
    const now = 100_000;
    const stale = findStaleTasks(
      [
        mk('a', 'streaming', now - 90_000), // idle 90s
        mk('b', 'streaming', now - 1_000),  // fresh
        mk('c', 'queued', 0),               // not streaming → ignored
        mk('d', 'awaiting_approval', 0),    // not streaming → ignored
      ],
      now,
      60_000,
    );
    expect(stale.map(t => t.id)).toEqual(['a']);
  });

  it('returns empty when nothing is stale', () => {
    const now = 100_000;
    expect(findStaleTasks([mk('a', 'streaming', now)], now, 60_000)).toEqual([]);
  });

  it('treats exactly-at-threshold as not yet stale', () => {
    const now = 100_000;
    expect(findStaleTasks([mk('a', 'streaming', now - 60_000)], now, 60_000)).toEqual([]);
  });
});

describe('materializeIfNeeded — real provider tool names', () => {
  const baseTask = {
    id: 't1', workspaceId: '/ws', sessionId: 's1', title: 't', prompt: 'p',
    provider: 'claude' as const, model: 'm', approvalPolicy: 'auto-read' as const,
    status: 'streaming' as const, branch: 'swarm/t1', baseBranch: 'main',
    worktreePath: null, projectPath: '/ws', createdAt: 0, lastActivityAt: 0,
    costEstimate: 0, toolCallCount: 0,
  };

  it('materializes a worktree for a real Edit tool', async () => {
    const worktreeAdd = vi.fn().mockResolvedValue('/ws/.sai-swarm/t1');
    const updateTask = vi.fn().mockResolvedValue(undefined);
    const wt = await materializeIfNeeded(baseTask, 'Edit', { worktreeAdd, updateTask });
    expect(worktreeAdd).toHaveBeenCalledTimes(1);
    expect(wt).toBe('/ws/.sai-swarm/t1');
  });

  it('does NOT materialize for a real Read tool', async () => {
    const worktreeAdd = vi.fn().mockResolvedValue('/ws/.sai-swarm/t1');
    const updateTask = vi.fn().mockResolvedValue(undefined);
    const wt = await materializeIfNeeded(baseTask, 'Read', { worktreeAdd, updateTask });
    expect(worktreeAdd).not.toHaveBeenCalled();
    expect(wt).toBeNull();
  });
});
