import type { Level, TopUser } from './types';

export interface HistoryEntry {
  ts: number;
  memUsedPct: number;
  swapUsedKb: number;
  psiMemFull10: number;
  level: Level;
  /** null on ticks without a process scan */
  top: TopUser[] | null;
  unitSizes: Array<{ rootPid: number; startTicks: number; sizeKb: number }>;
}

export class History {
  private entries: HistoryEntry[] = [];

  constructor(private readonly windowMs = 600_000) {}

  push(e: HistoryEntry): void {
    this.entries.push(e);
    const cutoff = e.ts - this.windowMs;
    while (this.entries.length > 0 && this.entries[0].ts < cutoff) this.entries.shift();
  }

  /** Newest entry at or before ts; one older than ts - maxStaleMs (a gap: suspend, skipped ticks) counts as missing. */
  private at(ts: number, maxStaleMs = Infinity): HistoryEntry | null {
    for (let i = this.entries.length - 1; i >= 0; i--) {
      const e = this.entries[i];
      if (e.ts <= ts) return e.ts >= ts - maxStaleMs ? e : null;
    }
    return null;
  }

  swapUsedKbAt(ts: number, maxStaleMs?: number): number | null {
    return this.at(ts, maxStaleMs)?.swapUsedKb ?? null;
  }

  unitSizeAt(ts: number, rootPid: number, startTicks: number, maxStaleMs?: number): number | null {
    const u = this.at(ts, maxStaleMs)?.unitSizes.find(x => x.rootPid === rootPid && x.startTicks === startTicks);
    return u ? u.sizeKb : null;
  }

  latestTop(): TopUser[] {
    for (let i = this.entries.length - 1; i >= 0; i--) {
      const t = this.entries[i].top;
      if (t) return t;
    }
    return [];
  }

  summary(sinceMs: number): Array<Pick<HistoryEntry, 'ts' | 'memUsedPct' | 'swapUsedKb' | 'psiMemFull10' | 'level'> & { top3: TopUser[] }> {
    const last = this.entries[this.entries.length - 1];
    if (!last) return [];
    const from = last.ts - sinceMs;
    return this.entries
      .filter(e => e.ts >= from)
      .map(e => ({
        ts: e.ts,
        memUsedPct: e.memUsedPct,
        swapUsedKb: e.swapUsedKb,
        psiMemFull10: e.psiMemFull10,
        level: e.level,
        top3: (e.top ?? []).slice(0, 3),
      }));
  }
}
