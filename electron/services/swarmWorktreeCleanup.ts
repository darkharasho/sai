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

export interface GcWorktree {
  /** Absolute worktree path (a `.sai-swarm/<ws>/<taskId>` dir). */
  path: string;
  /** Task id — the dir's basename. */
  taskId: string;
  /** Checked-out branch short name, or null (detached). */
  branch: string | null;
}

export interface SwarmGcPlan {
  /** Worktrees to remove (with their branch, when known). */
  removeWorktrees: GcWorktree[];
  /** `swarm/*` branches to delete that have no worktree left. */
  deleteBranches: string[];
}

/**
 * Plan the startup GC for one project root. Everything here is belt-and-
 * braces conservative:
 *   - only worktrees whose dir basename (the task id) is NOT a live task are
 *     removed;
 *   - only `swarm/`-prefixed branches are ever deleted, and only when they
 *     are neither referenced by a live task nor checked out in a worktree
 *     that survives the plan.
 * Pure: the caller performs the actual git/fs mutations.
 */
export function planSwarmGc(args: {
  /** Registered worktrees under this workspace's `.sai-swarm/<ws>/` root. */
  swarmWorktrees: readonly GcWorktree[];
  /** All local `swarm/*` branch short names. */
  swarmBranches: readonly string[];
  liveTaskIds: ReadonlySet<string>;
  /** Branch names still referenced by live (non-landed/discarded) tasks. */
  liveBranches: ReadonlySet<string>;
}): SwarmGcPlan {
  const removeWorktrees = args.swarmWorktrees.filter(w => !args.liveTaskIds.has(w.taskId));
  const survivingBranches = new Set(
    args.swarmWorktrees
      .filter(w => args.liveTaskIds.has(w.taskId))
      .map(w => w.branch)
      .filter((b): b is string => b != null),
  );
  const removedBranches = new Set(
    removeWorktrees.map(w => w.branch).filter((b): b is string => b != null),
  );
  const deleteBranches = args.swarmBranches.filter(b =>
    b.startsWith('swarm/')
    && !args.liveBranches.has(b)
    && !survivingBranches.has(b)
    // Branches whose worktree we remove in this same plan are deleted by
    // removeWorktreeAndBranch already — don't double-delete.
    && !removedBranches.has(b),
  );
  return { removeWorktrees, deleteBranches };
}
