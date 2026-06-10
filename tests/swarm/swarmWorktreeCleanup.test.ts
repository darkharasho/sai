import { describe, it, expect, vi } from 'vitest';
import { removeWorktreeAndBranch, findOrphanWorktrees } from '../../electron/services/swarmWorktreeCleanup';

describe('removeWorktreeAndBranch', () => {
  it('removes the worktree then deletes the branch on success', async () => {
    const worktreeRemove = vi.fn().mockResolvedValue(undefined);
    const deleteBranch = vi.fn().mockResolvedValue(undefined);
    const worktreeExists = vi.fn().mockReturnValue(false);
    await removeWorktreeAndBranch('/p', '/wt', 'swarm/x', { worktreeRemove, deleteBranch, worktreeExists });
    expect(worktreeRemove).toHaveBeenCalledWith('/p', '/wt');
    expect(deleteBranch).toHaveBeenCalledWith('/p', 'swarm/x');
  });

  it('does NOT delete the branch and surfaces the error when the worktree still exists', async () => {
    const worktreeRemove = vi.fn().mockRejectedValue(new Error('locked'));
    const deleteBranch = vi.fn();
    const worktreeExists = vi.fn().mockReturnValue(true);
    await expect(
      removeWorktreeAndBranch('/p', '/wt', 'swarm/x', { worktreeRemove, deleteBranch, worktreeExists })
    ).rejects.toThrow('locked');
    expect(deleteBranch).not.toHaveBeenCalled();
  });

  it('still deletes the branch if remove errored but the worktree is gone anyway', async () => {
    const worktreeRemove = vi.fn().mockRejectedValue(new Error('already removed'));
    const deleteBranch = vi.fn().mockResolvedValue(undefined);
    const worktreeExists = vi.fn().mockReturnValue(false);
    await removeWorktreeAndBranch('/p', '/wt', 'swarm/x', { worktreeRemove, deleteBranch, worktreeExists });
    expect(deleteBranch).toHaveBeenCalledWith('/p', 'swarm/x');
  });
});

describe('findOrphanWorktrees', () => {
  it('returns worktree dirs whose taskId has no live task', () => {
    const orphans = findOrphanWorktrees(
      ['t1', 't2', 't3'],            // dir entries under .sai-swarm/<ws>/
      new Set(['t2']),               // live task ids
    );
    expect(orphans.sort()).toEqual(['t1', 't3']);
  });

  it('returns empty when every dir maps to a live task', () => {
    expect(findOrphanWorktrees(['t1'], new Set(['t1']))).toEqual([]);
  });

  it('returns empty for no dirs', () => {
    expect(findOrphanWorktrees([], new Set(['t1']))).toEqual([]);
  });
});
