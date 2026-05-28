# Mobile Remote — Phase 5: Terminal — Design

**Status:** Approved (2026-05-25).
**Depends on:** P0–P4 merged.
**Scope:** Add a working terminal surface to the mobile PWA. Phone-owned PTYs only (no sharing with desktop). xterm.js + soft-key toolbar + viewport-aware resize. Scrollback replay on reconnect.

## Decisions

| # | Decision | Why |
|---|----------|-----|
| Q1 | **Independent** phone terminals (no sharing with desktop) | Sharing requires PTY data fan-out and cols negotiation across two clients — a separate design problem. B unblocks v1; an attach RPC can be added later without breaking the wire. |
| Q2 | **Multiple terminals via sheet picker** | Single is too limiting (no background `npm run dev`). A persistent tab strip eats vertical pixels the iPhone viewport can't spare. Sheet picker matches existing RepoPicker pattern. |
| Q3 | **PTY survives disconnect + ring-buffer replay on reattach** | Phones disconnect constantly (lock, app switch, Tailscale flap). 64KB/term RAM cost is trivial. Without replay the surface is unusable in practice. |
| Q4 | **Unrestricted input** | Terminal input is raw bytes — there is no tool-call boundary to clamp. Pairing already gates physical access; bearer tokens are revocable from Settings. Risk parity with phone chat (which can already drive shell tools via Claude). |
| Q5 | **Fourth NavDrawer rail item, fullscreen while active** | Terminal is a workspace tool — same home as Files/Git/Chats. But every column matters, so the rail and right sliver hide while Terminal is active; a back-arrow in the terminal toolbar returns to the drawer. |

## Architecture

```
phone xterm.js  ⇄  terminal.* WS frames  ⇄  bridge terminal-store
                                              │
                                              ↓
                                          node-pty (one IPty per phone term)
                                          ring buffer (64KB)
                                          PhoneTerminal registry
```

Phone-owned terminals are completely independent from desktop's window-bound terminals. The two registries do not see each other. Cleanup paths are shared via `workspace.terminals` (so a workspace close kills both).

## Wire protocol

New WS message types (all carry `reqId` for client→server requests; client correlates replies the same way Files/Git does):

### Client → Server

| Type | Payload | Reply |
|---|---|---|
| `terminal.list` | `{ cwd }` | `terminal.list.result { terms: { termId, cwd, cols, rows, alive }[] }` |
| `terminal.open` | `{ cwd, cols, rows }` | `terminal.opened { termId, cols, rows }` |
| `terminal.attach` | `{ termId, cols, rows }` | `terminal.attached { termId, cols, rows }` + replay chunk |
| `terminal.detach` | `{ termId }` | (no reply; one-way) |
| `terminal.input` | `{ termId, data }` | (no reply; one-way) |
| `terminal.resize` | `{ termId, cols, rows }` | (no reply; one-way) |
| `terminal.signal` | `{ termId, signal }` | (no reply; one-way) — currently SIGINT only |
| `terminal.kill` | `{ termId }` | `terminal.exit` follows |

### Server → Client (unsolicited)

| Type | Payload | When |
|---|---|---|
| `terminal.output` | `{ termId, data }` | PTY stdout chunk (only sent to the currently attached client) |
| `terminal.exit` | `{ termId, code }` | PTY exited |

**Fan-out:** v1 assumes ≤1 attached client per termId at a time. If a second client attaches while another is attached, the previous is detached. Document this assumption; revisit if it becomes a real complaint.

## Server-side modules

### `electron/services/pty.ts` (refactor)

Extract pure impls (no `ipcMain` coupling):

```ts
// New exports
export function createTerminalImpl(opts: {
  cwd: string;
  cols: number;
  rows: number;
  onData: (data: string) => void;
  onExit: (code: number) => void;
}): { termId: number; pty: IPty };

export function writeTerminalImpl(termId: number, data: string): void;
export function resizeTerminalImpl(termId: number, cols: number, rows: number): void;
export function signalTerminalImpl(termId: number, signal: NodeJS.Signals): void;
export function killTerminalImpl(termId: number): void;
```

Existing `ipcMain.handle('terminal:create', ...)` thins down to call `createTerminalImpl`; signal/resize/kill follow suit. Desktop behavior unchanged.

### `electron/services/remote/terminal-store.ts` (new)

```ts
interface PhoneTerminal {
  termId: number;
  cwd: string;
  pty: IPty;
  ring: RingBuffer;          // ~64KB cap
  attachedClient: WebSocket | null;
  cols: number;
  rows: number;
  lastAttachAt: number;      // for idle GC
}

class PhoneTerminalRegistry {
  open(cwd, cols, rows): PhoneTerminal;
  attach(termId, ws, cols, rows): { replay: string; cols: number; rows: number } | null;
  detach(termId, ws): void;             // no-op if ws is not currently attached
  input(termId, data): void;
  resize(termId, cols, rows): void;
  signal(termId, sig): void;
  kill(termId): void;
  list(cwd?: string): PhoneTerminalSummary[];
  destroyAll(): void;                   // called from RemoteModule.stop
  startIdleGc(intervalMs?: number);     // 60min unattached → kill
}
```

Ring buffer: simple `Buffer[]` with a running byte total; drop oldest chunk when adding pushes total over 64KB. Replay concatenates all chunks into one string (xterm.js accepts a single large `write` call).

### `electron/services/remote/bridge-server.ts` (wire routing)

Add a `terminal.*` switch arm that delegates to the registry. On WS close: iterate registry, call `detach(termId, ws)` for any attached client.

Pattern mirrors P3/P4 git/files routing exactly.

### `electron/main.ts` (wiring)

Pass `terminalStore` into `RemoteModule` construction. `before-quit` calls `terminalStore.destroyAll()` alongside existing bridge stop.

## Client-side modules

### `src/renderer-remote/terminal/Terminal.tsx` (new)

Lazy-imports `xterm` + `@xterm/addon-fit`. Owns:
- the `Terminal` instance + FitAddon
- the active `termId` (from picker or auto-opened)
- WS attach/detach plumbing (`client.on` subscription)
- viewport-resize listeners (`window.visualViewport.resize` + drawer resize)

```ts
useEffect(() => {
  // lazy import
  Promise.all([import('xterm'), import('@xterm/addon-fit')]).then(([{ Terminal }, { FitAddon }]) => { ... });
}, []);
```

Renderer choice: canvas (not WebGL) — Safari iOS WebGL is unreliable.

Disable iOS autocorrect on the hidden textarea xterm.js creates:
```ts
term.textarea.setAttribute('autocorrect', 'off');
term.textarea.setAttribute('autocapitalize', 'none');
term.textarea.setAttribute('spellcheck', 'false');
```

### `src/renderer-remote/terminal/TerminalToolbar.tsx` (new)

Soft-key row above the iOS keyboard. Layout:
```
[←back]  Esc  Tab  Ctrl  ↑  ↓  ←  →
```
- `Esc` sends `\x1b`.
- `Tab` sends `\t`.
- `Ctrl` is sticky-modifier: tap → highlighted; next char tap (e.g., C) sends `\x03`; sticky resets.
- Arrows send `\x1b[A`/`B`/`C`/`D`.
- Back-arrow restores the drawer (no fullscreen).

### `src/renderer-remote/terminal/TerminalPicker.tsx` (new)

Bottom sheet, mirrors RepoPicker styling. Lists `terminal.list` results for current cwd; tapping a row sends `terminal.attach`. "New terminal" action at top sends `terminal.open`.

### `src/renderer-remote/chat/NavDrawer.tsx` (modify)

- Add `terminal` to `NavItem` union.
- Add `Terminal` icon (from lucide) to `NAV_ITEMS`.
- When `active === 'terminal'`, hide rail + sliver (`display: 'none'` or conditionally render) so terminal occupies full viewport.
- Continue polling `files.status` for the git badge regardless of active surface.

### `src/renderer-remote/wire.ts` (add helpers)

```ts
listTerminals(cwd: string): Promise<PhoneTerminalSummary[]>;
openTerminal(cwd, cols, rows): Promise<{ termId, cols, rows }>;
attachTerminal(termId, cols, rows): Promise<{ termId, cols, rows }>;
detachTerminal(termId): void;             // fire-and-forget
inputTerminal(termId, data): void;
resizeTerminal(termId, cols, rows): void;
signalTerminal(termId, signal): void;
killTerminal(termId): void;
```

`terminal.output` events handled by Terminal.tsx's `client.on` subscription, not via a wire helper.

## Lifecycle flows

**Open new terminal:**
1. User taps Terminal rail → picker opens → "New terminal".
2. PWA: `openTerminal(cwd, cols, rows)` → `terminal.opened { termId }`.
3. PWA writes `termId` to state, picker closes, xterm.js takes focus.
4. Bridge: pty.onData hooked to ring + send `terminal.output` to attached client.

**Attach to existing:**
1. Picker shows current terms; tap one.
2. PWA: `attachTerminal(termId, cols, rows)` → bridge resizes PTY, replays ring as single `terminal.output`, then live-streams.

**Backgrounded:**
1. PWA visibility hidden → `detachTerminal(termId)`.
2. PTY survives; ring accumulates output.
3. PWA visible again → `attachTerminal(termId, cols, rows)` → replay + live.

**WS dropped (Tailscale flap, lock screen):**
1. Server-side WS `close` handler iterates registry, calls `detach` for any attached client.
2. PWA reconnect logic (existing) re-auths; Terminal.tsx re-attaches automatically (state preserved).

**Exit:**
1. `pty.onExit(code)` → bridge sends `terminal.exit { termId, code }`, removes registry entry.
2. PWA shows "[process exited (N)]" in xterm.js (`term.write(...)`), disables input, picker re-list no longer shows it.

**Idle GC:**
- A timer every 5min walks the registry; any entry with `attachedClient === null && now - lastAttachAt > 60min` → kill.

## Testing

### Unit tests

`tests/unit/remote/bridge-server-terminal.test.ts`:
- `terminal.open` returns termId + dims; PTY spawn called with cwd.
- `terminal.input` writes bytes through.
- `terminal.resize` calls `pty.resize`.
- `terminal.attach` replays ring buffer then live-streams.
- `terminal.detach` keeps PTY alive but stops output.
- WS close auto-detaches.
- `terminal.kill` kills PTY and emits `terminal.exit`.
- Idle GC kills entries with `lastAttachAt > 60min` ago.

PTY is stubbed (no real shell): emit canned `onData` strings, capture `write()` calls. Use a fake clock for idle GC.

`tests/unit/remote/terminal-ring-buffer.test.ts`:
- Push under cap → snapshot returns full content.
- Push over cap → oldest chunks evicted, total stays ≤ cap.
- Empty snapshot = empty string.

### Integration test

`tests/integration/remote/terminal-end-to-end.test.ts`:
- Real bridge, real `node-pty` spawning `/bin/sh -c 'echo hello; exit 0'`.
- WS connect, open → assert `hello` arrives, exit code 0.
- Mid-stream disconnect → reconnect → assert replay contains earlier output.

Skip on Windows CI if `node-pty` Windows ABI causes flakiness — use `process.platform !== 'win32'` guard.

### Manual smoke

Create `docs/superpowers/notes/2026-05-25-mobile-remote-p5-smoke.md` with on-device checklist:
- Terminal rail item visible with placeholder icon; tapping enters fullscreen.
- Picker shows "New terminal" when empty; opens fresh PTY.
- `ls`, `git status`, ANSI-colored `git log --oneline` all render correctly.
- Soft-key toolbar: Esc cancels less, Tab completes, Ctrl+C kills `sleep 30`, arrows recall history.
- Lock phone for >1min → unlock → scrollback present, prompt responsive.
- Open second terminal via picker; switch back; both maintain state.
- iOS keyboard show → cols recompute, prompt remains visible.
- Kill from picker → exit message in xterm, term gone from list.
- Workspace switch (RepoPicker) → terminal list scoped to new cwd.

## Risk areas

- **xterm.js bundle weight** (~150KB gzipped + addon-fit). Mitigation: lazy import only when Terminal surface mounted (matches Shiki pattern).
- **Heavy stdout (`yes`, `find /`)** — ring buffer must wrap, not grow unbounded. Test explicitly.
- **iOS Safari `\r\n` handling** — confirm in manual smoke. node-pty emits raw bytes; xterm.js handles `\r\n` natively.
- **node-pty + Electron rebuild dance** — already in deps for desktop. No new native deps.
- **Cols/rows mismatch on attach** — bridge always resizes PTY to phone's reported dims; if phone reports something silly (cols < 20), clamp to a minimum.
- **WebSocket buffering on large output** — `terminal.output` chunks are 1:1 with PTY data callbacks (typically small). If we see "binary frame too large" errors, split chunks before send.

## Out of scope (v1)

- Sharing PTYs with desktop or between multiple phone clients (one attached client per term).
- iOS push notification on PTY exit (iOS PWA limitation; already a roadmap non-goal).
- Custom font configuration on phone (use system monospace).
- Search-in-buffer / find UI inside terminal.
- Copy-on-select / paste support beyond standard xterm.js + iOS selection gestures.
- Per-terminal env overrides — inherits desktop's env-stripping logic from `pty.ts`.

## File map

**New:**
- `electron/services/remote/terminal-store.ts`
- `electron/services/remote/ring-buffer.ts` (or inline in terminal-store.ts)
- `src/renderer-remote/terminal/Terminal.tsx`
- `src/renderer-remote/terminal/TerminalToolbar.tsx`
- `src/renderer-remote/terminal/TerminalPicker.tsx`
- `tests/unit/remote/bridge-server-terminal.test.ts`
- `tests/unit/remote/terminal-ring-buffer.test.ts`
- `tests/integration/remote/terminal-end-to-end.test.ts`
- `docs/superpowers/notes/2026-05-25-mobile-remote-p5-smoke.md`

**Modified:**
- `electron/services/pty.ts` (extract impls)
- `electron/services/remote/bridge-server.ts` (terminal.* routing, WS-close detach)
- `electron/main.ts` (terminalStore wiring, destroyAll on quit)
- `src/renderer-remote/wire.ts` (terminal helpers)
- `src/renderer-remote/chat/NavDrawer.tsx` (rail item + fullscreen mode)
- `package.json` (`xterm`, `@xterm/addon-fit` as PWA deps)

## Exit criteria

- Typical commands runnable from phone: `git status`, `npm run`, `tail -f logs`.
- ANSI color/cursor sequences render correctly.
- Large output (`yes | head -1000`) doesn't lock the PWA; ring buffer caps.
- Lock screen → unlock → terminal resumes with scrollback intact.
- Multiple terminals selectable via picker.
- No regression in desktop terminal behavior.
- All unit + integration tests passing.
- Manual smoke checklist signed off on real iPhone.
