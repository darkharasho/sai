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
  // Try the happy path; if either canFastForward returns false OR ffMerge
  // throws (race with a sibling land that advanced main between our check and
  // our merge), auto-rebase and retry. Only give up after the rebase + retry
  // also fails — that indicates a true conflict the user has to resolve.
  const tryFastForward = async (): Promise<true | { reason: string }> => {
    const canFf = await deps.canFastForward(task.workspaceId, task.branch, task.baseBranch);
    if (!canFf) return { reason: 'not-ancestor' };
    try {
      await deps.ffMerge(task.workspaceId, task.branch);
      return true;
    } catch (err) {
      return { reason: err instanceof Error ? err.message : String(err) };
    }
  };

  let result = await tryFastForward();
  if (result !== true && deps.rebase) {
    try {
      await deps.rebase(task.worktreePath, task.baseBranch);
    } catch (err) {
      return { ok: false, reason: 'rebase-needed', detail: err instanceof Error ? err.message : String(err) };
    }
    result = await tryFastForward();
  }
  if (result !== true) return { ok: false, reason: 'rebase-needed', detail: result.reason };

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
