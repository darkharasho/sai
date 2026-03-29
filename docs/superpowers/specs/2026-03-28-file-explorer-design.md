# File Explorer & Monaco Editor

## Summary

Add a file explorer sidebar and fullscreen Monaco editor modal to SAI. The file explorer appears as a new tab in the NavBar (above Git), rendering a VS Code-style recursive file tree. Clicking a file opens a fullscreen modal with a full Monaco editor instance. Right-click context menu supports file operations (create, rename, delete, copy path).

## Architecture

### New Components

**`src/components/FileExplorer/FileExplorerSidebar.tsx`**
- Renders in the sidebar slot (like GitSidebar) when `sidebarOpen === 'files'`
- Header: "Explorer" with project name
- Recursive file tree with Lucide icons:
  - `FolderOpen` / `Folder` for expanded/collapsed directories
  - `ChevronDown` / `ChevronRight` for expand/collapse arrows
  - `FileText` for generic files, `FileCode` for code files (ts, js, py, etc.)
- Tree state: `Map<string, { entries: DirEntry[], expanded: boolean }>` held in component state
- Lazy loading: expanding a folder triggers `fs:readDir` for that path
- Entries sorted: directories first (alphabetical), then files (alphabetical)
- Click file → calls `onFileOpen(absolutePath)` callback to App
- Right-click → shows context menu component
- Inline rename input for New File / New Folder / Rename operations

**`src/components/FileExplorer/EditorModal.tsx`**
- Reuses the modal overlay pattern from ToolCallCard's FullscreenModal (fixed position, backdrop blur, 90vw x 85vh, rounded corners, dark theme)
- Replaces Shiki read-only view with Monaco editor instance
- Header: file path, unsaved changes dot indicator, "Ctrl+S to save" hint, close button (X)
- Footer status bar: language name, cursor position (Ln/Col), encoding (UTF-8)
- Monaco configuration:
  - Theme: matches SAI dark theme (custom Monaco theme registered on mount)
  - Font: JetBrains Mono, 13px
  - Minimap enabled
  - Language auto-detected from file extension
- Ctrl+S → calls `fs:writeFile` via IPC, clears unsaved indicator
- Escape → closes modal (with unsaved changes confirmation if dirty)
- Monaco's `onDidChangeModelContent` tracks dirty state for the unsaved indicator

**`src/components/FileExplorer/ContextMenu.tsx`**
- Positioned absolutely at right-click coordinates
- Menu items:
  - Open (files only)
  - ---
  - New File...
  - New Folder...
  - ---
  - Rename...
  - Delete (red text, with confirmation dialog)
  - ---
  - Copy Path
  - Copy Relative Path
- Closes on click outside, Escape, or menu item selection
- Delete uses Electron native `dialog.showMessageBox` for confirmation

### Modified Components

**`src/components/NavBar.tsx`**
- Add `FolderClosed` icon button above the existing Git button
- Clicking toggles `sidebarOpen` to `'files'`
- Same active styling (accent color, left border)

**`src/App.tsx`**
- Render `FileExplorerSidebar` when `sidebarOpen === 'files'`
- New state: `editorModal: { path: string, content: string } | null`
- `handleFileOpen` callback: calls `fs:readFile`, sets `editorModal` state
- `EditorModal` rendered at top level (overlays everything)
- If a file open in the editor is deleted via context menu, close the modal

### Electron IPC Handlers

New handlers registered in a new `electron/services/fs.ts` service file (following the pattern of `pty.ts`, `claude.ts`, `git.ts`), called from `electron/main.ts` via `registerFsHandlers()`:

| Channel | Args | Returns | Description |
|---------|------|---------|-------------|
| `fs:readDir` | `dirPath: string` | `DirEntry[]` | List directory contents: `{ name, path, type: 'file' \| 'directory' }` |
| `fs:readFile` | `filePath: string` | `string` | Read file as UTF-8 text |
| `fs:writeFile` | `filePath, content` | `void` | Write content to file |
| `fs:rename` | `oldPath, newPath` | `void` | Rename file or directory |
| `fs:delete` | `targetPath` | `void` | Delete file or directory (recursive for dirs) |
| `fs:createFile` | `filePath` | `void` | Create empty file (mkdir -p for parent dirs) |
| `fs:createDir` | `dirPath` | `void` | Create directory (recursive) |

All handlers in `electron/preload.ts` exposed via `window.sai`.

### Types

```typescript
// In src/types.ts
interface DirEntry {
  name: string;
  path: string;
  type: 'file' | 'directory';
}
```

## Data Flow

### File Tree Loading
1. `FileExplorerSidebar` mounts → calls `window.sai.fsReadDir(projectPath)`
2. Receives `DirEntry[]` → renders top-level entries
3. User clicks folder → calls `fsReadDir(folder.path)` → stores in tree state map → renders children indented
4. Collapse folder → children hidden (state retained for instant re-expand)

### File Editing
1. User clicks file in tree → `onFileOpen(path)` → App calls `window.sai.fsReadFile(path)` → sets `editorModal` state
2. Monaco renders with content, language detected from file extension
3. User edits → Monaco fires `onDidChangeModelContent` → dirty flag set → dot appears in header
4. User presses Ctrl+S → App calls `window.sai.fsWriteFile(path, content)` → dirty flag cleared
5. User presses Escape or clicks X → if dirty, confirm dialog → modal closes → `editorModal` set to null

### Context Menu Operations
- **New File/Folder:** Inline input appears in tree → on Enter, calls `fsCreateFile`/`fsCreateDir` → refreshes parent directory
- **Rename:** Inline input replaces filename → on Enter, calls `fsRename` → refreshes parent directory
- **Delete:** Native Electron confirmation → calls `fsDelete` → refreshes parent directory, closes editor if file was open
- **Copy Path:** `navigator.clipboard.writeText(absolutePath)`
- **Copy Relative Path:** `navigator.clipboard.writeText(path.relative(projectPath, absolutePath))`

## Error Handling

- `fs:readDir` permission denied → inline "Permission denied" text in tree under that folder
- `fs:readFile` failure → modal doesn't open, no crash
- `fs:writeFile` failure → modal stays open, header shows "Save failed" text briefly
- `fs:delete` failure → native error dialog
- `fs:rename` / `fs:createFile` name collision → inline error below rename input

## Styling

- Inline CSS-in-JS (`<style>` blocks) matching existing project pattern
- CSS variables from `globals.css` (--bg-primary, --bg-secondary, --accent, --text, etc.)
- Lucide React icons throughout (no emoji, no custom SVGs)
- Monaco custom theme: background `#111418`, matching SAI's dark palette
- File tree row height: ~28px, hover background: `var(--bg-hover)`
- Context menu: `#1c2128` background, `var(--border)` borders, 6px border-radius

## Dependencies

- `monaco-editor` — new npm dependency (the Monaco Editor core)
- No other new dependencies
