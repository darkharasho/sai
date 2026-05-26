# Mobile Remote — Phase 5: Terminal Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a working terminal surface to the mobile PWA. Phone-owned PTYs (independent from desktop), xterm.js renderer, soft-key toolbar, viewport-aware resize, scrollback replay on reconnect.

**Architecture:**
- Extract pure impls from `electron/services/pty.ts` (no IPC coupling): `createTerminalImpl / writeTerminalImpl / resizeTerminalImpl / signalTerminalImpl / killTerminalImpl`. Desktop IPC handlers thin down to call them; behavior unchanged.
- New `electron/services/remote/ring-buffer.ts` (64KB cap, drop-oldest eviction).
- New `electron/services/remote/terminal-store.ts` — `PhoneTerminalRegistry` (open / attach / detach / input / resize / signal / kill / list / destroyAll / startIdleGc). Each entry: `{ termId, cwd, pty, ring, attachedClient, cols, rows, lastAttachAt }`. Independent from desktop's terminal registry.
- BridgeServer gains `terminal.*` WS routing + a `terminalStore` opt. WS-close auto-detaches.
- `electron/main.ts` constructs the store, wires it into BridgeServer, calls `destroyAll()` on `before-quit`.
- PWA: `Terminal.tsx` (lazy xterm + FitAddon, canvas renderer, autocorrect off, visualViewport resize) + `TerminalToolbar.tsx` (Esc/Tab/sticky-Ctrl/arrows/back) + `TerminalPicker.tsx` (sheet listing + "New terminal"). `NavDrawer.tsx` adds Terminal nav item and goes fullscreen while active.
- `wire.ts` adds 8 helpers (`listTerminals / openTerminal / attachTerminal / detachTerminal / inputTerminal / resizeTerminal / signalTerminal / killTerminal`). `terminal.output` events flow through `client.on(...)`.

**Tech Stack:** TypeScript, node-pty (existing dep), ws, vitest, React, `@xterm/xterm` + `@xterm/addon-fit` (already installed; lazy-imported).

**Spec:** `docs/superpowers/specs/2026-05-25-mobile-remote-p5-terminal-design.md`. **Branch:** `feat/mobile-remote-p5` to branch off `main` after P0–P4 land (currently on `feat/mobile-remote-p3`; create new branch before starting). **PWA build config:** `vite.config.pwa.ts`.

---

## Pre-flight notes

- `@xterm/xterm` and `@xterm/addon-fit` are already in `dependencies` (package.json:70–72) — no install needed.
- `node-pty` is already a dep with `electron-rebuild` postinstall.
- Existing desktop pty.ts uses a module-level `allTerminals` map + `nextId`. The phone registry is **separate** — phone PTYs do not appear in `allTerminals` and vice versa. `destroyAllTerminals()` in pty.ts only touches desktop; `terminalStore.destroyAll()` only touches phone.
- The bridge wires per-message handlers in `handleWs`; route file is `electron/services/remote/bridge-server.ts`.
- Tests live in `tests/unit/remote/` and `tests/integration/remote/`. Integration test skips on Windows via `it.skipIf(process.platform === 'win32')` because node-pty + shell semantics differ.
- xterm.js v5 ESM — lazy-imported inside `useEffect` to avoid bloating the initial PWA bundle.

---

## File structure

**New (Electron):**
- `electron/services/remote/ring-buffer.ts`
- `electron/services/remote/terminal-store.ts`

**Modified (Electron):**
- `electron/services/pty.ts` — extract 5 impls (desktop IPC stays)
- `electron/services/remote/bridge-server.ts` — `terminalStore` opt + `terminal.*` routes + WS-close detach
- `electron/main.ts` — construct store, wire opt, destroy on quit

**New (PWA):**
- `src/renderer-remote/terminal/Terminal.tsx`
- `src/renderer-remote/terminal/TerminalToolbar.tsx`
- `src/renderer-remote/terminal/TerminalPicker.tsx`

**Modified (PWA):**
- `src/renderer-remote/wire.ts` — 8 helpers
- `src/renderer-remote/chat/NavDrawer.tsx` — Terminal nav item + fullscreen mode

**New tests + docs:**
- `tests/unit/remote/terminal-ring-buffer.test.ts`
- `tests/unit/remote/terminal-store.test.ts`
- `tests/unit/remote/bridge-server-terminal.test.ts`
- `tests/integration/remote/terminal-end-to-end.test.ts`
- `docs/superpowers/notes/2026-05-25-mobile-remote-p5-smoke.md`

---

## Task 1: Verify xterm deps + create branch

**Files:** none (verification)

- [ ] **Step 1: Verify deps already declared**

```bash
cd /var/home/mstephens/Documents/GitHub/sai
node -e "const p=require('./package.json'); console.log(p.dependencies['@xterm/xterm'], p.dependencies['@xterm/addon-fit'], p.dependencies['node-pty']);"
```

Expected: `^5.5.0 ^0.10.0 ^1.0.0`. If any is missing, run `npm i @xterm/xterm @xterm/addon-fit` and commit a `chore(remote): pin xterm deps for PWA terminal` patch.

- [ ] **Step 2: Branch from main**

```bash
git fetch origin
git checkout -B feat/mobile-remote-p5 origin/main
```

Expected: clean working tree on new branch tracking main.

---

## Task 2: RingBuffer module + unit test

**Files:**
- Create: `electron/services/remote/ring-buffer.ts`
- Create: `tests/unit/remote/terminal-ring-buffer.test.ts`

- [ ] **Step 1: Failing test**

Create `tests/unit/remote/terminal-ring-buffer.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { RingBuffer } from '@electron/services/remote/ring-buffer';

describe('RingBuffer', () => {
  it('empty snapshot is empty string', () => {
    const rb = new RingBuffer(1024);
    expect(rb.snapshot()).toBe('');
    expect(rb.size).toBe(0);
  });

  it('push under cap keeps full content', () => {
    const rb = new RingBuffer(1024);
    rb.push('hello ');
    rb.push('world');
    expect(rb.snapshot()).toBe('hello world');
    expect(rb.size).toBe(11);
  });

  it('evicts oldest chunks when over cap', () => {
    const rb = new RingBuffer(10);
    rb.push('aaaaa');     // 5
    rb.push('bbbbb');     // 10 (at cap)
    rb.push('ccc');       // 13 → drop "aaaaa" → 8
    expect(rb.snapshot()).toBe('bbbbbccc');
    expect(rb.size).toBe(8);
  });

  it('drops a single oversized chunk down to cap by keeping only its tail', () => {
    const rb = new RingBuffer(5);
    rb.push('abcdefghij'); // 10 bytes; cap=5 → keep last 5
    expect(rb.snapshot()).toBe('fghij');
    expect(rb.size).toBe(5);
  });

  it('clear empties the buffer', () => {
    const rb = new RingBuffer(100);
    rb.push('x');
    rb.clear();
    expect(rb.snapshot()).toBe('');
    expect(rb.size).toBe(0);
  });
});
```

- [ ] **Step 2: Run — expect failure**

```bash
npx vitest run tests/unit/remote/terminal-ring-buffer.test.ts
```

Expected: 5 failures (module missing).

- [ ] **Step 3: Implement**

Create `electron/services/remote/ring-buffer.ts`:

```ts
/**
 * Append-only ring buffer of UTF-8 strings with a byte-length cap.
 * Oldest chunks are evicted when the total exceeds `capBytes`.
 * A single push larger than `capBytes` is truncated to its tail.
 */
export class RingBuffer {
  private chunks: string[] = [];
  private byteLength = 0;

  constructor(private readonly capBytes: number) {}

  get size(): number { return this.byteLength; }

  push(data: string): void {
    if (!data) return;
    let incoming = data;
    let incomingLen = Buffer.byteLength(incoming, 'utf8');

    // If a single chunk is larger than the cap, keep only its tail.
    if (incomingLen > this.capBytes) {
      // Trim from the front (string-wise; byte-accurate truncation is fine on ASCII;
      // for non-ASCII we may keep slightly less than capBytes, which is acceptable).
      incoming = incoming.slice(incoming.length - this.capBytes);
      incomingLen = Buffer.byteLength(incoming, 'utf8');
      this.chunks = [incoming];
      this.byteLength = incomingLen;
      return;
    }

    this.chunks.push(incoming);
    this.byteLength += incomingLen;

    while (this.byteLength > this.capBytes && this.chunks.length > 1) {
      const oldest = this.chunks.shift()!;
      this.byteLength -= Buffer.byteLength(oldest, 'utf8');
    }
  }

  snapshot(): string {
    return this.chunks.join('');
  }

  clear(): void {
    this.chunks = [];
    this.byteLength = 0;
  }
}
```

- [ ] **Step 4: Run — expect pass**

```bash
npx vitest run tests/unit/remote/terminal-ring-buffer.test.ts
npx tsc --noEmit
```

Expected: 5 passing, tsc clean.

- [ ] **Step 5: Commit**

```bash
git add electron/services/remote/ring-buffer.ts tests/unit/remote/terminal-ring-buffer.test.ts
git commit -m "feat(remote): RingBuffer with 64KB-cap eviction"
```

---

## Task 3: Extract pure impls from pty.ts

**Files:**
- Modify: `electron/services/pty.ts`

- [ ] **Step 1: Read current handlers**

```bash
grep -n "ipcMain.handle\|ipcMain.on" electron/services/pty.ts
```

Confirm lines 53, 149, 174, 193, 208, 241, 267, 274, 281, 285.

- [ ] **Step 2: Add 5 new exported impls above `registerTerminalHandlers`**

Insert immediately after the `terminalOwner` Map declaration (~line 49) and before `registerTerminalHandlers`:

```ts
/**
 * Spawn a node-pty shell at `cwd` and return its IPty + the globally-unique id.
 * Caller is responsible for wiring data/exit listeners. This impl is shared by
 * the desktop IPC handler and the phone-remote terminal store; they maintain
 * independent registries.
 */
export function createTerminalImpl(opts: {
  cwd: string;
  cols: number;
  rows: number;
  onData: (data: string) => void;
  onExit: (code: number) => void;
}): { termId: number; pty: pty.IPty } {
  const id = nextId++;
  const env = { ...process.env } as Record<string, string>;

  let spawnCmd: string;
  let spawnArgs: string[];
  let ptyName: string;
  let fallbackCwd: string;

  if (process.platform === 'win32') {
    const pwsh7Candidates = [
      process.env.PWSH_PATH,
      'C:\\Program Files\\PowerShell\\7\\pwsh.exe',
      'C:\\Program Files (x86)\\PowerShell\\7\\pwsh.exe',
    ].filter((p): p is string => typeof p === 'string' && p.length > 0);
    const winPwsh = process.env.SystemRoot
      ? `${process.env.SystemRoot}\\System32\\WindowsPowerShell\\v1.0\\powershell.exe`
      : '';
    let resolved: string | null = null;
    for (const candidate of pwsh7Candidates) {
      try { if (fs.existsSync(candidate)) { resolved = candidate; break; } } catch { /* ignore */ }
    }
    if (!resolved && winPwsh) {
      try { if (fs.existsSync(winPwsh)) resolved = winPwsh; } catch { /* ignore */ }
    }
    spawnCmd = resolved || process.env.ComSpec || 'cmd.exe';
    const isCmd = spawnCmd.toLowerCase().endsWith('cmd.exe');
    spawnArgs = isCmd ? [] : ['-NoLogo'];
    ptyName = 'xterm-256color';
    fallbackCwd = process.env.USERPROFILE || process.env.HOMEDRIVE || 'C:\\';
  } else {
    const shell = process.env.SHELL || '/bin/bash';
    delete env.GIO_LAUNCHED_DESKTOP_FILE;
    delete env.GIO_LAUNCHED_DESKTOP_FILE_PID;
    delete env.BAMF_DESKTOP_FILE_HINT;
    delete env.XDG_ACTIVATION_TOKEN;
    delete env.DESKTOP_STARTUP_ID;
    delete env.CHROME_DESKTOP;
    delete env.INVOCATION_ID;
    const shellInit = `stty -echoctl 2>/dev/null; exec "${shell}" --login`;
    const useScope = canUseSystemdScope();
    spawnCmd = useScope ? 'systemd-run' : shell;
    spawnArgs = useScope
      ? ['--user', '--scope', '--quiet', '--', shell, '-c', shellInit]
      : ['-c', shellInit];
    ptyName = 'xterm-256color';
    fallbackCwd = process.env.HOME || '/';
  }

  const term = pty.spawn(spawnCmd, spawnArgs, {
    name: ptyName,
    cwd: opts.cwd || fallbackCwd,
    cols: opts.cols,
    rows: opts.rows,
    env,
  });

  allTerminals.set(id, term);
  term.onData((data) => opts.onData(data));
  term.onExit(({ exitCode }) => {
    allTerminals.delete(id);
    opts.onExit(exitCode);
  });
  return { termId: id, pty: term };
}

export function writeTerminalImpl(termId: number, data: string): void {
  allTerminals.get(termId)?.write(data);
}

export function resizeTerminalImpl(termId: number, cols: number, rows: number): void {
  allTerminals.get(termId)?.resize(cols, rows);
}

export function signalTerminalImpl(termId: number, signal: NodeJS.Signals): void {
  const term = allTerminals.get(termId);
  if (!term) return;
  try { process.kill(-term.pid, signal); } catch { /* already exited */ }
}

export function killTerminalImpl(termId: number): void {
  const term = allTerminals.get(termId);
  if (!term) return;
  try { term.kill(); } catch { /* already exited */ }
  allTerminals.delete(termId);
}
```

- [ ] **Step 3: tsc + full test suite (desktop behavior unchanged)**

```bash
npx tsc --noEmit
npm test 2>&1 | tail -10
```

Expected: tsc clean, all existing tests pass. We're additive only — the existing IPC handlers stay as-is; they don't yet call the new impls. (Refactoring the handlers to delegate is intentional non-scope to keep desktop risk-free.)

- [ ] **Step 4: Commit**

```bash
git add electron/services/pty.ts
git commit -m "refactor(pty): extract create/write/resize/signal/kill impls"
```

---

## Task 4: terminal-store.ts — open / input / resize / signal / kill + unit test

**Files:**
- Create: `electron/services/remote/terminal-store.ts`
- Create: `tests/unit/remote/terminal-store.test.ts`

- [ ] **Step 1: Failing tests for the basic lifecycle**

Create `tests/unit/remote/terminal-store.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { PhoneTerminalRegistry } from '@electron/services/remote/terminal-store';

// Stub createTerminalImpl by mocking the module
vi.mock('@electron/services/pty', () => {
  let nextId = 100;
  const writes: Array<{ termId: number; data: string }> = [];
  const resizes: Array<{ termId: number; cols: number; rows: number }> = [];
  const signals: Array<{ termId: number; sig: NodeJS.Signals }> = [];
  const kills: number[] = [];
  const dataCbs = new Map<number, (s: string) => void>();
  const exitCbs = new Map<number, (n: number) => void>();
  return {
    createTerminalImpl: (opts: any) => {
      const termId = nextId++;
      dataCbs.set(termId, opts.onData);
      exitCbs.set(termId, opts.onExit);
      return { termId, pty: { pid: 9000 + termId } };
    },
    writeTerminalImpl: (termId: number, data: string) => writes.push({ termId, data }),
    resizeTerminalImpl: (termId: number, cols: number, rows: number) =>
      resizes.push({ termId, cols, rows }),
    signalTerminalImpl: (termId: number, sig: NodeJS.Signals) =>
      signals.push({ termId, sig }),
    killTerminalImpl: (termId: number) => kills.push(termId),
    // expose stub knobs for tests
    __ptyStub: { writes, resizes, signals, kills, dataCbs, exitCbs },
  };
});

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const ptyStub = () => (require('@electron/services/pty') as any).__ptyStub;

describe('PhoneTerminalRegistry — basic lifecycle', () => {
  let reg: PhoneTerminalRegistry;

  beforeEach(() => { reg = new PhoneTerminalRegistry(); });
  afterEach(() => { reg.destroyAll(); });

  it('open() returns a PhoneTerminal with cwd/cols/rows + alive', () => {
    const t = reg.open('/repo', 80, 24);
    expect(t.cwd).toBe('/repo');
    expect(t.cols).toBe(80);
    expect(t.rows).toBe(24);
    expect(t.termId).toBeGreaterThan(0);
    expect(reg.list().map((x) => x.termId)).toContain(t.termId);
  });

  it('list() filters by cwd', () => {
    reg.open('/a', 80, 24);
    reg.open('/b', 80, 24);
    expect(reg.list('/a')).toHaveLength(1);
    expect(reg.list('/b')).toHaveLength(1);
    expect(reg.list()).toHaveLength(2);
  });

  it('input/resize/signal/kill delegate to impls', () => {
    const t = reg.open('/r', 80, 24);
    reg.input(t.termId, 'ls\n');
    reg.resize(t.termId, 120, 40);
    reg.signal(t.termId, 'SIGINT');
    reg.kill(t.termId);
    const s = ptyStub();
    expect(s.writes).toContainEqual({ termId: t.termId, data: 'ls\n' });
    expect(s.resizes).toContainEqual({ termId: t.termId, cols: 120, rows: 40 });
    expect(s.signals).toContainEqual({ termId: t.termId, sig: 'SIGINT' });
    expect(s.kills).toContain(t.termId);
    expect(reg.list()).toHaveLength(0);
  });

  it('clamps cols/rows to a minimum on open', () => {
    const t = reg.open('/r', 5, 1);
    expect(t.cols).toBeGreaterThanOrEqual(20);
    expect(t.rows).toBeGreaterThanOrEqual(5);
  });
});
```

- [ ] **Step 2: Run — expect failure**

```bash
npx vitest run tests/unit/remote/terminal-store.test.ts
```

Expected: module-missing errors.

- [ ] **Step 3: Implement skeleton**

Create `electron/services/remote/terminal-store.ts`:

```ts
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

  /** Spawn a new PTY. Wires data → ring + (if attached) send; exit → terminal.exit emit. */
  open(cwd: string, cols: number, rows: number): PhoneTerminal {
    const c = clampCols(cols);
    const r = clampRows(rows);
    const ring = new RingBuffer(RING_CAP_BYTES);

    // We populate `entry` after createTerminalImpl returns; the data/exit
    // closures capture it by reference via a placeholder.
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

  /**
   * Attach `ws` as the sole output sink for `termId`. Returns the ring snapshot
   * to replay, plus the (possibly clamped) cols/rows. Returns null if termId
   * is unknown. If another client is already attached, it is detached.
   */
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

  /** Detach `ws` if it is the current attached client. No-op otherwise. */
  detach(termId: number, ws: WebSocket): void {
    const t = this.terms.get(termId);
    if (!t) return;
    if (t.attachedClient === ws) {
      t.attachedClient = null;
      t.lastAttachAt = Date.now();
    }
  }

  /** Detach `ws` from any terminal it is attached to (called on WS close). */
  detachAll(ws: WebSocket): void {
    for (const t of this.terms.values()) {
      if (t.attachedClient === ws) {
        t.attachedClient = null;
        t.lastAttachAt = Date.now();
      }
    }
  }

  /** Kill every PTY (called from RemoteModule.stop / before-quit). */
  destroyAll(): void {
    for (const t of [...this.terms.values()]) {
      try { killTerminalImpl(t.termId); } catch { /* already gone */ }
    }
    this.terms.clear();
    if (this.gcTimer) { clearInterval(this.gcTimer); this.gcTimer = null; }
  }

  /**
   * Walk the registry every `intervalMs` and kill entries that have been
   * unattached for longer than `maxIdleMs`. Default cadence: 5 min walk,
   * 60 min idle threshold.
   */
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
    // Prevent the timer from holding the process open during tests / quit.
    (this.gcTimer as unknown as { unref?: () => void }).unref?.();
  }
}
```

- [ ] **Step 4: Run — expect pass**

```bash
npx vitest run tests/unit/remote/terminal-store.test.ts
npx tsc --noEmit
```

Expected: 4 passing, tsc clean.

- [ ] **Step 5: Commit**

```bash
git add electron/services/remote/terminal-store.ts tests/unit/remote/terminal-store.test.ts
git commit -m "feat(remote): PhoneTerminalRegistry open/input/resize/signal/kill"
```

---

## Task 5: terminal-store attach + detach + ring replay (unit)

**Files:**
- Modify: `tests/unit/remote/terminal-store.test.ts`

- [ ] **Step 1: Add failing tests**

Append to `tests/unit/remote/terminal-store.test.ts`:

```ts
describe('PhoneTerminalRegistry — attach/detach + replay', () => {
  let reg: PhoneTerminalRegistry;

  beforeEach(() => { reg = new PhoneTerminalRegistry(); });
  afterEach(() => { reg.destroyAll(); });

  function fakeWs(): any {
    const sent: string[] = [];
    return {
      OPEN: 1,
      readyState: 1,
      send: (s: string) => sent.push(s),
      __sent: sent,
    };
  }

  it('attach() returns ring snapshot + dims; resizes PTY to client dims', () => {
    const t = reg.open('/r', 80, 24);
    // Simulate PTY data before any attach
    const onData = ptyStub().dataCbs.get(t.termId)!;
    onData('first ');
    onData('second\n');

    const ws = fakeWs();
    const r = reg.attach(t.termId, ws, 100, 30);
    expect(r).not.toBeNull();
    expect(r!.replay).toBe('first second\n');
    expect(r!.cols).toBe(100);
    expect(r!.rows).toBe(30);
    expect(ptyStub().resizes).toContainEqual({ termId: t.termId, cols: 100, rows: 30 });
  });

  it('streams subsequent output to the attached client only', () => {
    const t = reg.open('/r', 80, 24);
    const ws = fakeWs();
    reg.attach(t.termId, ws, 80, 24);
    const onData = ptyStub().dataCbs.get(t.termId)!;
    onData('live\n');
    expect(ws.__sent.some((s: string) => s.includes('"terminal.output"') && s.includes('live'))).toBe(true);
  });

  it('attach with a new ws displaces the previous attached client', () => {
    const t = reg.open('/r', 80, 24);
    const wsA = fakeWs(); const wsB = fakeWs();
    reg.attach(t.termId, wsA, 80, 24);
    reg.attach(t.termId, wsB, 80, 24);
    const onData = ptyStub().dataCbs.get(t.termId)!;
    onData('after-swap');
    expect(wsA.__sent.some((s: string) => s.includes('after-swap'))).toBe(false);
    expect(wsB.__sent.some((s: string) => s.includes('after-swap'))).toBe(true);
  });

  it('detach stops live output but keeps PTY alive + ring filling', () => {
    const t = reg.open('/r', 80, 24);
    const ws = fakeWs();
    reg.attach(t.termId, ws, 80, 24);
    reg.detach(t.termId, ws);
    const onData = ptyStub().dataCbs.get(t.termId)!;
    onData('buffered\n');
    // Not sent to ws
    expect(ws.__sent.some((s: string) => s.includes('buffered'))).toBe(false);
    // But re-attach replays it
    const ws2 = fakeWs();
    const r = reg.attach(t.termId, ws2, 80, 24);
    expect(r!.replay).toContain('buffered\n');
  });

  it('detachAll(ws) detaches every term the ws was attached to', () => {
    const a = reg.open('/r', 80, 24);
    const b = reg.open('/r', 80, 24);
    const ws = fakeWs();
    reg.attach(a.termId, ws, 80, 24);
    reg.attach(b.termId, ws, 80, 24);
    reg.detachAll(ws);
    // Pump output to both; nothing should reach ws
    ptyStub().dataCbs.get(a.termId)!('xa');
    ptyStub().dataCbs.get(b.termId)!('xb');
    expect(ws.__sent.some((s: string) => s.includes('xa') || s.includes('xb'))).toBe(false);
  });

  it('attach returns null for an unknown termId', () => {
    const ws = fakeWs();
    expect(reg.attach(9999, ws, 80, 24)).toBeNull();
  });
});
```

- [ ] **Step 2: Run — expect pass**

The impl in Task 4 already covers attach/detach/detachAll; tests should pass without further changes.

```bash
npx vitest run tests/unit/remote/terminal-store.test.ts
```

Expected: all passing (4 + 6 = 10).

- [ ] **Step 3: Commit**

```bash
git add tests/unit/remote/terminal-store.test.ts
git commit -m "test(remote): terminal-store attach/detach + replay coverage"
```

---

## Task 6: terminal-store idle GC + destroyAll (unit, fake clock)

**Files:**
- Modify: `tests/unit/remote/terminal-store.test.ts`

- [ ] **Step 1: Add failing tests with fake timers**

Append to `tests/unit/remote/terminal-store.test.ts`:

```ts
describe('PhoneTerminalRegistry — idle GC + destroyAll', () => {
  let reg: PhoneTerminalRegistry;

  beforeEach(() => {
    reg = new PhoneTerminalRegistry();
    vi.useFakeTimers();
  });
  afterEach(() => {
    reg.destroyAll();
    vi.useRealTimers();
  });

  it('destroyAll() kills every entry', () => {
    const a = reg.open('/r', 80, 24);
    const b = reg.open('/r', 80, 24);
    reg.destroyAll();
    expect(reg.list()).toHaveLength(0);
    expect(ptyStub().kills).toEqual(expect.arrayContaining([a.termId, b.termId]));
  });

  it('idle GC kills unattached terminals older than maxIdleMs', () => {
    let now = 1_000_000;
    reg.startIdleGc({ intervalMs: 1000, maxIdleMs: 5000, now: () => now });
    const a = reg.open('/r', 80, 24);
    // Detached from birth → lastAttachAt = 1_000_000
    now = 1_000_000 + 6000; // 6s later
    vi.advanceTimersByTime(1000);
    expect(reg.list().find((x) => x.termId === a.termId)).toBeUndefined();
    expect(ptyStub().kills).toContain(a.termId);
  });

  it('idle GC leaves attached terminals alone', () => {
    let now = 1_000_000;
    reg.startIdleGc({ intervalMs: 1000, maxIdleMs: 5000, now: () => now });
    const a = reg.open('/r', 80, 24);
    const ws: any = { OPEN: 1, readyState: 1, send: () => {} };
    reg.attach(a.termId, ws, 80, 24);
    now = 1_000_000 + 999_999;
    vi.advanceTimersByTime(1000);
    expect(reg.list().find((x) => x.termId === a.termId)).toBeDefined();
  });
});
```

- [ ] **Step 2: Run — expect pass**

```bash
npx vitest run tests/unit/remote/terminal-store.test.ts
```

Expected: all 13 passing.

- [ ] **Step 3: Commit**

```bash
git add tests/unit/remote/terminal-store.test.ts
git commit -m "test(remote): terminal-store idle GC + destroyAll"
```

---

## Task 7: BridgeServer opts — `terminalStore` + types

**Files:**
- Modify: `electron/services/remote/bridge-server.ts`

- [ ] **Step 1: Add the opt + import**

At the top of `bridge-server.ts`, add the type import:

```ts
import type { PhoneTerminalRegistry, PhoneTerminalSummary } from './terminal-store';
```

In `BridgeServerOpts` (alongside the existing `pull?`), add:

```ts
/** Phone-owned PTY registry. If absent, terminal.* messages return an error. */
terminalStore?: PhoneTerminalRegistry;
```

Export the `PhoneTerminalSummary` type for downstream consumers (re-export from the file's top exports):

```ts
export type { PhoneTerminalSummary } from './terminal-store';
```

- [ ] **Step 2: tsc**

```bash
npx tsc --noEmit
```

Expected: clean.

- [ ] **Step 3: Commit**

```bash
git add electron/services/remote/bridge-server.ts
git commit -m "feat(remote): BridgeServer terminalStore opt + type export"
```

---

## Task 8: BridgeServer — terminal.list + terminal.open routes (TDD)

**Files:**
- Create: `tests/unit/remote/bridge-server-terminal.test.ts`
- Modify: `electron/services/remote/bridge-server.ts`

- [ ] **Step 1: Failing tests**

Create `tests/unit/remote/bridge-server-terminal.test.ts`:

```ts
import { describe, it, expect, vi, afterEach } from 'vitest';
import WebSocket from 'ws';
import { BridgeServer } from '@electron/services/remote/bridge-server';
import { PairingStore } from '@electron/services/remote/pairing-store';
import { SessionBus } from '@electron/services/remote/session-bus';

function once<T = any>(ws: WebSocket, predicate: (m: any) => boolean): Promise<T> {
  return new Promise((resolve, reject) => {
    const onMsg = (data: WebSocket.Data) => {
      const m = JSON.parse(data.toString());
      if (predicate(m)) { ws.off('message', onMsg); resolve(m); }
    };
    ws.on('message', onMsg);
    ws.once('close', (code) => reject(new Error(`closed: ${code}`)));
  });
}

async function pairedSocket(server: BridgeServer, port: number): Promise<WebSocket> {
  const code = server.mintPairingCode();
  const r = await fetch(`http://127.0.0.1:${port}/pair`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ code, deviceLabel: 'Test' }),
  });
  const { token } = await r.json();
  const ws = new WebSocket(`ws://127.0.0.1:${port}/ws`);
  await new Promise((r) => ws.once('open', r));
  ws.send(JSON.stringify({ type: 'auth', token }));
  await once(ws, (m) => m.type === 'auth_ok');
  return ws;
}

function fakeStore(overrides: Partial<any> = {}): any {
  const base = {
    list: vi.fn().mockReturnValue([]),
    open: vi.fn().mockReturnValue({ termId: 7, cwd: '/r', cols: 80, rows: 24, alive: true }),
    attach: vi.fn().mockReturnValue({ replay: '', cols: 80, rows: 24 }),
    detach: vi.fn(),
    detachAll: vi.fn(),
    input: vi.fn(),
    resize: vi.fn(),
    signal: vi.fn(),
    kill: vi.fn(),
  };
  return { ...base, ...overrides };
}

describe('BridgeServer — terminal.list / terminal.open', () => {
  let server: BridgeServer; let port: number;
  afterEach(async () => { await server.stop(); });

  it('terminal.list returns store.list(cwd)', async () => {
    const store = fakeStore({
      list: vi.fn((cwd: string) => cwd === '/r'
        ? [{ termId: 1, cwd: '/r', cols: 80, rows: 24, alive: true }]
        : []),
    });
    server = new BridgeServer({
      tailnetIp: '127.0.0.1', pairing: new PairingStore(':memory:'), bus: new SessionBus(),
      pwaDir: null, screenshotSecret: 'x', loadScreenshot: async () => null,
      terminalStore: store,
    });
    ({ port } = await server.start());
    const ws = await pairedSocket(server, port);
    ws.send(JSON.stringify({ type: 'terminal.list', cwd: '/r', reqId: 'L1' }));
    const m = await once(ws, (m) => m.type === 'terminal.list.result');
    expect(m.reqId).toBe('L1');
    expect(m.terms).toEqual([{ termId: 1, cwd: '/r', cols: 80, rows: 24, alive: true }]);
    expect(store.list).toHaveBeenCalledWith('/r');
    ws.close();
  });

  it('terminal.open spawns and returns termId + dims', async () => {
    const store = fakeStore();
    server = new BridgeServer({
      tailnetIp: '127.0.0.1', pairing: new PairingStore(':memory:'), bus: new SessionBus(),
      pwaDir: null, screenshotSecret: 'x', loadScreenshot: async () => null,
      terminalStore: store,
    });
    ({ port } = await server.start());
    const ws = await pairedSocket(server, port);
    ws.send(JSON.stringify({ type: 'terminal.open', cwd: '/r', cols: 100, rows: 30, reqId: 'O1' }));
    const m = await once(ws, (m) => m.type === 'terminal.opened');
    expect(m.reqId).toBe('O1');
    expect(m.termId).toBe(7);
    expect(m.cols).toBe(80);
    expect(m.rows).toBe(24);
    expect(store.open).toHaveBeenCalledWith('/r', 100, 30);
    ws.close();
  });

  it('terminal.open with no store returns error', async () => {
    server = new BridgeServer({
      tailnetIp: '127.0.0.1', pairing: new PairingStore(':memory:'), bus: new SessionBus(),
      pwaDir: null, screenshotSecret: 'x', loadScreenshot: async () => null,
    });
    ({ port } = await server.start());
    const ws = await pairedSocket(server, port);
    ws.send(JSON.stringify({ type: 'terminal.open', cwd: '/r', cols: 80, rows: 24, reqId: 'E1' }));
    const m = await once(ws, (m) => m.type === 'error');
    expect(m.reqId).toBe('E1');
    expect(m.code).toBe('terminal_unavailable');
    ws.close();
  });
});
```

- [ ] **Step 2: Run — expect failure (routes not yet wired)**

```bash
npx vitest run tests/unit/remote/bridge-server-terminal.test.ts
```

Expected: 3 failures (timeouts / unknown message).

- [ ] **Step 3: Implement the two routes**

In `electron/services/remote/bridge-server.ts`, in `handleWs`'s message handler, AFTER the `git.pull` branch, add:

```ts
if (msg.type === 'terminal.list' && typeof msg.cwd === 'string') {
  const reqId = msg.reqId;
  const store = this.opts.terminalStore;
  if (!store) {
    ws.send(JSON.stringify({ v: 1, type: 'error', reqId, code: 'terminal_unavailable', message: 'no terminal store' }));
    return;
  }
  try {
    const terms = store.list(msg.cwd);
    ws.send(JSON.stringify({ v: 1, type: 'terminal.list.result', reqId, terms }));
  } catch (err) {
    ws.send(JSON.stringify({ v: 1, type: 'error', reqId, code: 'terminal_list_failed', message: (err as Error).message }));
  }
  return;
}

if (msg.type === 'terminal.open' && typeof msg.cwd === 'string'
    && typeof msg.cols === 'number' && typeof msg.rows === 'number') {
  const reqId = msg.reqId;
  const store = this.opts.terminalStore;
  if (!store) {
    ws.send(JSON.stringify({ v: 1, type: 'error', reqId, code: 'terminal_unavailable', message: 'no terminal store' }));
    return;
  }
  try {
    const t = store.open(msg.cwd, msg.cols, msg.rows);
    ws.send(JSON.stringify({ v: 1, type: 'terminal.opened', reqId, termId: t.termId, cols: t.cols, rows: t.rows }));
  } catch (err) {
    ws.send(JSON.stringify({ v: 1, type: 'error', reqId, code: 'terminal_open_failed', message: (err as Error).message }));
  }
  return;
}
```

- [ ] **Step 4: Run — expect pass + tsc**

```bash
npx vitest run tests/unit/remote/bridge-server-terminal.test.ts
npx tsc --noEmit
```

Expected: 3 passing.

- [ ] **Step 5: Commit**

```bash
git add electron/services/remote/bridge-server.ts tests/unit/remote/bridge-server-terminal.test.ts
git commit -m "feat(remote): bridge routes for terminal.list and terminal.open"
```

---

## Task 9: BridgeServer — terminal.attach (replay + live)

**Files:**
- Modify: `tests/unit/remote/bridge-server-terminal.test.ts`
- Modify: `electron/services/remote/bridge-server.ts`

- [ ] **Step 1: Failing test**

Append to `tests/unit/remote/bridge-server-terminal.test.ts`:

```ts
describe('BridgeServer — terminal.attach', () => {
  let server: BridgeServer; let port: number;
  afterEach(async () => { await server.stop(); });

  it('terminal.attach replies with cols/rows then sends replay as terminal.output', async () => {
    const store = fakeStore({
      attach: vi.fn(() => ({ replay: 'hello\n', cols: 80, rows: 24 })),
    });
    server = new BridgeServer({
      tailnetIp: '127.0.0.1', pairing: new PairingStore(':memory:'), bus: new SessionBus(),
      pwaDir: null, screenshotSecret: 'x', loadScreenshot: async () => null,
      terminalStore: store,
    });
    ({ port } = await server.start());
    const ws = await pairedSocket(server, port);
    ws.send(JSON.stringify({ type: 'terminal.attach', termId: 7, cols: 80, rows: 24, reqId: 'A1' }));
    const attached = await once(ws, (m) => m.type === 'terminal.attached');
    expect(attached.reqId).toBe('A1');
    expect(attached.termId).toBe(7);
    expect(attached.cols).toBe(80);
    expect(attached.rows).toBe(24);
    const replay = await once(ws, (m) => m.type === 'terminal.output' && m.termId === 7);
    expect(replay.data).toBe('hello\n');
    expect(store.attach).toHaveBeenCalled();
    ws.close();
  });

  it('terminal.attach unknown termId returns error', async () => {
    const store = fakeStore({ attach: vi.fn(() => null) });
    server = new BridgeServer({
      tailnetIp: '127.0.0.1', pairing: new PairingStore(':memory:'), bus: new SessionBus(),
      pwaDir: null, screenshotSecret: 'x', loadScreenshot: async () => null,
      terminalStore: store,
    });
    ({ port } = await server.start());
    const ws = await pairedSocket(server, port);
    ws.send(JSON.stringify({ type: 'terminal.attach', termId: 999, cols: 80, rows: 24, reqId: 'A2' }));
    const m = await once(ws, (m) => m.type === 'error');
    expect(m.reqId).toBe('A2');
    expect(m.code).toBe('terminal_unknown');
    ws.close();
  });
});
```

- [ ] **Step 2: Run — expect failure**

```bash
npx vitest run tests/unit/remote/bridge-server-terminal.test.ts
```

Expected: 2 new failures.

- [ ] **Step 3: Implement route**

In `bridge-server.ts`, after the `terminal.open` branch:

```ts
if (msg.type === 'terminal.attach' && typeof msg.termId === 'number'
    && typeof msg.cols === 'number' && typeof msg.rows === 'number') {
  const reqId = msg.reqId;
  const store = this.opts.terminalStore;
  if (!store) {
    ws.send(JSON.stringify({ v: 1, type: 'error', reqId, code: 'terminal_unavailable', message: 'no terminal store' }));
    return;
  }
  const r = store.attach(msg.termId, ws, msg.cols, msg.rows);
  if (!r) {
    ws.send(JSON.stringify({ v: 1, type: 'error', reqId, code: 'terminal_unknown', message: `no such terminal ${msg.termId}` }));
    return;
  }
  ws.send(JSON.stringify({ v: 1, type: 'terminal.attached', reqId, termId: msg.termId, cols: r.cols, rows: r.rows }));
  if (r.replay) {
    ws.send(JSON.stringify({ v: 1, type: 'terminal.output', termId: msg.termId, data: r.replay }));
  }
  return;
}
```

- [ ] **Step 4: Run — expect pass**

```bash
npx vitest run tests/unit/remote/bridge-server-terminal.test.ts
```

Expected: 5 passing.

- [ ] **Step 5: Commit**

```bash
git add electron/services/remote/bridge-server.ts tests/unit/remote/bridge-server-terminal.test.ts
git commit -m "feat(remote): bridge route for terminal.attach (replay + live)"
```

---

## Task 10: BridgeServer — input / resize / signal / kill / detach + WS-close auto-detach

**Files:**
- Modify: `tests/unit/remote/bridge-server-terminal.test.ts`
- Modify: `electron/services/remote/bridge-server.ts`

- [ ] **Step 1: Failing tests**

Append to `tests/unit/remote/bridge-server-terminal.test.ts`:

```ts
describe('BridgeServer — terminal input/resize/signal/kill/detach + ws close', () => {
  let server: BridgeServer; let port: number;
  afterEach(async () => { await server.stop(); });

  it('terminal.input / resize / signal / detach are one-way, no reply', async () => {
    const store = fakeStore();
    server = new BridgeServer({
      tailnetIp: '127.0.0.1', pairing: new PairingStore(':memory:'), bus: new SessionBus(),
      pwaDir: null, screenshotSecret: 'x', loadScreenshot: async () => null,
      terminalStore: store,
    });
    ({ port } = await server.start());
    const ws = await pairedSocket(server, port);
    ws.send(JSON.stringify({ type: 'terminal.input', termId: 7, data: 'ls\n' }));
    ws.send(JSON.stringify({ type: 'terminal.resize', termId: 7, cols: 120, rows: 40 }));
    ws.send(JSON.stringify({ type: 'terminal.signal', termId: 7, signal: 'SIGINT' }));
    ws.send(JSON.stringify({ type: 'terminal.detach', termId: 7 }));
    // No reply expected — give the server time to process
    await new Promise((r) => setTimeout(r, 50));
    expect(store.input).toHaveBeenCalledWith(7, 'ls\n');
    expect(store.resize).toHaveBeenCalledWith(7, 120, 40);
    expect(store.signal).toHaveBeenCalledWith(7, 'SIGINT');
    expect(store.detach).toHaveBeenCalledWith(7, expect.anything());
    ws.close();
  });

  it('terminal.kill calls store.kill and replies result', async () => {
    const store = fakeStore();
    server = new BridgeServer({
      tailnetIp: '127.0.0.1', pairing: new PairingStore(':memory:'), bus: new SessionBus(),
      pwaDir: null, screenshotSecret: 'x', loadScreenshot: async () => null,
      terminalStore: store,
    });
    ({ port } = await server.start());
    const ws = await pairedSocket(server, port);
    ws.send(JSON.stringify({ type: 'terminal.kill', termId: 7, reqId: 'K1' }));
    const m = await once(ws, (m) => m.type === 'terminal.kill.result');
    expect(m.reqId).toBe('K1');
    expect(store.kill).toHaveBeenCalledWith(7);
    ws.close();
  });

  it('ws close calls store.detachAll(ws)', async () => {
    const store = fakeStore();
    server = new BridgeServer({
      tailnetIp: '127.0.0.1', pairing: new PairingStore(':memory:'), bus: new SessionBus(),
      pwaDir: null, screenshotSecret: 'x', loadScreenshot: async () => null,
      terminalStore: store,
    });
    ({ port } = await server.start());
    const ws = await pairedSocket(server, port);
    ws.close();
    // Allow the close handler to run
    await new Promise((r) => setTimeout(r, 100));
    expect(store.detachAll).toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run — expect failure**

```bash
npx vitest run tests/unit/remote/bridge-server-terminal.test.ts
```

Expected: 3 new failures.

- [ ] **Step 3: Implement routes**

In `bridge-server.ts`, after the `terminal.attach` branch:

```ts
if (msg.type === 'terminal.input' && typeof msg.termId === 'number' && typeof msg.data === 'string') {
  this.opts.terminalStore?.input(msg.termId, msg.data);
  return;
}

if (msg.type === 'terminal.resize' && typeof msg.termId === 'number'
    && typeof msg.cols === 'number' && typeof msg.rows === 'number') {
  this.opts.terminalStore?.resize(msg.termId, msg.cols, msg.rows);
  return;
}

if (msg.type === 'terminal.signal' && typeof msg.termId === 'number' && typeof msg.signal === 'string') {
  this.opts.terminalStore?.signal(msg.termId, msg.signal as NodeJS.Signals);
  return;
}

if (msg.type === 'terminal.detach' && typeof msg.termId === 'number') {
  this.opts.terminalStore?.detach(msg.termId, ws);
  return;
}

if (msg.type === 'terminal.kill' && typeof msg.termId === 'number') {
  const reqId = msg.reqId;
  try {
    this.opts.terminalStore?.kill(msg.termId);
    ws.send(JSON.stringify({ v: 1, type: 'terminal.kill.result', reqId, termId: msg.termId }));
  } catch (err) {
    ws.send(JSON.stringify({ v: 1, type: 'error', reqId, code: 'terminal_kill_failed', message: (err as Error).message }));
  }
  return;
}
```

And inside the existing `ws.on('close', () => { ... })` close handler at the bottom of `handleWs`, add a `detachAll` call:

```ts
ws.on('close', () => {
  this.opts.terminalStore?.detachAll(ws);
  if (unsub) unsub();
  if (deviceId) {
    const set = this.liveSockets.get(deviceId);
    if (set) { set.delete(ws); if (set.size === 0) this.liveSockets.delete(deviceId); }
  }
});
```

- [ ] **Step 4: Run — expect pass**

```bash
npx vitest run tests/unit/remote/bridge-server-terminal.test.ts
npm test 2>&1 | tail -10
npx tsc --noEmit
```

Expected: 8 passing in the terminal file; full suite green; tsc clean.

- [ ] **Step 5: Commit**

```bash
git add electron/services/remote/bridge-server.ts tests/unit/remote/bridge-server-terminal.test.ts
git commit -m "feat(remote): bridge routes for terminal input/resize/signal/kill/detach + ws-close auto-detach"
```

---

## Task 11: Wire terminalStore into electron/main.ts

**Files:**
- Modify: `electron/main.ts`

- [ ] **Step 1: Add import**

Near other remote service imports (around line 5):

```ts
import { PhoneTerminalRegistry } from './services/remote/terminal-store';
```

- [ ] **Step 2: Construct the store at module scope (near `let remote: RemoteModule | null = null;`)**

```ts
const terminalStore = new PhoneTerminalRegistry();
terminalStore.startIdleGc();
```

- [ ] **Step 3: Pass the opt into BridgeServer**

Inside the `makeBridge: (tailnetIp) => { const b = new BridgeServer({...}); ... }` call, alongside the other opts, add:

```ts
terminalStore,
```

- [ ] **Step 4: Destroy on quit**

Locate the existing `destroyAllTerminals()` call in the `before-quit` handler (~line 804) and the duplicate at ~line 337. Add `terminalStore.destroyAll();` immediately after each:

```ts
destroyAllTerminals();
terminalStore.destroyAll();
```

- [ ] **Step 5: tsc + suite**

```bash
npx tsc --noEmit
npm test 2>&1 | tail -10
```

Expected: clean.

- [ ] **Step 6: Commit**

```bash
git add electron/main.ts
git commit -m "feat(remote): wire PhoneTerminalRegistry into bridge + destroy on quit"
```

---

## Task 12: Integration test — real node-pty end to end (skip on Windows)

**Files:**
- Create: `tests/integration/remote/terminal-end-to-end.test.ts`

- [ ] **Step 1: Write the test**

```ts
import { describe, it, expect } from 'vitest';
import WebSocket from 'ws';
import { RemoteModule } from '@electron/services/remote';
import { BridgeServer } from '@electron/services/remote/bridge-server';
import { PairingStore } from '@electron/services/remote/pairing-store';
import { SessionBus } from '@electron/services/remote/session-bus';
import { PhoneTerminalRegistry } from '@electron/services/remote/terminal-store';

describe('mobile remote terminal end-to-end', () => {
  it.skipIf(process.platform === 'win32')('spawn → echo hello → exit 0 → replay on reconnect', async () => {
    const pairing = new PairingStore(':memory:');
    const bus = new SessionBus();
    const terminalStore = new PhoneTerminalRegistry();

    const remote = new RemoteModule({
      pairing, bus,
      resolveTailnetEndpoint: async () => ({ ip: '127.0.0.1', host: null }),
      makeBridge: (ip) => new BridgeServer({
        tailnetIp: ip, pairing, bus, pwaDir: null,
        screenshotSecret: 'e2e', loadScreenshot: async () => null, port: 0,
        terminalStore,
      }),
      pollMs: 0,
    });
    await remote.start();
    const { url } = remote.status();
    const { code } = remote.mintPairingCode();
    const pairRes = await fetch(`${url}/pair`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ code, deviceLabel: 'E2E' }),
    });
    const { token } = await pairRes.json();

    const wsUrl = url!.replace(/^http/, 'ws') + '/ws';
    const ws = new WebSocket(wsUrl);
    const inbox: any[] = [];
    ws.on('message', (d) => inbox.push(JSON.parse(d.toString())));
    await new Promise((r) => ws.once('open', r));
    ws.send(JSON.stringify({ type: 'auth', token }));
    await waitFor(inbox, (m) => m.type === 'auth_ok', 3000);

    // Open a PTY that prints hello and exits.
    ws.send(JSON.stringify({ type: 'terminal.open', cwd: process.cwd(), cols: 80, rows: 24, reqId: 'O1' }));
    const opened = await waitFor(inbox, (m) => m.type === 'terminal.opened' && m.reqId === 'O1', 3000);
    const termId = opened.termId as number;
    // Attach so output is streamed
    ws.send(JSON.stringify({ type: 'terminal.attach', termId, cols: 80, rows: 24, reqId: 'A1' }));
    await waitFor(inbox, (m) => m.type === 'terminal.attached' && m.reqId === 'A1', 3000);

    // Send a command
    ws.send(JSON.stringify({ type: 'terminal.input', termId, data: 'echo hello-from-pty; exit 0\n' }));

    // Wait for hello and exit
    await waitFor(inbox, (m) =>
      m.type === 'terminal.output' && m.termId === termId && String(m.data).includes('hello-from-pty'),
      5000);
    await waitFor(inbox, (m) => m.type === 'terminal.exit' && m.termId === termId, 5000);

    ws.close();
    terminalStore.destroyAll();
    await remote.stop();
  }, 15_000);

  it.skipIf(process.platform === 'win32')('mid-stream disconnect → reconnect → replay contains earlier output', async () => {
    const pairing = new PairingStore(':memory:');
    const bus = new SessionBus();
    const terminalStore = new PhoneTerminalRegistry();

    const remote = new RemoteModule({
      pairing, bus,
      resolveTailnetEndpoint: async () => ({ ip: '127.0.0.1', host: null }),
      makeBridge: (ip) => new BridgeServer({
        tailnetIp: ip, pairing, bus, pwaDir: null,
        screenshotSecret: 'e2e2', loadScreenshot: async () => null, port: 0,
        terminalStore,
      }),
      pollMs: 0,
    });
    await remote.start();
    const { url } = remote.status();
    const { code } = remote.mintPairingCode();
    const pairRes = await fetch(`${url}/pair`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ code, deviceLabel: 'E2E' }),
    });
    const { token } = await pairRes.json();
    const wsUrl = url!.replace(/^http/, 'ws') + '/ws';

    // First socket
    const ws1 = new WebSocket(wsUrl);
    const in1: any[] = [];
    ws1.on('message', (d) => in1.push(JSON.parse(d.toString())));
    await new Promise((r) => ws1.once('open', r));
    ws1.send(JSON.stringify({ type: 'auth', token }));
    await waitFor(in1, (m) => m.type === 'auth_ok', 3000);
    ws1.send(JSON.stringify({ type: 'terminal.open', cwd: process.cwd(), cols: 80, rows: 24, reqId: 'O' }));
    const opened = await waitFor(in1, (m) => m.type === 'terminal.opened', 3000);
    const termId = opened.termId as number;
    ws1.send(JSON.stringify({ type: 'terminal.attach', termId, cols: 80, rows: 24, reqId: 'A' }));
    await waitFor(in1, (m) => m.type === 'terminal.attached', 3000);
    ws1.send(JSON.stringify({ type: 'terminal.input', termId, data: 'echo phase-one-marker\n' }));
    await waitFor(in1, (m) =>
      m.type === 'terminal.output' && String(m.data).includes('phase-one-marker'), 5000);
    // Drop the socket without sending detach (server's ws.close handler runs detachAll)
    ws1.close();
    await new Promise((r) => setTimeout(r, 100));

    // Second socket — reattach and assert replay contains the marker
    const ws2 = new WebSocket(wsUrl);
    const in2: any[] = [];
    ws2.on('message', (d) => in2.push(JSON.parse(d.toString())));
    await new Promise((r) => ws2.once('open', r));
    ws2.send(JSON.stringify({ type: 'auth', token }));
    await waitFor(in2, (m) => m.type === 'auth_ok', 3000);
    ws2.send(JSON.stringify({ type: 'terminal.attach', termId, cols: 80, rows: 24, reqId: 'A2' }));
    await waitFor(in2, (m) => m.type === 'terminal.attached' && m.reqId === 'A2', 3000);
    // The very next terminal.output frame is the ring replay
    const replay = await waitFor(in2, (m) => m.type === 'terminal.output' && m.termId === termId, 3000);
    expect(String(replay.data)).toContain('phase-one-marker');

    ws2.send(JSON.stringify({ type: 'terminal.kill', termId, reqId: 'K' }));
    await waitFor(in2, (m) => m.type === 'terminal.kill.result', 3000);
    ws2.close();
    terminalStore.destroyAll();
    await remote.stop();
  }, 15_000);
});

async function waitFor(inbox: any[], pred: (m: any) => boolean, timeoutMs: number): Promise<any> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const m = inbox.find(pred);
    if (m) return m;
    await new Promise((r) => setTimeout(r, 20));
  }
  throw new Error('waitFor timeout');
}
```

- [ ] **Step 2: Run**

```bash
npm run test:integration -- tests/integration/remote/terminal-end-to-end.test.ts
```

Expected: 2 passing on macOS/Linux; both skipped on Windows.

- [ ] **Step 3: Commit**

```bash
git add tests/integration/remote/terminal-end-to-end.test.ts
git commit -m "test(remote): terminal end-to-end (echo + reconnect replay)"
```

---

## Task 13: PWA wire.ts — 8 terminal helpers

**Files:**
- Modify: `src/renderer-remote/wire.ts`

- [ ] **Step 1: Extend `WireClient` interface**

Add to the interface (after `pull`):

```ts
listTerminals(cwd: string): Promise<Array<{ termId: number; cwd: string; cols: number; rows: number; alive: boolean }>>;
openTerminal(cwd: string, cols: number, rows: number): Promise<{ termId: number; cols: number; rows: number }>;
attachTerminal(termId: number, cols: number, rows: number): Promise<{ termId: number; cols: number; rows: number }>;
detachTerminal(termId: number): void;
inputTerminal(termId: number, data: string): void;
resizeTerminal(termId: number, cols: number, rows: number): void;
signalTerminal(termId: number, signal: string): void;
killTerminal(termId: number): Promise<void>;
```

- [ ] **Step 2: Add reply dispatcher branches**

Inside the per-type reply dispatcher in `connect()` (the big `if/else if` chain), before the final `else { entry.resolve(msg); }`, add:

```ts
} else if (t === 'terminal.list.result') {
  entry.resolve((msg as any).terms ?? []);
} else if (t === 'terminal.opened') {
  entry.resolve({ termId: (msg as any).termId, cols: (msg as any).cols, rows: (msg as any).rows });
} else if (t === 'terminal.attached') {
  entry.resolve({ termId: (msg as any).termId, cols: (msg as any).cols, rows: (msg as any).rows });
} else if (t === 'terminal.kill.result') {
  entry.resolve(undefined);
```

- [ ] **Step 3: Add helpers in the returned client**

Append, after the existing `pull:` helper:

```ts
listTerminals: (cwd) => new Promise((resolve, reject) => {
  const reqId = `r${++reqCounter}`;
  pendingReq.set(reqId, { resolve, reject });
  setTimeout(() => { if (pendingReq.delete(reqId)) reject(new Error('terminal.list timeout')); }, 5000);
  sendFrame({ type: 'terminal.list', cwd, reqId });
}),
openTerminal: (cwd, cols, rows) => new Promise((resolve, reject) => {
  const reqId = `r${++reqCounter}`;
  pendingReq.set(reqId, { resolve, reject });
  setTimeout(() => { if (pendingReq.delete(reqId)) reject(new Error('terminal.open timeout')); }, 10_000);
  sendFrame({ type: 'terminal.open', cwd, cols, rows, reqId });
}),
attachTerminal: (termId, cols, rows) => new Promise((resolve, reject) => {
  const reqId = `r${++reqCounter}`;
  pendingReq.set(reqId, { resolve, reject });
  setTimeout(() => { if (pendingReq.delete(reqId)) reject(new Error('terminal.attach timeout')); }, 10_000);
  sendFrame({ type: 'terminal.attach', termId, cols, rows, reqId });
}),
detachTerminal: (termId) => sendFrame({ type: 'terminal.detach', termId }),
inputTerminal: (termId, data) => sendFrame({ type: 'terminal.input', termId, data }),
resizeTerminal: (termId, cols, rows) => sendFrame({ type: 'terminal.resize', termId, cols, rows }),
signalTerminal: (termId, signal) => sendFrame({ type: 'terminal.signal', termId, signal }),
killTerminal: (termId) => new Promise((resolve, reject) => {
  const reqId = `r${++reqCounter}`;
  pendingReq.set(reqId, { resolve, reject });
  setTimeout(() => { if (pendingReq.delete(reqId)) reject(new Error('terminal.kill timeout')); }, 10_000);
  sendFrame({ type: 'terminal.kill', termId, reqId });
}),
```

- [ ] **Step 4: tsc + PWA build + commit**

```bash
npx tsc --noEmit
npx vite build --config vite.config.pwa.ts
git add src/renderer-remote/wire.ts
git commit -m "feat(remote): PWA wire helpers for terminal.*"
```

---

## Task 14: PWA — Terminal.tsx (lazy xterm + visualViewport)

**Files:**
- Create: `src/renderer-remote/terminal/Terminal.tsx`

- [ ] **Step 1: Write the component**

```tsx
import { useEffect, useRef, useState } from 'react';
import type { WireClient, WireMsg } from '../wire';
import TerminalToolbar from './TerminalToolbar';

type XTermInstance = any; // narrowed at runtime via dynamic import
type FitAddonInstance = any;

interface Props {
  client: WireClient;
  termId: number;
  cwd: string;
  onBack: () => void;
  /** Called when the PTY has exited and the user dismisses the message. */
  onExit?: (code: number) => void;
}

export default function Terminal({ client, termId, cwd: _cwd, onBack, onExit }: Props) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const termRef = useRef<XTermInstance | null>(null);
  const fitRef = useRef<FitAddonInstance | null>(null);
  const [exited, setExited] = useState<number | null>(null);
  const [ctrlSticky, setCtrlSticky] = useState(false);

  // Mount xterm.js lazily on first render
  useEffect(() => {
    let cancelled = false;
    let dispOnData: { dispose: () => void } | null = null;
    let cleanupOnMsg: (() => void) | null = null;

    void Promise.all([import('@xterm/xterm'), import('@xterm/addon-fit')]).then(([xterm, fitMod]) => {
      if (cancelled || !containerRef.current) return;
      const term = new xterm.Terminal({
        cursorBlink: true,
        fontFamily: '"Geist Mono", ui-monospace, monospace',
        fontSize: 13,
        theme: { background: '#000000' },
        // Canvas renderer is more reliable on iOS Safari than WebGL
        rendererType: 'canvas' as any,
      });
      const fit = new fitMod.FitAddon();
      term.loadAddon(fit);
      term.open(containerRef.current);
      // Disable iOS autocorrect on xterm's hidden textarea
      const ta = (term as any).textarea as HTMLTextAreaElement | undefined;
      if (ta) {
        ta.setAttribute('autocorrect', 'off');
        ta.setAttribute('autocapitalize', 'none');
        ta.setAttribute('spellcheck', 'false');
      }
      fit.fit();
      termRef.current = term;
      fitRef.current = fit;

      // Wire input
      dispOnData = term.onData((data: string) => {
        client.inputTerminal(termId, data);
      });

      // Subscribe to terminal.output / terminal.exit for this termId
      cleanupOnMsg = client.on((msg: WireMsg) => {
        if ((msg as any).termId !== termId) return;
        if (msg.type === 'terminal.output') {
          term.write(String((msg as any).data ?? ''));
        } else if (msg.type === 'terminal.exit') {
          const code = (msg as any).code as number;
          term.write(`\r\n\x1b[33m[process exited (${code})]\x1b[0m\r\n`);
          setExited(code);
        }
      });

      // Attach (replay + live)
      const { cols, rows } = term;
      client.attachTerminal(termId, cols, rows).catch(() => { /* surfaced via error msg */ });
    });

    return () => {
      cancelled = true;
      dispOnData?.dispose();
      cleanupOnMsg?.();
      try { client.detachTerminal(termId); } catch { /* ignore */ }
      try { termRef.current?.dispose(); } catch { /* ignore */ }
      termRef.current = null;
      fitRef.current = null;
    };
  }, [client, termId]);

  // Recompute size on viewport changes (iOS keyboard show/hide, drawer changes)
  useEffect(() => {
    const recompute = () => {
      const fit = fitRef.current;
      const term = termRef.current;
      if (!fit || !term) return;
      try {
        fit.fit();
        client.resizeTerminal(termId, term.cols, term.rows);
      } catch { /* ignore */ }
    };
    const vv = (window as any).visualViewport as VisualViewport | undefined;
    vv?.addEventListener('resize', recompute);
    window.addEventListener('resize', recompute);
    const ro = new ResizeObserver(recompute);
    if (containerRef.current) ro.observe(containerRef.current);
    return () => {
      vv?.removeEventListener('resize', recompute);
      window.removeEventListener('resize', recompute);
      ro.disconnect();
    };
  }, [client, termId]);

  const sendBytes = (data: string) => client.inputTerminal(termId, data);

  const onToolbarKey = (key: 'Esc' | 'Tab' | 'Up' | 'Down' | 'Left' | 'Right' | 'Ctrl') => {
    if (key === 'Ctrl') { setCtrlSticky((v) => !v); return; }
    if (ctrlSticky) {
      // Ctrl+<key> only well-defined for letters; for arrows/Esc/Tab we still emit the base sequence.
      setCtrlSticky(false);
    }
    switch (key) {
      case 'Esc':   return sendBytes('\x1b');
      case 'Tab':   return sendBytes('\t');
      case 'Up':    return sendBytes('\x1b[A');
      case 'Down':  return sendBytes('\x1b[B');
      case 'Right': return sendBytes('\x1b[C');
      case 'Left':  return sendBytes('\x1b[D');
    }
  };

  /** Consume the next printable char when Ctrl is sticky, then emit \x01..\x1a. */
  const onCtrlChar = (ch: string) => {
    if (!ctrlSticky) return false;
    const c = ch.toLowerCase();
    if (c >= 'a' && c <= 'z') {
      sendBytes(String.fromCharCode(c.charCodeAt(0) - 96));
      setCtrlSticky(false);
      return true;
    }
    setCtrlSticky(false);
    return false;
  };

  return (
    <div style={{
      display: 'flex',
      flexDirection: 'column',
      height: '100%',
      background: '#000',
      paddingTop: 'env(safe-area-inset-top)',
      paddingBottom: 'env(safe-area-inset-bottom)',
    }}>
      <div ref={containerRef} style={{ flex: 1, minHeight: 0, padding: 4 }} />
      {exited !== null ? (
        <div style={{ padding: 12, display: 'flex', gap: 8, background: 'var(--bg-secondary)', borderTop: '1px solid var(--border)' }}>
          <button
            onClick={() => { onExit?.(exited); onBack(); }}
            style={{ padding: '8px 12px', background: 'var(--accent)', color: '#000', border: 'none', borderRadius: 6 }}
          >Close</button>
          <span style={{ alignSelf: 'center', fontSize: 12, color: 'var(--text-muted)' }}>
            exited ({exited})
          </span>
        </div>
      ) : (
        <TerminalToolbar
          ctrlSticky={ctrlSticky}
          onKey={onToolbarKey}
          onBack={onBack}
          onCtrlChar={onCtrlChar}
        />
      )}
    </div>
  );
}
```

- [ ] **Step 2: tsc + PWA build**

```bash
npx tsc --noEmit
npx vite build --config vite.config.pwa.ts
```

Expected: clean. (TerminalToolbar import will fail until Task 15.)

If the build fails because TerminalToolbar.tsx is missing, that's expected — proceed to Task 15 and commit them together. Stage Terminal.tsx now but don't commit yet.

```bash
git add src/renderer-remote/terminal/Terminal.tsx
```

---

## Task 15: PWA — TerminalToolbar.tsx

**Files:**
- Create: `src/renderer-remote/terminal/TerminalToolbar.tsx`

- [ ] **Step 1: Write**

```tsx
import { ArrowLeft } from 'lucide-react';

type Key = 'Esc' | 'Tab' | 'Up' | 'Down' | 'Left' | 'Right' | 'Ctrl';

interface Props {
  ctrlSticky: boolean;
  onKey: (k: Key) => void;
  /** Restore the drawer / leave fullscreen. */
  onBack: () => void;
  /** Hook so a Ctrl+letter shortcut from another input layer can consume Ctrl. Currently unused but reserved. */
  onCtrlChar?: (ch: string) => boolean;
}

export default function TerminalToolbar({ ctrlSticky, onKey, onBack }: Props) {
  const btnBase: React.CSSProperties = {
    minWidth: 40,
    height: 36,
    padding: '0 10px',
    background: 'var(--bg-elevated)',
    color: 'var(--text)',
    border: '1px solid var(--border)',
    borderRadius: 8,
    fontFamily: '"Geist Mono", ui-monospace, monospace',
    fontSize: 13,
    cursor: 'pointer',
    flexShrink: 0,
  };
  const ctrlStyle: React.CSSProperties = ctrlSticky ? {
    ...btnBase, background: 'var(--accent)', color: '#000', borderColor: 'var(--accent)',
  } : btnBase;

  return (
    <div style={{
      display: 'flex',
      alignItems: 'center',
      gap: 6,
      padding: '6px 8px',
      background: 'var(--bg-secondary)',
      borderTop: '1px solid var(--border)',
      overflowX: 'auto',
      WebkitOverflowScrolling: 'touch',
    }}>
      <button onClick={onBack} aria-label="Back to drawer" style={{ ...btnBase, minWidth: 36 }}>
        <ArrowLeft size={16} strokeWidth={2} />
      </button>
      <button onClick={() => onKey('Esc')}  style={btnBase}>Esc</button>
      <button onClick={() => onKey('Tab')}  style={btnBase}>Tab</button>
      <button onClick={() => onKey('Ctrl')} style={ctrlStyle}>Ctrl</button>
      <button onClick={() => onKey('Up')}    style={btnBase}>↑</button>
      <button onClick={() => onKey('Down')}  style={btnBase}>↓</button>
      <button onClick={() => onKey('Left')}  style={btnBase}>←</button>
      <button onClick={() => onKey('Right')} style={btnBase}>→</button>
    </div>
  );
}
```

- [ ] **Step 2: tsc + PWA build + commit**

```bash
npx tsc --noEmit
npx vite build --config vite.config.pwa.ts
git add src/renderer-remote/terminal/Terminal.tsx src/renderer-remote/terminal/TerminalToolbar.tsx
git commit -m "feat(remote): PWA Terminal + soft-key toolbar"
```

---

## Task 16: PWA — TerminalPicker.tsx (sheet)

**Files:**
- Create: `src/renderer-remote/terminal/TerminalPicker.tsx`

- [ ] **Step 1: Write**

```tsx
import { useEffect, useState } from 'react';
import { Plus, X } from 'lucide-react';
import type { WireClient } from '../wire';

interface Summary { termId: number; cwd: string; cols: number; rows: number; alive: boolean }

interface Props {
  client: WireClient;
  cwd: string;
  /** Called after the user picks (existing) or creates (new) a terminal. */
  onPick: (termId: number) => void;
  onClose: () => void;
}

export default function TerminalPicker({ client, cwd, onPick, onClose }: Props) {
  const [terms, setTerms] = useState<Summary[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    client.listTerminals(cwd)
      .then((arr) => { if (!cancelled) setTerms(arr as Summary[]); })
      .catch((e: Error) => { if (!cancelled) setErr(e.message); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [client, cwd]);

  const onNew = async () => {
    setCreating(true);
    setErr(null);
    try {
      // Reasonable default; Terminal.tsx will resize after mount via fit().
      const r = await client.openTerminal(cwd, 80, 24);
      onPick(r.termId);
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setCreating(false);
    }
  };

  return (
    <div style={{
      position: 'fixed', inset: 0, zIndex: 70,
      display: 'flex', flexDirection: 'column',
      background: 'rgba(0,0,0,0.5)',
    }}>
      <button onClick={onClose} aria-label="Close picker" style={{
        flex: 1, background: 'transparent', border: 'none', cursor: 'pointer',
      }} />
      <div style={{
        background: 'var(--bg-secondary)',
        borderTop: '1px solid var(--border)',
        borderTopLeftRadius: 12, borderTopRightRadius: 12,
        paddingBottom: 'env(safe-area-inset-bottom)',
        maxHeight: '70vh',
        display: 'flex', flexDirection: 'column',
      }}>
        <div style={{
          display: 'flex', alignItems: 'center', gap: 8,
          padding: '12px 14px', borderBottom: '1px solid var(--border)',
        }}>
          <div style={{ fontSize: 13, fontWeight: 600, flex: 1 }}>Terminals</div>
          <button onClick={onClose} aria-label="Close" style={{
            background: 'transparent', border: 'none', color: 'var(--text-muted)', cursor: 'pointer',
          }}><X size={18} /></button>
        </div>
        <button
          onClick={onNew}
          disabled={creating}
          style={{
            display: 'flex', alignItems: 'center', gap: 8,
            padding: '12px 14px', textAlign: 'left',
            background: 'transparent', color: 'var(--accent)', border: 'none',
            borderBottom: '1px solid var(--border)',
            fontSize: 14, cursor: 'pointer',
          }}
        >
          <Plus size={16} /> {creating ? 'Opening…' : 'New terminal'}
        </button>
        <div style={{ overflowY: 'auto', flex: 1 }}>
          {loading && <div style={{ padding: '12px 14px', fontSize: 12, color: 'var(--text-muted)' }}>Loading…</div>}
          {err && <div style={{ padding: '12px 14px', fontSize: 12, color: 'var(--red)' }}>{err}</div>}
          {!loading && terms.length === 0 && !err && (
            <div style={{ padding: '12px 14px', fontSize: 12, color: 'var(--text-muted)' }}>
              No terminals yet.
            </div>
          )}
          {terms.map((t) => (
            <button key={t.termId} onClick={() => onPick(t.termId)} style={{
              display: 'flex', alignItems: 'center', gap: 8,
              width: '100%', textAlign: 'left',
              padding: '10px 14px', background: 'transparent',
              color: 'var(--text)', border: 'none',
              borderBottom: '1px solid var(--border)',
              fontFamily: '"Geist Mono", ui-monospace, monospace',
              fontSize: 13, cursor: 'pointer',
            }}>
              <span style={{ color: 'var(--accent)' }}>#{t.termId}</span>
              <span style={{ flex: 1, color: 'var(--text-muted)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{t.cwd}</span>
              <span style={{ color: 'var(--text-muted)' }}>{t.cols}×{t.rows}</span>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: tsc + PWA build + commit**

```bash
npx tsc --noEmit
npx vite build --config vite.config.pwa.ts
git add src/renderer-remote/terminal/TerminalPicker.tsx
git commit -m "feat(remote): PWA TerminalPicker sheet"
```

---

## Task 17: PWA — NavDrawer adds Terminal rail item + fullscreen mode

**Files:**
- Modify: `src/renderer-remote/chat/NavDrawer.tsx`

- [ ] **Step 1: Extend types + nav items + imports**

At the top of the file, extend imports:

```ts
import { FolderClosed, GitBranch, Clock, X, Terminal as TerminalIcon } from 'lucide-react';
import Terminal from '../terminal/Terminal';
import TerminalPicker from '../terminal/TerminalPicker';
```

Widen `NavItem`:

```ts
type NavItem = 'files' | 'git' | 'chats' | 'terminal';
```

Add to `NAV_ITEMS`:

```ts
const NAV_ITEMS: NavItemMeta[] = [
  { id: 'files',    icon: FolderClosed, label: 'Files' },
  { id: 'git',      icon: GitBranch,    label: 'Changes' },
  { id: 'chats',    icon: Clock,        label: 'Chats' },
  { id: 'terminal', icon: TerminalIcon, label: 'Terminal' },
];
```

- [ ] **Step 2: Add local state for picker + active termId**

Inside `NavDrawer`, near the existing `useState` calls:

```ts
const [activeTermId, setActiveTermId] = useState<number | null>(null);
const [pickerOpen, setPickerOpen] = useState(false);

// When the user clicks the Terminal rail item, open the picker (unless a term is already active).
useEffect(() => {
  if (active === 'terminal' && activeTermId === null) setPickerOpen(true);
  if (active !== 'terminal') setPickerOpen(false);
}, [active, activeTermId]);
```

- [ ] **Step 3: Render Terminal fullscreen when active**

Replace the outer return so that when `active === 'terminal' && activeTermId !== null`, the rail + sliver are hidden and `Terminal` fills the viewport. Modify the existing return so the rail render and sliver button are conditional on `active !== 'terminal' || activeTermId === null`.

Concretely, at the very start of the `return ( ... )`:

```tsx
const terminalActive = active === 'terminal' && activeTermId !== null;
const gitCwdLocal = gitCwd;
```

Then wrap the existing rail `<div>` and sliver `<button>` with `{!terminalActive && ( ... )}`. Adjust the right panel: when `terminalActive` is true, the right panel should fill the whole screen and the `marginRight: SLIVER_WIDTH` should be 0.

For the active surface rendering branch, add at the end (alongside the existing `active === 'chats'` block):

```tsx
{active === 'terminal' && activeTermId !== null && (
  <Terminal
    client={client}
    termId={activeTermId}
    cwd={gitCwdLocal}
    onBack={() => { setActiveTermId(null); setActive('files'); }}
    onExit={() => { setActiveTermId(null); }}
  />
)}
```

And **after** the closing `</div>` of the outer drawer but still inside the top-level return, render the picker:

```tsx
{pickerOpen && (
  <TerminalPicker
    client={client}
    cwd={gitCwdLocal}
    onPick={(termId) => { setActiveTermId(termId); setPickerOpen(false); }}
    onClose={() => {
      setPickerOpen(false);
      // If no terminal was picked, drop back to files
      if (activeTermId === null) setActive('files');
    }}
  />
)}
```

- [ ] **Step 4: tsc + PWA build + commit**

```bash
npx tsc --noEmit
npx vite build --config vite.config.pwa.ts
git add src/renderer-remote/chat/NavDrawer.tsx
git commit -m "feat(remote): NavDrawer adds Terminal nav item + fullscreen mode"
```

---

## Task 18: Manual smoke checklist

**Files:**
- Create: `docs/superpowers/notes/2026-05-25-mobile-remote-p5-smoke.md`

- [ ] **Step 1: Write**

```markdown
# Mobile Remote Phase 5 — Manual Smoke Checklist

Run on real hardware (laptop + iPhone) before declaring P5 done.

## Prerequisites
- [ ] P0–P4 smoke pass.
- [ ] Tailscale up. PWA reachable from phone over the tailnet.

## Drawer integration
- [ ] Open the drawer. Four rail items visible: Files, Changes, Chats, Terminal.
- [ ] Tap Terminal. Picker sheet slides up from the bottom.
- [ ] Picker shows "New terminal" at top + (initially) "No terminals yet.".

## New terminal
- [ ] Tap "New terminal". Picker dismisses, drawer rail and sliver hide, xterm fills the viewport.
- [ ] Prompt appears within ~1s. Type `ls` + Enter. Output renders with ANSI colors.
- [ ] Run `git status` in a repo cwd. Branch line shown.
- [ ] Run `git log --oneline --color=always | head` — colors render.

## Soft-key toolbar
- [ ] Esc cancels an active `less` invocation.
- [ ] Tab completes `cd <prefix><Tab>`.
- [ ] Run `sleep 30`. Tap Ctrl (highlights). Tap "c" on the on-screen keyboard. The sleep is killed (SIGINT delivered as `\x03`).
- [ ] Arrows recall history (`↑`/`↓`) and move within a line (`←`/`→`).
- [ ] Back arrow returns to the drawer with terminal preserved.

## Lock/unlock + reconnect
- [ ] Start a long-running command (`tail -f /tmp/sai.log` or `for i in $(seq 1 100); do echo $i; sleep 1; done`).
- [ ] Lock the phone for >1 min. Unlock.
- [ ] Terminal reattaches; scrollback intact; live output resumes within ~2s.

## Multiple terminals
- [ ] Back-arrow to drawer. Open Terminal again. Picker now lists the existing term + "New terminal".
- [ ] Tap "New terminal". A second xterm opens.
- [ ] Back-arrow → picker → tap the first term. Switches back, state preserved.

## Viewport resize
- [ ] Tap inside xterm — iOS keyboard pops up. Visible columns recompute; prompt stays in view.
- [ ] Dismiss keyboard — restore cols.

## Kill from picker / exit
- [ ] In the picker, no kill button is exposed yet (v1) — exit a term via `exit` instead.
- [ ] `exit 0` in a term → `[process exited (0)]` line in yellow → Close button → back to drawer.
- [ ] Re-open picker; the exited term is gone from the list.

## Workspace switch
- [ ] Use RepoPicker (Files/Git rail) to switch workspace. Open Terminal — picker only lists terms whose cwd matches the new workspace.

## Heavy stdout
- [ ] Run `yes | head -10000`. PWA stays responsive. After it finishes, scrollback is capped (oldest output evicted) but the last few hundred lines are visible.

## Regression
- [ ] Desktop SAI terminal still spawns normally (open a desktop window terminal — no change).
```

- [ ] **Step 2: Commit**

```bash
git add docs/superpowers/notes/2026-05-25-mobile-remote-p5-smoke.md
git commit -m "docs(remote): manual smoke checklist for phase 5"
```

---

## Task 19: Final sweep

- [ ] **Step 1: Full suite + tsc + PWA build**

```bash
cd /var/home/mstephens/Documents/GitHub/sai
npm test 2>&1 | tail -10
npx tsc --noEmit
npx vite build --config vite.config.pwa.ts
```

Expected: all tests pass; tsc clean; PWA build succeeds.

- [ ] **Step 2: Final tidy commit (only if anything was fixed)**

```bash
git add -A
git commit -m "chore(remote): final tidy after p5 verification" || true
```

---

## Done

Phase 5 is complete when:

1. All vitest unit + integration tests pass (P0–P4 stay green; new RingBuffer + terminal-store + bridge-terminal unit tests + terminal-end-to-end integration test all green).
2. `tsc --noEmit` clean.
3. PWA bundle builds.
4. Manual smoke walked on a real iPhone over Tailscale.
5. No regression in desktop terminal behavior (Task 3's impl extraction is additive).

Next per roadmap: polish (AI commit messages, branch picker, discard) or new phase TBD.
