// @vitest-environment node
import { describe, it, expect } from 'vitest';
import { rawLevel, stepLevel, THRESHOLDS, type LevelState } from '../../../../electron/services/loadGuard/levels';
import type { SystemSample } from '../../../../electron/services/loadGuard/types';

const sample = (o: Partial<SystemSample> = {}): SystemSample => ({
  ts: 0, memTotalKb: 1000, memAvailableKb: 500, swapTotalKb: 1_000_000, swapFreeKb: 1_000_000,
  psiMemSome10: 0, psiMemFull10: 0, psiCpuSome10: 0, gpu: null, ...o,
});

describe('rawLevel', () => {
  it('5% MemAvailable is critical', () => expect(rawLevel(sample({ memAvailableKb: 50 }), null)).toBe('critical'));
  it('PSI full 10.1 is critical', () => expect(rawLevel(sample({ psiMemFull10: 10.1 }), null)).toBe('critical'));
  it('19% MemAvailable is warning', () => expect(rawLevel(sample({ memAvailableKb: 190 }), null)).toBe('warning'));
  it('swap growth boundary is strict', () => {
    const s = sample({ swapFreeKb: 1_000_000 - THRESHOLDS.warnSwapGrowthKb30s });
    expect(rawLevel(s, 0)).toBe('normal');
    expect(rawLevel(sample({ swapFreeKb: 1_000_000 - THRESHOLDS.warnSwapGrowthKb30s - 1 }), 0)).toBe('warning');
  });
  it('PSI some boundary is strict', () => {
    expect(rawLevel(sample({ psiMemSome10: 5.1 }), null)).toBe('warning');
    expect(rawLevel(sample({ psiMemSome10: 5 }), null)).toBe('normal');
  });
  it('null swap history ignores swap growth', () => {
    expect(rawLevel(sample({ swapFreeKb: 0 }), null)).toBe('normal');
  });
});

describe('stepLevel', () => {
  const crit: LevelState = { level: 'critical', since: 0, calmSince: null, calmPeak: null };
  const run = (start: LevelState, ticks: Array<[number, 'normal' | 'warning' | 'critical']>) =>
    ticks.reduce((st, [t, r]) => stepLevel(st, r, t), start);

  it('normal to critical is immediate', () => {
    const st = stepLevel({ level: 'normal', since: 0, calmSince: null, calmPeak: null }, 'critical', 5);
    expect(st.level).toBe('critical');
    expect(st.since).toBe(5);
  });
  it('holds critical at 29_999ms, drops at 30_000ms', () => {
    expect(run(crit, [[0, 'normal'], [29_999, 'normal']]).level).toBe('critical');
    expect(run(crit, [[0, 'normal'], [30_000, 'normal']]).level).toBe('normal');
  });
  it('a warning tick during calm resets the dwell', () => {
    const st = run(crit, [[0, 'normal'], [20_000, 'normal'], [20_001, 'warning'], [40_001, 'normal']]);
    expect(st.level).toBe('critical');
  });
  it('critical then warning for 30s gives warning, not normal', () => {
    const st = run(crit, [[0, 'warning'], [15_000, 'warning'], [30_000, 'warning']]);
    expect(st.level).toBe('warning');
    expect(st.calmSince).toBeNull();
  });
});
