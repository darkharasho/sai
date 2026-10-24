import type { AiUnit, SystemSample, UnitKind } from './types';
import type { Classified } from './classify';

export const FAULT = {
  sharePct: 25,
  singleUnitKb: 4 * 1024 * 1024,
  growthKb60s: 2 * 1024 * 1024,
  tiePct: 10,
  killCooldownMs: 5_000,
} as const;

const DISRUPTION: Record<UnitKind, number> = { command: 0, service: 1, agent: 2 };

export function isSaiFault(
  s: SystemSample,
  c: Classified,
  unitSizeKb60sAgo: (rootPid: number, startTicks: number) => number | null,
): boolean {
  const used = (s.memTotalKb - s.memAvailableKb) + (s.swapTotalKb - s.swapFreeKb);
  if (used > 0 && (c.saiAiKb / used) * 100 >= FAULT.sharePct) return true;
  for (const u of c.units) {
    if (u.sizeKb >= FAULT.singleUnitKb) return true;
    const before = unitSizeKb60sAgo(u.rootPid, u.startTicks);
    if (before !== null && u.sizeKb - before >= FAULT.growthKb60s) return true;
  }
  return false;
}

export function pickKillTarget(units: AiUnit[]): AiUnit | null {
  if (units.length === 0) return null;
  const sorted = [...units].sort((a, b) => b.sizeKb - a.sizeKb);
  const floor = sorted[0].sizeKb * (1 - FAULT.tiePct / 100);
  const tied = sorted.filter(u => u.sizeKb >= floor);
  return tied.reduce((best, u) => (DISRUPTION[u.kind] < DISRUPTION[best.kind] ? u : best));
}
