# Terminal Tabs Design

## Overview

Add terminal tab support to SAI. Multiple terminals per workspace, displayed as a right-side vertical tab list (VS Code style) that appears when 2+ terminals exist. Single terminal shows a `+` button in the header with no tab pane.

## Data Model

### New type: `TerminalTab`

```typescript
// src/types.ts
export interface TerminalTab {
  id: number;          // PTY id from main process
  name: string | null; // user-assigned name (null = auto-detect from process)
  order: number;       // display order in tab list
}
```

### Updated: `WorkspaceContext`

```typescript
export interface WorkspaceContext {
  // ... existing fields ...
  terminalIds: number[];           // kept for backwards compat
  terminalTabs: TerminalTab[];     // ordered tab list
  activeTerminalId: number | null; // currently focused tab
}
```

## UI Layout

### Single terminal (default state)

The terminal panel looks identical to today:
- Header: "TERMINAL" label on the left, restart button, and a new `+` icon button on the right
- No right-side tab pane visible
- Clicking `+` creates a second terminal and triggers the tab pane to appear

### Multiple terminals (2+ tabs)

The terminal panel splits horizontally:

```
┌──────────────────────────────────┬──────────┐
│ TERMINAL                    [↻]  │ 1: node ←│ (active, accent border)
├──────────────────────────────────│ 2: bash  │
│                                  │ 3: py  × │ (× on hover)
│  $ npm run dev                   │          │
│  Server running on :3000         │          │
│  █                               │   [+]    │
└──────────────────────────────────┴──────────┘
         ~flex: 1                    ~140px
```

- **Tab pane** (~140px wide) on the right edge, always visible when 2+ tabs exist
- Each tab row: `{order}: {name || processName}`
- Active tab: left accent border (`var(--accent)`), highlighted background
- Close `×` button appears on hover per tab row
- Double-click tab name to inline rename (input field replaces label, Enter to confirm, Escape to cancel)
- `+` button at the bottom of the tab pane
- Restart button in the header operates on the active tab

### Close behavior

- Closing a tab with a running foreground process shows a confirmation dialog before killing
- Closing the second-to-last tab hides the tab pane (reverts to single terminal view)
- Closing the last terminal altogether: the terminal panel shows an empty state with a `+` to create a new one
- Closing a tab kills its PTY via existing IPC and unregisters from `terminalBuffer`

## Terminal Buffer & Active Terminal Tracking

### `terminalBuffer.ts` changes

Add per-workspace active terminal tracking:

```typescript
const activeTerminals = new Map<string, number>(); // workspacePath → active terminal ID

export function setActiveTerminalId(workspacePath: string, id: number) {
  activeTerminals.set(workspacePath, id);
}
```

New lookup functions:

- `getTerminalById(id: number)` — get xterm instance by PTY ID
- `getTerminalByName(name: string, workspacePath: string)` — search registered terminals by user-assigned name
- `getTerminalByIndex(index: number, workspacePath: string)` — search by 1-based tab order

Update `getActiveTerminal()` to use `activeTerminals` map instead of iterating to find the last registered terminal.

Terminal names are stored in React state (`WorkspaceContext.terminalTabs`) and passed to `terminalBuffer` via a registration update function so the buffer module can resolve name-based lookups.

## Mention System

### Mention syntax

| Mention | Resolves to |
|---------|-------------|
| `@terminal` | Active tab's full buffer |
| `@terminal:last` | Active tab's last command output |
| `@terminal:1` | Tab #1's full buffer (1-based) |
| `@terminal:server` | Tab named "server"'s full buffer |
| `@terminal:1:last` | Tab #1's last command output |
| `@terminal:server:last` | Tab "server"'s last command output |

### Autocomplete

When the user types `@terminal:`, the autocomplete dropdown shows:

1. `@terminal` — Active terminal output
2. `@terminal:last` — Active terminal last command
3. `@terminal:1 (bash)` — Tab 1 by number (with process hint)
4. `@terminal:2 (server)` — Tab 2 by number
5. etc.

Fuzzy matching on tab number and name as user types after the colon.

### Resolution logic

In `ChatInput.tsx`, when a terminal mention is applied:

1. Parse the mention value to extract: target (number, name, or none) and modifier (`:last` or none)
2. If target is a number → `getTerminalByIndex(n)`
3. If target is a non-numeric string → `getTerminalByName(name)`
4. If no target → `getActiveTerminal()`
5. If modifier is `:last` → call `getTerminalLastCommand()` on resolved terminal
6. Otherwise → call `getTerminalContent()` on resolved terminal

### Name collision with `:last`

The reserved word `last` is used as a modifier. Inline rename should reject "last" as a tab name to avoid ambiguity (e.g., `@terminal:last` always means "last command of active tab", never "tab named last").

## Persistence & Workspace Switching

### Workspace switching

- Each workspace owns its own `terminalTabs` and `activeTerminalId` in `WorkspaceContext`
- Switching workspaces swaps the terminal panel to show that workspace's tabs and active terminal
- xterm instances stay alive in `terminalBuffer` registry (keyed by ID), just hidden/shown
- `FitAddon.fit()` fires via the existing `IntersectionObserver` when the active terminal becomes visible

### Workspace suspension

- Suspension kills all PTYs (existing behavior in `workspace.ts`)
- On resume, `terminalTabs` array is preserved (names, order) but PTY IDs are stale
- Resume creates fresh PTYs for each tab, updating IDs in `terminalTabs`
- Terminal buffer content is lost on suspension (same as today)

### App restart

- Terminal tabs are ephemeral — not persisted to localStorage
- On app restart, each workspace starts with a single terminal (current behavior)
- This matches the existing terminal lifecycle

## Files Modified

| File | Changes |
|------|---------|
| `src/types.ts` | Add `TerminalTab` interface, add `terminalTabs` and `activeTerminalId` to `WorkspaceContext` |
| `src/components/Terminal/TerminalPanel.tsx` | Multi-terminal support: render tab pane when 2+ tabs, `+` button, close with confirm, inline rename, active tab switching |
| `src/terminalBuffer.ts` | Active terminal ID tracking per workspace, `getTerminalById`, `getTerminalByName`, `getTerminalByIndex`, name registration |
| `src/components/Chat/ChatInput.tsx` | Parse `@terminal:N`, `@terminal:name`, `:last` modifier; update autocomplete to list all tabs |
| `src/App.tsx` | Initialize `terminalTabs`/`activeTerminalId` in workspace state, tab CRUD callbacks (create, close, rename, switch), pass props to TerminalPanel |

### Files not modified

- `electron/services/pty.ts` — existing IPC handles multiple terminals already
- `electron/preload.ts` — no new IPC channels needed
- `electron/main.ts` — no changes
- Settings, sessions, git, file explorer — unaffected
