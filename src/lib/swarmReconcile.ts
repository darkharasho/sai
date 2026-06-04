import type { SwarmTask } from '../types';
import { swarmGetTasks, swarmUpdateTask } from '../swarmDb';

export interface ReconcileDeps {
  getTasks: (workspaceId: string) => Promise<SwarmTask[]>;
  updateTask: (id: string, patch: Partial<SwarmTask>) => Promise<void>;
}

/**
 * On app start, demote any task that was left mid-flight (`streaming` or
 * `awaiting_approval`) to `paused`. The provider process did not survive the
 * relaunch, so the task cannot still be running and any pending approval is
 * stale; the user must explicitly resume. Other statuses (`queued`, `paused`,
 * `done`, `failed`, `landed`, `discarded`) are preserved as-is.
 */
export async function reconcileTasksOnStartup(
  workspaceId: string,
  deps?: ReconcileDeps
): Promise<void> {
  const getTasks = deps?.getTasks ?? swarmGetTasks;
  const updateTask = deps?.updateTask ?? swarmUpdateTask;
  const tasks = await getTasks(workspaceId);
  for (const t of tasks) {
    if (t.status === 'streaming' || t.status === 'awaiting_approval') {
      await updateTask(t.id, { status: 'paused' });
    }
  }
}
