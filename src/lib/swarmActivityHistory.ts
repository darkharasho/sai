/**
 * Helpers for deriving short-window activity timelines for swarm sparklines.
 *
 * The orchestrator chat shows tiny sparklines on a few existing cards
 * (per-task tool_use rate, workspace active count). To keep these cheap and
 * reactive, App.tsx maintains a per-workspace ring buffer of recent events
 * via `activityHistoryRef`. These helpers are pure so they can be unit-tested.
 */

export interface TimedEvent {
  /** Optional task association — used to filter events for per-task sparklines. */
  taskId?: string;
  ts: number;
}

/**
 * Bucket a list of timed events into `bucketCount` equal-width buckets ending
 * at `now`. Returns the per-bucket counts oldest first.
 *
 * Defaults: 12 buckets × 5s = 60s window.
 */
export function bucketToolCalls(
  events: TimedEvent[],
  now: number,
  bucketCount = 12,
  bucketMs = 5000,
): number[] {
  const buckets = new Array<number>(bucketCount).fill(0);
  if (!events || events.length === 0) return buckets;
  const windowStart = now - bucketCount * bucketMs;
  for (const ev of events) {
    if (ev.ts < windowStart || ev.ts > now) continue;
    // Bucket index 0 = oldest, bucketCount - 1 = newest.
    const offset = ev.ts - windowStart;
    let idx = Math.floor(offset / bucketMs);
    if (idx < 0) idx = 0;
    if (idx >= bucketCount) idx = bucketCount - 1;
    buckets[idx] += 1;
  }
  return buckets;
}

/**
 * Trim events older than `windowMs` (default 60s) relative to `now`.
 * Returns a new array — does not mutate the input.
 */
export function trimEvents(events: TimedEvent[], now: number, windowMs = 60_000): TimedEvent[] {
  const cutoff = now - windowMs;
  return events.filter(e => e.ts >= cutoff);
}

/**
 * Push a value into a fixed-length ring buffer (oldest first).
 * Returns a NEW array of length `size`.
 */
export function pushRing(buf: number[], value: number, size: number): number[] {
  const next = buf.length >= size ? buf.slice(buf.length - size + 1) : buf.slice();
  next.push(value);
  while (next.length < size) next.unshift(0);
  return next;
}
