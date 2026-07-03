import { describe, it, expect, vi } from 'vitest';
import { removeWorktreeAndBranch, findOrphanWorktrees, planSwarmGc } from '../../electron/services/swarmWorktreeCleanup';

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

describe('planSwarmGc', () => {
  const wt = (taskId: string, branch: string | null = `swarm/${taskId}`) => ({
    path: `/parent/.sai-swarm/ws/${taskId}`, taskId, branch,
  });

  it('removes worktrees with no live task and keeps live ones', () => {
    const plan = planSwarmGc({
      swarmWorktrees: [wt('dead1'), wt('live1')],
      swarmBranches: ['swarm/dead1', 'swarm/live1'],
      liveTaskIds: new Set(['live1']),
      liveBranches: new Set(['swarm/live1']),
    });
    expect(plan.removeWorktrees.map(w => w.taskId)).toEqual(['dead1']);
    // dead1's branch rides along with its worktree removal; live1's survives.
    expect(plan.deleteBranches).toEqual([]);
  });

  it('deletes dangling swarm/* branches that have no worktree and no live task', () => {
    const plan = planSwarmGc({
      swarmWorktrees: [],
      swarmBranches: ['swarm/dangling-a', 'swarm/owned'],
      liveTaskIds: new Set(),
      liveBranches: new Set(['swarm/owned']),
    });
    expect(plan.deleteBranches).toEqual(['swarm/dangling-a']);
  });

  it('never deletes a branch checked out in a surviving worktree', () => {
    const plan = planSwarmGc({
      swarmWorktrees: [wt('live1', 'swarm/shared')],
      swarmBranches: ['swarm/shared'],
      liveTaskIds: new Set(['live1']),
      liveBranches: new Set(),           // task row lost the branch name somehow
    });
    expect(plan.removeWorktrees).toEqual([]);
    expect(plan.deleteBranches).toEqual([]);
  });

  it('never touches non-swarm branches even if passed in', () => {
    const plan = planSwarmGc({
      swarmWorktrees: [],
      swarmBranches: ['main', 'feature/x'],
      liveTaskIds: new Set(),
      liveBranches: new Set(),
    });
    expect(plan.deleteBranches).toEqual([]);
  });

  it('handles detached-HEAD worktrees (null branch) without planning a branch delete', () => {
    const plan = planSwarmGc({
      swarmWorktrees: [wt('dead1', null)],
      swarmBranches: [],
      liveTaskIds: new Set(),
      liveBranches: new Set(),
    });
    expect(plan.removeWorktrees.map(w => w.taskId)).toEqual(['dead1']);
    expect(plan.deleteBranches).toEqual([]);
  });

  it('does not double-delete a branch whose worktree is being removed in the same plan', () => {
    const plan = planSwarmGc({
      swarmWorktrees: [wt('dead1', 'swarm/dead1')],
      swarmBranches: ['swarm/dead1'],
      liveTaskIds: new Set(),
      liveBranches: new Set(),
    });
    expect(plan.removeWorktrees.map(w => w.taskId)).toEqual(['dead1']);
    expect(plan.deleteBranches).toEqual([]);
  });
});
