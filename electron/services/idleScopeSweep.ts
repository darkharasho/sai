export interface IdleScopeRecord {
  workspaceId: string;
  scope: string;
  lastActivityAt: number;
  streaming: boolean;
  /** The scope is blocked on required user input (AskUserQuestion / approval /
   *  plan review). Such a scope looks idle — its lastActivityAt is stale because
   *  the agent is politely waiting — but it must not be swept: killing it makes
   *  the pending prompt unanswerable. */
  awaitingInput?: boolean;
  /** The scope is deliberately waiting on a self-scheduled wakeup (ScheduleWakeup
   *  / loop). It looks idle but must not be reaped — the timer will resume it. */
  pendingWakeup?: boolean;
}

export interface SweepOptions {
  now: number;
  idleMs: number;
  scopes: IdleScopeRecord[];
  stop: (workspaceId: string, scope: string) => void;
}

export function sweepIdleScopes({ now, idleMs, scopes, stop }: SweepOptions): void {
  for (const r of scopes) {
    if (r.streaming) continue;
    if (r.awaitingInput) continue;
    if (r.pendingWakeup) continue;
    if (now - r.lastActivityAt > idleMs) stop(r.workspaceId, r.scope);
  }
}

export const IDLE_SCOPE_MS = 30 * 60 * 1000;
export const SWEEP_INTERVAL_MS = 5 * 60 * 1000;
