# Terminal Isolation & Per-Workspace AI Tabs

**Date:** 2026-04-08
**Status:** Approved

## Problem

Two terminal architecture issues:

1. **Cross-contamination between workspace terminal and AI terminal.** TerminalModeView's data handler captures data from the workspace terminal (via `getActiveTerminalId()`) and feeds it into the BlockSegmenter. The fallback PTY also registers with the workspace, polluting terminal buffer lookups.

2. **AI terminal tabs are global, not per-workspace.** `termTabs`, `activeTermTabId`, and `terminalModeActivated` are single state values in App.tsx. Switching workspaces shows the same tabs and destroys/recreates TerminalModeView instances, losing state.

## Fix 1: Terminal Data Cross-Contamination

### Changes

**`src/components/TerminalMode/TerminalModeView.tsx`**

- Change the `terminalOnData` handler (around line 382) to only match `fallbackPtyRef.current` instead of `getActiveTerminalId() ?? fallbackPtyRef.current`. Terminal mode should only listen to its own PTY.
- Similarly, update `executeCommand` (around line 427) to only use `fallbackPtyRef.current`, not fall back to the workspace terminal.

**`electron/services/pty.ts`**

- Add an optional `scope` parameter to `terminal:create` IPC handler (e.g., `'terminal-mode'`).
- When `scope === 'terminal-mode'`, skip registering the PTY in `ws.terminals` and `terminalOwner`. The PTY still goes into `allTerminals` for lifecycle management but stays invisible to workspace terminal lookups.

**`electron/preload.ts`**

- Update `terminalCreate` bridge to pass through the optional scope parameter.

### Result

- Workspace terminal and AI terminal each only see their own PTY data.
- `getActiveTerminalId()` only returns workspace terminals, never terminal-mode PTYs.
- No shell startup noise from the fallback PTY leaks into workspace terminal context.

## Fix 2: Per-Workspace AI Terminal Tabs

### Changes

**`src/App.tsx`**

- Remove global `termTabs`, `activeTermTabId`, and `terminalModeActivated` state.
- Add these fields to the per-workspace state shape (the `workspaces` Map):
  ```ts
  termTabs: { id: string; name: string; createdAt: number }[]
  activeTermTabId: string
  terminalModeActivated: boolean
  ```
- Initialize defaults when a workspace is first created: one tab ("Tab 1"), `terminalModeActivated: false`.
- Read/write these values from the active workspace's state.
- All existing tab operations (`createTermTab`, `closeTermTab`, `renameTermTab`, tab navigation keybindings) update the active workspace's state instead of global state.

### Result

- Each workspace gets its own set of AI terminal tabs.
- Switching workspaces automatically swaps to that workspace's tabs.
- Terminal mode activation is per-workspace — opening terminal mode in one workspace doesn't affect others.
- TerminalModeView instances are preserved per-workspace (they mount/unmount based on workspace state, not global state).

## Files Affected

| File | Changes |
|------|---------|
| `src/components/TerminalMode/TerminalModeView.tsx` | Data handler and executeCommand use only fallback PTY |
| `electron/services/pty.ts` | Add scope param, skip workspace registration for terminal-mode |
| `electron/preload.ts` | Pass scope param through IPC bridge |
| `src/App.tsx` | Move tab state into per-workspace Map, update all tab operations |

## Testing

- Verify workspace terminal shows no output from AI terminal's shell startup.
- Verify AI terminal mode only captures its own PTY output.
- Verify switching workspaces swaps AI terminal tabs.
- Verify each workspace can independently activate/deactivate terminal mode.
- Verify creating/closing/renaming tabs in one workspace doesn't affect another.
- Run existing test suite to catch regressions.
