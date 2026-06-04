import { describe, it, expect, vi } from 'vitest';
import { SwarmScheduler } from '@/lib/swarmScheduler';
import { materializeIfNeeded } from '@/lib/swarmScheduler';

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
