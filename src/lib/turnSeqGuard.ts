/**
 * Decide whether a turn-end message (`result` / `done`) belongs to a SUPERSEDED
 * turn and must therefore be ignored for streaming-state purposes.
 *
 * When a follow-up is sent while a turn is still in flight (interrupt / autonomous
 * chaining), the prior turn's `result` arrives tagged with the OLD turnSeq while the
 * NEW turn is already streaming. Letting that stale `result` clear `streamingScopes`
 * makes the Stop button + thinking indicator vanish mid-response. App.tsx already
 * guarded `done` this way; `result` was not — this centralizes the check for both.
 *
 * Returns false (treat as current) when either turnSeq is unknown, so the "result is
 * authoritative even if `done` is lost" robustness is preserved for the live turn.
 */
export function turnEndIsStale(
  msgTurnSeq: number | null | undefined,
  expectedTurnSeq: number | null | undefined,
): boolean {
  if (msgTurnSeq == null || expectedTurnSeq == null) return false;
  return msgTurnSeq !== expectedTurnSeq;
}
