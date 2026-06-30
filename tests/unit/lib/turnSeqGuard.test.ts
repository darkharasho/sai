import { describe, it, expect } from 'vitest';
import { turnEndIsStale } from '@/lib/turnSeqGuard';

describe('turnEndIsStale', () => {
  // The bug: when a follow-up is sent mid-flight (interrupt / autonomous chaining),
  // the prior turn's `result` arrives tagged with the OLD turnSeq while the NEW turn
  // is already streaming. App.tsx must NOT let that stale `result` clear the new
  // turn's streaming state (Stop button + thinking indicator). `done` was already
  // guarded; `result` was not.
  it('flags a result from a superseded turn as stale (new turn is active)', () => {
    // expected=2 (new turn streaming), incoming result tagged with old turn 1
    expect(turnEndIsStale(1, 2)).toBe(true);
  });

  it('does not flag a result that matches the current turn', () => {
    expect(turnEndIsStale(2, 2)).toBe(false);
  });

  it('does not flag when the message turnSeq is unknown (cannot prove staleness)', () => {
    expect(turnEndIsStale(null, 2)).toBe(false);
    expect(turnEndIsStale(undefined, 2)).toBe(false);
  });

  it('does not flag when the expected turnSeq is unknown', () => {
    expect(turnEndIsStale(1, null)).toBe(false);
    expect(turnEndIsStale(1, undefined)).toBe(false);
  });

  it('treats the post-clear sentinel (-1) mismatch as stale', () => {
    // After a turn's result clears the scope, wsTurnSeq is reset to -1; the trailing
    // `done` (turnSeq=2) is then correctly stale relative to -1.
    expect(turnEndIsStale(2, -1)).toBe(true);
  });
});
