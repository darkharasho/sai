// Pure helpers that translate a `claude:message` envelope into a patch for
// the matching SwarmTask in renderer state. Centralizing the logic here
// (a) avoids depending on which ChatPanel is mounted, so background tasks
// get their status/tool counts updated, and (b) keeps the logic unit-testable
// without mounting App.tsx.

import type { SwarmTask } from '../types';
import { isTurnErrored } from './chatActivity';

export type SwarmTaskPatch =
  | { kind: 'status'; status: 'done' | 'failed'; costEstimate?: number; lastActivityAt: number }
  | { kind: 'toolCount'; delta: number; lastActivityAt: number }
  | { kind: 'heartbeat'; lastActivityAt: number };

export interface MirrorResult {
  taskId: string;
  patch: SwarmTaskPatch;
}

/**
 * Given a `claude:message` envelope and the current task list for the
 * message's workspace, return the patch (if any) to apply.
 *
 * Returns null when the message is not relevant to any swarm task.
 */
export function deriveSwarmMirror(
  msg: any,
  tasksForWorkspace: readonly SwarmTask[],
  now: number = Date.now()
): MirrorResult | null {
  if (!msg || typeof msg !== 'object') return null;
  const scope: string = msg.scope || 'chat';
  if (scope === 'chat') return null;

  const task = tasksForWorkspace.find(t => t.sessionId === scope);
  if (!task) return null;

  // Turn completion → terminalize a still-in-flight task. A turn that ended in
  // an error (result.is_error / error subtype) marks the task failed, not done.
  // Cost, when reported, rides on the same terminal patch.
  if (msg.type === 'done' || msg.type === 'result') {
    if (task.status === 'streaming' || task.status === 'awaiting_approval') {
      const status = isTurnErrored(msg) ? 'failed' : 'done';
      const patch: SwarmTaskPatch = { kind: 'status', status, lastActivityAt: now };
      if (typeof msg.total_cost_usd === 'number' && Number.isFinite(msg.total_cost_usd)) patch.costEstimate = msg.total_cost_usd;
      return { taskId: task.id, patch };
    }
    return null;
  }

  // Only a fatal error (process crash / spawn failure, flagged by the provider)
  // fails the task. Benign stderr lines arrive as non-fatal error messages and
  // must not mark a healthy task failed — they fall through to the heartbeat below.
  if (msg.type === 'error' && msg.fatal === true) {
    if (task.status === 'streaming' || task.status === 'awaiting_approval' || task.status === 'queued') {
      return { taskId: task.id, patch: { kind: 'status', status: 'failed', lastActivityAt: now } };
    }
    return null;
  }

  // Assistant message containing tool_use blocks → bump toolCallCount.
  if (msg.type === 'assistant' && msg.message && Array.isArray(msg.message.content)) {
    let count = 0;
    for (const block of msg.message.content) {
      if (block && block.type === 'tool_use') count++;
    }
    if (count > 0) {
      return { taskId: task.id, patch: { kind: 'toolCount', delta: count, lastActivityAt: now } };
    }
  }

  // Any other stream traffic for a streaming task — assistant text/thinking,
  // tool_result (`user`) messages, non-fatal stderr, system events — is a sign
  // of life. Refresh lastActivityAt via a heartbeat so the stale-task watchdog
  // doesn't cull a task that is busy on a long step which hasn't yet emitted a
  // new tool_use (a long-running tool, a sub-agent, or a stretch of reasoning).
  if (task.status === 'streaming') {
    return { taskId: task.id, patch: { kind: 'heartbeat', lastActivityAt: now } };
  }

  return null;
}

/** Apply a patch to a single task; returns the new task object. */
export function applySwarmPatch(task: SwarmTask, patch: SwarmTaskPatch): SwarmTask {
  if (patch.kind === 'status') {
    return {
      ...task,
      status: patch.status,
      lastActivityAt: patch.lastActivityAt,
      ...(patch.costEstimate != null ? { costEstimate: patch.costEstimate } : {}),
    };
  }
  if (patch.kind === 'heartbeat') {
    return { ...task, lastActivityAt: patch.lastActivityAt };
  }
  return {
    ...task,
    toolCallCount: task.toolCallCount + patch.delta,
    lastActivityAt: patch.lastActivityAt,
  };
}
