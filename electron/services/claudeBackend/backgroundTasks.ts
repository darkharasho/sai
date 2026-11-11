// Per-task detail for the background-work sidebar.
//
// This is a pure, display-only fold of the SDK's task_* system frames. It is
// deliberately separate from SdkBackend's liveTasks ledger: nothing here may
// influence the wait/completion decision.

import { SHELL_TASK_TYPE } from '../waitClassifier';

export type BackgroundTaskStatus = 'pending' | 'running' | 'paused' | 'completed' | 'failed' | 'stopped';

export interface BackgroundTaskDetail {
  id: string;
  description: string;
  /** subagent_type ?? workflow_name ?? ('shell' for local_bash, else task_type) ?? 'task' */
  kind: string;
  isShell: boolean;
  /** Has a subagent_type, or has ever sent task_progress. */
  isAgent: boolean;
  status: BackgroundTaskStatus;
  startedAt: number;
  endedAt: number | null;
  lastEventAt: number;
  totalTokens: number | null;
  toolUses: number | null;
  lastToolName: string | null;
  summary: string | null;
  error: string | null;
  /** skip_transcript housekeeping task — filtered out of snapshots. */
  hidden?: boolean;
  /** tool_use id of the Agent call that launched this task (display-only join key). */
  toolUseId: string | null;
}

export const STUCK_AFTER_MS = 120_000;

const TASK_SUBTYPES = new Set(['task_started', 'task_progress', 'task_updated', 'task_notification']);

const str = (v: unknown): string | null => (typeof v === 'string' && v.length > 0 ? v : null);
const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);

function mapStatus(v: unknown): BackgroundTaskStatus | null {
  switch (v) {
    case 'pending':
    case 'running':
    case 'paused':
    case 'completed':
    case 'failed':
    case 'stopped':
      return v;
    case 'killed':
      return 'stopped';
    default:
      return null;
  }
}

function deriveKind(subagentType: string | null, workflowName: string | null, taskType: string | null): string {
  if (subagentType) return subagentType;
  if (workflowName) return workflowName;
  if (taskType === SHELL_TASK_TYPE) return 'shell';
  return taskType ?? 'task';
}

function blank(id: string, nowMs: number): BackgroundTaskDetail {
  return {
    id,
    description: '',
    kind: 'task',
    isShell: false,
    isAgent: false,
    status: 'running',
    startedAt: nowMs,
    endedAt: null,
    lastEventAt: nowMs,
    totalTokens: null,
    toolUses: null,
    lastToolName: null,
    summary: null,
    error: null,
    toolUseId: null,
  };
}

export function isTerminalDetail(t: BackgroundTaskDetail): boolean {
  return t.status === 'completed' || t.status === 'failed' || t.status === 'stopped';
}

function finish(t: BackgroundTaskDetail, status: BackgroundTaskStatus, endMs: number): BackgroundTaskDetail {
  const terminal = status === 'completed' || status === 'failed' || status === 'stopped';
  return { ...t, status, endedAt: terminal ? (t.endedAt ?? endMs) : null };
}

/**
 * Fold one SDK frame into the task map. Returns the SAME map instance when the
 * frame is not a task frame (or carries no task id), so callers can cheaply
 * skip emitting.
 */
export function foldBackgroundTaskFrame(
  tasks: ReadonlyMap<string, BackgroundTaskDetail>,
  frame: Record<string, unknown>,
  nowMs: number,
): Map<string, BackgroundTaskDetail> {
  const same = tasks as Map<string, BackgroundTaskDetail>;
  if (frame.type !== 'system' || typeof frame.subtype !== 'string' || !TASK_SUBTYPES.has(frame.subtype)) return same;
  const id = str(frame.task_id);
  if (!id) return same;

  const prev = tasks.get(id) ?? blank(id, nowMs);
  let t: BackgroundTaskDetail = { ...prev, lastEventAt: nowMs };
  const description = str(frame.description);
  if (description) t.description = description;

  switch (frame.subtype) {
    case 'task_started': {
      const subagentType = str(frame.subagent_type);
      const taskType = str(frame.task_type);
      t.kind = deriveKind(subagentType, str(frame.workflow_name), taskType);
      t.isShell = taskType === SHELL_TASK_TYPE;
      t.isAgent = t.isAgent || subagentType !== null;
      if (frame.skip_transcript === true) t.hidden = true;
      t.toolUseId = str(frame.tool_use_id) ?? t.toolUseId;
      break;
    }
    case 'task_progress': {
      const usage = (frame.usage ?? {}) as Record<string, unknown>;
      t.totalTokens = num(usage.total_tokens) ?? t.totalTokens;
      t.toolUses = num(usage.tool_uses) ?? t.toolUses;
      t.lastToolName = str(frame.last_tool_name) ?? t.lastToolName;
      t.summary = str(frame.summary) ?? t.summary;
      t.isAgent = true;
      t.toolUseId = str(frame.tool_use_id) ?? t.toolUseId;
      break;
    }
    case 'task_updated': {
      const patch = (frame.patch ?? {}) as Record<string, unknown>;
      const err = str(patch.error);
      if (err) t.error = err;
      const status = mapStatus(patch.status);
      if (status) t = finish(t, status, num(patch.end_time) ?? nowMs);
      break;
    }
    case 'task_notification': {
      t.summary = str(frame.summary) ?? t.summary;
      t = finish(t, mapStatus(frame.status) ?? 'completed', nowMs);
      break;
    }
  }

  const next = new Map(tasks);
  next.set(id, t);
  return next;
}

export function clearFinishedTasks(tasks: ReadonlyMap<string, BackgroundTaskDetail>): Map<string, BackgroundTaskDetail> {
  const next = new Map<string, BackgroundTaskDetail>();
  for (const [id, t] of tasks) if (!isTerminalDetail(t)) next.set(id, t);
  return next;
}

/** The session (and its runtime) is gone: whatever was still running died
 *  with it. Returns the SAME map when nothing was running. */
export function retireRunningTasks(tasks: ReadonlyMap<string, BackgroundTaskDetail>, nowMs: number): Map<string, BackgroundTaskDetail> {
  let next: Map<string, BackgroundTaskDetail> | null = null;
  for (const [id, t] of tasks) {
    if (isTerminalDetail(t)) continue;
    next ??= new Map(tasks);
    next.set(id, { ...t, status: 'stopped', endedAt: nowMs });
  }
  return next ?? (tasks as Map<string, BackgroundTaskDetail>);
}

export function isPossiblyStuck(t: BackgroundTaskDetail, nowMs: number): boolean {
  if (t.isShell || !t.isAgent || isTerminalDetail(t)) return false;
  return nowMs - t.lastEventAt >= STUCK_AFTER_MS;
}

/** Snapshot order: hidden tasks dropped, oldest first. */
export function visibleTasks(tasks: ReadonlyMap<string, BackgroundTaskDetail>): BackgroundTaskDetail[] {
  return [...tasks.values()].filter((t) => !t.hidden).sort((a, b) => a.startedAt - b.startedAt);
}
