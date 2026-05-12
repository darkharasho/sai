import { ipcMain } from 'electron';
import * as path from 'node:path';
import {
  gitWorktreeAdd, gitWorktreeRemove, gitDeleteBranch,
  gitCanFastForward, gitFastForwardMerge,
} from './git';

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
    await gitWorktreeRemove(projectPath, worktreePath).catch(() => {});
    await gitDeleteBranch(projectPath, branch);
  });
  ipcMain.handle('swarm:can-ff', (_e, projectPath: string, source: string, target: string) =>
    gitCanFastForward(projectPath, source, target));
  ipcMain.handle('swarm:ff-merge', (_e, projectPath: string, source: string) =>
    gitFastForwardMerge(projectPath, source));
}
