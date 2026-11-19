export const TRIANGLE_MASK_URL =
  "data:image/svg+xml;utf8,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='3 3.5 18.5 16'%3E%3Cpath d='M8.97 9.25 Q12 4 15.03 9.25 L17.63 13.75 Q20.66 19 14.6 19 L9.4 19 Q3.34 19 6.37 13.75 Z' fill='%23000'/%3E%3C/svg%3E";

export type IndicatorState =
  | 'inactive' | 'alive' | 'busy' | 'done' | 'approval' | 'busy-done' | 'question'
  // Per-session states used by the chats sidebar:
  | 'error'      // last turn ended in an error
  | 'waiting'    // scheduled wakeup pending (ScheduleWakeup / /loop)
  | 'suspended'; // backing process reaped by the idle sweep

export interface WorkspaceStatusFlags {
  approval?: boolean;
  busy?: boolean;
  streaming?: boolean;
  awaitingQuestion?: boolean;
  completed?: boolean;
}

export function workspaceDisplayState(
  flags: WorkspaceStatusFlags | undefined,
  opts?: { isOpen?: boolean },
): IndicatorState {
  if (flags?.approval) return 'approval';
  // A scope blocked on an AskUserQuestion answer gets its own state — folding
  // it into 'busy' made it impossible to tell which workspace was waiting.
  if (flags?.awaitingQuestion) return 'question';
  if (flags?.busy || flags?.streaming) return 'busy';
  if (flags?.completed) return 'done';
  if (opts?.isOpen) return 'alive';
  return 'inactive';
}

/** Workspace path of a `${projectPath}:${sessionId}` scope key. Session ids
 *  (UUIDs / 'chat') never contain ':', so split on the last one. */
function scopeWorkspace(scopeKey: string): string {
  const i = scopeKey.lastIndexOf(':');
  return i > 0 ? scopeKey.slice(0, i) : scopeKey;
}

/** Workspaces that have a parked wait (scheduled wakeup / background tasks)
 *  and no streaming turn — "waiting", not "working". */
export function waitingWorkspacesFrom(
  waitingScopeKeys: Iterable<string>,
  streamingScopeKeys: Iterable<string>,
): Set<string> {
  const streaming = new Set<string>();
  for (const k of streamingScopeKeys) streaming.add(scopeWorkspace(k));
  const out = new Set<string>();
  for (const k of waitingScopeKeys) {
    const ws = scopeWorkspace(k);
    if (!streaming.has(ws)) out.add(ws);
  }
  return out;
}

/** Scopes whose AI promised to pick back up and still has a live watcher
 *  (follow-up ⟳ following / resuming). The turn has ended, so these aren't in
 *  the wait map, but they're waiting all the same; stalled ones (⚠) are an
 *  attention state, not a wait. */
export function followUpWaitScopes(
  followUps: ReadonlyMap<string, { state: string }>,
): Set<string> {
  const out = new Set<string>();
  for (const [k, v] of followUps) {
    if (v.state === 'following' || v.state === 'resuming') out.add(k);
  }
  return out;
}
