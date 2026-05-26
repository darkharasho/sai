import { WebSocket } from 'ws';
import { RingBuffer } from './ring-buffer';
import {
  createTerminalImpl,
  writeTerminalImpl,
  resizeTerminalImpl,
  signalTerminalImpl,
  killTerminalImpl,
  snapshotTerminal,
  subscribeTerminal,
  listDesktopTerminals,
} from '../pty';

export interface PhoneTerminalSummary {
  termId: number;
  cwd: string;
  cols: number;
  rows: number;
  alive: boolean;
  origin: 'phone' | 'desktop';
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

/**
 * Restricted byte allow-list for input on desktop-owned terminals. Returns the
 * filtered string (possibly empty). Phone-owned terms bypass this filter.
 * Allowed: ESC, TAB, CR, LF, Ctrl-A..Z (\x01-\x1A), arrow sequences
 * (\x1b[A/B/C/D). Everything else is dropped.
 */
function filterDesktopInput(data: string): string {
  if (data === '') return '';
  // Whole-string fast paths for the common control sequences the toolbar emits.
  if (data === '\x1b[A' || data === '\x1b[B' || data === '\x1b[C' || data === '\x1b[D') return data;
  let out = '';
  for (let i = 0; i < data.length; i++) {
    const ch = data.charCodeAt(i);
    // \x01..\x1a covers Ctrl-A..Ctrl-Z (and includes \t=\x09, \n=\x0a, \r=\x0d).
    // \x1b is ESC; toolbar may send it on its own.
    if ((ch >= 0x01 && ch <= 0x1a) || ch === 0x1b) {
      out += data[i];
    }
    // else drop silently
  }
  return out;
}

function isDesktopTermId(termId: number): boolean {
  return listDesktopTerminals().some((t) => t.termId === termId);
}

export class PhoneTerminalRegistry {
  private readonly terms = new Map<number, PhoneTerminal>();
  private readonly desktopUnsubs = new Map<WebSocket, Map<number, () => void>>();
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
    const phone: PhoneTerminalSummary[] = [];
    for (const t of this.terms.values()) {
      if (cwd && t.cwd !== cwd) continue;
      phone.push({
        termId: t.termId, cwd: t.cwd, cols: t.cols, rows: t.rows, alive: t.alive,
        origin: 'phone',
      });
    }
    const desktop: PhoneTerminalSummary[] = listDesktopTerminals()
      .filter((t) => !cwd || t.cwd === cwd)
      .map((t) => ({ ...t, origin: 'desktop' as const }));
    return [...phone, ...desktop];
  }

  input(termId: number, data: string): void {
    const t = this.terms.get(termId);
    if (t && t.alive) {
      writeTerminalImpl(termId, data);
      return;
    }
    // Desktop-owned: re-validate at the bridge for safety even though the phone
    // toolbar only emits allow-listed bytes.
    const filtered = filterDesktopInput(data);
    if (!filtered) return;
    writeTerminalImpl(termId, filtered);
  }

  resize(termId: number, cols: number, rows: number): void {
    const t = this.terms.get(termId);
    if (t && t.alive) {
      t.cols = clampCols(cols); t.rows = clampRows(rows);
      resizeTerminalImpl(termId, t.cols, t.rows);
      return;
    }
    // Desktop-owned: silently ignore. Desktop dims stand.
  }

  signal(termId: number, sig: NodeJS.Signals): void {
    const t = this.terms.get(termId);
    if (t && t.alive) {
      signalTerminalImpl(termId, sig);
      return;
    }
    // Desktop-owned: only SIGINT is allowed (Ctrl+C synonym).
    if (isDesktopTermId(termId) && sig === 'SIGINT') {
      signalTerminalImpl(termId, sig);
    }
  }

  kill(termId: number): void {
    const t = this.terms.get(termId);
    if (t) {
      killTerminalImpl(termId);
      t.alive = false;
      this.terms.delete(termId);
      return;
    }
    if (isDesktopTermId(termId)) {
      throw new Error('Cannot kill desktop-owned terminal from phone');
    }
    // Unknown — no-op (preserves prior behavior for already-gone termIds).
  }

  private attachDesktop(termId: number, ws: WebSocket): { replay: string; cols: number; rows: number } | null {
    const meta = listDesktopTerminals().find((t) => t.termId === termId);
    if (!meta) return null;
    // Clear any previous subscription this ws had on this termId.
    const existing = this.desktopUnsubs.get(ws)?.get(termId);
    if (existing) { try { existing(); } catch { /* ignore */ } }
    const unsub = subscribeTerminal(termId, (data) => {
      if (ws.readyState !== ws.OPEN) return;
      try {
        ws.send(JSON.stringify({ v: 1, type: 'terminal.output', termId, data }));
      } catch { /* socket dying */ }
    });
    let perWs = this.desktopUnsubs.get(ws);
    if (!perWs) { perWs = new Map(); this.desktopUnsubs.set(ws, perWs); }
    perWs.set(termId, unsub);
    return { replay: snapshotTerminal(termId), cols: meta.cols, rows: meta.rows };
  }

  attach(termId: number, ws: WebSocket, cols: number, rows: number):
    { replay: string; cols: number; rows: number } | null
  {
    // Phone-owned first (existing behavior, including resize).
    const t = this.terms.get(termId);
    if (t && t.alive) {
      if (t.attachedClient && t.attachedClient !== ws) {
        t.attachedClient = null;
      }
      t.cols = clampCols(cols); t.rows = clampRows(rows);
      resizeTerminalImpl(termId, t.cols, t.rows);
      t.attachedClient = ws;
      t.lastAttachAt = Date.now();
      return { replay: t.ring.snapshot(), cols: t.cols, rows: t.rows };
    }
    // Otherwise: try desktop. cols/rows are ignored — desktop dims stand.
    return this.attachDesktop(termId, ws);
  }

  detach(termId: number, ws: WebSocket): void {
    const t = this.terms.get(termId);
    if (t && t.attachedClient === ws) {
      t.attachedClient = null;
      t.lastAttachAt = Date.now();
      return;
    }
    // Desktop-owned: pop and call the stored unsub.
    const perWs = this.desktopUnsubs.get(ws);
    const unsub = perWs?.get(termId);
    if (unsub) {
      try { unsub(); } catch { /* ignore */ }
      perWs!.delete(termId);
      if (perWs!.size === 0) this.desktopUnsubs.delete(ws);
    }
  }

  detachAll(ws: WebSocket): void {
    for (const t of this.terms.values()) {
      if (t.attachedClient === ws) {
        t.attachedClient = null;
        t.lastAttachAt = Date.now();
      }
    }
    const perWs = this.desktopUnsubs.get(ws);
    if (perWs) {
      for (const unsub of perWs.values()) {
        try { unsub(); } catch { /* ignore */ }
      }
      this.desktopUnsubs.delete(ws);
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
