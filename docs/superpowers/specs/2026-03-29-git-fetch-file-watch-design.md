# Design: Periodic Git Fetch & External File Change Detection

**Date:** 2026-03-29
**Status:** Approved

---

## Overview

Two related background monitoring features:

1. **Periodic `git fetch`** — keep the pull button's "behind by N" count current without user action
2. **External file change detection** — detect when open editor files are modified on disk by an external process (e.g., Claude tools), and offer to reload

---

## Approach

Pure polling, consistent with the existing 5s git status polling architecture. No new dependencies.

---

## Backend (Electron services)

### `git:fetch` IPC handler — `electron/services/git.ts`

- Runs `git fetch --quiet` on the active project path
- Returns nothing; the next `git:status` poll picks up the updated `behind` count naturally from the tracking branch
- Exposed via `preload.ts` as `window.sai.gitFetch(path)`

### `fs:mtime` IPC handler — `electron/services/fs.ts`

- Takes a file path, returns `{ mtime: number }` (ms since epoch via `fs.stat`)
- No file content read — lightweight
- Exposed via `preload.ts` as `window.sai.fsMtime(path)`

---

## State Changes

### `types.ts` — `OpenFile`

Add one field:

```ts
diskMtime?: number  // mtime (ms) when file was last loaded from or saved to disk
```

Set in two existing places:
- When a file is first opened: set `diskMtime` to mtime at load time
- When a file is saved: update `diskMtime` to current mtime

### `App.tsx` — per-workspace state

```ts
externallyModified: Set<string>  // paths of open dirty files changed on disk; stored in App.tsx alongside the workspaces map, keyed to the active project path
```

Clean files that changed on disk are silently reloaded and never enter this set.

---

## Polling Logic (`App.tsx`)

### 60s interval — git fetch

```
if projectPath → call gitFetch(projectPath) → ignore result
```

The next 5s git status poll sees the updated `behind` count automatically. No UI changes needed — the pull button already displays the behind count from `gitStatus()`.

### 5s interval — file mtime check

Runs as a dedicated interval (separate from the git status interval to keep concerns isolated):

For each open file in the active workspace:

1. Call `fsMtime(path)` → compare to `file.diskMtime`
2. **Unchanged** → skip
3. **Changed + clean** (`!isDirty`) → read file from disk, update `openFiles[path].content` and `diskMtime`, keep `isDirty = false`. Monaco picks up new content via the existing model update path.
4. **Changed + dirty** (`isDirty`) → add path to `externallyModified`

---

## UI — External Change Banner

A thin banner rendered inside `CodePanel`, above the Monaco editor. Shown only when the **active file's path** is in `externallyModified`.

```
⚠ File changed on disk   [Reload]  [Keep My Edits]
```

Styled consistently with existing subtle UI indicators (not a blocking modal).

### Reload

- Read file from disk
- Update `openFiles[path].content`
- Reset `isDirty = false`
- Update `diskMtime` to current
- Remove path from `externallyModified`

### Keep My Edits

- Update `diskMtime` to current (prevents re-appearance for the same external write)
- Remove path from `externallyModified`

The banner is dismissed either way. It reappears only if another external write happens after the user's choice.

---

## Files Touched

| File | Change |
|------|--------|
| `electron/services/git.ts` | Add `gitFetch()` function + `git:fetch` IPC handler |
| `electron/services/fs.ts` | Add `fsMtime()` function + `fs:mtime` IPC handler |
| `electron/preload.ts` | Expose `gitFetch` and `fsMtime` on `window.sai` |
| `src/types.ts` | Add `diskMtime?: number` to `OpenFile` |
| `src/components/App.tsx` | Add 60s fetch interval, 5s mtime check loop, `externallyModified` state |
| `src/components/CodePanel/CodePanel.tsx` | Render external change banner when active file is in `externallyModified` |

---

## Out of Scope

- Automatic `git pull` (user must click the pull button)
- Conflict detection between staged changes and incoming remote commits
- File watching via chokidar or `fs.watch`
- Notifications/toasts for clean file auto-reloads
