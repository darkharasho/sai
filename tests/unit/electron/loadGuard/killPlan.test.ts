// @vitest-environment node
import { describe, it, expect } from 'vitest';
import { isSaiFault, pickKillTarget } from '../../../../electron/services/loadGuard/killPlan';
import type { Classified } from '../../../../electron/services/loadGuard/classify';
import type { AiUnit, SystemSample, UnitKind } from '../../../../electron/services/loadGuard/types';

const GiB = 1024 * 1024;
const tag = { instance: 1, provider: 'claude' as const, projectPath: '/p', scope: 's' };
const unit = (kind: UnitKind, gib: number, rootPid = 1): AiUnit => ({
  rootPid, kind, tag, sizeKb: gib * GiB, pids: [rootPid], label: kind, startTicks: 7,
});
// used = 90 GiB mem + 10 GiB swap = 100 GiB
const sample: SystemSample = {
  ts: 0, memTotalKb: 100 * GiB, memAvailableKb: 10 * GiB, swapTotalKb: 20 * GiB, swapFreeKb: 10 * GiB,
  psiMemSome10: 0, psiMemFull10: 0, psiCpuSome10: 0, gpu: null,
};
const cls = (saiGiB: number, units: AiUnit[] = []): Classified => ({
  units, saiAiKb: saiGiB * GiB, saiAppKb: 0, top: [], game: null,
});
const noHist = () => null;

describe('isSaiFault', () => {
  it('24% share is not a fault, 25% is', () => {
    expect(isSaiFault(sample, cls(24), noHist)).toBe(false);
    expect(isSaiFault(sample, cls(25), noHist)).toBe(true);
  });
  it('a single 4 GiB unit is a fault despite a 20% share', () => {
    expect(isSaiFault(sample, cls(20, [unit('command', 4)]), noHist)).toBe(true);
  });
  it('growth of 2 GiB + 1 KiB in 60s is a fault', () => {
    const u = unit('command', 3);
    expect(isSaiFault(sample, cls(3, [u]), () => u.sizeKb - 2 * GiB - 1)).toBe(true);
    expect(isSaiFault(sample, cls(3, [u]), () => u.sizeKb - 2 * GiB + 1)).toBe(false);
  });
});

describe('isSaiFault boundaries and R8', () => {
  it('a fat app renderer without AI share is not a fault', () => {
    const c: Classified = { units: [], saiAiKb: 10 * GiB, saiAppKb: 30 * GiB, top: [], game: null };
    expect(isSaiFault(sample, c, noHist)).toBe(false);
  });
  it('growth of exactly 2 GiB is a fault', () => {
    const u = unit('command', 3);
    expect(isSaiFault(sample, cls(3, [u]), () => u.sizeKb - 2 * GiB)).toBe(true);
  });
  it('a unit of exactly 4 GiB is a fault', () => {
    expect(isSaiFault(sample, cls(4, [unit('command', 4)]), noHist)).toBe(true);
  });
});

describe('pickKillTarget', () => {
  it('largest wins when not tied', () => {
    expect(pickKillTarget([unit('agent', 2, 1), unit('command', 7, 2)])?.rootPid).toBe(2);
  });
  it('within 10% prefers command over agent', () => {
    expect(pickKillTarget([unit('agent', 5, 1), unit('command', 4.6, 2)])?.kind).toBe('command');
  });
  it('outside 10% keeps the largest', () => {
    expect(pickKillTarget([unit('agent', 5, 1), unit('service', 4.4, 2)])?.kind).toBe('agent');
  });
  it('empty is null', () => expect(pickKillTarget([])).toBeNull());
});
