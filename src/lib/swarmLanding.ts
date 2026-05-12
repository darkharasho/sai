import type { SwarmTask } from '../types';

export interface LandDeps {
  canFastForward: (cwd: string, source: string, target: string) => Promise<boolean>;
  ffMerge: (cwd: string, source: string) => Promise<void>;
  worktreeRemove: (cwd: string, worktreePath: string, branch: string) => Promise<void>;
  updateTask: (id: string, patch: Partial<SwarmTask>) => Promise<void>;
  /** Optional: rebase the task's branch onto its base branch. When provided
   *  and a fast-forward isn't possible, landTask will auto-rebase and retry
   *  before falling back to the rebase-needed result. */
  rebase?: (worktreePath: string, baseBranch: string) => Promise<void>;
}

export async function landTask(
  task: SwarmTask,
  deps: LandDeps
): Promise<{ ok: true } | { ok: false; reason: 'rebase-needed'; detail?: string }> {
  if (!task.worktreePath) {
    await deps.updateTask(task.id, { status: 'landed' });
    return { ok: true };
  }
  let canFf = await deps.canFastForward(task.workspaceId, task.branch, task.baseBranch);
  if (!canFf && deps.rebase) {
    // Diverged: try an auto-rebase against baseBranch in the worktree, then
    // re-check canFastForward. Common when sibling tasks landed first and
    // advanced the base branch beyond this task's fork point.
    try {
      await deps.rebase(task.worktreePath, task.baseBranch);
      canFf = await deps.canFastForward(task.workspaceId, task.branch, task.baseBranch);
    } catch (err) {
      return { ok: false, reason: 'rebase-needed', detail: err instanceof Error ? err.message : String(err) };
    }
  }
  if (!canFf) return { ok: false, reason: 'rebase-needed' };
  await deps.ffMerge(task.workspaceId, task.branch);
  await deps.worktreeRemove(task.workspaceId, task.worktreePath, task.branch);
  await deps.updateTask(task.id, { status: 'landed', worktreePath: null });
  return { ok: true };
}

export interface DiscardDeps {
  worktreeRemove: (cwd: string, worktreePath: string, branch: string) => Promise<void>;
  updateTask: (id: string, patch: Partial<SwarmTask>) => Promise<void>;
}

export async function discardTask(task: SwarmTask, deps: DiscardDeps) {
  if (task.worktreePath) await deps.worktreeRemove(task.workspaceId, task.worktreePath, task.branch);
  await deps.updateTask(task.id, { status: 'discarded', worktreePath: null });
}
