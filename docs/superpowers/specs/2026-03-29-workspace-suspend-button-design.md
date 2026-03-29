# Workspace Manual Suspend Button

**Date:** 2026-03-29
**Status:** Approved

## Summary

Add a manual suspend action to the workspace dropdown in TitleBar. Users can suspend or close any active workspace on demand via a per-row overflow menu (`···`).

## UI Behavior

- Active workspace rows in the dropdown gain a `···` overflow button on hover.
- Suspended workspace rows do not show the button (they are already suspended).
- Clicking `···` opens a small submenu anchored to the row with two actions:
  - **⏸ Suspend** — immediately suspends the workspace, no confirmation prompt.
  - **✕ Close** — opens a `CloseWorkspaceModal` before proceeding.
- The submenu closes when the user clicks outside it or selects an action.

## Close Confirmation Modal

A new `CloseWorkspaceModal` component, styled identically to the existing `UnsavedChangesModal`:

- Title: **"Close Workspace"**
- Body: `<projectName> will be removed from your workspace list. This cannot be undone.`
- Buttons: **Cancel** (dismisses) | **Close** (red, confirms)
- Escape key cancels; clicking the overlay cancels.

## Backend Changes

### `electron/main.ts`
Add a new IPC handler `workspace:suspend` that calls the existing `suspend(projectPath, mainWindow)` function from `electron/services/workspace.ts`. The `suspend()` function already handles killing the Claude process, clearing terminals, setting `status = 'suspended'`, and firing the `workspace:suspended` IPC event to the frontend.

### `electron/preload.ts`
Expose `workspaceSuspend: (projectPath: string) => ipcRenderer.invoke('workspace:suspend', projectPath)` alongside the existing `workspaceClose`.

## Frontend Changes

### `src/components/TitleBar.tsx`
- Add `overflowOpen` state tracking which workspace's submenu is open (`string | null`).
- Render `···` button on active workspace rows; clicking it sets `overflowOpen` to that `projectPath`.
- Render the submenu when `overflowOpen` matches the row's `projectPath`.
- Suspend handler: calls `window.sai.workspaceSuspend(projectPath)` then closes the submenu.
- Close handler: closes the submenu and sets `closeTarget` state to open the modal.
- Outside-click listener already present for the dropdown can be extended to also close the submenu.

### `src/components/CloseWorkspaceModal.tsx`
New component, modeled on `UnsavedChangesModal`. Props: `projectPath: string`, `onConfirm: () => void`, `onCancel: () => void`. Calls `window.sai.workspaceClose(projectPath)` inside `onConfirm` (or the caller does — caller preferred for consistency).

## Data Flow

```
User clicks ··· → overflowOpen = projectPath → submenu renders
  → Suspend clicked → workspaceSuspend(projectPath) IPC → suspend() → workspace:suspended event → frontend status update
  → Close clicked   → CloseWorkspaceModal shown → confirmed → workspaceClose(projectPath) IPC → remove() → workspace removed
```

## Out of Scope

- Suspend for the currently active/foreground workspace (the one open in the editor) — the button still appears but behavior is the same; the workspace suspends and the user stays on it until they switch.
- Bulk "Suspend All" action.
- Additional submenu actions (rename, pin, etc.).
