// @vitest-environment node
import { describe, it, expect } from 'vitest';
import { History, type HistoryEntry } from '../../../../electron/services/loadGuard/history';
import type { TopUser } from '../../../../electron/services/loadGuard/types';

const entry = (ts: number, o: Partial<HistoryEntry> = {}): HistoryEntry => ({
  ts, memUsedPct: 50, swapUsedKb: ts, psiMemFull10: 0, level: 'normal', top: null, unitSizes: [], ...o,
});

describe('History', () => {
  it('drops entries older than the window and looks up by ts', () => {
    const h = new History();
    for (let t = 0; t <= 700_000; t += 10_000) h.push(entry(t));
    expect(h.swapUsedKbAt(0)).toBeNull();
    expect(h.swapUsedKbAt(95_000)).toBeNull(); // 0..90s are older than 700s-600s
    const h2 = new History();
    for (let t = 0; t <= 100_000; t += 10_000) h2.push(entry(t));
    expect(h2.swapUsedKbAt(95_000)).toBe(90_000);
  });
  it('latestTop skips null tops', () => {
    const top: TopUser[] = [{ label: 'a', sizeKb: 1, owner: 'other' }];
    const h = new History();
    h.push(entry(0, { top }));
    h.push(entry(1000));
    expect(h.latestTop()).toBe(top);
    expect(new History().latestTop()).toEqual([]);
  });
  it('unitSizeAt matches pid and startTicks', () => {
    const h = new History();
    h.push(entry(0, { unitSizes: [{ rootPid: 5, startTicks: 10, sizeKb: 99 }] }));
    expect(h.unitSizeAt(1000, 5, 10)).toBe(99);
    expect(h.unitSizeAt(1000, 5, 11)).toBeNull();
  });
  it('maxStaleMs treats an entry older than ts - maxStaleMs as missing', () => {
    const h = new History();
    h.push(entry(0, { unitSizes: [{ rootPid: 5, startTicks: 10, sizeKb: 99 }] }));
    h.push(entry(100_000));
    // newest entry at/before 60s is ts 0: 60s stale
    expect(h.swapUsedKbAt(60_000)).toBe(0);
    expect(h.swapUsedKbAt(60_000, 15_000)).toBeNull();
    expect(h.swapUsedKbAt(10_000, 15_000)).toBe(0);
    expect(h.unitSizeAt(60_000, 5, 10)).toBe(99);
    expect(h.unitSizeAt(60_000, 5, 10, 15_000)).toBeNull();
    expect(h.unitSizeAt(15_000, 5, 10, 15_000)).toBe(99);
  });
  it('summary returns top3 within the window', () => {
    const h = new History();
    const top: TopUser[] = Array.from({ length: 5 }, (_, i) => ({ label: `u${i}`, sizeKb: 5 - i, owner: 'other' as const }));
    h.push(entry(0, { top }));
    h.push(entry(60_000));
    expect(h.summary(30_000)).toHaveLength(1);
    expect(h.summary(120_000)[0].top3).toHaveLength(3);
  });
});
