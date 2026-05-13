import { describe, it, expect } from 'vitest';
import { bucketToolCalls, trimEvents, pushRing } from '../../src/lib/swarmActivityHistory';

describe('bucketToolCalls', () => {
  it('returns all-zero buckets for empty events', () => {
    const out = bucketToolCalls([], 1_000_000);
    expect(out).toHaveLength(12);
    expect(out.every(v => v === 0)).toBe(true);
  });

  it('places events in their correct 5s bucket (oldest first)', () => {
    const now = 60_000;
    // Events: one at 1s ago (newest bucket = 11), one at 30s ago (bucket 5),
    // one at 58s ago (bucket 0).
    const events = [
      { ts: now - 1_000 },
      { ts: now - 30_000 },
      { ts: now - 58_000 },
    ];
    const out = bucketToolCalls(events, now);
    expect(out[11]).toBe(1);
    expect(out[6]).toBe(1); // 30000 ms ago → idx (60000-30000)/5000 = 6
    expect(out[0]).toBe(1); // 58000 ms ago → idx (60000-58000)/5000 = 0
    expect(out.reduce((a, b) => a + b, 0)).toBe(3);
  });

  it('drops events outside the window', () => {
    const now = 100_000;
    const out = bucketToolCalls([{ ts: 0 }, { ts: 10_000 }, { ts: now - 1000 }], now);
    expect(out.reduce((a, b) => a + b, 0)).toBe(1);
  });

  it('honors custom bucket count and width', () => {
    const now = 10_000;
    const out = bucketToolCalls([{ ts: 9_500 }], now, 4, 1_000);
    expect(out).toHaveLength(4);
    expect(out[3]).toBe(1);
  });
});

describe('trimEvents', () => {
  it('removes events older than the window', () => {
    const now = 100_000;
    const events = [{ ts: 0 }, { ts: 50_000 }, { ts: 99_000 }];
    const trimmed = trimEvents(events, now, 60_000);
    expect(trimmed.map(e => e.ts)).toEqual([50_000, 99_000]);
  });
});

describe('pushRing', () => {
  it('grows toward the fixed size, padding with zeros', () => {
    let buf: number[] = [];
    buf = pushRing(buf, 1, 4);
    expect(buf).toEqual([0, 0, 0, 1]);
    buf = pushRing(buf, 2, 4);
    expect(buf).toEqual([0, 0, 1, 2]);
    buf = pushRing(buf, 3, 4);
    expect(buf).toEqual([0, 1, 2, 3]);
    buf = pushRing(buf, 4, 4);
    expect(buf).toEqual([1, 2, 3, 4]);
    buf = pushRing(buf, 5, 4);
    expect(buf).toEqual([2, 3, 4, 5]);
  });
});
