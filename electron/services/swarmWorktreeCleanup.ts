import * as fs from 'node:fs';

export interface WorktreeCleanupDeps {
  worktreeRemove: (repoCwd: string, worktreePath: string) => Promise<void>;
  deleteBranch: (repoCwd: string, branch: string) => Promise<void>;
  /** Whether the worktree directory still exists after a remove attempt. */
  worktreeExists: (worktreePath: string) => boolean;
}

/**
 * Remove a swarm worktree, then delete its branch — but only if the worktree is
 * actually gone. Deleting the branch while its worktree still exists orphans the
 * worktree (git refuses to reuse the branch). On a remove failure where the
 * worktree survives, surface the error and leave the branch intact.
 */
export async function removeWorktreeAndBranch(
  repoCwd: string,
  worktreePath: string,
  branch: string,
  deps: WorktreeCleanupDeps,
): Promise<void> {
  try {
    await deps.worktreeRemove(repoCwd, worktreePath);
  } catch (err) {
    if (deps.worktreeExists(worktreePath)) throw err; // worktree survived → keep the branch
    // else: remove "failed" but the worktree is gone → safe to continue
  }
  await deps.deleteBranch(repoCwd, branch);
}

export const defaultWorktreeExists = (worktreePath: string): boolean => fs.existsSync(worktreePath);

/**
 * Given the task-id directory names found under a workspace's `.sai-swarm/<ws>/`
 * folder and the set of live (persisted, non-terminal-removed) task ids, return
 * the directory names that no longer correspond to a live task — candidates for
 * GC. Pure: callers do the actual fs/git removal.
 */
export function findOrphanWorktrees(
  worktreeDirTaskIds: readonly string[],
  liveTaskIds: ReadonlySet<string>,
): string[] {
  return worktreeDirTaskIds.filter(id => !liveTaskIds.has(id));
}
