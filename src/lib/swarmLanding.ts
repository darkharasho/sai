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
  /** Optional: abort an in-progress rebase, leaving the worktree clean. Called
   *  when `rebase` throws so a failed land doesn't wedge the worktree. */
  rebaseAbort?: (worktreePath: string) => Promise<void>;
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
    const gitCwd = task.projectPath ?? task.workspaceId;
    const canFf = await deps.canFastForward(gitCwd, task.branch, task.baseBranch);
    if (!canFf) return { reason: 'not-ancestor' };
    try {
      await deps.ffMerge(gitCwd, task.branch);
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
      // Leave the worktree clean so the next attempt / retry isn't blocked by an
      // in-progress rebase.
      if (deps.rebaseAbort) {
        try { await deps.rebaseAbort(task.worktreePath); } catch { /* best-effort */ }
      }
      return { ok: false, reason: 'rebase-needed', detail: err instanceof Error ? err.message : String(err) };
    }
    result = await tryFastForward();
  }
  if (result !== true) return { ok: false, reason: 'rebase-needed', detail: result.reason };

  const gitCwd = task.projectPath ?? task.workspaceId;
  await deps.worktreeRemove(gitCwd, task.worktreePath, task.branch);
  await deps.updateTask(task.id, { status: 'landed', worktreePath: null });
  return { ok: true };
}

export interface DiscardDeps {
  worktreeRemove: (cwd: string, worktreePath: string, branch: string) => Promise<void>;
  updateTask: (id: string, patch: Partial<SwarmTask>) => Promise<void>;
}

export async function discardTask(task: SwarmTask, deps: DiscardDeps) {
  if (task.worktreePath) {
    const gitCwd = task.projectPath ?? task.workspaceId;
    await deps.worktreeRemove(gitCwd, task.worktreePath, task.branch);
  }
  await deps.updateTask(task.id, { status: 'discarded', worktreePath: null });
}

export interface RebaseRetryDeps {
  rebaseStatus: (worktreePath: string) => Promise<{ inProgress: boolean }>;
  rebaseAbort: (worktreePath: string) => Promise<void>;
  rebase: (worktreePath: string, baseBranch: string) => Promise<void>;
}

/**
 * Re-run a rebase for a "rebase + retry" land. Clears any in-progress rebase
 * first (re-running into an in-progress rebase is the wedge bug), then rebases.
 * On failure it aborts so the worktree is left clean.
 */
export async function rebaseRetry(
  worktreePath: string,
  baseBranch: string,
  deps: RebaseRetryDeps,
): Promise<{ ok: true } | { ok: false; detail: string }> {
  try {
    const status = await deps.rebaseStatus(worktreePath);
    if (status.inProgress) await deps.rebaseAbort(worktreePath);
    await deps.rebase(worktreePath, baseBranch);
    return { ok: true };
  } catch (err) {
    try { await deps.rebaseAbort(worktreePath); } catch { /* best-effort */ }
    return { ok: false, detail: err instanceof Error ? err.message : String(err) };
  }
}
