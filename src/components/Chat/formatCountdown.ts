/** Coarse '~Nm' while >= 2 min out; live 'MM:SS' under 2 min; 'resuming…' at/under 0. */
export function formatCountdown(secondsRemaining: number): string {
  const s = Math.floor(secondsRemaining);
  if (s <= 0) return 'resuming…';
  if (s >= 120) return `~${Math.round(s / 60)}m`;
  const m = Math.floor(s / 60);
  const rem = s % 60;
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
