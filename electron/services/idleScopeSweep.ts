export interface IdleScopeRecord {
  workspaceId: string;
  scope: string;
  lastActivityAt: number;
  streaming: boolean;
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
    if (now - r.lastActivityAt > idleMs) stop(r.workspaceId, r.scope);
  }
}

export const IDLE_SCOPE_MS = 30 * 60 * 1000;
export const SWEEP_INTERVAL_MS = 5 * 60 * 1000;
