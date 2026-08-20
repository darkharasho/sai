/** Live countdown: 'H:MM:SS' at an hour or more, 'MM:SS' below, 'resuming…' at/under 0. */
export function formatCountdown(secondsRemaining: number): string {
  const s = Math.floor(secondsRemaining);
  if (s <= 0) return 'resuming…';
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const rem = s % 60;
  if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${String(rem).padStart(2, '0')}`;
  return `${String(m).padStart(2, '0')}:${String(rem).padStart(2, '0')}`;
}

/** '<h>:<mm><am|pm>' resume time from an absolute now + seconds remaining. */
export function formatWakeTime(nowMs: number, secondsRemaining: number): string {
  const d = new Date(nowMs + secondsRemaining * 1000);
  let h = d.getHours();
  const m = d.getMinutes();
  const ampm = h >= 12 ? 'pm' : 'am';
  h = h % 12;
  if (h === 0) h = 12;
  return `resumes ${h}:${String(m).padStart(2, '0')}${ampm}`;
}

/** Open-ended elapsed time: '45s' → '2m 05s' → '2h 11m'. Used by waits with no
 *  known end (background work), where the only honest number is how long it has
 *  been going. */
export function formatElapsed(secondsElapsed: number): string {
  const s = Math.max(0, Math.floor(secondsElapsed));
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ${String(s % 60).padStart(2, '0')}s`;
  return `${Math.floor(m / 60)}h ${String(m % 60).padStart(2, '0')}m`;
}
