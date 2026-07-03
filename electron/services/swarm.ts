import { ipcMain } from 'electron';
import * as path from 'node:path';
import {
  gitWorktreeAdd, gitWorktreeRemove, gitDeleteBranch,
  gitCanFastForward, gitFastForwardMerge, gitDiffShortstat, gitBranchDiff,
  gitWorktreePrune, gitListWorktrees, gitListBranches,
} from './git';
import { removeWorktreeAndBranch, defaultWorktreeExists, planSwarmGc } from './swarmWorktreeCleanup';

const SWARM_ROOT = '.sai-swarm'; // sibling-of-project dir

export function swarmWorktreePath(projectPath: string, _workspaceId: string, taskId: string) {
  const parent = path.dirname(projectPath);
  const wsName = path.basename(projectPath);
  return path.join(parent, SWARM_ROOT, wsName, taskId);
}

export function registerSwarmHandlers() {
  ipcMain.handle('swarm:worktree-add', async (_e, projectPath: string, taskId: string, branch: string, baseBranch: string) => {
    const wt = swarmWorktreePath(projectPath, projectPath, taskId);
    await gitWorktreeAdd(projectPath, wt, branch, baseBranch);
    return wt;
  });
  ipcMain.handle('swarm:worktree-remove', async (_e, projectPath: string, worktreePath: string, branch: string) => {
    await removeWorktreeAndBranch(projectPath, worktreePath, branch, {
      worktreeRemove: gitWorktreeRemove,
      deleteBranch: gitDeleteBranch,
      worktreeExists: defaultWorktreeExists,
    });
  });
  ipcMain.handle('swarm:can-ff', (_e, projectPath: string, source: string, target: string) =>
    gitCanFastForward(projectPath, source, target));
  ipcMain.handle('swarm:ff-merge', (_e, projectPath: string, source: string) =>
    gitFastForwardMerge(projectPath, source));
  ipcMain.handle('swarm:diff-stats', (_e, projectPath: string, baseBranch: string, branch: string) =>
    gitDiffShortstat(projectPath, baseBranch, branch));
  ipcMain.handle('swarm:branch-diff', (_e, projectPath: string, baseBranch: string, branch: string) =>
    gitBranchDiff(projectPath, baseBranch, branch));

  // Startup GC: remove worktrees under this project's `.sai-swarm/<ws>/` root
  // and `swarm/*` branches that no live (non-landed/discarded) task owns.
  // Driven by the renderer after hydration — swarmDb (the task source of
  // truth) is IndexedDB, which main can't read. Best-effort per item; one
  // stuck worktree must not stop the rest of the sweep.
  ipcMain.handle('swarm:gc', async (
    _e,
    projectPath: string,
    liveTaskIds: string[],
    liveBranches: string[],
  ): Promise<{ removedWorktrees: number; deletedBranches: number }> => {
    await gitWorktreePrune(projectPath);
    const swarmRoot = path.join(path.dirname(projectPath), SWARM_ROOT, path.basename(projectPath)) + path.sep;
    const all = await gitListWorktrees(projectPath);
    const swarmWorktrees = all
      .filter(w => w.path.startsWith(swarmRoot))
      .map(w => ({ path: w.path, taskId: path.basename(w.path), branch: w.branch }));
    const swarmBranches = await gitListBranches(projectPath, 'swarm/');
    const plan = planSwarmGc({
      swarmWorktrees,
      swarmBranches,
      liveTaskIds: new Set(liveTaskIds),
      liveBranches: new Set(liveBranches),
    });
    let removedWorktrees = 0;
    for (const wt of plan.removeWorktrees) {
      try {
        if (wt.branch) {
          await removeWorktreeAndBranch(projectPath, wt.path, wt.branch, {
            worktreeRemove: gitWorktreeRemove,
            deleteBranch: gitDeleteBranch,
            worktreeExists: defaultWorktreeExists,
          });
        } else {
          await gitWorktreeRemove(projectPath, wt.path);
        }
        removedWorktrees++;
      } catch (err) {
        console.warn('[swarm-gc] worktree remove failed:', wt.path, err instanceof Error ? err.message : err);
      }
    }
    let deletedBranches = 0;
    for (const branch of plan.deleteBranches) {
      try {
        await gitDeleteBranch(projectPath, branch);
        deletedBranches++;
      } catch { /* best-effort */ }
    }
    return { removedWorktrees, deletedBranches };
  });
}
