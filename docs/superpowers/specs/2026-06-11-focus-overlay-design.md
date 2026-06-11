# Focus Overlay — Design

**Date:** 2026-06-11
**Status:** Approved (user, 2026-06-11)

## Summary

When SAI's main window loses focus and at least one workspace has something to report, a small always-on-top overlay window (≈380×230, bottom-right) shows the most interesting conversation's tail plus a one-line status strip of every non-idle workspace and meta workspace. It is semi-transparent and click-through by default; holding **Ctrl+Shift** while hovering makes it solid, clickable, and draggable. Off by default behind a setting.

Modeled on otto's `OverlayManager` (`otto/src/main/overlay-window.ts`), adapted to SAI's status pipeline.

## Decisions (user-confirmed)

1. **Visibility rule (B):** show only when main window is unfocused AND ≥1 workspace is busy / awaiting question / awaiting approval / completed-unread. Hide on focus or when all idle.
2. **Layout (Option 1):** focused convo + status strip. Top: squircle + name per non-idle workspace (and meta roots). Body: the "most interesting" workspace — name + state label, last assistant text clamped to ~3 lines, current tool-call line while streaming.
3. **Interaction (A):** Ctrl+Shift+hover → interactive (full opacity, mouse events on, whole card is a drag region). Release → ghost mode (opacity 0.65, `setIgnoreMouseEvents(true, { forward: true })`). Modifier state is read from forwarded `mousemove` events. Fallback if forwarding is unavailable (Wayland): global shortcut `Ctrl+Shift+F9` toggles interactive mode; settings pane mentions it.
4. **Setting:** `overlayEnabled`, default **false**, in Settings. Position persisted as `overlayBounds` after drag.

## Architecture

**Main process — `electron/services/overlay.ts` (new):**
- `OverlayManager` class: creates the window lazily on first show (frameless, transparent, alwaysOnTop `screen-saver`, `focusable: false`, `skipTaskbar`, visible on all workspaces, `showInactive()`).
- Loads `dist/index.html` (or `VITE_DEV_SERVER_URL`) with `#overlay` hash — same single-bundle hash-route pattern as `/render-host`.
- Inputs: `setEnabled(bool)` (from the setting), `setMainFocused(bool)` (from main-window focus/blur), `update(payload)` (from renderer IPC), `setInteractive(bool)`.
- Pure visibility predicate exported for tests: `shouldShowOverlay({ enabled, mainFocused, hasReportable })`.
- IPC: `overlay:update` (renderer → main, payload below; main forwards to overlay window as `overlay:state`), `overlay:setInteractive` (overlay renderer → main; flips `setIgnoreMouseEvents` + opacity), `overlay:moved` (persist bounds via `writeSetting('overlayBounds', …)`).
- Cleanup: destroyed in the main-window `close` handler alongside the other services.

**Renderer — payload builder + view:**
- `src/lib/overlayFeed.ts` (new, pure): `buildOverlayPayload({ workspaces: Array<{ path, kind: 'project'|'meta', state: IndicatorState }>, focus })` → `{ hasReportable, strip: [...], focus?: { name, state, snippet, toolLine } }`. "Most interesting" priority: question > approval > busy > done.
- App.tsx: a small effect (mirroring the `remoteEmitWorkspaceStatus` pattern) recomputes the payload from `busyWorkspaces` / `awaitingQuestionWorkspaces` / `approvalSessions` / `completedWorkspacesWithUnread` / latest assistant message + tool line of the chosen workspace, and sends `overlay:update` (throttled ~250ms, only when enabled — gate on the `overlayEnabled` setting so the IPC is silent when off).
- `src/components/Overlay/OverlayView.tsx` (new): renders the Option-1 layout from `overlay:state` events. Reuses `WorkspaceSquircle`. Listens to forwarded `mousemove`: when `e.ctrlKey && e.shiftKey` → `overlay:setInteractive(true)`; on `keyup`-equivalent (mousemove without modifiers, or `mouseleave`) → `false`. In interactive mode the root gets `-webkit-app-region: drag`.
- `src/main.tsx`: if `location.hash === '#overlay'`, mount `OverlayView` instead of `App` (same branch style as the render-host route).

**Settings:** toggle in `SettingsModal` writing `overlayEnabled`; main reads it at startup and on `settings:changed` (or via existing `onSettingChange` plumbing) and calls `overlayManager.setEnabled`.

## Edge cases

- Quit/close: overlay destroyed in the `close` handler; never blocks quit.
- Multiple displays: bounds clamped to the nearest display work area on show (otto's `bottomRight()` equivalent), so a persisted position on an unplugged monitor can't strand it.
- Dev hot reload: manager is single-instance (module-level, like the idle-sweep timer fix).
- The overlay window must be excluded from the renderer's quit-flush handshake and capture-window logic (it loads the same bundle; the `#overlay` branch mounts only OverlayView, so App's IPC listeners never register).

## Testing

- `tests/unit/services/overlay.test.ts`: visibility predicate; manager show/hide on focus/enabled/reportable transitions with mocked BrowserWindow (pattern: `workspace.test.ts`); bounds clamping.
- `tests/unit/lib/overlayFeed.test.ts`: payload builder — priority order, strip contents, idle → `hasReportable: false`.
- `tests/unit/components/Overlay/OverlayView.test.tsx`: renders strip + focus section from a payload; ctrl+shift mousemove emits `overlay:setInteractive(true)`, plain mousemove emits `false`.

## Out of scope

- Clicking the overlay to focus/raise SAI on a specific workspace (could be a follow-up; in interactive mode a click could `workspaceSwitch + focus`, but not in v1).
- Showing approvals/question UI inside the overlay (display-only in v1).
- macOS/Windows-specific tray alternatives.
