import type { SwarmTask, SwarmApproval } from '../types';
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

/**
 * Given the live task set and persisted approval rows, return the ids of
 * approvals that are no longer actionable:
 *   - the task is gone entirely (lost/discarded), or
 *   - the task is not `awaiting_approval` anymore. After the startup
 *     reconcile every mid-flight task is `paused`, so a surviving approval
 *     row points at a toolUseId in a process that no longer exists —
 *     approving it would silently no-op while the tray shows it as live.
 * Both kinds should be pruned on startup so they don't inflate counts or
 * render as un-actionable cards.
 */
export function findOrphanApprovalIds(
  tasks: Pick<SwarmTask, 'id' | 'status'>[],
  approvals: Pick<SwarmApproval, 'id' | 'taskId'>[],
): string[] {
  const awaitingTaskIds = new Set(
    tasks.filter(t => t.status === 'awaiting_approval').map(t => t.id),
  );
  return approvals.filter(a => !awaitingTaskIds.has(a.taskId)).map(a => a.id);
}
