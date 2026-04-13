# Monaco Diff Editor & Git Gutter Decorations

**Date:** 2026-04-13
**Status:** Approved

## Overview

Two related features that bring VS Code-style git integration to SAI's editor:

1. **Monaco Diff Editor** — Replace the custom Shiki-based DiffViewer with Monaco's built-in `createDiffEditor`, gaining native minimap support, word-level diff highlighting, and consistent theming.
2. **Git Gutter Decorations** — Show change indicators (added/modified/deleted) in the regular editor's gutter and minimap, matching VS Code's behavior.

## Feature 1: Monaco Diff Editor

### Current State

`DiffViewer.tsx` is a custom component that:
- Fetches raw unified diff via `window.sai.gitDiff()`
- Parses diff format manually
- Highlights with Shiki
- Renders custom HTML with colored backgrounds for add/del/context lines
- Supports unified and split view modes
- Has no minimap

### Changes

**New IPC: `git:show`**
- Handler: `ipcMain.handle('git:show', (event, cwd, filepath, ref))`
- Returns file content at a given git ref (e.g., `HEAD`)
- Used to provide the "original" side of the diff editor
- Falls back to empty string for new/untracked files

**Working tree content:** Use existing `fsReadFile` IPC — no new handler needed.

**Replace DiffViewer component:**
- Use `monaco.editor.createDiffEditor()` instead of custom Shiki rendering
- Configure with:
  - `minimap: { enabled: true }` (respects user's minimap setting)
  - `renderSideBySide: mode === 'split'` (maps to existing unified/split toggle)
  - `theme: 'sai-dark'` (reuses existing Monaco theme)
  - `readOnly: true` (diff view is read-only)
  - `originalEditable: false`
  - `scrollBeyondLastLine: false`
  - `automaticLayout: true`
- Set original model from `git:show` result, modified model from `fsReadFile` (unstaged) or `git:show` with `:` ref (staged)
- Listen for theme change events same as MonacoEditor does

**What stays the same:**
- Tab bar, toolbar, unified/split toggle in CodePanel
- `git:diff` IPC remains (used elsewhere)
- Props interface stays compatible (projectPath, filePath, staged, mode)

### Staged vs Unstaged Diffs

- **Unstaged:** original = `HEAD:<filepath>`, modified = working tree content
- **Staged:** original = `HEAD:<filepath>`, modified = staged content (via `git show :filepath`)

The `git:show` handler accepts a ref parameter to handle both cases.

## Feature 2: Git Gutter Decorations

### Decoration Types (VS Code parity)

| Change Type | Gutter | Minimap | Visual |
|-------------|--------|---------|--------|
| Added | Green bar (left margin) | Green stripe | Lines that exist in working tree but not in HEAD |
| Modified | Blue bar (left margin) | Blue stripe | Lines that differ from HEAD |
| Deleted | Red triangle (left margin) | Red stripe | Position where lines were removed |

### New IPC: `git:diffLines`

**Handler:** `ipcMain.handle('git:diffLines', (event, cwd, filepath))`

**Returns:**
```typescript
interface DiffLineInfo {
  added: Array<{ startLine: number; endLine: number }>;
  modified: Array<{ startLine: number; endLine: number }>;
  deleted: number[]; // line numbers where deletions occurred
}
```

**Implementation:**
- Runs `git diff HEAD -- <filepath>` 
- Parses unified diff hunk headers (`@@ -old,count +new,count @@`)
- Classifies changes:
  - **Added:** Hunks where old count is 0 (pure insertions)
  - **Deleted:** Hunks where new count is 0 (pure deletions) — records the line number where content was removed
  - **Modified:** Hunks with both old and new content (replacements)
- For untracked files: returns all lines as added ranges
- For clean files: returns empty arrays

### MonacoEditor Changes

**New prop:** `projectPath: string`

**Decoration application:**
- On editor mount, fetch `git:diffLines(projectPath, filePath)`
- Apply decorations via `editor.deltaDecorations()`:
  - Added lines: `{ isWholeLine: true, linesDecorationsClassName: 'git-added-gutter', minimap: { color: '#2ea04370', position: 1 } }`
  - Modified lines: `{ isWholeLine: true, linesDecorationsClassName: 'git-modified-gutter', minimap: { color: '#0078d470', position: 1 } }`
  - Deleted lines: `{ linesDecorationsClassName: 'git-deleted-gutter', minimap: { color: '#f8514970', position: 1 } }` (placed on the line after the deletion)

**CSS classes:**
```css
.git-added-gutter { border-left: 3px solid #2ea043; margin-left: 3px; }
.git-modified-gutter { border-left: 3px solid #0078d4; margin-left: 3px; }
.git-deleted-gutter { border-left: 3px solid transparent; position: relative; }
.git-deleted-gutter::before { /* red triangle indicator */ }
```

**Refresh triggers:**
- Editor mount
- After successful save (`handleSave` callback)
- Re-fetch via `git:diffLines` and re-apply decorations

### CodePanel Integration

Pass `projectPath` through to MonacoEditor from CodePanel (already available as a prop on CodePanel).

## Files to Modify

| File | Change |
|------|--------|
| `electron/services/git.ts` | Add `git:show`, `git:diffLines` handlers |
| `electron/preload.ts` | Expose `gitShow`, `gitDiffLines` |
| `src/components/CodePanel/DiffViewer.tsx` | Full rewrite: Monaco diff editor |
| `src/components/FileExplorer/MonacoEditor.tsx` | Add git gutter decorations, new `projectPath` prop |
| `src/components/CodePanel/CodePanel.tsx` | Pass `projectPath` to MonacoEditor |

## Out of Scope

- Inline diff peek (clicking a gutter decoration to see the old content)
- Git blame integration
- Change navigation (next/previous change keybindings)
- Diff for uncommitted changes in the regular editor (only HEAD comparison)
