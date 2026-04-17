# Git Sidebar Redesign

**Date:** 2026-04-17  
**Status:** Approved  
**Goal:** Make the git sidebar more robust — adding stash, merge conflict resolution, and rebase support, alongside UX improvements across error handling, file navigation, and branch management.

---

## Overview

The sidebar keeps its single-panel layout (VS Code style) but becomes context-aware: urgent states (conflicts, rebase in progress) float to the top, optional sections (stashes) collapse when empty, and new controls appear only when relevant. No tabs, no new mental model.

Implementation strategy: **extract focused sub-components first, then layer in new features**. This keeps each new piece isolated, testable, and easy to understand independently.

---

## Layout — Single Panel with Contextual Surfaces

The panel order from top to bottom:

1. **Header** — "Source Control" label + change count badge
2. **ConflictSection** — renders nothing when no conflicts; floats to top when conflicts exist
3. **RebaseInProgressBanner** (part of `RebaseControls.tsx`) — renders nothing when no rebase is in progress; shows banner when active
4. **FileSearch** — filter input (shown when ≥10 changed files, or Ctrl+F pressed)
5. **ChangedFiles (Staged)** — collapsible staged file list
6. **ChangedFiles (Unstaged)** — collapsible unstaged file list
7. **GitActivity** — AI commit history (existing, unchanged)
8. **CommitBox** — branch selector, stash/rebase/AI buttons, commit textarea, commit/push/pull

---

## Component Architecture

### New components (`src/components/Git/`)

| Component | Responsibility |
|---|---|
| `ConflictSection.tsx` | Conflict banner + per-file collapsible hunk viewer |
| `ConflictHunkViewer.tsx` | Single conflict hunk with navigation and resolution buttons |
| `StashMenu.tsx` | Dropdown: quick stash, stash with message, stash list with pop/apply/drop |
| `RebaseControls.tsx` | Two exports: `RebaseButton` (branch picker, mounts in CommitBox) and `RebaseInProgressBanner` (status banner, mounts in GitSidebar) |
| `FileSearch.tsx` | Controlled filter input that narrows the file lists |
| `InlineDiff.tsx` | Expandable compact diff for a single file inside the sidebar |

### Existing components — targeted changes only

- **`GitSidebar.tsx`** — mounts `ConflictSection` at top, `FileSearch` above file lists, wires new IPC state; no new logic of its own
- **`CommitBox.tsx`** — adds `StashMenu` and `RebaseControls` buttons to the branch row; disables commit/push/pull while rebase is in progress
- **`ChangedFiles.tsx`** — adds expand toggle per file row that renders `InlineDiff`; shows `+N -M` line count badge; shows ▶ expand arrow

### New IPC handlers (`electron/services/git.ts`)

| Channel | Description |
|---|---|
| `git:stashList` | Returns array of `{ index, message, date, fileCount }` |
| `git:stash` | Creates stash; accepts optional `{ message: string }` |
| `git:stashPop` | Pops stash by index |
| `git:stashApply` | Applies stash by index (leaves stash in list) |
| `git:stashDrop` | Drops stash by index |
| `git:rebase` | Runs `git rebase <branch>`; returns success or error |
| `git:rebaseAbort` | Runs `git rebase --abort` |
| `git:rebaseContinue` | Runs `git rebase --continue` |
| `git:rebaseSkip` | Runs `git rebase --skip` |
| `git:conflictFiles` | Returns list of files with conflict markers |
| `git:conflictHunks` | Parses a file and returns structured `ConflictHunk[]` |
| `git:resolveConflict` | Accepts `{ filepath, resolution: 'ours' \| 'theirs' \| 'both' }`, writes resolved file and stages it |
| `git:resolveAllConflicts` | Bulk resolve: accepts `{ resolution: 'ours' \| 'theirs' }`, applies to all conflicted files |

### New types (`src/types.ts`)

```typescript
interface ConflictHunk {
  index: number;        // hunk number within the file (0-based)
  ours: string[];       // lines from HEAD
  theirs: string[];     // lines from incoming branch
  oursLabel: string;    // e.g. "HEAD"
  theirsLabel: string;  // e.g. "feature/foo"
}

interface StashEntry {
  index: number;
  message: string;
  date: string;
  fileCount: number;
}
```

---

## Feature: Merge Conflict Resolution

### ConflictSection

- Renders nothing when `conflictFiles.length === 0`
- When conflicts exist: red left-bordered banner at top of panel with label "⚠ MERGE CONFLICTS — resolve before committing"
- Lists each conflicted file as a collapsible row showing filename + conflict count
- Bulk action buttons: **Accept All Ours** / **Accept All Theirs**
- Clicking a file row expands `ConflictHunkViewer` for that file; only one file expanded at a time

### ConflictHunkViewer

- Shows the currently active hunk for a file: raw conflict block with green (ours) / blue (theirs) highlighting, branch labels from git markers
- Resolution buttons per hunk: **✓ Ours** / **✓ Theirs** / **✓ Both** / **↗ Editor**
- Hunk navigation: "◀ prev" / "hunk N of M in file" / "next ▶"
- Accepting a hunk auto-advances to the next unresolved hunk in the file
- When all hunks in a file are resolved, the file row collapses and disappears from the list
- When all files are resolved, `ConflictSection` disappears entirely
- **↗ Editor** opens the file in the Monaco diff editor (calls existing `onFileClick`)

### Conflict state detection

- `gitStatus()` already returns file status; add detection for `UU` (unmerged both modified), `AA`, `DD` status codes
- `git:conflictFiles` is a dedicated call for the sidebar to get only conflicted files
- `git:conflictHunks` reads the file content, parses `<<<<<<<` / `=======` / `>>>>>>>` markers, returns structured hunks
- `git:resolveConflict` writes the resolved content (ours lines, theirs lines, or both) back to disk and runs `git add <filepath>`

---

## Feature: Stash

### StashMenu (dropdown in CommitBox footer)

- Button label: **≡ Stash ▾** — styled in purple, sits in branch row next to Rebase and AI sparkle
- Opens a popover dropdown with two sections:

**SAVE section:**
- **↓ Stash WIP** (quick) — runs `git stash` immediately, closes dropdown, refreshes
- **↓ Stash with message…** — shows an inline text input in the dropdown, Enter to confirm

**STASHES section:**
- Lists all stash entries: message, file count, relative date
- Per-entry actions: **Pop** (apply + remove), **Apply** (apply, keep in list), **Drop** (remove without applying)
- Empty state: "No stashes" greyed label

- Dropdown closes on Esc or click outside
- All stash operations refresh the sidebar on completion

---

## Feature: Rebase

### RebaseControls (button in CommitBox footer)

- Button label: **⟲ Rebase** — styled in yellow, sits in branch row
- Clicking opens a branch picker popover:
  - Title: "Rebase `<current-branch>` onto…"
  - Filterable branch list (same fuzzy search as branch selector)
  - **Rebase** confirm button / **Cancel**
  - Running `git:rebase` closes the picker

### Rebase in-progress banner (RebaseControls, in GitSidebar below header)

- Rendered when a `.git/rebase-merge` or `.git/rebase-apply` directory is detected (checked on each status poll via a new `git:rebaseStatus` IPC call)
- Target branch name read from `.git/rebase-merge/onto` (a commit SHA) resolved to a branch name, falling back to the SHA if no branch matches
- Yellow left-bordered banner: "⟲ REBASE IN PROGRESS — onto `<target>`"
- Subtitle: "Resolve conflicts above, then continue"
- Buttons: **Continue** / **Skip** / **Abort**
- While in progress: Commit, Push, Pull buttons in CommitBox are disabled

### Rebase + conflict integration

- If rebase produces conflicts, `ConflictSection` appears automatically on the next status poll
- After user resolves all conflicts, the **Continue** button becomes active
- Abort runs `git rebase --abort` and clears the in-progress state

---

## UX Improvements

### File search (`FileSearch.tsx`)

- Appears above the staged/unstaged sections when ≥10 changed files exist, or when Ctrl+F is pressed
- Placeholder: "Filter changed files… (Ctrl+F)"
- Fuzzy match on filename (not full path) — highlights matched characters in the file list
- Sections with zero matches are hidden entirely
- Match count shown in input: "3 matches"
- Esc clears the filter and returns focus to file list

### Inline diff peek (`InlineDiff.tsx`)

- Every file row in `ChangedFiles` gets a ▶ expand arrow on the left and a `+N -M` line count badge on the right
- Clicking ▶ expands an inline diff panel below the file row (calls `git:diff` for unstaged, `git:diff` with `--staged` for staged)
- Shows unified diff with standard green/red line highlighting, limited to first 50 lines with "… N more lines" if longer
- "↗ Open in editor" link at the bottom of the expanded diff opens the full Monaco diff editor
- Only one file expanded at a time (expanding a second collapses the first)

### Empty states

Three distinct states replacing the current generic "No changes" message:

| State | Icon | Message |
|---|---|---|
| Clean working tree | ✓ (green) | "No changes / Working tree is clean" |
| Not a git repository | ⊘ (grey) | "Not a git repo / Open a folder tracked by git" |
| Git error | ⚠ (red) | "Git unavailable / Could not run git status" + **Retry** button |

Detection: if `gitStatus()` throws with "not a git repository" message → "not a repo" state; other errors → "git error" state.

### Branch UX improvements

- **Fuzzy search** in branch dropdown — uses simple fuzzy match (characters in order, not just substring)
- **Remote branches** grouped under an `origin/` header, visually distinct from local branches
- **Ahead/behind counts** shown next to branch name in the selector: `⎇ main ↑2 ↓0`
- **Keyboard navigation** in dropdown: ↑↓ to move, Enter to checkout, Esc to close

### Keyboard navigation

| Key | Action |
|---|---|
| `Ctrl+F` | Focus file search input |
| `↑↓` | Navigate focused file list |
| `Space` | Stage/unstage focused file |
| `Enter` | Open diff for focused file |
| `Esc` | Close open dropdown, clear search, or collapse hunk viewer |

ARIA roles added to file list (`role="listbox"`, `role="option"`, `aria-selected`) and branch dropdown for screen reader support.

---

## Error Handling

- All new IPC operations return `{ success: boolean; error?: string }` — same pattern as existing git handlers
- Errors surface in the existing red error banner in CommitBox (already dismissible)
- Stash conflicts on pop/apply are surfaced as errors with the message "Stash apply produced conflicts — resolve them before continuing"
- Rebase errors (non-conflict) surface in the error banner; rebase in-progress state is detected independently via filesystem check

---

## Out of Scope

- Interactive rebase (pick/squash/reword/reorder)
- Cherry-pick
- Tag management
- Performance virtualization for large file/branch lists (separate future concern)
