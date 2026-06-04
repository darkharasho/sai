import type { SwarmTask, SwarmApproval } from '../types';

export interface ApprovalRoutingTarget {
  /** The workspace that owns the approval (and its provider session). */
  workspaceId: string;
  /** The live task for this approval, or undefined if it's an orphan. */
  task: SwarmTask | undefined;
  toolUseId: string;
}

/**
 * Resolve where an approve/deny should be dispatched. Routing keys off the
 * approval's OWN `workspaceId` — never the currently-active workspace — so a
 * background-workspace approval reaches the correct provider session. The task
 * (for its provider + session scope) is looked up within that workspace; a
 * missing task means the approval is orphaned (provider gone).
 */
export function approvalRoutingTarget(
  approval: SwarmApproval,
  tasksByWs: ReadonlyMap<string, SwarmTask[]>,
): ApprovalRoutingTarget {
  const workspaceId = approval.workspaceId;
  const task = (tasksByWs.get(workspaceId) ?? []).find(t => t.id === approval.taskId);
  return { workspaceId, task, toolUseId: approval.toolUseId };
}
