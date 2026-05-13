import type { SwarmTask } from '../types';
import { swarmGetTasks, swarmUpdateTask } from '../swarmDb';

export interface ReconcileDeps {
  getTasks: (workspaceId: string) => Promise<SwarmTask[]>;
  updateTask: (id: string, patch: Partial<SwarmTask>) => Promise<void>;
}

/**
 * On app start, demote any task that was left in `streaming` to `paused`.
 * The model wasn't actually running across the relaunch, so the user must
 * explicitly resume. Other statuses (including `awaiting_approval`) are
 * preserved as-is — their persisted approval rows remain valid.
 */
export async function reconcileTasksOnStartup(
  workspaceId: string,
  deps?: ReconcileDeps
): Promise<void> {
  const getTasks = deps?.getTasks ?? swarmGetTasks;
  const updateTask = deps?.updateTask ?? swarmUpdateTask;
  const tasks = await getTasks(workspaceId);
  for (const t of tasks) {
    if (t.status === 'streaming') {
      await updateTask(t.id, { status: 'paused' });
    }
  }
}
