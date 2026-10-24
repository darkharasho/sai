import type { Level, SystemSample } from './types';

export const THRESHOLDS = {
  warnMemAvailPct: 20,
  warnSwapGrowthKb30s: 262144,
  warnPsiSome10: 5,
  critPsiFull10: 10,
  critMemAvailPct: 6,
  dwellMs: 30_000,
} as const;

export interface LevelState {
  level: Level;
  since: number;
  /** when the current level's conditions last went false */
  calmSince: number | null;
  /** highest raw level seen since calmSince */
  calmPeak: Level | null;
}

const RANK: Record<Level, number> = { normal: 0, warning: 1, critical: 2 };

export function rawLevel(s: SystemSample, swapUsedKb30sAgo: number | null): Level {
  const availPct = s.memTotalKb > 0 ? (s.memAvailableKb / s.memTotalKb) * 100 : 100;
  if (availPct < THRESHOLDS.critMemAvailPct || s.psiMemFull10 > THRESHOLDS.critPsiFull10) return 'critical';
  const swapUsed = s.swapTotalKb - s.swapFreeKb;
  const swapGrowth = swapUsedKb30sAgo === null ? 0 : swapUsed - swapUsedKb30sAgo;
  if (
    availPct < THRESHOLDS.warnMemAvailPct ||
    swapGrowth > THRESHOLDS.warnSwapGrowthKb30s ||
    s.psiMemSome10 > THRESHOLDS.warnPsiSome10
  ) return 'warning';
  return 'normal';
}

export function stepLevel(prev: LevelState, raw: Level, now: number): LevelState {
  if (RANK[raw] > RANK[prev.level]) return { level: raw, since: now, calmSince: null, calmPeak: null };
  if (RANK[raw] === RANK[prev.level]) return { ...prev, calmSince: null, calmPeak: null };
  // raw is below the current level
  let { calmSince, calmPeak } = prev;
  if (calmSince === null || calmPeak === null || RANK[raw] > RANK[calmPeak]) {
    calmSince = now;
    calmPeak = raw;
  }
  if (now - calmSince >= THRESHOLDS.dwellMs) {
    return { level: calmPeak, since: now, calmSince: null, calmPeak: null };
  }
  return { ...prev, calmSince, calmPeak };
}
