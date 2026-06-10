# Workspace Status Indicator — Design Spec

**Date:** 2026-06-06  
**Scope:** Unified squircle/triangle status system + chat panel state hardening

---

## Overview

Replace five separate, inconsistent dot/circle/spinner implementations with two shared components and a single state-mapping function. Fix the race conditions that cause the busy/done states to flicker or appear in the wrong order.

---

## Components

### `WorkspaceSquircle` (`src/components/shared/WorkspaceSquircle.tsx`)

A single component driven by a `state` prop. Renders the correct shape, color, and animation for each workspace state.

| `state`    | Shape         | Size  | Color   | Animation                        |
|------------|---------------|-------|---------|----------------------------------|
| `inactive` | squircle      | 9px   | #555    | none                             |
| `alive`    | squircle      | 9px   | #22c55e | slow breathing pulse (2.5s)      |
| `busy`     | squircle      | 9px   | #d4a72c | shrink-pulse (1.4s)              |
| `done`     | squircle      | 9px   | #e0e0e0 | slow blink (1.8s)                |
| `approval` | triangle      | 16px  | #f97316 | flash (1.2s)                     |

The squircle uses `DOT_MASK_URL` from `src/lib/assets.ts`.

The triangle uses a tight-viewBox SVG mask (viewBox `3 3.5 18.5 16`) with optically-corrected vertical position (center shifted to y=14 so its visual weight aligns with the squircle center line). Path:
```
M8.97 9.25 Q12 4 15.03 9.25 L17.63 13.75 Q20.66 19 14.6 19 L9.4 19 Q3.34 19 6.37 13.75 Z
```
Corner radius ≈ 3.5 (medium-round, paired with the squircle's own roundness).

Props:
```ts
interface WorkspaceSquircleProps {
  state: 'inactive' | 'alive' | 'busy' | 'done' | 'approval';
  className?: string;
}
```

### `StatusSlot` (`src/components/shared/WorkspaceSquircle.tsx`, same file)

An 18px fixed-width flex container that centers whichever indicator sits inside it. Every row that shows a status indicator uses `StatusSlot` so text always starts at the same horizontal offset regardless of indicator state.

```ts
interface StatusSlotProps {
  children: React.ReactNode;
}
```

---

## State Mapping

### `workspaceDisplayState` (`src/lib/workspaceStatus.ts`, new file)

Maps existing status flags to indicator states, in priority order:

```ts
type IndicatorState = 'inactive' | 'alive' | 'busy' | 'done' | 'approval';

function workspaceDisplayState(status: WorkspaceStatus | undefined, opts?: {
  isOpen?: boolean;  // workspace has an active process
}): IndicatorState {
  if (!status && !opts?.isOpen) return 'inactive';
  if (status?.approval)                                    return 'approval';
  if (status?.busy || status?.streaming || status?.awaitingQuestion) return 'busy';
  if (status?.completed)                                   return 'done';
  if (opts?.isOpen)                                        return 'alive';
  return 'inactive';
}
```

**Clearing `done`:**
- On workspace navigation (`handleProjectSwitch`) — existing behavior, keep as-is
- On user typing in the input — clear `completedWorkspaces` for that path
- Suspended workspaces → `inactive` (no process to interact with)

---

## Locations Updated

All five existing implementations replaced with `<StatusSlot><WorkspaceSquircle state={...} /></StatusSlot>`:

1. **`src/components/Chat/ChatHistorySidebar.tsx`** — replaces `chat-history-suspended-dot`, `workspace-done-dot`, `titlebar-busy-spinner`, `workspace-approval-icon` and their CSS keyframes
2. **`src/components/TitleBar.tsx`** — replaces `workspace-done-dot`, `titlebar-busy-spinner`, `workspace-completed-icon`, `workspace-status-dot` and their CSS keyframes
3. **`src/renderer-remote/chat/WorkspaceHeader.tsx`** — replaces all `ws-dot-*` variants and the `StatusDot` component (fold `workspaceDisplayState` in place of `displayPriority`)
4. **`src/components/CommandPalette.tsx`** — replaces its dot
5. **`src/components/NavBar.tsx`** — replaces its dot

---

## Chat Panel State Hardening

Three targeted fixes in `src/App.tsx`:

### 1. Atomic busy→done transition

`chatStreamingWorkspaces` and `busyWorkspaces` currently clear in separate `setState` calls, which can produce a frame where a workspace briefly appears `done` then snaps back to `busy`. Fix: clear `chatStreamingWorkspaces` inside the same updater callback that removes from `busyWorkspaces` and adds to `completedWorkspaces`.

### 2. Clear `completed` before setting `busy`

When a new turn starts (`streaming_start`) for a workspace already in `completedWorkspaces`, remove it from `completedWorkspaces` in the same batched state update that adds to `busyWorkspaces`. Prevents the stale `done` dot remaining visible at the start of a new turn.

### 3. Squircle state is turn-event-driven only

The 250ms `streamSettled` idle debounce in `ChatPanel` unlocks mid-stream markdown rendering — it is not a turn-completion signal and must not affect the squircle state. The indicator only transitions on:
- `streaming_start` → `busy`
- `done` / `process_exit` → `done` (then `alive` after user interaction)

No code change needed in `ChatPanel` itself — the squircle reads from App-level state (`busyWorkspaces`, `completedWorkspaces`), not from `streamSettled`.

---

## What's Not Changing

- The `streamSettled` / `streamIdleTimerRef` logic in `ChatPanel` — markdown unlock behavior is unaffected
- The `completedWorkspaces` clear-on-visit logic in `handleProjectSwitch` — already correct
- Animation timings on existing squircle states that already work (sidebar session dots)
- The `DOT_MASK_URL` asset — reused as-is
