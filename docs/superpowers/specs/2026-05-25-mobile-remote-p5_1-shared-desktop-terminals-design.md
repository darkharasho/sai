# Mobile Remote — Phase 5.1: View Desktop Terminals — Design

**Status:** Approved (2026-05-25).
**Depends on:** P5 merged.
**Scope:** Phone can list and attach to terminals already running on the desktop. View-only by default with a small Ctrl/arrows/Enter input set. No PTY resize negotiation — phone wraps/scrolls at desktop's cols.

## Decisions

| # | Decision | Why |
|---|----------|-----|
| Q1 | **Read-only-ish** input: phone can send Esc, Tab, Ctrl+letter, arrows, Enter. No raw typing. | The user explicitly asked for "read-only with a couple quick actions." Typing into someone else's session creates split-attention bugs (desktop is the source of truth). The few control keys cover the 90% case: kill a runaway, recall history, accept a prompt. |
| Q2 | **No PTY resize on phone attach.** Desktop's cols/rows stand; phone xterm renders at desktop dims and overflows. | The alternative — resize PTY when phone attaches, resize back on detach — flickers the desktop terminal every time the phone backgrounds. Read-only sessions tolerate overflow (horizontal scroll); interactive sessions stay on phone-owned terminals. |
| Q3 | **Add a 64KB ring buffer per desktop terminal** in `pty.ts`. | The bridge needs replay on attach. Cost is trivial (one Buffer chunk array per term). Reused for any future "view your own scrollback" UX. |
| Q4 | **Pub-sub API on desktop terminals**: `subscribeTerminal(termId, cb) → unsubscribe`. | The phone bridge attaches another listener; existing `safeSend(win, 'terminal:data', ...)` still drives the desktop window. Both fire from one `pty.onData`. |
| Q5 | **Unified `terminal.list`** returns both phone-owned and desktop-owned terms, each tagged with `origin: 'phone' \| 'desktop'`. Picker shows them in two sections. | Simpler than two separate WS frames. Phone client decides label/icon by `origin`. |

## Architecture

```
desktop window (xterm)
    ↑ safeSend('terminal:data')
    │
node-pty.onData ──► ring buffer (64KB) ──► subscribers Set
                                              ↓
                                   bridge (phone-attached client)
                                              ↓
                                   ws.send('terminal.output')
```

A phone client never spawns or kills a desktop terminal. It can:
- Subscribe (attach) and receive scrollback + live output.
- Send a restricted set of input bytes.
- Unsubscribe (detach).

`pty.ts` remains the single owner of all PTY lifecycle.

## Wire protocol (additive — no breaking changes)

`terminal.list.result` already returns `{ terms: PhoneTerminalSummary[] }`. We extend each summary:

```ts
interface TerminalSummary {
  termId: number;
  cwd: string;
  cols: number;
  rows: number;
  alive: boolean;
  origin: 'phone' | 'desktop';  // new
}
```

No new message types. The existing `terminal.attach`, `terminal.input`, `terminal.resize`, `terminal.signal`, `terminal.kill`, `terminal.detach` route to the same registry; the registry decides whether the termId is phone- or desktop-owned and dispatches accordingly.

**Restrictions applied at the bridge for desktop-owned terms:**
- `terminal.input` only forwards bytes that match the allow-list: ESC (`\x1b`), TAB (`\t`), CR (`\r`), LF (`\n`), Ctrl-A through Ctrl-Z (`\x01`-`\x1a`), arrow sequences (`\x1b[A/B/C/D`), and printable ASCII letters/digits when prefixed by Ctrl in the same input frame (the phone toolbar enforces this in practice; bridge re-validates for safety).
- `terminal.resize` — silently ignored.
- `terminal.kill` — refused (returns error). Desktop kills happen via the desktop UI.
- `terminal.signal` — allowed (SIGINT only) as a synonym for Ctrl+C.

## Server-side modules

### `electron/services/pty.ts` (modify)

Add ring buffer + subscriber set, fed from the existing `term.onData`:

```ts
const ringByTerm = new Map<number, RingBuffer>();
type DataListener = (data: string) => void;
const subscribersByTerm = new Map<number, Set<DataListener>>();
const RING_CAP_BYTES = 64 * 1024;

export function snapshotTerminal(termId: number): string {
  return ringByTerm.get(termId)?.snapshot() ?? '';
}

export function subscribeTerminal(termId: number, cb: DataListener): () => void {
  let set = subscribersByTerm.get(termId);
  if (!set) { set = new Set(); subscribersByTerm.set(termId, set); }
  set.add(cb);
  return () => { set?.delete(cb); };
}

export function listDesktopTerminals(): Array<{ termId: number; cwd: string; cols: number; rows: number; alive: boolean }> {
  // Walk allTerminals; for each, return termId + best-effort cwd/cols/rows.
}
```

Wire the ring + fan-out inside the existing `term.onData` handler (both the IPC `'terminal:create'` path and the new `createTerminalImpl`):

```ts
term.onData((data) => {
  let ring = ringByTerm.get(id);
  if (!ring) { ring = new RingBuffer(RING_CAP_BYTES); ringByTerm.set(id, ring); }
  ring.push(data);
  for (const cb of subscribersByTerm.get(id) ?? []) {
    try { cb(data); } catch { /* isolate */ }
  }
  safeSend(win, 'terminal:data', id, data);   // existing desktop path
});
term.onExit(() => {
  // existing cleanup
  ringByTerm.delete(id);
  subscribersByTerm.delete(id);
});
```

(`createTerminalImpl` is the phone-side spawn path and already has its own data wiring; it keeps the phone-owned ring inside `PhoneTerminalRegistry` and does NOT touch `ringByTerm`. The two registries stay independent.)

### `electron/services/remote/terminal-store.ts` (modify)

`PhoneTerminalRegistry` becomes the unified entry point. Add:

```ts
list(cwd?: string): TerminalSummary[] {
  const phone = [...this.terms.values()].map((t) => ({
    termId: t.termId, cwd: t.cwd, cols: t.cols, rows: t.rows, alive: t.alive, origin: 'phone' as const,
  }));
  const desktop = listDesktopTerminals().map((t) => ({ ...t, origin: 'desktop' as const }));
  const all = [...phone, ...desktop];
  return cwd ? all.filter((t) => t.cwd === cwd) : all;
}
```

Add `attachDesktop(termId, ws, cols, rows)`:

```ts
attachDesktop(termId: number, ws: WebSocket): { replay: string } | null {
  // Make sure the desktop term still exists
  const replay = snapshotTerminal(termId);
  if (!replay && !desktopTerminalExists(termId)) return null;
  // Detach any previous subscriber for this ws
  this.desktopUnsubs.get(ws)?.get(termId)?.();
  const unsub = subscribeTerminal(termId, (data) => {
    if (ws.readyState !== ws.OPEN) return;
    try { ws.send(JSON.stringify({ v: 1, type: 'terminal.output', termId, data })); } catch { /* ignore */ }
  });
  let perWs = this.desktopUnsubs.get(ws);
  if (!perWs) { perWs = new Map(); this.desktopUnsubs.set(ws, perWs); }
  perWs.set(termId, unsub);
  return { replay };
}
```

`detachDesktop(termId, ws)` calls the stored unsub. `detachAll(ws)` also walks `desktopUnsubs.get(ws)`.

Public-facing `attach(termId, ws, cols, rows)` dispatches:
```ts
attach(termId, ws, cols, rows) {
  if (this.terms.has(termId)) return this.attachPhone(termId, ws, cols, rows);  // existing
  if (desktopTerminalExists(termId)) {
    const r = this.attachDesktop(termId, ws);
    if (!r) return null;
    return { replay: r.replay, cols: desktopColsRows(termId).cols, rows: desktopColsRows(termId).rows };
  }
  return null;
}
```

`input(termId, data)`: if desktop-owned, apply the allow-list filter; route to `writeTerminalImpl`. If phone-owned, unchanged.

`resize/kill/signal`: routed conditionally per the restrictions table above.

### `electron/services/remote/bridge-server.ts` (no changes)

All routing is unchanged — the registry dispatches internally. Existing `terminal.list` already returns `store.list(msg.cwd)`; the result shape is additive (new `origin` field).

## Client-side modules

### `src/renderer-remote/wire.ts`

Update the `listTerminals` return type to include `origin`. No other changes.

### `src/renderer-remote/terminal/TerminalPicker.tsx`

- Group the picker list: "Phone terminals" section then "Desktop terminals" section.
- Each row shows the cwd + a small badge: `phone` (accent fill) or `desktop` (outlined).
- "New terminal" action stays at the top; new terminals are always phone-owned.

### `src/renderer-remote/terminal/Terminal.tsx`

Take an extra prop:

```ts
interface Props {
  client: WireClient;
  termId: number;
  cwd: string;
  origin: 'phone' | 'desktop';   // new
  onBack: () => void;
  onExit?: (code: number) => void;
}
```

Behavior changes when `origin === 'desktop'`:
- xterm renders at desktop's cols/rows from `terminal.attached` — do NOT call `fit()` on resize; just re-render. (Phone client cannot resize.)
- The hidden xterm textarea is removed from focus chain (`tabIndex={-1}`, no `term.focus()` calls). iOS keyboard never opens.
- Render `<TerminalToolbar variant="view-only" />` which shows Esc/Tab/Ctrl-sticky/arrows/Enter and a single "View only" status pill. No "tap-to-focus" hint.
- All input goes through the toolbar; tapping the canvas doesn't focus anything.

### `src/renderer-remote/terminal/TerminalToolbar.tsx`

Add a `variant: 'full' | 'view-only'` prop. View-only adds Enter and removes nothing else (Esc/Tab/Ctrl/arrows are already there). Visually, add a subtle "view only" pill on the right.

### `src/renderer-remote/chat/NavDrawer.tsx`

Already passes `cwd` to Terminal. Pass `origin` too, derived from the picker selection.

## Lifecycle flows

**Open new terminal (unchanged):** Always creates a phone-owned term.

**Attach to desktop term:**
1. Picker shows desktop terms under a header.
2. Tap → `attachTerminal(termId, cols, rows)` (cols/rows ignored on desktop terms).
3. Bridge: `attachDesktop` returns scrollback ring + cols/rows from desktop's PTY.
4. PWA: writes replay to xterm in one chunk; live `terminal.output` follows.

**Input on desktop term:**
1. User taps a toolbar key (e.g., Ctrl+C).
2. `inputTerminal(termId, '\x03')` → bridge re-validates against allow-list → `writeTerminalImpl(termId, '\x03')` → PTY receives SIGINT-via-Ctrl-C.

**Detach (background / leave drawer):**
- PWA `terminal.detach { termId }` → bridge calls `detachDesktop(termId, ws)` → unsub.
- Subscriber removed; desktop window still receives data.

**WS close:**
- `detachAll(ws)` already walks phone-owned terms; extend it to also walk the new `desktopUnsubs.get(ws)` map and call every unsub.

**Desktop term exit:**
- `pty.onExit` already cleans `allTerminals` and (new) `ringByTerm` + `subscribersByTerm`. Any phone client attached to the dead termId receives a `terminal.exit` via its existing subscriber callback.

## Testing

### Unit tests

`tests/unit/remote/terminal-store-desktop.test.ts`:
- `list()` merges phone + desktop summaries; desktop entries flagged `origin: 'desktop'`.
- `attach(termId)` for a desktop term returns the ring snapshot, subscribes to live data, and forwards `terminal.output` frames.
- `attach()` for an unknown termId returns null.
- `input(termId, byte)` on a desktop term: allow-list lets through ESC, TAB, CR, Ctrl-letters, arrows; drops everything else (silently — no error frame).
- `resize/kill` on a desktop term: kill returns an error; resize silently no-ops.
- WS close detaches both phone subscribers and desktop subscribers.

Stub `pty.ts` exports (`subscribeTerminal`, `snapshotTerminal`, `listDesktopTerminals`, `writeTerminalImpl`) so the registry can be tested without spawning real PTYs.

### Integration test

Extend `tests/integration/remote/terminal-end-to-end.test.ts`:
- Pre-populate `pty.ts` with a "fake desktop terminal" via the new exports (writes to ring + subscribers, ignores writeTerminalImpl for assertions).
- Connect WS, `terminal.list` → assert one desktop term appears.
- `terminal.attach` → assert replay arrives and live data flows.
- `terminal.input` with disallowed byte (e.g., `'a'`) → assert `writeTerminalImpl` was NOT called.
- `terminal.input` with `'\x03'` → assert it WAS called.

### Manual smoke

Add to `docs/superpowers/notes/2026-05-25-mobile-remote-p5-smoke.md`:
- Open a desktop terminal on the laptop; run `top` or `tail -f`.
- On phone, open terminal picker — desktop terminal listed under "Desktop terminals" with cwd.
- Tap it: scrollback appears, live output streams.
- Tap Ctrl + C: process interrupted on desktop.
- Tap ↑: history recall on desktop prompt.
- Background phone for 30s, foreground: stream resumes from current state (no replay; we already detached).
- Kill desktop terminal from desktop: phone shows `[process exited]` line.

## Risk areas

- **Ring buffer growth on noisy desktop terminals** (`yes`, build logs). 64KB cap is enforced; older chunks evicted. Acceptable.
- **PTY destroyed before unsub fires** — `subscribersByTerm.delete(id)` in `onExit` handles this; subscribers' unsub no-ops on missing termId.
- **Multiple phone clients attaching to the same desktop term** — each registers its own subscriber via its own `ws`. Each receives output independently. This is actually *easier* than the phone-owned single-client model.
- **Bridge restart (`RemoteModule.stop`)** — phone-owned PTYs are destroyed (existing behavior); desktop subscribers are unsub'd; desktop PTYs continue running normally.

## Out of scope

- Phone-initiated full input (typing) on desktop terms. Read-mostly is the explicit goal.
- Phone-initiated kill of desktop terms.
- Cols/rows negotiation. Desktop dims stand.
- Migrating a desktop term into the phone-owned registry (no transfer API).
- Highlighting / copy from desktop term scrollback on phone.

## File map

**New:**
- `tests/unit/remote/terminal-store-desktop.test.ts`

**Modified:**
- `electron/services/pty.ts` (ring buffer, subscribe API, listDesktopTerminals)
- `electron/services/remote/terminal-store.ts` (list merge, attachDesktop, dispatch in input/resize/kill/signal, WS-close walks both maps)
- `src/renderer-remote/wire.ts` (listTerminals return type)
- `src/renderer-remote/terminal/TerminalPicker.tsx` (grouped sections, origin badge)
- `src/renderer-remote/terminal/Terminal.tsx` (origin prop, view-only mode)
- `src/renderer-remote/terminal/TerminalToolbar.tsx` (variant prop)
- `src/renderer-remote/chat/NavDrawer.tsx` (pass origin)
- `tests/integration/remote/terminal-end-to-end.test.ts` (desktop term cases)
- `docs/superpowers/notes/2026-05-25-mobile-remote-p5-smoke.md` (desktop term smoke steps)

## Exit criteria

- Picker shows desktop terminals alongside phone terminals.
- Attaching to a desktop term shows current scrollback and live output.
- Ctrl+C / arrows / Enter / Tab / Esc reach the desktop PTY.
- Typing other characters silently no-ops on the bridge.
- No regression in phone-owned terminal behavior.
- No regression in desktop terminal behavior (still drives the desktop window normally).
- Multiple phone clients can attach to the same desktop term.
- Unit + integration tests pass.
- Smoke checklist signed off.
