import type { SwarmTask } from '../types';

export interface LandDeps {
  canFastForward: (cwd: string, source: string, target: string) => Promise<boolean>;
  ffMerge: (cwd: string, source: string) => Promise<void>;
  worktreeRemove: (cwd: string, worktreePath: string, branch: string) => Promise<void>;
  updateTask: (id: string, patch: Partial<SwarmTask>) => Promise<void>;
}

export async function landTask(
  task: SwarmTask,
  deps: LandDeps
): Promise<{ ok: true } | { ok: false; reason: 'rebase-needed' }> {
  if (!task.worktreePath) {
    await deps.updateTask(task.id, { status: 'landed' });
    return { ok: true };
  }
  const canFf = await deps.canFastForward(task.workspaceId, task.branch, task.baseBranch);
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
