# Mobile Remote — Phase 5.1: View Desktop Terminals — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let the mobile PWA list, attach to, and view live output from terminals that were spawned by the desktop SAI app. Read-mostly: phone can send a restricted control-key set (Esc/Tab/CR/LF/Ctrl-letters/arrows) but not raw typing. No PTY resize from phone. Phone-owned terminals (P5) keep working unchanged.

**Architecture:**
- `electron/services/pty.ts`: add a per-desktop-terminal ring buffer (`ringByTerm`, 64KB cap, reusing existing `RingBuffer`) and a subscriber set (`subscribersByTerm`). Wire ring-write + fan-out into the existing `term.onData` inside `registerTerminalHandlers` (desktop IPC path only — the phone path in `createTerminalImpl` keeps its own ring inside `PhoneTerminalRegistry`). Export three new functions: `snapshotTerminal(termId)`, `subscribeTerminal(termId, cb)`, `listDesktopTerminals()`. Clean up both maps on `term.onExit`.
- `electron/services/remote/terminal-store.ts`: `PhoneTerminalRegistry` becomes the unified dispatcher. `list()` merges phone + desktop summaries with an `origin` tag. `attach()` dispatches by termId provenance: phone-owned → existing path; desktop-owned → `attachDesktop` (replay snapshot, subscribe, store unsub keyed by `(ws, termId)`). `input()` applies an allow-list filter for desktop-owned terms; `resize` silently no-ops; `kill` returns an error; `signal('SIGINT')` is allowed. `detach`/`detachAll` walk both phone-attached terms and the new `desktopUnsubs` map.
- `electron/services/remote/bridge-server.ts`: **no changes** — all message routing already calls `store.list/attach/input/...`. The registry decides phone vs desktop internally.
- PWA: `wire.ts` extends the `listTerminals` return type with `origin`. `TerminalPicker` renders two sections ("Phone terminals" / "Desktop terminals") and passes `origin` to `onPick`. `Terminal.tsx` accepts an `origin` prop; in `desktop` mode it skips `fit()`, removes the textarea from the focus chain, and renders `TerminalToolbar` in `variant="view-only"`. `TerminalToolbar` gains a `variant: 'full' | 'view-only'` prop — view-only adds an Enter key and a "view only" pill. `NavDrawer` threads `origin` from picker → Terminal.

**Tech Stack:** TypeScript, node-pty (existing dep), ws, vitest, React, `@xterm/xterm` + `@xterm/addon-fit` + `@xterm/addon-canvas` (already installed; lazy-imported by `Terminal.tsx`).

**Spec:** `docs/superpowers/specs/2026-05-25-mobile-remote-p5_1-shared-desktop-terminals-design.md`. **Branch:** `feat/mobile-remote-p5.1` to branch off `main` once P5 has landed; if P5 hasn't merged yet, branch from current `main` and rebase later.

---

## Pre-flight notes

- xterm + node-pty deps are already declared (verified in P5). No installs expected.
- `electron/services/remote/ring-buffer.ts` already exists (added in P5). Reuse it for the desktop ring map — do NOT duplicate.
- `electron/services/pty.ts` keeps two parallel terminal entry points: the IPC handler `'terminal:create'` inside `registerTerminalHandlers` (desktop windows) and `createTerminalImpl` (phone, called from `PhoneTerminalRegistry`). The ring + subscriber wiring added in this phase lives **only** on the desktop IPC path; phone-owned terminals still ring-buffer inside `PhoneTerminalRegistry`. Keeping the two registries independent matches the P5 design and keeps `allTerminals` simple.
- `tests/unit/remote/terminal-store.test.ts` already uses the `vi.hoisted` stub pattern to mock `@electron/services/pty` exports. Extend the same stub object for the new exports.
- `tests/integration/remote/terminal-end-to-end.test.ts` already exercises phone-owned terms end-to-end. The new tests add a "fake desktop term" by calling the new pty.ts exports directly (no real desktop window), then drive the bridge through WS.
- All commits use Conventional Commits, scope `remote` or `pty`.

---

## File structure

**Modified (Electron):**
- `electron/services/pty.ts` — ring buffer map, subscriber set, `snapshotTerminal` / `subscribeTerminal` / `listDesktopTerminals`, ring/fanout in desktop `term.onData` + cleanup in `term.onExit`
- `electron/services/remote/terminal-store.ts` — `origin` in summaries, merged `list()`, dispatching `attach/input/resize/kill/signal`, `desktopUnsubs` map, allow-list filter, `detach/detachAll` walking both maps

**Modified (PWA):**
- `src/renderer-remote/wire.ts` — `listTerminals` return type adds `origin`
- `src/renderer-remote/terminal/Terminal.tsx` — `origin` prop, view-only behavior
- `src/renderer-remote/terminal/TerminalToolbar.tsx` — `variant` prop, Enter key, "view only" pill
- `src/renderer-remote/terminal/TerminalPicker.tsx` — grouped sections, origin badge, `onPick(termId, origin)`
- `src/renderer-remote/chat/NavDrawer.tsx` — thread `origin` from picker → Terminal

**Modified (tests + docs):**
- `tests/unit/remote/terminal-store.test.ts` — add "shared desktop terminals" describe block (merged list, attachDesktop, allow-list filter, kill refuses, resize no-ops, detachAll walks desktop unsubs)
- `tests/integration/remote/terminal-end-to-end.test.ts` — add "desktop term attach/replay/allow-list" case
- `docs/superpowers/notes/2026-05-25-mobile-remote-p5-smoke.md` — append "Desktop terminal viewing" section

---

## Task 1: Verify deps + create branch

**Files:** none (verification)

- [ ] **Step 1: Verify xterm + node-pty still present**

```bash
cd /var/home/mstephens/Documents/GitHub/sai
node -e "const p=require('./package.json'); console.log(p.dependencies['@xterm/xterm'], p.dependencies['@xterm/addon-fit'], p.dependencies['@xterm/addon-canvas'], p.dependencies['node-pty']);"
```

Expected: four non-`undefined` versions printed.

- [ ] **Step 2: Branch from main**

```bash
git fetch origin
git checkout -B feat/mobile-remote-p5.1 origin/main
```

Expected: clean working tree on new branch tracking `main`. If P5 isn't merged yet, branch off whichever ref the user designates and rebase later.

---

## Task 2: pty.ts — ring + subscriber state + listDesktopTerminals export

**Files:**
- Modify: `electron/services/pty.ts`

This task only adds module-level state and three pure exports. The fan-out wiring inside `term.onData` lands in Task 3 so we can test each piece in isolation.

- [ ] **Step 1: Add imports + module-level state**

Near the top of `electron/services/pty.ts`, after the existing imports:

```ts
import { RingBuffer } from './remote/ring-buffer';
```

After the existing `let nextId = 1;` line (around line 50):

```ts
// Shared scrollback + fan-out for desktop-owned terminals so phone clients can
// attach via the remote bridge. Phone-owned terminals (created via
// createTerminalImpl from PhoneTerminalRegistry) keep their own ring inside
// the registry — these maps are only populated by the desktop IPC handler.
const DESKTOP_RING_CAP_BYTES = 64 * 1024;
type DesktopDataListener = (data: string) => void;
const ringByTerm = new Map<number, RingBuffer>();
const subscribersByTerm = new Map<number, Set<DesktopDataListener>>();
```

- [ ] **Step 2: Add public exports**

Append after `destroyAllTerminals`:

```ts
/**
 * Return the current ring snapshot for a desktop-owned terminal, or '' if none.
 * Phone-owned terminals (PhoneTerminalRegistry) snapshot their own ring directly.
 */
export function snapshotTerminal(termId: number): string {
  return ringByTerm.get(termId)?.snapshot() ?? '';
}

/**
 * Subscribe to live output for a desktop-owned terminal. Returns an unsubscribe.
 * The callback runs synchronously inside the pty.onData handler — keep it cheap.
 */
export function subscribeTerminal(termId: number, cb: DesktopDataListener): () => void {
  let set = subscribersByTerm.get(termId);
  if (!set) { set = new Set(); subscribersByTerm.set(termId, set); }
  set.add(cb);
  return () => { set?.delete(cb); };
}

/**
 * List desktop-owned terminals with best-effort cwd / cols / rows.
 * cwd is taken from terminalOwner; cols/rows from the IPty instance.
 */
export function listDesktopTerminals(): Array<{
  termId: number; cwd: string; cols: number; rows: number; alive: boolean;
}> {
  const out: Array<{ termId: number; cwd: string; cols: number; rows: number; alive: boolean }> = [];
  for (const [termId, term] of allTerminals.entries()) {
    // Skip phone-owned: phone terms live in PhoneTerminalRegistry, but they also
    // pass through createTerminalImpl → allTerminals. We tag desktop ownership
    // by the presence of a terminalOwner entry (set only inside the IPC handler).
    const cwd = terminalOwner.get(termId);
    if (cwd === undefined) continue;
    const t = term as unknown as { cols?: number; rows?: number };
    out.push({
      termId, cwd,
      cols: typeof t.cols === 'number' ? t.cols : 80,
      rows: typeof t.rows === 'number' ? t.rows : 24,
      alive: true,
    });
  }
  return out;
}

/** Test hook: seed desktop state without spawning a real PTY. */
export function _seedDesktopTerminalForTest(termId: number, cwd: string, cols = 80, rows = 24): void {
  // Used by integration test to simulate a desktop term. We can't fake
  // allTerminals (it needs a real IPty), so we only populate the ancillary
  // maps; listDesktopTerminals reads allTerminals → use this in unit tests via
  // the vi.hoisted stub instead. (Kept here as an explicit no-op anchor so
  // test code can document its intent; integration tests use the real path.)
  void termId; void cwd; void cols; void rows;
}
```

> **Design note:** `listDesktopTerminals` distinguishes phone-owned from desktop-owned by the presence of a `terminalOwner` entry. The IPC handler sets `terminalOwner.set(id, cwd)` for every desktop spawn; `createTerminalImpl` (phone path) does not. This avoids a second registry and matches the spec's "two registries stay independent" requirement.

- [ ] **Step 3: tsc**

```bash
npx tsc --noEmit
```

Expected: clean. No tests yet — Task 3 wires the data callback and Task 5 lands the first failing test that exercises these exports.

- [ ] **Step 4: Commit**

```bash
git add electron/services/pty.ts
git commit -m "feat(pty): scaffold ring + subscriber maps for shared desktop terminals"
```

---

## Task 3: pty.ts — fan-out ring + subscribers from desktop term.onData

**Files:**
- Modify: `electron/services/pty.ts`

- [ ] **Step 1: Wire ring + subscribers inside the existing desktop `term.onData`**

Inside `registerTerminalHandlers`, the `ipcMain.handle('terminal:create', ...)` block currently ends with:

```ts
term.onData((data) => { safeSend(win, 'terminal:data', id, data); });
term.onExit(() => {
  allTerminals.delete(id);
  const owner = terminalOwner.get(id);
  if (owner) {
    const ownerWs = get(owner);
    ownerWs?.terminals.delete(id);
    terminalOwner.delete(id);
  }
});
```

Replace with:

```ts
term.onData((data) => {
  // Desktop renderer (unchanged behavior)
  safeSend(win, 'terminal:data', id, data);
  // Phone-bridge fan-out: write to ring, broadcast to subscribers.
  let ring = ringByTerm.get(id);
  if (!ring) { ring = new RingBuffer(DESKTOP_RING_CAP_BYTES); ringByTerm.set(id, ring); }
  ring.push(data);
  const subs = subscribersByTerm.get(id);
  if (subs && subs.size > 0) {
    for (const cb of subs) {
      try { cb(data); } catch { /* isolate one subscriber's failure */ }
    }
  }
});
term.onExit(() => {
  allTerminals.delete(id);
  const owner = terminalOwner.get(id);
  if (owner) {
    const ownerWs = get(owner);
    ownerWs?.terminals.delete(id);
    terminalOwner.delete(id);
  }
  ringByTerm.delete(id);
  subscribersByTerm.delete(id);
});
```

Also extend the `terminal:kill` handler so explicit kills clear both maps:

```ts
ipcMain.on('terminal:kill', (_event, id: number) => {
  const term = allTerminals.get(id);
  if (term) {
    term.kill();
    allTerminals.delete(id);
    const owner = terminalOwner.get(id);
    if (owner) {
      const ownerWs = get(owner);
      ownerWs?.terminals.delete(id);
      terminalOwner.delete(id);
    }
    ringByTerm.delete(id);
    subscribersByTerm.delete(id);
  }
});
```

- [ ] **Step 2: Extend `destroyAllTerminals` to clear the new maps**

```ts
export function destroyAllTerminals() {
  for (const term of allTerminals.values()) { term.kill(); }
  allTerminals.clear();
  terminalOwner.clear();
  ringByTerm.clear();
  subscribersByTerm.clear();
}
```

- [ ] **Step 3: tsc + existing suite (no regression)**

```bash
npx tsc --noEmit
npm test 2>&1 | tail -10
```

Expected: tsc clean, all existing tests pass — no test covers the new code yet, and the desktop renderer behavior is byte-identical.

- [ ] **Step 4: Commit**

```bash
git add electron/services/pty.ts
git commit -m "feat(pty): fan ring + subscribers from desktop term.onData/onExit"
```

---

## Task 4: terminal-store.ts — add `origin` to summaries + merged `list()`

**Files:**
- Modify: `electron/services/remote/terminal-store.ts`
- Modify: `tests/unit/remote/terminal-store.test.ts`

- [ ] **Step 1: Extend the stub to expose the new pty.ts exports**

Edit the `vi.hoisted` block in `tests/unit/remote/terminal-store.test.ts`. Add stub state for desktop calls and expose handlers in the mock factory:

```ts
const stub = vi.hoisted(() => {
  let nextId = 100;
  const state = {
    writes: [] as Array<{ termId: number; data: string }>,
    resizes: [] as Array<{ termId: number; cols: number; rows: number }>,
    signals: [] as Array<{ termId: number; sig: NodeJS.Signals }>,
    kills: [] as number[],
    dataCbs: new Map<number, (s: string) => void>(),
    exitCbs: new Map<number, (n: number) => void>(),
    // New for P5.1: shared desktop terminal stubs.
    desktopTerms: new Map<number, { cwd: string; cols: number; rows: number; alive: boolean }>(),
    desktopRings: new Map<number, string>(),
    desktopSubs: new Map<number, Set<(s: string) => void>>(),
    getNextId: () => nextId++,
  };
  return state;
});

vi.mock('@electron/services/pty', () => ({
  createTerminalImpl: (opts: any) => {
    const termId = stub.getNextId();
    stub.dataCbs.set(termId, opts.onData);
    stub.exitCbs.set(termId, opts.onExit);
    return { termId, pty: { pid: 9000 + termId } };
  },
  writeTerminalImpl: (termId: number, data: string) => stub.writes.push({ termId, data }),
  resizeTerminalImpl: (termId: number, cols: number, rows: number) =>
    stub.resizes.push({ termId, cols, rows }),
  signalTerminalImpl: (termId: number, sig: NodeJS.Signals) =>
    stub.signals.push({ termId, sig }),
  killTerminalImpl: (termId: number) => stub.kills.push(termId),
  // P5.1: desktop bridge surface.
  snapshotTerminal: (termId: number) => stub.desktopRings.get(termId) ?? '',
  subscribeTerminal: (termId: number, cb: (s: string) => void) => {
    let set = stub.desktopSubs.get(termId);
    if (!set) { set = new Set(); stub.desktopSubs.set(termId, set); }
    set.add(cb);
    return () => { set?.delete(cb); };
  },
  listDesktopTerminals: () => [...stub.desktopTerms.entries()].map(([termId, t]) => ({
    termId, cwd: t.cwd, cols: t.cols, rows: t.rows, alive: t.alive,
  })),
}));
```

- [ ] **Step 2: Failing test for merged `list()` with origins**

Append a new describe block at the end of `tests/unit/remote/terminal-store.test.ts`:

```ts
describe('PhoneTerminalRegistry — shared desktop terminals', () => {
  let reg: PhoneTerminalRegistry;

  beforeEach(() => {
    reg = new PhoneTerminalRegistry();
    stub.desktopTerms.clear();
    stub.desktopRings.clear();
    stub.desktopSubs.clear();
  });
  afterEach(() => { reg.destroyAll(); });

  it('list() merges phone + desktop summaries with origin tags', () => {
    const phone = reg.open('/repo', 80, 24);
    stub.desktopTerms.set(7, { cwd: '/repo', cols: 100, rows: 30, alive: true });
    const all = reg.list();
    const phoneEntry = all.find((x) => x.termId === phone.termId)!;
    const desktopEntry = all.find((x) => x.termId === 7)!;
    expect(phoneEntry.origin).toBe('phone');
    expect(desktopEntry.origin).toBe('desktop');
    expect(desktopEntry.cwd).toBe('/repo');
    expect(desktopEntry.cols).toBe(100);
  });

  it('list(cwd) filters desktop terms by cwd', () => {
    stub.desktopTerms.set(7, { cwd: '/a', cols: 80, rows: 24, alive: true });
    stub.desktopTerms.set(8, { cwd: '/b', cols: 80, rows: 24, alive: true });
    expect(reg.list('/a').map((x) => x.termId)).toEqual([7]);
    expect(reg.list('/b').map((x) => x.termId)).toEqual([8]);
  });
});
```

- [ ] **Step 3: Run — expect failure**

```bash
npx vitest run tests/unit/remote/terminal-store.test.ts
```

Expected: 2 failures (no `origin` on summaries; `list()` does not include desktop entries).

- [ ] **Step 4: Implement — extend `PhoneTerminalSummary` and `list()`**

In `electron/services/remote/terminal-store.ts`, update imports:

```ts
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
```

Extend the summary:

```ts
export interface PhoneTerminalSummary {
  termId: number;
  cwd: string;
  cols: number;
  rows: number;
  alive: boolean;
  origin: 'phone' | 'desktop';
}
```

Replace `list()`:

```ts
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
```

- [ ] **Step 5: Run — expect pass**

```bash
npx vitest run tests/unit/remote/terminal-store.test.ts
npx tsc --noEmit
```

Expected: all describe blocks green; tsc clean.

- [ ] **Step 6: Commit**

```bash
git add electron/services/remote/terminal-store.ts tests/unit/remote/terminal-store.test.ts
git commit -m "feat(remote): tag terminal summaries with origin + merge desktop list"
```

---

## Task 5: terminal-store.ts — `attach()` dispatch + desktop replay/stream

**Files:**
- Modify: `electron/services/remote/terminal-store.ts`
- Modify: `tests/unit/remote/terminal-store.test.ts`

- [ ] **Step 1: Failing tests for desktop attach**

Append inside the new "shared desktop terminals" describe block:

```ts
function fakeWs(): any {
  const sent: string[] = [];
  return { OPEN: 1, readyState: 1, send: (s: string) => sent.push(s), __sent: sent };
}

it('attach() for a desktop term returns the ring snapshot + desktop dims', () => {
  stub.desktopTerms.set(7, { cwd: '/repo', cols: 132, rows: 50, alive: true });
  stub.desktopRings.set(7, 'previous output\n$ ');
  const ws = fakeWs();
  const r = reg.attach(7, ws, 80, 24);
  expect(r).not.toBeNull();
  expect(r!.replay).toBe('previous output\n$ ');
  expect(r!.cols).toBe(132);
  expect(r!.rows).toBe(50);
});

it('desktop attach subscribes to live output and forwards terminal.output frames', () => {
  stub.desktopTerms.set(7, { cwd: '/repo', cols: 80, rows: 24, alive: true });
  const ws = fakeWs();
  reg.attach(7, ws, 80, 24);
  const subs = stub.desktopSubs.get(7)!;
  expect(subs.size).toBe(1);
  // Fire the data callback as the pty would.
  for (const cb of subs) cb('live-byte');
  expect(ws.__sent.some((s: string) =>
    s.includes('"terminal.output"') && s.includes('"termId":7') && s.includes('live-byte'),
  )).toBe(true);
});

it('attach() returns null for an unknown termId (neither phone nor desktop)', () => {
  const ws = fakeWs();
  expect(reg.attach(9999, ws, 80, 24)).toBeNull();
});

it('does NOT resize the desktop PTY on attach (phone cols/rows ignored)', () => {
  stub.desktopTerms.set(7, { cwd: '/repo', cols: 132, rows: 50, alive: true });
  const before = stub.resizes.length;
  reg.attach(7, fakeWs(), 80, 24);
  expect(stub.resizes.length).toBe(before); // no resize emitted
});
```

- [ ] **Step 2: Run — expect failure**

```bash
npx vitest run tests/unit/remote/terminal-store.test.ts
```

Expected: 4 failures (attach returns null for desktop ids, no subscriber registered, etc.).

- [ ] **Step 3: Implement — dispatch + `attachDesktop`**

In `electron/services/remote/terminal-store.ts`, add a per-ws desktop-unsub map to the class fields:

```ts
private readonly desktopUnsubs = new Map<WebSocket, Map<number, () => void>>();
```

Add a private helper:

```ts
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
```

Update the public `attach()`:

```ts
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
```

- [ ] **Step 4: Run — expect pass**

```bash
npx vitest run tests/unit/remote/terminal-store.test.ts
npx tsc --noEmit
```

Expected: all tests green; tsc clean.

- [ ] **Step 5: Commit**

```bash
git add electron/services/remote/terminal-store.ts tests/unit/remote/terminal-store.test.ts
git commit -m "feat(remote): dispatch terminal.attach to desktop snapshot+subscribe"
```

---

## Task 6: terminal-store.ts — input allow-list filter for desktop-owned terms

**Files:**
- Modify: `electron/services/remote/terminal-store.ts`
- Modify: `tests/unit/remote/terminal-store.test.ts`

- [ ] **Step 1: Failing tests**

Append:

```ts
it('input() on a desktop term passes through allow-listed bytes', () => {
  stub.desktopTerms.set(7, { cwd: '/repo', cols: 80, rows: 24, alive: true });
  reg.input(7, '\x03');         // Ctrl+C
  reg.input(7, '\x1b');         // Esc
  reg.input(7, '\t');           // Tab
  reg.input(7, '\r');           // CR
  reg.input(7, '\n');           // LF
  reg.input(7, '\x1b[A');       // Up
  reg.input(7, '\x1b[B');       // Down
  reg.input(7, '\x1b[C');       // Right
  reg.input(7, '\x1b[D');       // Left
  expect(stub.writes.filter((w) => w.termId === 7).map((w) => w.data))
    .toEqual(['\x03', '\x1b', '\t', '\r', '\n', '\x1b[A', '\x1b[B', '\x1b[C', '\x1b[D']);
});

it('input() on a desktop term drops printable characters silently', () => {
  stub.desktopTerms.set(7, { cwd: '/repo', cols: 80, rows: 24, alive: true });
  reg.input(7, 'a');
  reg.input(7, 'hello world');
  reg.input(7, '1');
  expect(stub.writes.filter((w) => w.termId === 7)).toHaveLength(0);
});

it('input() on a phone term is unfiltered (regression guard)', () => {
  const phone = reg.open('/repo', 80, 24);
  reg.input(phone.termId, 'hello\n');
  expect(stub.writes).toContainEqual({ termId: phone.termId, data: 'hello\n' });
});
```

- [ ] **Step 2: Run — expect failure**

```bash
npx vitest run tests/unit/remote/terminal-store.test.ts
```

Expected: 1 failing test (printable chars currently fall through because there's no dispatch yet for desktop input).

- [ ] **Step 3: Implement allow-list + dispatch**

Add a module-level helper at the top of `terminal-store.ts` (below the imports):

```ts
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
```

Update `input()`:

```ts
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
```

- [ ] **Step 4: Run — expect pass**

```bash
npx vitest run tests/unit/remote/terminal-store.test.ts
```

Expected: all tests green.

- [ ] **Step 5: Commit**

```bash
git add electron/services/remote/terminal-store.ts tests/unit/remote/terminal-store.test.ts
git commit -m "feat(remote): allow-list filter for desktop-owned terminal input"
```

---

## Task 7: terminal-store.ts — `resize` / `kill` / `signal` dispatch for desktop terms

**Files:**
- Modify: `electron/services/remote/terminal-store.ts`
- Modify: `tests/unit/remote/terminal-store.test.ts`

- [ ] **Step 1: Failing tests**

Append:

```ts
it('resize() on a desktop term silently no-ops', () => {
  stub.desktopTerms.set(7, { cwd: '/repo', cols: 80, rows: 24, alive: true });
  const before = stub.resizes.length;
  reg.resize(7, 120, 40);
  expect(stub.resizes.length).toBe(before);
});

it('kill() on a desktop term throws (refused at the bridge layer)', () => {
  stub.desktopTerms.set(7, { cwd: '/repo', cols: 80, rows: 24, alive: true });
  expect(() => reg.kill(7)).toThrowError(/desktop/i);
  expect(stub.kills).not.toContain(7);
});

it('signal(SIGINT) on a desktop term forwards via signalTerminalImpl', () => {
  stub.desktopTerms.set(7, { cwd: '/repo', cols: 80, rows: 24, alive: true });
  reg.signal(7, 'SIGINT');
  expect(stub.signals).toContainEqual({ termId: 7, sig: 'SIGINT' });
});

it('signal() with non-SIGINT on a desktop term is ignored', () => {
  stub.desktopTerms.set(7, { cwd: '/repo', cols: 80, rows: 24, alive: true });
  const before = stub.signals.length;
  reg.signal(7, 'SIGTERM');
  expect(stub.signals.length).toBe(before);
});
```

- [ ] **Step 2: Run — expect failure**

```bash
npx vitest run tests/unit/remote/terminal-store.test.ts
```

Expected: 4 failures.

- [ ] **Step 3: Implement dispatch**

Helper near `filterDesktopInput`:

```ts
function isDesktopTermId(termId: number): boolean {
  return listDesktopTerminals().some((t) => t.termId === termId);
}
```

Update `resize`, `kill`, `signal`:

```ts
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
```

- [ ] **Step 4: Run — expect pass**

```bash
npx vitest run tests/unit/remote/terminal-store.test.ts
```

Expected: all green.

- [ ] **Step 5: Commit**

```bash
git add electron/services/remote/terminal-store.ts tests/unit/remote/terminal-store.test.ts
git commit -m "feat(remote): dispatch resize/kill/signal for desktop-owned terminals"
```

---

## Task 8: terminal-store.ts — `detach` + `detachAll` walk desktop unsubs

**Files:**
- Modify: `electron/services/remote/terminal-store.ts`
- Modify: `tests/unit/remote/terminal-store.test.ts`

- [ ] **Step 1: Failing tests**

Append:

```ts
it('detach(desktopTermId, ws) clears the per-ws subscriber', () => {
  stub.desktopTerms.set(7, { cwd: '/repo', cols: 80, rows: 24, alive: true });
  const ws = fakeWs();
  reg.attach(7, ws, 80, 24);
  expect(stub.desktopSubs.get(7)!.size).toBe(1);
  reg.detach(7, ws);
  expect(stub.desktopSubs.get(7)!.size).toBe(0);
});

it('detachAll(ws) clears both phone and desktop subscribers', () => {
  const phone = reg.open('/repo', 80, 24);
  stub.desktopTerms.set(7, { cwd: '/repo', cols: 80, rows: 24, alive: true });
  const ws = fakeWs();
  reg.attach(phone.termId, ws, 80, 24);
  reg.attach(7, ws, 80, 24);
  reg.detachAll(ws);
  // Phone path: data callback should no longer send to ws.
  stub.dataCbs.get(phone.termId)!('x');
  // Desktop path: subscriber set empty.
  expect(stub.desktopSubs.get(7)!.size).toBe(0);
  expect(ws.__sent.some((s: string) => s.includes('"termId":' + phone.termId) && s.includes('"x"'))).toBe(false);
});
```

- [ ] **Step 2: Run — expect failure**

```bash
npx vitest run tests/unit/remote/terminal-store.test.ts
```

Expected: 2 failures.

- [ ] **Step 3: Implement**

Update `detach` and `detachAll`:

```ts
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
```

- [ ] **Step 4: Run — expect pass + full unit suite**

```bash
npx vitest run tests/unit/remote/terminal-store.test.ts
npx tsc --noEmit
```

Expected: all green; tsc clean.

- [ ] **Step 5: Commit**

```bash
git add electron/services/remote/terminal-store.ts tests/unit/remote/terminal-store.test.ts
git commit -m "feat(remote): detach + detachAll clear desktop subscribers"
```

---

## Task 9: PWA wire.ts — extend `listTerminals` return type with `origin`

**Files:**
- Modify: `src/renderer-remote/wire.ts`

Type-only change.

- [ ] **Step 1: Update the interface**

```ts
listTerminals(cwd: string): Promise<Array<{
  termId: number;
  cwd: string;
  cols: number;
  rows: number;
  alive: boolean;
  origin: 'phone' | 'desktop';
}>>;
```

No runtime change — the bridge already returns whatever fields `store.list()` produces; the new `origin` field flows through `terminal.list.result.terms` automatically.

- [ ] **Step 2: tsc**

```bash
npx tsc --noEmit
```

Expected: clean (TerminalPicker currently types its local `Summary` independently; we update it in Task 11).

- [ ] **Step 3: Commit**

```bash
git add src/renderer-remote/wire.ts
git commit -m "feat(remote): typed origin on listTerminals result"
```

---

## Task 10: PWA TerminalToolbar — `variant` prop + Enter key + view-only pill

**Files:**
- Modify: `src/renderer-remote/terminal/TerminalToolbar.tsx`

- [ ] **Step 1: Extend props + render**

Replace the file with:

```tsx
import { ArrowLeft } from 'lucide-react';

type Key = 'Esc' | 'Tab' | 'Up' | 'Down' | 'Left' | 'Right' | 'Ctrl' | 'Enter';

interface Props {
  ctrlSticky: boolean;
  onKey: (k: Key) => void;
  onBack: () => void;
  onCtrlChar?: (ch: string) => boolean;
  /** 'full' (default, phone-owned): typing via xterm textarea + control keys.
   *  'view-only' (desktop-owned): no typing; toolbar exposes Enter as well. */
  variant?: 'full' | 'view-only';
}

export default function TerminalToolbar({ ctrlSticky, onKey, onBack, variant = 'full' }: Props) {
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
      {variant === 'view-only' && (
        <>
          <button onClick={() => onKey('Enter')} style={btnBase}>Enter</button>
          <div style={{ flex: 1 }} />
          <span style={{
            fontSize: 11,
            padding: '2px 8px',
            borderRadius: 999,
            border: '1px solid var(--border)',
            color: 'var(--text-muted)',
            background: 'transparent',
            whiteSpace: 'nowrap',
          }}>view only</span>
        </>
      )}
    </div>
  );
}
```

- [ ] **Step 2: tsc**

```bash
npx tsc --noEmit
```

Expected: clean. (`Terminal.tsx` calls `onKey` with a union that didn't include `'Enter'`; that's fine — view-only callers will handle it in Task 11.)

- [ ] **Step 3: Commit**

```bash
git add src/renderer-remote/terminal/TerminalToolbar.tsx
git commit -m "feat(remote): TerminalToolbar variant + Enter key + view-only pill"
```

---

## Task 11: PWA Terminal — `origin` prop + view-only behavior

**Files:**
- Modify: `src/renderer-remote/terminal/Terminal.tsx`

- [ ] **Step 1: Extend props + branch behavior**

Add `origin` to `Props`:

```ts
interface Props {
  client: WireClient;
  termId: number;
  cwd: string;
  origin: 'phone' | 'desktop';
  onBack: () => void;
  onExit?: (code: number) => void;
}
```

Inside the component, after destructuring:

```ts
const isDesktop = origin === 'desktop';
```

In the lazy-mount effect, after `term.open(containerRef.current)`:
- Skip the textarea attribute mutations is fine; the textarea is still useful for IME, but for `isDesktop` we mark it `tabIndex={-1}` and never call `term.focus()`:

```ts
const ta = (term as any).textarea as HTMLTextAreaElement | undefined;
if (ta) {
  ta.setAttribute('autocorrect', 'off');
  ta.setAttribute('autocapitalize', 'none');
  ta.setAttribute('spellcheck', 'false');
  ta.setAttribute('inputmode', 'text');
  if (isDesktop) {
    ta.setAttribute('tabindex', '-1');
    ta.setAttribute('readonly', 'true');
  }
}
```

Skip `fit()` and `onData` wiring for desktop terms — the phone never sends raw typed bytes and never resizes the PTY:

```ts
if (!isDesktop) {
  const sizeRo = new ResizeObserver(() => doFit());
  sizeRo.observe(containerRef.current);
  (term as any).__sizeRo = sizeRo;
  requestAnimationFrame(() => { doFit(); requestAnimationFrame(doFit); });
  term.focus();
  dispOnData = term.onData((data: string) => {
    client.inputTerminal(termId, data);
    try { term.scrollToBottom(); } catch { /* ignore */ }
    if (data.includes('\r') || data.includes('\n')) {
      const ta2 = (term as any).textarea as HTMLTextAreaElement | undefined;
      ta2?.blur();
    }
  });
}
```

In the second effect (viewport recompute), skip `fit()` for desktop:

```ts
const recompute = () => {
  if (isDesktop) return; // desktop dims stand
  const fit = fitRef.current;
  const term = termRef.current;
  if (!fit || !term) return;
  try {
    fit.fit();
    client.resizeTerminal(termId, term.cols, term.rows);
  } catch { /* ignore */ }
};
```

In the container `<div>`, suppress focus-grabbing taps when desktop:

```tsx
<div
  ref={containerRef}
  onTouchEnd={isDesktop ? undefined : () => {
    const term = termRef.current;
    const ta = term && ((term as any).textarea as HTMLTextAreaElement | undefined);
    try { ta?.focus(); } catch { /* ignore */ }
  }}
  onClick={isDesktop ? undefined : () => {
    const term = termRef.current;
    const ta = term && ((term as any).textarea as HTMLTextAreaElement | undefined);
    try { ta?.focus(); } catch { /* ignore */ }
  }}
  style={{ /* unchanged */ }}
/>
```

Update toolbar usage and add Enter handling:

```ts
const onToolbarKey = (key: 'Esc' | 'Tab' | 'Up' | 'Down' | 'Left' | 'Right' | 'Ctrl' | 'Enter') => {
  if (key === 'Ctrl') { setCtrlSticky((v) => !v); return; }
  if (ctrlSticky) { setCtrlSticky(false); }
  switch (key) {
    case 'Esc':   return sendBytes('\x1b');
    case 'Tab':   return sendBytes('\t');
    case 'Up':    return sendBytes('\x1b[A');
    case 'Down':  return sendBytes('\x1b[B');
    case 'Right': return sendBytes('\x1b[C');
    case 'Left':  return sendBytes('\x1b[D');
    case 'Enter': return sendBytes('\r');
  }
};
```

And the JSX:

```tsx
<TerminalToolbar
  ctrlSticky={ctrlSticky}
  onKey={onToolbarKey}
  onBack={onBack}
  onCtrlChar={onCtrlChar}
  variant={isDesktop ? 'view-only' : 'full'}
/>
```

- [ ] **Step 2: tsc + PWA build**

```bash
npx tsc --noEmit
npx vite build --config vite.config.pwa.ts
```

Expected: tsc clean, PWA build succeeds.

- [ ] **Step 3: Commit**

```bash
git add src/renderer-remote/terminal/Terminal.tsx
git commit -m "feat(remote): Terminal view-only mode for desktop-owned terminals"
```

---

## Task 12: PWA TerminalPicker — group by origin, pass origin up

**Files:**
- Modify: `src/renderer-remote/terminal/TerminalPicker.tsx`

- [ ] **Step 1: Replace the file**

```tsx
import { useEffect, useState } from 'react';
import { Plus, X } from 'lucide-react';
import type { WireClient } from '../wire';

interface Summary {
  termId: number;
  cwd: string;
  cols: number;
  rows: number;
  alive: boolean;
  origin: 'phone' | 'desktop';
}

interface Props {
  client: WireClient;
  cwd: string;
  onPick: (termId: number, origin: 'phone' | 'desktop') => void;
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
      const r = await client.openTerminal(cwd, 80, 24);
      onPick(r.termId, 'phone');
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setCreating(false);
    }
  };

  const phoneTerms = terms.filter((t) => t.origin === 'phone');
  const desktopTerms = terms.filter((t) => t.origin === 'desktop');

  const renderRow = (t: Summary) => (
    <button key={t.termId} onClick={() => onPick(t.termId, t.origin)} style={{
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
      <span style={{
        fontSize: 10, padding: '2px 6px', borderRadius: 999,
        border: t.origin === 'desktop' ? '1px solid var(--border)' : 'none',
        background: t.origin === 'phone' ? 'var(--accent)' : 'transparent',
        color: t.origin === 'phone' ? '#000' : 'var(--text-muted)',
      }}>{t.origin}</span>
      <span style={{ color: 'var(--text-muted)' }}>{t.cols}×{t.rows}</span>
    </button>
  );

  const sectionHeader = (label: string) => (
    <div style={{
      padding: '8px 14px 4px',
      fontSize: 11,
      color: 'var(--text-muted)',
      textTransform: 'uppercase',
      letterSpacing: 0.5,
      background: 'var(--bg-secondary)',
    }}>{label}</div>
  );

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
          {phoneTerms.length > 0 && sectionHeader('Phone terminals')}
          {phoneTerms.map(renderRow)}
          {desktopTerms.length > 0 && sectionHeader('Desktop terminals')}
          {desktopTerms.map(renderRow)}
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: tsc**

```bash
npx tsc --noEmit
```

Expected: clean — note `NavDrawer.tsx` currently calls `onPick={(termId) => ...}` (single arg). Task 13 widens it.

- [ ] **Step 3: Commit**

```bash
git add src/renderer-remote/terminal/TerminalPicker.tsx
git commit -m "feat(remote): TerminalPicker groups phone vs desktop terminals"
```

---

## Task 13: NavDrawer — thread `origin` from picker → Terminal

**Files:**
- Modify: `src/renderer-remote/chat/NavDrawer.tsx`

- [ ] **Step 1: Track origin state**

Inside `NavDrawer`, replace:

```ts
const [activeTermId, setActiveTermId] = useState<number | null>(null);
```

with:

```ts
const [activeTerm, setActiveTerm] = useState<{ termId: number; origin: 'phone' | 'desktop' } | null>(null);
```

Replace all references to `activeTermId`. The two effects and `terminalActive` use:

```ts
const terminalActive = active === 'terminal' && activeTerm !== null;
useEffect(() => {
  if (active === 'terminal' && activeTerm === null) setPickerOpen(true);
  if (active !== 'terminal') setPickerOpen(false);
}, [active, activeTerm]);
```

The Terminal mount:

```tsx
{active === 'terminal' && activeTerm !== null && (
  <Terminal
    client={client}
    termId={activeTerm.termId}
    cwd={gitCwdLocal}
    origin={activeTerm.origin}
    onBack={() => { setActiveTerm(null); setActive('files'); }}
    onExit={() => { setActiveTerm(null); }}
  />
)}
```

The picker:

```tsx
{pickerOpen && (
  <TerminalPicker
    client={client}
    cwd={gitCwdLocal}
    onPick={(termId, origin) => { setActiveTerm({ termId, origin }); setPickerOpen(false); }}
    onClose={() => {
      setPickerOpen(false);
      if (activeTerm === null) setActive('files');
    }}
  />
)}
```

- [ ] **Step 2: tsc + PWA build**

```bash
npx tsc --noEmit
npx vite build --config vite.config.pwa.ts
```

Expected: clean.

- [ ] **Step 3: Commit**

```bash
git add src/renderer-remote/chat/NavDrawer.tsx
git commit -m "feat(remote): NavDrawer threads terminal origin to Terminal view"
```

---

## Task 14: Integration test — desktop term attach + allow-list

**Files:**
- Modify: `tests/integration/remote/terminal-end-to-end.test.ts`

The unit tests cover the registry. This integration test exercises the BridgeServer routing end-to-end against a fake "desktop term" that we register directly via the new pty.ts exports.

Because `listDesktopTerminals` walks `allTerminals` (a real `IPty` map), we can't easily fake an entry from outside `pty.ts`. We work around this by spawning a phone-owned PTY first, then injecting a `terminalOwner` entry for it via a small test hook. To avoid leaking test hooks into prod code, we instead drive the integration test by:
1. Spawning a real shell via `terminal:create` IPC path is not available in this process.
2. Adding a tiny `_seedDesktopTerminalForTest` export to `pty.ts` that registers ring + subscriber for a synthetic `termId`, AND mocks `listDesktopTerminals` for the test by also seeding a sidecar Map.

Update `pty.ts` `_seedDesktopTerminalForTest` to actually do something:

```ts
// Test-only sidecar so integration tests can simulate a desktop terminal
// without spawning a real IPty. Only consulted by listDesktopTerminals when
// the sidecar map is non-empty.
const desktopTestSidecar = new Map<number, { cwd: string; cols: number; rows: number; alive: boolean }>();
export function _seedDesktopTerminalForTest(termId: number, cwd: string, cols = 80, rows = 24): {
  fireData: (data: string) => void;
  fireExit: () => void;
  writes: string[];
} {
  desktopTestSidecar.set(termId, { cwd, cols, rows, alive: true });
  // Seed ring so snapshotTerminal returns something useful.
  if (!ringByTerm.get(termId)) ringByTerm.set(termId, new RingBuffer(DESKTOP_RING_CAP_BYTES));
  const writes: string[] = [];
  // Patch a write sink for the integration test via the global write impl.
  // We achieve this by piggybacking on writeTerminalImpl: if termId is in the
  // sidecar, capture instead of dispatching to a real PTY.
  return {
    fireData: (data: string) => {
      ringByTerm.get(termId)!.push(data);
      const subs = subscribersByTerm.get(termId);
      if (subs) for (const cb of subs) { try { cb(data); } catch { /* isolate */ } }
    },
    fireExit: () => {
      desktopTestSidecar.delete(termId);
      ringByTerm.delete(termId);
      subscribersByTerm.delete(termId);
    },
    writes,
  };
}
```

Then update `listDesktopTerminals` and `writeTerminalImpl` to consult the sidecar in test mode:

```ts
export function listDesktopTerminals(): Array<{ termId: number; cwd: string; cols: number; rows: number; alive: boolean }> {
  const out: Array<{ termId: number; cwd: string; cols: number; rows: number; alive: boolean }> = [];
  for (const [termId, term] of allTerminals.entries()) {
    const cwd = terminalOwner.get(termId);
    if (cwd === undefined) continue;
    const t = term as unknown as { cols?: number; rows?: number };
    out.push({
      termId, cwd,
      cols: typeof t.cols === 'number' ? t.cols : 80,
      rows: typeof t.rows === 'number' ? t.rows : 24,
      alive: true,
    });
  }
  for (const [termId, t] of desktopTestSidecar.entries()) {
    out.push({ termId, cwd: t.cwd, cols: t.cols, rows: t.rows, alive: t.alive });
  }
  return out;
}
```

Update `writeTerminalImpl` to capture sidecar writes:

```ts
const desktopTestWrites: Array<{ termId: number; data: string }> = [];
export function _drainDesktopTestWrites(): Array<{ termId: number; data: string }> {
  const copy = [...desktopTestWrites];
  desktopTestWrites.length = 0;
  return copy;
}

export function writeTerminalImpl(termId: number, data: string): void {
  if (desktopTestSidecar.has(termId)) {
    desktopTestWrites.push({ termId, data });
    return;
  }
  allTerminals.get(termId)?.write(data);
}
```

- [ ] **Step 1: Failing test**

Append to `tests/integration/remote/terminal-end-to-end.test.ts`:

```ts
  it.skipIf(process.platform === 'win32')('desktop terminal — list/attach/replay/allow-list/SIGINT', async () => {
    const pairing = new PairingStore(':memory:');
    const bus = new SessionBus();
    const terminalStore = new PhoneTerminalRegistry();

    const remote = new RemoteModule({
      pairing, bus,
      resolveTailnetEndpoint: async () => ({ ip: '127.0.0.1', host: null }),
      makeBridge: (ip) => new BridgeServer({
        tailnetIp: ip, pairing, bus, pwaDir: null,
        screenshotSecret: 'e2e-d', loadScreenshot: async () => null, port: 0,
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

    // Seed a fake desktop terminal via pty.ts test hooks.
    const { _seedDesktopTerminalForTest, _drainDesktopTestWrites } =
      await import('@electron/services/pty');
    const harness = _seedDesktopTerminalForTest(424242, process.cwd(), 132, 50);

    const wsUrl = url!.replace(/^http/, 'ws') + '/ws';
    const ws = new WebSocket(wsUrl);
    const inbox: any[] = [];
    ws.on('message', (d) => inbox.push(JSON.parse(d.toString())));
    await new Promise((r) => ws.once('open', r));
    ws.send(JSON.stringify({ type: 'auth', token }));
    await waitFor(inbox, (m) => m.type === 'auth_ok', 3000);

    // 1. listTerminals shows the desktop term with origin='desktop'.
    ws.send(JSON.stringify({ type: 'terminal.list', cwd: process.cwd(), reqId: 'L1' }));
    const list = await waitFor(inbox, (m) => m.type === 'terminal.list.result' && m.reqId === 'L1', 3000);
    const found = (list.terms as any[]).find((t) => t.termId === 424242);
    expect(found).toBeDefined();
    expect(found.origin).toBe('desktop');
    expect(found.cols).toBe(132);

    // 2. Pre-seed the ring then attach → expect replay.
    harness.fireData('before-attach-output\n');
    ws.send(JSON.stringify({ type: 'terminal.attach', termId: 424242, cols: 80, rows: 24, reqId: 'A1' }));
    const attached = await waitFor(inbox, (m) => m.type === 'terminal.attached' && m.reqId === 'A1', 3000);
    expect(attached.cols).toBe(132); // desktop dims stand
    expect(attached.rows).toBe(50);
    expect(String(attached.replay ?? '')).toContain('before-attach-output');

    // 3. Live data flows.
    harness.fireData('live-byte\n');
    await waitFor(inbox, (m) =>
      m.type === 'terminal.output' && m.termId === 424242 && String(m.data).includes('live-byte'),
      3000);

    // 4. Disallowed input is dropped silently (no write captured).
    _drainDesktopTestWrites(); // reset
    ws.send(JSON.stringify({ type: 'terminal.input', termId: 424242, data: 'hello' }));
    await new Promise((r) => setTimeout(r, 50));
    expect(_drainDesktopTestWrites().filter((w) => w.termId === 424242)).toHaveLength(0);

    // 5. Allowed input (Ctrl-C) passes through.
    ws.send(JSON.stringify({ type: 'terminal.input', termId: 424242, data: '\x03' }));
    await new Promise((r) => setTimeout(r, 50));
    expect(_drainDesktopTestWrites().some((w) => w.termId === 424242 && w.data === '\x03')).toBe(true);

    ws.close();
    harness.fireExit();
    terminalStore.destroyAll();
    await remote.stop();
  }, 30_000);
```

- [ ] **Step 2: Run — expect pass**

```bash
npx vitest run tests/integration/remote/terminal-end-to-end.test.ts
npx tsc --noEmit
```

Expected: all three cases (the two existing + the new one) pass. On `npx tsc` the new pty.ts exports must be typed correctly.

- [ ] **Step 3: Commit**

```bash
git add electron/services/pty.ts tests/integration/remote/terminal-end-to-end.test.ts
git commit -m "test(remote): integration coverage for shared desktop terminals"
```

---

## Task 15: Manual smoke checklist — append desktop section

**Files:**
- Modify: `docs/superpowers/notes/2026-05-25-mobile-remote-p5-smoke.md`

- [ ] **Step 1: Append section**

Append to `docs/superpowers/notes/2026-05-25-mobile-remote-p5-smoke.md`:

```markdown
## P5.1 — Desktop terminal viewing

- [ ] On the desktop, open a SAI terminal in any workspace; run `top` or `tail -f /var/log/syslog` so output is continuous.
- [ ] On phone, open the picker. A "Desktop terminals" section lists the desktop terminal under its cwd; row shows `desktop` pill.
- [ ] Tap it. Terminal opens in view-only mode: no iOS keyboard appears when tapping the canvas. Toolbar shows Esc/Tab/Ctrl/arrows/Enter + a "view only" pill on the right.
- [ ] Scrollback appears immediately (ring replay). Live output continues to stream within ~500ms of arriving on the desktop.
- [ ] Tap Ctrl, then "c" via any on-screen key (or Ctrl on the toolbar then a hardware key) — the foreground process on the desktop is interrupted.
- [ ] Tap ↑ — desktop prompt recalls last history entry (visible both on desktop and phone).
- [ ] Tap Enter at an interactive prompt — desktop accepts the line.
- [ ] Tap Esc inside `less` on the desktop — `less` exits.
- [ ] Background phone for 30s, foreground — terminal reattaches; ring replay shows recent output; live stream resumes.
- [ ] Kill the desktop terminal via the desktop window UI. Phone shows `[process exited]` line (or `terminal.exit` produces a Close button) and the row is gone from the picker after reopening it.
- [ ] Phone picker still allows tapping "New terminal" — that one stays phone-owned and accepts typing.

## Regression

- [ ] Phone-owned terminals from P5 still accept typing and resize on viewport change.
- [ ] Desktop terminal window still renders normally (no flicker, no double output) while phone is attached.
- [ ] Disconnecting the phone WS does not affect the desktop terminal.
- [ ] Multiple phones attached to the same desktop term all receive the same stream.
```

- [ ] **Step 2: Commit**

```bash
git add docs/superpowers/notes/2026-05-25-mobile-remote-p5-smoke.md
git commit -m "docs(remote): smoke checklist for shared desktop terminals (p5.1)"
```

---

## Task 16: Final sweep

- [ ] **Step 1: Full suite + tsc + PWA build**

```bash
cd /var/home/mstephens/Documents/GitHub/sai
npm test 2>&1 | tail -15
npx tsc --noEmit
npx vite build --config vite.config.pwa.ts
```

Expected: all tests pass (P0–P5 stay green; new unit cases + new integration case green); tsc clean; PWA bundle builds.

- [ ] **Step 2: Optional tidy commit (only if anything was fixed)**

```bash
git add -A
git commit -m "chore(remote): final tidy after p5.1 verification" || true
```

---

## Done

Phase 5.1 is complete when:

1. All vitest unit + integration tests pass (the new "shared desktop terminals" describe block in `terminal-store.test.ts` and the new integration case all green).
2. `tsc --noEmit` clean.
3. PWA bundle builds.
4. Manual smoke (desktop terminal section + regression checklist) walked on a real iPhone over Tailscale with the desktop SAI running on the laptop.
5. No regression in phone-owned terminal behavior (P5 smoke still passes).
6. No regression in desktop terminal behavior (desktop window still renders normally with no extra output or flicker).
