import { WebSocket } from 'ws';
import { RingBuffer } from './ring-buffer';
import {
  createTerminalImpl,
  writeTerminalImpl,
  resizeTerminalImpl,
  signalTerminalImpl,
  killTerminalImpl,
} from '../pty';

export interface PhoneTerminalSummary {
  termId: number;
  cwd: string;
  cols: number;
  rows: number;
  alive: boolean;
}

export interface PhoneTerminal {
  termId: number;
  cwd: string;
  ring: RingBuffer;
  attachedClient: WebSocket | null;
  cols: number;
  rows: number;
  lastAttachAt: number;
  alive: boolean;
}

const RING_CAP_BYTES = 64 * 1024;
const MIN_COLS = 20;
const MIN_ROWS = 5;

function clampCols(c: number): number { return Math.max(MIN_COLS, c | 0); }
function clampRows(r: number): number { return Math.max(MIN_ROWS, r | 0); }

export class PhoneTerminalRegistry {
  private readonly terms = new Map<number, PhoneTerminal>();
  private gcTimer: NodeJS.Timeout | null = null;

  open(cwd: string, cols: number, rows: number): PhoneTerminal {
    const c = clampCols(cols);
    const r = clampRows(rows);
    const ring = new RingBuffer(RING_CAP_BYTES);

    let entry: PhoneTerminal | null = null;

    const { termId } = createTerminalImpl({
      cwd, cols: c, rows: r,
      onData: (data) => {
        if (!entry) return;
        entry.ring.push(data);
        const ws = entry.attachedClient;
        if (ws && ws.readyState === ws.OPEN) {
          try {
            ws.send(JSON.stringify({ v: 1, type: 'terminal.output', termId: entry.termId, data }));
          } catch { /* ignore send failures */ }
        }
      },
      onExit: (code) => {
        if (!entry) return;
        entry.alive = false;
        const ws = entry.attachedClient;
        if (ws && ws.readyState === ws.OPEN) {
          try { ws.send(JSON.stringify({ v: 1, type: 'terminal.exit', termId: entry.termId, code })); }
          catch { /* ignore */ }
        }
        this.terms.delete(entry.termId);
      },
    });

    entry = {
      termId, cwd,
      ring,
      attachedClient: null,
      cols: c, rows: r,
      lastAttachAt: Date.now(),
      alive: true,
    };
    this.terms.set(termId, entry);
    return entry;
  }

  list(cwd?: string): PhoneTerminalSummary[] {
    const out: PhoneTerminalSummary[] = [];
    for (const t of this.terms.values()) {
      if (cwd && t.cwd !== cwd) continue;
      out.push({ termId: t.termId, cwd: t.cwd, cols: t.cols, rows: t.rows, alive: t.alive });
    }
    return out;
  }

  input(termId: number, data: string): void {
    const t = this.terms.get(termId);
    if (!t || !t.alive) return;
    writeTerminalImpl(termId, data);
  }

  resize(termId: number, cols: number, rows: number): void {
    const t = this.terms.get(termId);
    if (!t || !t.alive) return;
    t.cols = clampCols(cols); t.rows = clampRows(rows);
    resizeTerminalImpl(termId, t.cols, t.rows);
  }

  signal(termId: number, sig: NodeJS.Signals): void {
    const t = this.terms.get(termId);
    if (!t || !t.alive) return;
    signalTerminalImpl(termId, sig);
  }

  kill(termId: number): void {
    const t = this.terms.get(termId);
    if (!t) return;
    killTerminalImpl(termId);
    t.alive = false;
    this.terms.delete(termId);
  }

  attach(termId: number, ws: WebSocket, cols: number, rows: number):
    { replay: string; cols: number; rows: number } | null
  {
    const t = this.terms.get(termId);
    if (!t || !t.alive) return null;
    if (t.attachedClient && t.attachedClient !== ws) {
      t.attachedClient = null;
    }
    t.cols = clampCols(cols); t.rows = clampRows(rows);
    resizeTerminalImpl(termId, t.cols, t.rows);
    t.attachedClient = ws;
    t.lastAttachAt = Date.now();
    return { replay: t.ring.snapshot(), cols: t.cols, rows: t.rows };
  }

  detach(termId: number, ws: WebSocket): void {
    const t = this.terms.get(termId);
    if (!t) return;
    if (t.attachedClient === ws) {
      t.attachedClient = null;
      t.lastAttachAt = Date.now();
    }
  }

  detachAll(ws: WebSocket): void {
    for (const t of this.terms.values()) {
      if (t.attachedClient === ws) {
        t.attachedClient = null;
        t.lastAttachAt = Date.now();
      }
    }
  }

  destroyAll(): void {
    for (const t of [...this.terms.values()]) {
      try { killTerminalImpl(t.termId); } catch { /* already gone */ }
    }
    this.terms.clear();
    if (this.gcTimer) { clearInterval(this.gcTimer); this.gcTimer = null; }
  }

  startIdleGc(opts: { intervalMs?: number; maxIdleMs?: number; now?: () => number } = {}): void {
    const intervalMs = opts.intervalMs ?? 5 * 60_000;
    const maxIdleMs = opts.maxIdleMs ?? 60 * 60_000;
    const now = opts.now ?? Date.now;
    if (this.gcTimer) clearInterval(this.gcTimer);
    this.gcTimer = setInterval(() => {
      const t0 = now();
      for (const t of [...this.terms.values()]) {
        if (t.attachedClient === null && t0 - t.lastAttachAt > maxIdleMs) {
          this.kill(t.termId);
        }
      }
    }, intervalMs);
    (this.gcTimer as unknown as { unref?: () => void }).unref?.();
  }
}
