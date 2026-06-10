import type { SwarmTask, SwarmApproval } from '../types';
import { swarmInit, swarmGetTasks, swarmGetApprovals, swarmResolveApproval } from '../swarmDb';
import { reconcileTasksOnStartup, findOrphanApprovalIds } from './swarmReconcile';

export interface HydrateDeps {
  init: () => Promise<void>;
  reconcile: (workspaceId: string) => Promise<void>;
  getTasks: (workspaceId: string) => Promise<SwarmTask[]>;
  getApprovals: (workspaceId: string) => Promise<SwarmApproval[]>;
  resolveApproval: (id: string) => Promise<void>;
}

export interface HydrateResult {
  tasks: SwarmTask[];
  liveApprovals: SwarmApproval[];
}

/**
 * Load a workspace's persisted swarm state for hydration on activation:
 *   1. init the DB,
 *   2. reconcile zombie (streaming/awaiting_approval) tasks to `paused`,
 *   3. load the reconciled tasks,
 *   4. prune approvals whose task no longer exists (delete + drop from result).
 * Orchestration over injectable deps (default to the real swarmDb/reconcile),
 * so it is unit-testable without mounting the App.
 */
export async function hydrateWorkspaceSwarm(
  workspaceId: string,
  deps?: Partial<HydrateDeps>,
): Promise<HydrateResult> {
  const init = deps?.init ?? swarmInit;
  const reconcile = deps?.reconcile ?? reconcileTasksOnStartup;
  const getTasks = deps?.getTasks ?? swarmGetTasks;
  const getApprovals = deps?.getApprovals ?? swarmGetApprovals;
  const resolveApproval = deps?.resolveApproval ?? swarmResolveApproval;

  await init();
  await reconcile(workspaceId);
  const tasks = await getTasks(workspaceId);
  const approvals = await getApprovals(workspaceId);
  const orphanIds = findOrphanApprovalIds(tasks, approvals);
  await Promise.all(orphanIds.map(id => resolveApproval(id)));
  const orphanSet = new Set(orphanIds);
  const liveApprovals = approvals.filter(a => !orphanSet.has(a.id));
  return { tasks, liveApprovals };
}
