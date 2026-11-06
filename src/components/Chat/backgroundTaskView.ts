// Pure view helpers for the background-work sidebar.
import { isPossiblyStuck, isTerminalDetail, type BackgroundTaskDetail } from '../../../electron/services/claudeBackend/backgroundTasks';
import { formatElapsed } from './formatCountdown';

/** How long a just-finished card shows its done state in place before moving
 *  to Finished. The whole effect (flash + move) stays under 1s. */
export const DONE_HOLD_MS = 650;

/** Running first (input order); terminal tasks still settling stay in running
 *  so their done state plays in place. Finished = newest first. */
export function partitionTasks(
  tasks: BackgroundTaskDetail[],
  settlingIds: ReadonlySet<string>,
): { running: BackgroundTaskDetail[]; finished: BackgroundTaskDetail[] } {
  const running: BackgroundTaskDetail[] = [];
  const finished: BackgroundTaskDetail[] = [];
  for (const t of tasks) {
    if (isTerminalDetail(t) && !settlingIds.has(t.id)) finished.push(t);
    else running.push(t);
  }
  finished.sort((a, b) => (b.endedAt ?? 0) - (a.endedAt ?? 0));
  return { running, finished };
}

export function nowLine(t: BackgroundTaskDetail, nowMs: number): string {
  switch (t.status) {
    case 'completed':
      return t.summary ?? 'Completed';
    case 'failed':
      return `Failed: ${t.error ?? t.summary ?? 'unknown error'}`;
    case 'stopped':
      return 'Stopped';
  }
  if (isPossiblyStuck(t, nowMs)) return `No updates for ${formatElapsed((nowMs - t.lastEventAt) / 1000)}`;
  if (t.isShell) return 'Running';
  if (t.summary) return t.summary;
  if (t.lastToolName) return `Now: ${t.lastToolName}`;
  return 'Starting…';
}

export function formatTokens(n: number): string {
  const trim = (v: number) => v.toFixed(1).replace(/\.0$/, '');
  if (n >= 1_000_000) return `${trim(n / 1_000_000)}M`;
  if (n >= 1_000) return `${trim(n / 1_000)}k`;
  return String(n);
}
