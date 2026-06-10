import { ipcMain } from 'electron';
import * as path from 'node:path';
import {
  gitWorktreeAdd, gitWorktreeRemove, gitDeleteBranch,
  gitCanFastForward, gitFastForwardMerge, gitDiffShortstat, gitBranchDiff,
} from './git';
import { removeWorktreeAndBranch, defaultWorktreeExists } from './swarmWorktreeCleanup';

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
}
