# Command Palette Design Spec

**Date:** 2026-04-07
**Status:** Approved

## Overview

A keyboard-first command palette (`Ctrl+K` / `Cmd+K`) for SAI that provides fast file search, slash command execution, project-wide text search (grep), and session switching from a single unified overlay.

## Motivation

SAI currently has no search functionality. The only way to open a file is to navigate the file explorer tree. For projects with deep directory structures, this is slow. A command palette is the standard solution for keyboard-driven navigation in code editors.

## Keybinding

- **`Ctrl+K` / `Cmd+K`** — Toggle command palette open/closed
- **`Shift+Tab`** — Focus AI chat input in terminal mode (moved from `Ctrl+K`)

## Modes

The palette has four modes, each with its own data source and matching strategy:

| Mode | Prefix Trigger | Tab Label | Data Source | Matching |
|------|---------------|-----------|------------|----------|
| Files | *(default)* | Files | File index (client-side) | Fuzzy match |
| Commands | `>` | Commands | Slash commands array | Substring |
| Grep | `#` | Grep | IPC `fs:grep` call | Backend grep/ripgrep |
| Sessions | `@` | Sessions | `workspaceGetAll()` IPC | Substring |

Mode can be switched by:
- Typing the prefix character as the first character in the input
- Pressing `Tab` to cycle through modes
- Clicking a mode pill

When switching modes via `Tab` or click, the input text is preserved (minus any prefix character).

## Keyboard Handling

| Key | Action |
|-----|--------|
| `Ctrl+K` / `Cmd+K` | Toggle palette |
| `Escape` | Close palette |
| `Up` / `Down` | Navigate results |
| `Enter` | Execute selected result |
| `Tab` | Cycle mode (Files → Commands → Grep → Sessions → Files) |

## UI Layout

Centered overlay panel, 520px wide, positioned 48px from the top of the main content area. Dark semi-transparent backdrop (`rgba(0,0,0,0.5)` with `backdrop-filter: blur(2px)`).

### Sections (top to bottom)

1. **Input row** — Search icon (Lucide `Search`), text input, blinking cursor. Placeholder text changes per mode ("Search files...", "Run command...", "Search in files...", "Switch session...").

2. **Mode pills** — Horizontal row of pill buttons showing the four modes. Active mode highlighted with accent background tint. Each pill has a Lucide icon and label.

3. **Results list** — Scrollable list of results, max height ~320px. First result auto-selected. Each result row contains:
   - **Files mode:** File-type badge (colored by extension), filename with fuzzy match highlights in accent color, relative directory path in muted text
   - **Commands mode:** Command icon, command name, description
   - **Grep mode:** File-type badge, filename:line, matching text snippet with search term highlighted
   - **Sessions mode:** Status dot (active/suspended), project name, project path

4. **Footer** — Keyboard hint bar: `Tab` switch mode, `↑↓` navigate, `Enter` open, `Esc` close.

### Visual Design

- Background: `var(--bg-elevated)`
- Border: `1px solid var(--border)`, `border-radius: 10px`
- Shadow: `0 16px 48px rgba(0,0,0,0.5)`
- Input font: `'Geist', sans-serif`, 14px
- Result font: `'Geist', sans-serif`, 13px
- Path font: `'Geist Mono'`, 11px, `var(--text-muted)`
- Active result: `rgba(accent, 0.08)` background
- Fuzzy match highlight: accent color, bold
- File-type badges: 28x28px rounded squares with extension-colored background tint and label (TS, JS, PY, CSS, etc.)
- Entrance animation: `dropdown-in` keyframe (opacity + translateY)
- Backdrop animation: fade-in 0.15s

## Backend Changes

### `fs:walkFiles` (new IPC handler)

Recursively walks the project directory, respecting `.gitignore`, and returns a flat array of relative file paths.

**Signature:**
```typescript
// Request
{ rootPath: string }

// Response
string[]  // e.g. ["src/App.tsx", "src/styles/globals.css", ...]
```

**Implementation:**
- Use Node.js `fs.readdirSync` with recursive walk
- Respect `.gitignore` by shelling out to `git ls-files` (which already handles nested .gitignore files, submodules, etc.)
- Fallback to raw filesystem walk if not a git repo
- Exclude `node_modules`, `.git`, `dist`, `build` by default

### `fs:grep` (new IPC handler)

Searches file contents across the project using `grep` or `ripgrep`.

**Signature:**
```typescript
// Request
{ rootPath: string; query: string; maxResults?: number }

// Response
{ file: string; line: number; text: string }[]
```

**Implementation:**
- Try `rg` (ripgrep) first, fall back to `grep -rn`
- Respect `.gitignore` (ripgrep does this by default, grep needs `--exclude-dir`)
- Limit results to `maxResults` (default 50)
- Return relative paths

## Frontend Architecture

### File Index

- Built once at project load by calling `fs:walkFiles`
- Stored in `App.tsx` state as `string[]`
- Passed as prop to `CommandPalette`
- Refreshed when the file explorer detects changes (optional, not required for V1)

### Fuzzy Matching Algorithm

Simple character-by-character fuzzy match with scoring:

1. Iterate through query characters, finding each in the candidate string
2. Score bonuses for: consecutive matches, match at start of filename, match after separator (`/`, `.`, `-`, `_`)
3. Score penalty for: distance between matches, long paths
4. Sort results by score descending, cap at 50 results

No external dependency needed — this is ~40 lines of code.

### Grep Debouncing

Grep mode debounces input by 300ms before sending the IPC request. Shows a subtle loading indicator (Lucide `Loader2` spinning) while waiting for results.

### Component

Single file: `src/components/CommandPalette.tsx`

**Props:**
```typescript
interface CommandPaletteProps {
  open: boolean;
  onClose: () => void;
  fileIndex: string[];
  slashCommands: string[];
  workspaces: WorkspaceInfo[];
  projectPath: string;
  onFileOpen: (path: string, line?: number) => void;
  onCommand: (command: string) => void;
  onWorkspaceSwitch: (path: string) => void;
}
```

**State is internal:** active mode, query text, selected index, results array, loading state (for grep).

## Result Actions

| Mode | Enter Action |
|------|-------------|
| Files | Call `onFileOpen(absolutePath)` — opens file in editor |
| Commands | Call `onCommand(commandName)` — sends to chat input as slash command |
| Grep | Call `onFileOpen(absolutePath, lineNumber)` — opens file at line |
| Sessions | Call `onWorkspaceSwitch(projectPath)` — switches workspace |

## Scope Exclusions (not in V1)

- Recent files section / frecency sorting
- File preview pane
- Multi-select in results
- Custom user-defined commands
- Persistent search history
