# Diff Viewer Design Spec

## Overview

A tabbed code panel that replaces the chat+terminal area when users click dirty files in the git sidebar. Shows syntax-highlighted git diffs with a unified/split toggle. The sidebar remains fully interactive so users can click through multiple files without dismissing anything.

The component is designed to be reusable — in future iterations it will support text editing and richer git operations.

## Architecture

### Layout behavior

When `activeFile` is set in App state, `main-content` renders `CodePanel` instead of `ChatPanel + TerminalPanel`. No overlay, no darkening — a conditional swap. The git sidebar and navbar remain unchanged and interactive.

```
App.tsx
├── TitleBar
├── NavBar
├── GitSidebar
│   └── ChangedFiles — onClick calls onFileClick(file)
└── main-content (conditional)
    ├── if activeFile → CodePanel
    └── if !activeFile → ChatPanel + TerminalPanel
```

### New state in App.tsx

```ts
const [openFiles, setOpenFiles] = useState<OpenFile[]>([]);
const [activeFilePath, setActiveFilePath] = useState<string | null>(null);
```

Where `OpenFile` is:

```ts
interface OpenFile {
  file: GitFile;  // path, status, staged
  diffMode: 'unified' | 'split';
}
```

When all tabs are closed (`openFiles` becomes empty), `activeFilePath` resets to `null` and chat+terminal reappear.

### New components

#### CodePanel (`src/components/CodePanel/CodePanel.tsx`)

Responsibilities:
- Renders a tab bar showing all open files
- Active tab is visually highlighted
- Each tab has a close button (X); middle-click also closes
- Toolbar below tabs with unified/split toggle
- Renders `DiffViewer` for the active file
- Escape key closes the active tab

Props:
```ts
interface CodePanelProps {
  openFiles: OpenFile[];
  activeFilePath: string;
  projectPath: string;
  onActivate: (path: string) => void;
  onClose: (path: string) => void;
  onCloseAll: () => void;
  onDiffModeChange: (path: string, mode: 'unified' | 'split') => void;
}
```

#### DiffViewer (`src/components/CodePanel/DiffViewer.tsx`)

Responsibilities:
- Receives a file path, staged flag, and diff mode
- Calls `window.vsai.gitDiff(projectPath, filePath, staged)` to fetch raw diff
- Renders diff using `diff2html` library
- Handles loading and error states
- Applies dark theme CSS overrides to diff2html output

Props:
```ts
interface DiffViewerProps {
  projectPath: string;
  filePath: string;
  staged: boolean;
  mode: 'unified' | 'split';
}
```

### Backend changes

#### git.ts — new IPC handler

```ts
ipcMain.handle('git:diff', async (_event, cwd: string, filepath: string, staged: boolean) => {
  const git = simpleGit(cwd);
  const args = staged ? ['--cached', '--', filepath] : ['--', filepath];
  return await git.diff(args);
});
```

Context-aware behavior:
- **Staged files** (`staged: true`): shows diff between HEAD and index (`--cached`)
- **Unstaged files** (`staged: false`): shows diff between index and working tree

#### preload.ts — expose to renderer

```ts
gitDiff: (cwd: string, filepath: string, staged: boolean) =>
  ipcRenderer.invoke('git:diff', cwd, filepath, staged),
```

### ChangedFiles click handler

Currently `ChangedFiles` only has an `onAction` prop (stage/unstage button). We add a new `onFileClick` prop that fires when the file row itself is clicked (not the action button).

```ts
interface ChangedFilesProps {
  title: string;
  files: GitFile[];
  onAction: (file: GitFile) => void;
  actionLabel: string;
  onFileClick: (file: GitFile) => void;  // new
}
```

The file row gets `cursor: pointer` and calls `onFileClick` on click. The action button continues to call `onAction` with `stopPropagation`.

## Data flow

1. User clicks a file row in `ChangedFiles`
2. `onFileClick` fires, calling up to `App.tsx`
3. App adds file to `openFiles` (if not already open) and sets `activeFilePath`
4. `main-content` renders `CodePanel` instead of chat+terminal
5. `CodePanel` shows tab bar and renders `DiffViewer` for active file
6. `DiffViewer` calls `window.vsai.gitDiff(projectPath, path, staged)` on mount
7. Raw diff string is passed to `diff2html` for rendering
8. User can click another file in sidebar → new tab opens
9. User closes all tabs → `activeFilePath` becomes null → chat+terminal return

## Styling

- Tab bar: matches existing app style (dark bg, accent color for active tab border)
- diff2html: import its CSS and override with CSS custom properties to match `--bg-primary`, `--bg-secondary`, `--text`, `--border` etc.
- Diff colors: green for additions (`--green` / `#3fb950`), red for deletions (`--red` / `#f85149`), matching GitHub dark theme
- Unified/split toggle: small segmented control in the toolbar

## Dependencies

- `diff2html` (~40KB gzipped) — handles diff parsing + rendering for both unified and side-by-side views

## File structure

```
src/components/CodePanel/
├── CodePanel.tsx
└── DiffViewer.tsx
```

## Future extensibility

- `CodePanel` can render different content types based on a mode prop (diff, editor, preview)
- Tab state can be extended with dirty flags, language info, etc.
- The same panel can be used for file previews, search results, or any content that should replace the chat area
