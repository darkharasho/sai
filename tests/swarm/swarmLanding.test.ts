import { describe, it, expect, vi } from 'vitest';
import { landTask, discardTask } from '@/lib/swarmLanding';

describe('swarmLanding', () => {
  it('lands a task by ff-merging then removing worktree', async () => {
    const canFf = vi.fn().mockResolvedValue(true);
    const ffMerge = vi.fn().mockResolvedValue(undefined);
    const wtRemove = vi.fn().mockResolvedValue(undefined);
    const updateTask = vi.fn().mockResolvedValue(undefined);
    const task = { id: 't', workspaceId: '/p', branch: 'swarm/x', baseBranch: 'main', worktreePath: '/wt' } as any;
    const r = await landTask(task, { canFastForward: canFf, ffMerge, worktreeRemove: wtRemove, updateTask });
    expect(r).toEqual({ ok: true });
    expect(ffMerge).toHaveBeenCalledWith('/p', 'swarm/x');
    expect(updateTask).toHaveBeenCalledWith('t', { status: 'landed', worktreePath: null });
  });

  it('reports rebase-needed when FF is not possible', async () => {
    const task = { id: 't', workspaceId: '/p', branch: 'swarm/x', baseBranch: 'main', worktreePath: '/wt' } as any;
    const r = await landTask(task, {
      canFastForward: () => Promise.resolve(false),
      ffMerge: vi.fn(), worktreeRemove: vi.fn(), updateTask: vi.fn(),
    });
    expect(r).toMatchObject({ ok: false, reason: 'rebase-needed' });
  });

  it('discards by removing worktree, branch, and marking discarded', async () => {
    const wtRemove = vi.fn(); const updateTask = vi.fn();
    const task = { id: 't', workspaceId: '/p', branch: 'swarm/x', worktreePath: '/wt' } as any;
    await discardTask(task, { worktreeRemove: wtRemove, updateTask });
    expect(wtRemove).toHaveBeenCalledWith('/p', '/wt', 'swarm/x');
    expect(updateTask).toHaveBeenCalledWith('t', { status: 'discarded', worktreePath: null });
  });
});
