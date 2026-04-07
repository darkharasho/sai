# Tab Sequential Numbering & Right-Click Rename

**Date:** 2026-04-06

## Problem

1. When a tab is closed and a new one is opened, the new tab gets a number based on total tabs ever created (e.g., close Tab 2, open new → "Tab 3" even though only 2 tabs exist).
2. There is no right-click rename option on tabs — only double-click.

## Goals

- New tab names always reflect current sequential position (`tabs.length + 1`).
- Users can right-click any tab to get a context menu with a "Rename" option.

## Out of Scope

- Renaming tabs via any mechanism other than what already exists (double-click) plus the new right-click menu.
- Reordering tabs via drag-and-drop.
- Persisting tab names across sessions.

---

## Design

### 1. Sequential Tab Numbering

**File:** `src/App.tsx`

**Change:** Remove `termTabCounterRef` (a `useRef(1)` that only ever incremented). Replace with derived numbering from current tab count.

- In `createTermTab`: name = `Tab ${prev.length + 1}` using the `setTermTabs(prev => ...)` updater form so the count is always accurate.
- In `closeTermTab` fallback (when closing the last tab): hardcode name as `"Tab 1"` since it will be the sole tab.

**Result:** With 2 tabs open, a new tab is always "Tab 3". With 1 tab open, a new tab is "Tab 2". Close back to 1 tab, open again → "Tab 2" again.

---

### 2. Right-Click Context Menu

**File:** `src/components/TerminalMode/TerminalTabBar.tsx`

**State added:**
```ts
const [contextMenu, setContextMenu] = useState<{ tabId: string; x: number; y: number } | null>(null);
```

**Behavior:**
- Each tab div gets an `onContextMenu` handler that calls `e.preventDefault()` and sets `contextMenu` to `{ tabId: tab.id, x: e.clientX, y: e.clientY }`.
- When `contextMenu !== null`, render a fixed-position div at `(x, y)` with a single "Rename" item.
- Clicking "Rename" calls `startRename` for the targeted tab and sets `contextMenu` to null.
- A `useEffect` adds a `mousedown` listener on `document` to close the menu on outside click.
- A `keydown` listener on `document` closes the menu on Escape.
- Both listeners are cleaned up when the menu closes.

**Styling:** Dark background (`#1a1e24`), border `#2d333b`, monospace font matching the tab bar, hover highlight on menu item. Fixed position, z-index high enough to appear above tab bar content.

---

## Files Changed

| File | Change |
|------|--------|
| `src/App.tsx` | Remove `termTabCounterRef`, update `createTermTab` and `closeTermTab` |
| `src/components/TerminalMode/TerminalTabBar.tsx` | Add `contextMenu` state, `onContextMenu` handler, context menu render, click-outside/Escape dismiss |

## No New Files

Both changes are confined to existing files.
