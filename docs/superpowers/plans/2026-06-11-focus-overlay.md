# Focus Overlay Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A click-through always-on-top mini window (spec: `docs/superpowers/specs/2026-06-11-focus-overlay-design.md`) showing convo tail + all-workspace statuses when SAI is unfocused and something is happening. Off by default.

**Architecture:** Pure payload builder in the renderer (`overlayFeed.ts`) → `overlay:update` IPC → `OverlayManager` in main (window lifecycle, ghost/interactive switching) → overlay window mounts `OverlayView` via a `#overlay` hash branch in `main.tsx`.

**Tech Stack:** Electron BrowserWindow (frameless/transparent/click-through), React, vitest (unit, jsdom for components / node for the manager).

**Branch:** `focus-overlay` off `main`.

---

### Task 0: Branch

- [x] `git checkout -b focus-overlay`

---

### Task 1: Payload builder — `src/lib/overlayFeed.ts`

**Files:** Create `src/lib/overlayFeed.ts`; Test `tests/unit/lib/overlayFeed.test.ts`

- [x] **Step 1: Failing tests:**

```ts
import { describe, it, expect } from 'vitest';
import { buildOverlayPayload, type OverlayRow } from '@/lib/overlayFeed';

const row = (over: Partial<OverlayRow>): OverlayRow => ({
  path: '/p', name: 'p', kind: 'project', state: 'inactive', ...over,
});

describe('buildOverlayPayload', () => {
  it('is not reportable when everything is idle/alive', () => {
    const p = buildOverlayPayload([row({ state: 'alive' }), row({ path: '/q', state: 'inactive' })]);
    expect(p.hasReportable).toBe(false);
    expect(p.strip).toHaveLength(0);
    expect(p.focus).toBeNull();
  });

  it('strips include every non-idle row; focus picks question > approval > busy > done', () => {
    const p = buildOverlayPayload([
      row({ path: '/busy', name: 'busy', state: 'busy' }),
      row({ path: '/done', name: 'done', state: 'done' }),
      row({ path: '/ask', name: 'ask', state: 'question', snippet: 'which one?' }),
    ]);
    expect(p.hasReportable).toBe(true);
    expect(p.strip.map(s => s.name)).toEqual(['busy', 'done', 'ask']);
    expect(p.focus?.path).toBe('/ask');
  });

  it('busy-done counts as busy for focus priority', () => {
    const p = buildOverlayPayload([row({ path: '/bd', state: 'busy-done' }), row({ path: '/d', state: 'done' })]);
    expect(p.focus?.path).toBe('/bd');
  });
});
```

- [x] **Step 2:** `npx vitest run --project unit tests/unit/lib/overlayFeed.test.ts` — FAIL (module missing).
- [x] **Step 3: Implement:**

```ts
import type { IndicatorState } from './workspaceStatus';

export interface OverlayRow {
  path: string;
  name: string;
  kind: 'project' | 'meta';
  state: IndicatorState;
  /** Last assistant text, pre-truncated by the caller. */
  snippet?: string;
  /** Current tool call line while streaming. */
  toolLine?: string;
}

export interface OverlayPayload {
  hasReportable: boolean;
  strip: Array<Pick<OverlayRow, 'path' | 'name' | 'kind' | 'state'>>;
  focus: OverlayRow | null;
}

const REPORTABLE: ReadonlySet<IndicatorState> = new Set(['busy', 'busy-done', 'done', 'approval', 'question']);
const FOCUS_PRIORITY: IndicatorState[] = ['question', 'approval', 'busy', 'busy-done', 'done'];

/** Pure: derive the overlay's content from per-workspace indicator rows. */
export function buildOverlayPayload(rows: OverlayRow[]): OverlayPayload {
  const reportable = rows.filter(r => REPORTABLE.has(r.state));
  let focus: OverlayRow | null = null;
  for (const want of FOCUS_PRIORITY) {
    const hit = reportable.find(r => r.state === want
      || (want === 'busy' && r.state === 'busy-done'));
    if (hit) { focus = hit; break; }
  }
  return {
    hasReportable: reportable.length > 0,
    strip: reportable.map(({ path, name, kind, state }) => ({ path, name, kind, state })),
    focus,
  };
}
```

- [x] **Step 4:** Tests PASS. **Step 5:** `git add -A && git commit -m "feat(overlay): pure payload builder for the focus overlay"`

---

### Task 2: `OverlayManager` — `electron/services/overlay.ts`

**Files:** Create `electron/services/overlay.ts`; Test `tests/unit/services/overlay.test.ts`

- [x] **Step 1: Failing tests** (mock `electron` like `tests/unit/services/workspace.test.ts` does; mock BrowserWindow with `setIgnoreMouseEvents`, `setOpacity`, `showInactive`, `hide`, `isVisible`, `isDestroyed`, `setBounds`, `webContents.send`, `loadFile`, `loadURL`, `on`; mock `screen.getDisplayNearestPoint`/`getPrimaryDisplay` returning `{ workArea: { x: 0, y: 0, width: 1920, height: 1080 } }`):

```ts
describe('shouldShowOverlay', () => {
  it('requires enabled + unfocused + reportable', () => {
    expect(shouldShowOverlay({ enabled: true, mainFocused: false, hasReportable: true })).toBe(true);
    expect(shouldShowOverlay({ enabled: false, mainFocused: false, hasReportable: true })).toBe(false);
    expect(shouldShowOverlay({ enabled: true, mainFocused: true, hasReportable: true })).toBe(false);
    expect(shouldShowOverlay({ enabled: true, mainFocused: false, hasReportable: false })).toBe(false);
  });
});

describe('OverlayManager', () => {
  it('shows on blur when enabled and reportable, hides on focus', () => { /* drive setEnabled(true), update({hasReportable:true,...}), setMainFocused(false) → window showInactive called; setMainFocused(true) → hide called */ });
  it('creates the window lazily and only once', () => { /* no window until first show */ });
  it('interactive mode flips opacity and mouse events', () => { /* setInteractive(true) → setIgnoreMouseEvents(false), setOpacity(1); false → setIgnoreMouseEvents(true,{forward:true}), setOpacity(0.65) */ });
  it('clamps persisted bounds to the work area', () => { /* savedBounds far offscreen → setBounds called with x,y inside 1920x1080 */ });
});
```

(Write these as real tests at execution time following workspace.test.ts's `loadService()`/reset-modules harness — full assertions, not comments.)

- [x] **Step 2:** RED. **Step 3: Implement** `electron/services/overlay.ts`:

```ts
import { BrowserWindow, screen } from 'electron';
import path from 'node:path';

const WIDTH = 380;
const HEIGHT = 230;
const MARGIN = 16;
const GHOST_OPACITY = 0.65;

export interface OverlayVisibilityInputs {
  enabled: boolean;
  mainFocused: boolean;
  hasReportable: boolean;
}

export function shouldShowOverlay(i: OverlayVisibilityInputs): boolean {
  return i.enabled && !i.mainFocused && i.hasReportable;
}

export interface OverlayManagerOpts {
  getSavedBounds: () => { x: number; y: number } | undefined;
  saveBounds: (b: { x: number; y: number }) => void;
}

export class OverlayManager {
  private win: BrowserWindow | null = null;
  private enabled = false;
  private mainFocused = true;
  private lastPayload: unknown = null;
  private hasReportable = false;

  constructor(private readonly opts: OverlayManagerOpts) {}

  setEnabled(v: boolean): void { this.enabled = v; if (!v) this.hideAndForget(); else this.apply(); }
  setMainFocused(v: boolean): void { this.mainFocused = v; this.apply(); }

  update(payload: { hasReportable: boolean }): void {
    this.lastPayload = payload;
    this.hasReportable = !!payload?.hasReportable;
    if (this.win && !this.win.isDestroyed()) this.win.webContents.send('overlay:state', payload);
    this.apply();
  }

  setInteractive(v: boolean): void {
    if (!this.win || this.win.isDestroyed()) return;
    if (v) { this.win.setIgnoreMouseEvents(false); this.win.setOpacity(1); }
    else { this.win.setIgnoreMouseEvents(true, { forward: true }); this.win.setOpacity(GHOST_OPACITY); }
  }

  noteMoved(): void {
    if (!this.win || this.win.isDestroyed()) return;
    const [x, y] = this.win.getPosition();
    this.opts.saveBounds({ x, y });
  }

  destroy(): void {
    if (this.win && !this.win.isDestroyed()) this.win.destroy();
    this.win = null;
  }

  private apply(): void {
    const show = shouldShowOverlay({ enabled: this.enabled, mainFocused: this.mainFocused, hasReportable: this.hasReportable });
    if (show) {
      if (!this.win || this.win.isDestroyed()) this.create();
      this.win!.setBounds({ ...this.position(), width: WIDTH, height: HEIGHT });
      if (this.lastPayload) this.win!.webContents.send('overlay:state', this.lastPayload);
      if (!this.win!.isVisible()) this.win!.showInactive();
    } else if (this.win && !this.win.isDestroyed() && this.win.isVisible()) {
      this.win.hide();
    }
  }

  private hideAndForget(): void {
    if (this.win && !this.win.isDestroyed() && this.win.isVisible()) this.win.hide();
  }

  private position(): { x: number; y: number } {
    const saved = this.opts.getSavedBounds();
    const wa = saved
      ? screen.getDisplayNearestPoint({ x: saved.x, y: saved.y }).workArea
      : screen.getPrimaryDisplay().workArea;
    const def = { x: wa.x + wa.width - WIDTH - MARGIN, y: wa.y + wa.height - HEIGHT - MARGIN };
    if (!saved) return def;
    return {
      x: Math.min(Math.max(saved.x, wa.x), wa.x + wa.width - WIDTH),
      y: Math.min(Math.max(saved.y, wa.y), wa.y + wa.height - HEIGHT),
    };
  }

  private create(): void {
    const win = new BrowserWindow({
      width: WIDTH, height: HEIGHT, ...this.position(),
      frame: false, transparent: true, alwaysOnTop: true, resizable: false,
      movable: true, minimizable: false, maximizable: false, skipTaskbar: true,
      focusable: false, show: false, hasShadow: false, backgroundColor: '#00000000',
      webPreferences: { preload: path.join(__dirname, 'preload.js'), sandbox: false },
    });
    win.setAlwaysOnTop(true, 'screen-saver');
    win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
    win.setIgnoreMouseEvents(true, { forward: true });
    win.setOpacity(GHOST_OPACITY);
    win.removeMenu();
    win.on('moved', () => this.noteMoved());
    if (process.env.VITE_DEV_SERVER_URL) {
      void win.loadURL(`${process.env.VITE_DEV_SERVER_URL.replace(/\/$/, '')}/#overlay`);
    } else {
      void win.loadFile(path.join(__dirname, '../dist/index.html'), { hash: 'overlay' });
    }
    this.win = win;
  }
}
```

- [x] **Step 4:** GREEN + `npx tsc --noEmit`. **Step 5:** `git commit -m "feat(overlay): OverlayManager window lifecycle in main"`

---

### Task 3: IPC + preload + main wiring

**Files:** Modify `electron/preload.ts`, `electron/main.ts`

- [x] **Step 1: preload** — add to the exposed `sai` object:

```ts
  overlayUpdate: (payload: unknown) => ipcRenderer.send('overlay:update', payload),
  overlaySetInteractive: (v: boolean) => ipcRenderer.send('overlay:setInteractive', v),
  overlayOnState: (cb: (payload: any) => void) => {
    const listener = (_e: unknown, payload: any) => cb(payload);
    ipcRenderer.on('overlay:state', listener);
    return () => ipcRenderer.removeListener('overlay:state', listener);
  },
```

- [x] **Step 2: main.ts** — module-level `let overlayManager: OverlayManager | null`; after window creation:

```ts
  overlayManager = new OverlayManager({
    getSavedBounds: () => readSettings().overlayBounds,
    saveBounds: (b) => writeSetting('overlayBounds', b),
  });
  overlayManager.setEnabled(readSettings().overlayEnabled === true);
  ipcMain.on('overlay:update', (_e, payload) => overlayManager?.update(payload));
  ipcMain.on('overlay:setInteractive', (_e, v: boolean) => overlayManager?.setInteractive(!!v));
```

In the existing `mainWindow.on('focus')` handler add `overlayManager?.setMainFocused(true);`, add a `mainWindow.on('blur', () => overlayManager?.setMainFocused(false));`, in `settings:set` handler add `if (key === 'overlayEnabled') overlayManager?.setEnabled(value === true);`, and in the `close` handler add `overlayManager?.destroy();` next to `destroyClaude();`.
- [x] **Step 3:** `npx tsc --noEmit` + existing unit suites for main-adjacent services PASS. **Step 4:** `git commit -m "feat(overlay): IPC wiring, settings + focus hooks"`

---

### Task 4: `OverlayView` + `#overlay` mount branch

**Files:** Create `src/components/Overlay/OverlayView.tsx`, `src/components/Overlay/OverlayView.css`; Modify `src/main.tsx`; Test `tests/unit/components/Overlay/OverlayView.test.tsx`

- [x] **Step 1: Failing tests** — render OverlayView with a mocked `window.sai` (`overlayOnState` captures the cb; fire a payload) and assert: strip squircles render per row, focus name + snippet + toolLine render; `mousemove` with `ctrlKey && shiftKey` calls `overlaySetInteractive(true)` and plain mousemove calls it with `false`.
- [x] **Step 2:** RED. **Step 3: Implement** — component subscribes via `window.sai.overlayOnState`, renders Option-1 layout (status strip of `WorkspaceSquircle` + name; focus section with state label, snippet clamped to 3 lines via CSS, monospace toolLine), root listens `onMouseMove` (`e.ctrlKey && e.shiftKey` → interactive true, else false) and `onMouseLeave` → false; in interactive mode adds class `overlay-interactive` with `-webkit-app-region: drag` on the card (buttonless v1, whole card drags). Body transparent.
  `src/main.tsx`: add a branch BEFORE the default App mount:

```ts
} else if (window.location.hash === '#overlay') {
  import('./components/Overlay/OverlayView').then(({ OverlayView }) => {
    ReactDOM.createRoot(root).render(<OverlayView />);
  });
}
```

- [x] **Step 4:** GREEN. **Step 5:** `git commit -m "feat(overlay): OverlayView renderer + #overlay mount branch"`

---

### Task 5: App feeds the overlay + settings toggle

**Files:** Modify `src/App.tsx`, `src/components/SettingsModal.tsx`

- [x] **Step 1: App effect** — alongside the `remoteEmitWorkspaceStatus` effect, add state `overlayEnabled` (loaded in the settings-loader effect with the `guard()` pattern) and an effect over `[busyWorkspaces, completedWorkspacesWithUnread, approvalSessions, awaitingQuestionWorkspaces, workspaces, metaWorkspaces, overlayEnabled]` that, when `overlayEnabled`, builds rows (project rows from open workspaces using the same state chain as the TitleBar chip — approval > question > busy > done > alive/inactive; meta rows from `metaWorkspaces` synthetic roots), attaches `snippet` (last assistant message text from `wsMessagesRef.current` or `activeSession.messages`, truncated to 220 chars) and `toolLine` (name of the last toolCall without output on that message, prefixed `▸ `) to the focus candidate rows, calls `buildOverlayPayload(rows)` and `window.sai.overlayUpdate(payload)` through a 250ms trailing throttle (setTimeout ref). When `overlayEnabled` is false, send nothing.
- [x] **Step 2: SettingsModal** — add `overlayEnabled` state + loader + handler (`window.sai.settingsSet('overlayEnabled', v)`) and a toggle row in the **Window** section:

```tsx
        <div className="settings-row">
          <div className="settings-row-info">
            <div className="settings-row-name">Focus overlay</div>
            <div className="settings-row-desc">When SAI is in the background and something is running, show a small click-through status window. Hold Ctrl+Shift over it to interact or drag it.</div>
          </div>
          <button
            className={`settings-toggle${overlayEnabled ? ' on' : ''}`}
            onClick={() => handleOverlayEnabledChange(!overlayEnabled)}
            role="switch"
            aria-checked={overlayEnabled}
          >
            <span className="settings-toggle-thumb" />
          </button>
        </div>
```

- [x] **Step 3:** `npx tsc --noEmit`; run `tests/unit/components/SettingsModal*` if present + full unit project. **Step 4:** `git commit -m "feat(overlay): renderer feed + settings toggle (off by default)"`

---

### Task 6: Verify + merge

- [x] `npx tsc --noEmit` clean; `npm test` all green.
- [x] Visual check: render the OverlayView layout via the in-app renderer for the user.
- [x] Merge to `main` (user's standing preference), re-run `npm test`, delete branch.
