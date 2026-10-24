import fs from 'node:fs';
import type { AiUnit } from './types';

export interface SignalDeps {
  kill: (pid: number, sig: NodeJS.Signals) => void;
  /** Reads field 22 of /proc/<pid>/stat; null when the process is gone. */
  startTicksOf: (pid: number) => number | null;
  persistPath: string;
  fs?: Pick<typeof import('fs'), 'readFileSync' | 'writeFileSync'>;
}

interface FrozenProc {
  pid: number;
  startTicks: number;
}

/** Reads start ticks from /proc/<pid>/stat; comm may hold spaces/parens, so parse after the LAST ')'. */
export function readStartTicks(pid: number, procRoot = '/proc'): number | null {
  try {
    const stat = fs.readFileSync(`${procRoot}/${pid}/stat`, 'utf8');
    const close = stat.lastIndexOf(')');
    if (close < 0) return null;
    const ticks = Number(stat.slice(close + 2).trim().split(/\s+/)[19]);
    return Number.isFinite(ticks) ? ticks : null;
  } catch {
    return null;
  }
}

/** Real deps; touches nothing until called, so tests never need these. */
export function defaultSignalDeps(persistPath: string): SignalDeps {
  return {
    kill: (pid, sig) => { process.kill(pid, sig); },
    startTicksOf: pid => readStartTicks(pid),
    persistPath,
  };
}

/** Freezes, thaws and kills SAI-owned processes. Never throws; every signal is pid-reuse checked. */
export class Signaller {
  private frozen = new Map<number, number>();

  constructor(private deps: SignalDeps) {}

  private get io() {
    return this.deps.fs ?? fs;
  }

  /** Signals pid only while it still has the expected start ticks. True when delivered. */
  private send(pid: number, startTicks: number, sig: NodeJS.Signals): boolean {
    try {
      if (this.deps.startTicksOf(pid) !== startTicks) return false;
      this.deps.kill(pid, sig);
      return true;
    } catch {
      // ESRCH (already gone), EPERM, anything: not sent, keep going.
      return false;
    }
  }

  private persist(): void {
    try {
      const list: FrozenProc[] = [...this.frozen].map(([pid, startTicks]) => ({ pid, startTicks }));
      this.io.writeFileSync(this.deps.persistPath, JSON.stringify(list));
    } catch {
      // A guard must never throw.
    }
  }

  private readPersisted(): FrozenProc[] {
    try {
      const parsed = JSON.parse(this.io.readFileSync(this.deps.persistPath, 'utf8') as string);
      if (!Array.isArray(parsed)) return [];
      return parsed.filter(
        p => p && Number.isInteger(p.pid) && typeof p.startTicks === 'number',
      );
    } catch {
      return [];
    }
  }

  freeze(procs: Array<{ pid: number; startTicks: number }>): number {
    let count = 0;
    for (const p of procs) {
      if (this.send(p.pid, p.startTicks, 'SIGSTOP')) {
        this.frozen.set(p.pid, p.startTicks);
        count++;
      }
    }
    this.persist();
    return count;
  }

  thawAll(): number {
    let count = 0;
    for (const [pid, startTicks] of this.frozen) {
      if (this.send(pid, startTicks, 'SIGCONT')) count++;
    }
    this.frozen.clear();
    this.persist();
    return count;
  }

  killTree(unit: Pick<AiUnit, 'pids'>, ticks: Map<number, number>): number {
    let count = 0;
    let changed = false;
    for (const pid of unit.pids) {
      const t = ticks.get(pid);
      if (t !== undefined && this.send(pid, t, 'SIGKILL')) count++;
      if (this.frozen.delete(pid)) changed = true;
    }
    if (changed) this.persist();
    return count;
  }

  recoverFromCrash(): number {
    let count = 0;
    for (const p of this.readPersisted()) {
      if (this.send(p.pid, p.startTicks, 'SIGCONT')) count++;
    }
    this.frozen.clear();
    this.persist();
    return count;
  }

  frozenCount(): number {
    return this.frozen.size;
  }
}
