# File Explorer & Monaco Editor Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a file explorer sidebar with a VS Code-style tree and a fullscreen Monaco editor modal to SAI.

**Architecture:** New NavBar button opens a FileExplorerSidebar (same slot as GitSidebar). Clicking files opens an EditorModal with a full Monaco editor. File operations go through new Electron IPC handlers in `electron/services/fs.ts`. Context menu supports create, rename, delete, copy path.

**Tech Stack:** React 19, TypeScript, Monaco Editor (`monaco-editor`), Electron IPC, Lucide React icons, Vite

---

## File Map

| Action | Path | Responsibility |
|--------|------|----------------|
| Create | `electron/services/fs.ts` | IPC handlers for filesystem operations |
| Modify | `electron/main.ts` | Register fs handlers |
| Modify | `electron/preload.ts` | Expose fs methods to renderer |
| Modify | `src/types.ts` | Add `DirEntry` type |
| Create | `src/components/FileExplorer/FileExplorerSidebar.tsx` | File tree sidebar |
| Create | `src/components/FileExplorer/ContextMenu.tsx` | Right-click context menu |
| Create | `src/components/FileExplorer/EditorModal.tsx` | Fullscreen Monaco editor modal |
| Modify | `src/components/NavBar.tsx` | Add folder icon button |
| Modify | `src/App.tsx` | Wire up sidebar, editor modal state |
| Modify | `vite.config.ts` | Monaco worker config |
| Modify | `package.json` | Add monaco-editor dependency |

---

### Task 1: Install Monaco and Configure Vite

**Files:**
- Modify: `package.json`
- Modify: `vite.config.ts`

- [ ] **Step 1: Install monaco-editor**

```bash
cd /var/home/mstephens/Documents/GitHub/sai && npm install monaco-editor
```

- [ ] **Step 2: Configure Vite for Monaco workers**

Monaco needs web workers for language services. Add the `vite-plugin-monaco-editor` or configure manually. The simplest approach for Electron+Vite is to import Monaco's ESM build and let Vite handle it. Modify `vite.config.ts`:

```typescript
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import electron from 'vite-plugin-electron';
import renderer from 'vite-plugin-electron-renderer';

export default defineConfig({
  plugins: [
    react(),
    electron([
      {
        entry: 'electron/main.ts',
        onstart(args) {
          args.startup();
        },
        vite: {
          build: {
            rollupOptions: {
              external: ['electron', 'node-pty', 'simple-git'],
            },
          },
        },
      },
      {
        entry: 'electron/preload.ts',
        onstart(args) {
          args.reload();
        },
      },
    ]),
    renderer(),
  ],
  optimizeDeps: {
    include: ['monaco-editor'],
  },
});
```

- [ ] **Step 3: Verify the app still builds**

```bash
cd /var/home/mstephens/Documents/GitHub/sai && npm run build
```

Expected: Build succeeds with no errors.

- [ ] **Step 4: Commit**

```bash
git add package.json package-lock.json vite.config.ts
git commit -m "feat: add monaco-editor dependency and vite config"
```

---

### Task 2: Electron Filesystem IPC Handlers

**Files:**
- Create: `electron/services/fs.ts`
- Modify: `electron/main.ts`
- Modify: `electron/preload.ts`
- Modify: `src/types.ts`

- [ ] **Step 1: Add DirEntry type**

Add to the bottom of `src/types.ts` (before the `declare global` block):

```typescript
export interface DirEntry {
  name: string;
  path: string;
  type: 'file' | 'directory';
}
```

- [ ] **Step 2: Create electron/services/fs.ts**

```typescript
import { ipcMain, dialog, BrowserWindow } from 'electron';
import fs from 'node:fs';
import path from 'node:path';

export function registerFsHandlers(mainWindow: BrowserWindow) {
  ipcMain.handle('fs:readDir', async (_event, dirPath: string) => {
    const entries = fs.readdirSync(dirPath, { withFileTypes: true });
    return entries
      .map(entry => ({
        name: entry.name,
        path: path.join(dirPath, entry.name),
        type: entry.isDirectory() ? 'directory' as const : 'file' as const,
      }))
      .sort((a, b) => {
        if (a.type !== b.type) return a.type === 'directory' ? -1 : 1;
        return a.name.localeCompare(b.name);
      });
  });

  ipcMain.handle('fs:readFile', async (_event, filePath: string) => {
    return fs.readFileSync(filePath, 'utf-8');
  });

  ipcMain.handle('fs:writeFile', async (_event, filePath: string, content: string) => {
    fs.writeFileSync(filePath, content, 'utf-8');
  });

  ipcMain.handle('fs:rename', async (_event, oldPath: string, newPath: string) => {
    fs.renameSync(oldPath, newPath);
  });

  ipcMain.handle('fs:delete', async (_event, targetPath: string) => {
    const result = await dialog.showMessageBox(mainWindow, {
      type: 'warning',
      buttons: ['Delete', 'Cancel'],
      defaultId: 1,
      title: 'Confirm Delete',
      message: `Delete "${path.basename(targetPath)}"?`,
      detail: 'This action cannot be undone.',
    });
    if (result.response === 0) {
      fs.rmSync(targetPath, { recursive: true, force: true });
      return true;
    }
    return false;
  });

  ipcMain.handle('fs:createFile', async (_event, filePath: string) => {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, '', 'utf-8');
  });

  ipcMain.handle('fs:createDir', async (_event, dirPath: string) => {
    fs.mkdirSync(dirPath, { recursive: true });
  });
}
```

- [ ] **Step 3: Register handlers in electron/main.ts**

Add import at top of `electron/main.ts`:

```typescript
import { registerFsHandlers } from './services/fs';
```

Add after the existing `registerGitHandlers()` call inside `createWindow()`:

```typescript
registerFsHandlers(mainWindow!);
```

- [ ] **Step 4: Expose in preload.ts**

Add these methods to the `contextBridge.exposeInMainWorld('sai', { ... })` object in `electron/preload.ts`:

```typescript
fsReadDir: (dirPath: string) => ipcRenderer.invoke('fs:readDir', dirPath),
fsReadFile: (filePath: string) => ipcRenderer.invoke('fs:readFile', filePath),
fsWriteFile: (filePath: string, content: string) => ipcRenderer.invoke('fs:writeFile', filePath, content),
fsRename: (oldPath: string, newPath: string) => ipcRenderer.invoke('fs:rename', oldPath, newPath),
fsDelete: (targetPath: string) => ipcRenderer.invoke('fs:delete', targetPath),
fsCreateFile: (filePath: string) => ipcRenderer.invoke('fs:createFile', filePath),
fsCreateDir: (dirPath: string) => ipcRenderer.invoke('fs:createDir', dirPath),
```

- [ ] **Step 5: Verify build**

```bash
cd /var/home/mstephens/Documents/GitHub/sai && npm run build
```

Expected: Build succeeds.

- [ ] **Step 6: Commit**

```bash
git add electron/services/fs.ts electron/main.ts electron/preload.ts src/types.ts
git commit -m "feat: add filesystem IPC handlers for file explorer"
```

---

### Task 3: NavBar — Add File Explorer Button

**Files:**
- Modify: `src/components/NavBar.tsx`

- [ ] **Step 1: Add FolderClosed icon and button**

Replace the entire `NavBar.tsx` with:

```typescript
import { FolderClosed, GitBranch } from 'lucide-react';

interface NavBarProps {
  activeSidebar: string | null;
  onToggle: (id: string) => void;
}

export default function NavBar({ activeSidebar, onToggle }: NavBarProps) {
  return (
    <div className="navbar">
      <button
        className={`nav-btn ${activeSidebar === 'files' ? 'active' : ''}`}
        onClick={() => onToggle('files')}
        title="Explorer"
      >
        <FolderClosed size={20} />
      </button>
      <button
        className={`nav-btn ${activeSidebar === 'git' ? 'active' : ''}`}
        onClick={() => onToggle('git')}
        title="Source Control"
      >
        <GitBranch size={20} />
      </button>
      <style>{`
        .navbar {
          width: var(--nav-width);
          background: var(--bg-secondary);
          display: flex;
          flex-direction: column;
          align-items: center;
          padding-top: 8px;
          gap: 4px;
          border-right: 1px solid var(--border);
          flex-shrink: 0;
        }
        .nav-btn {
          width: 40px;
          height: 40px;
          display: flex;
          align-items: center;
          justify-content: center;
          background: none;
          border: none;
          color: var(--text-secondary);
          cursor: pointer;
          border-radius: 6px;
        }
        .nav-btn:hover {
          color: var(--text);
          background: var(--bg-hover);
        }
        .nav-btn.active {
          color: var(--accent);
          border-left: 2px solid var(--accent);
          border-radius: 0 6px 6px 0;
        }
      `}</style>
    </div>
  );
}
```

- [ ] **Step 2: Verify the app runs and shows both buttons**

```bash
cd /var/home/mstephens/Documents/GitHub/sai && npm run dev
```

Expected: NavBar shows folder icon above git icon. Clicking folder icon does nothing yet (no sidebar wired up).

- [ ] **Step 3: Commit**

```bash
git add src/components/NavBar.tsx
git commit -m "feat: add file explorer button to navbar"
```

---

### Task 4: FileExplorerSidebar — File Tree Component

**Files:**
- Create: `src/components/FileExplorer/FileExplorerSidebar.tsx`

- [ ] **Step 1: Create the FileExplorerSidebar component**

Create `src/components/FileExplorer/FileExplorerSidebar.tsx`:

```typescript
import { useState, useEffect, useCallback, useRef } from 'react';
import { Folder, FolderOpen, FileText, FileCode2, ChevronRight, ChevronDown } from 'lucide-react';
import type { DirEntry } from '../../types';
import ContextMenu from './ContextMenu';

const CODE_EXTENSIONS = new Set([
  '.ts', '.tsx', '.js', '.jsx', '.py', '.rs', '.go', '.java',
  '.c', '.cpp', '.h', '.css', '.html', '.json', '.yaml', '.yml',
  '.toml', '.md', '.sh', '.bash', '.vue', '.svelte',
]);

function getFileIcon(name: string) {
  const ext = '.' + name.split('.').pop()?.toLowerCase();
  if (CODE_EXTENSIONS.has(ext)) return FileCode2;
  return FileText;
}

interface TreeState {
  entries: DirEntry[];
  expanded: boolean;
  loading: boolean;
  error: string | null;
}

interface FileExplorerSidebarProps {
  projectPath: string;
  onFileOpen: (filePath: string) => void;
}

interface InlineInput {
  parentPath: string;
  type: 'file' | 'directory';
  initialValue: string;
  renamePath?: string; // set when renaming
}

export default function FileExplorerSidebar({ projectPath, onFileOpen }: FileExplorerSidebarProps) {
  const [tree, setTree] = useState<Map<string, TreeState>>(new Map());
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; entry: DirEntry | null; parentPath: string } | null>(null);
  const [inlineInput, setInlineInput] = useState<InlineInput | null>(null);

  const loadDir = useCallback(async (dirPath: string) => {
    setTree(prev => {
      const next = new Map(prev);
      const existing = next.get(dirPath);
      next.set(dirPath, { entries: existing?.entries ?? [], expanded: true, loading: true, error: null });
      return next;
    });
    try {
      const entries = await window.sai.fsReadDir(dirPath) as DirEntry[];
      setTree(prev => {
        const next = new Map(prev);
        next.set(dirPath, { entries, expanded: true, loading: false, error: null });
        return next;
      });
    } catch (err: any) {
      setTree(prev => {
        const next = new Map(prev);
        next.set(dirPath, { entries: [], expanded: true, loading: false, error: err?.message ?? 'Permission denied' });
        return next;
      });
    }
  }, []);

  useEffect(() => {
    if (projectPath) {
      setTree(new Map());
      loadDir(projectPath);
    }
  }, [projectPath, loadDir]);

  const toggleDir = (dirPath: string) => {
    const state = tree.get(dirPath);
    if (state?.expanded) {
      setTree(prev => {
        const next = new Map(prev);
        next.set(dirPath, { ...state, expanded: false });
        return next;
      });
    } else if (state && state.entries.length > 0) {
      setTree(prev => {
        const next = new Map(prev);
        next.set(dirPath, { ...state, expanded: true });
        return next;
      });
    } else {
      loadDir(dirPath);
    }
  };

  const refreshDir = (dirPath: string) => {
    loadDir(dirPath);
  };

  const handleContextMenu = (e: React.MouseEvent, entry: DirEntry | null, parentPath: string) => {
    e.preventDefault();
    setContextMenu({ x: e.clientX, y: e.clientY, entry, parentPath });
  };

  const handleContextAction = async (action: string) => {
    if (!contextMenu) return;
    const { entry, parentPath } = contextMenu;
    setContextMenu(null);

    switch (action) {
      case 'open':
        if (entry && entry.type === 'file') onFileOpen(entry.path);
        break;
      case 'newFile':
        setInlineInput({ parentPath: entry?.type === 'directory' ? entry.path : parentPath, type: 'file', initialValue: '' });
        if (entry?.type === 'directory') {
          const state = tree.get(entry.path);
          if (!state?.expanded) loadDir(entry.path);
        }
        break;
      case 'newFolder':
        setInlineInput({ parentPath: entry?.type === 'directory' ? entry.path : parentPath, type: 'directory', initialValue: '' });
        if (entry?.type === 'directory') {
          const state = tree.get(entry.path);
          if (!state?.expanded) loadDir(entry.path);
        }
        break;
      case 'rename':
        if (entry) {
          setInlineInput({ parentPath, type: entry.type, initialValue: entry.name, renamePath: entry.path });
        }
        break;
      case 'delete':
        if (entry) {
          const deleted = await window.sai.fsDelete(entry.path);
          if (deleted) refreshDir(parentPath);
        }
        break;
      case 'copyPath':
        if (entry) navigator.clipboard.writeText(entry.path);
        break;
      case 'copyRelativePath':
        if (entry) {
          const rel = entry.path.startsWith(projectPath)
            ? entry.path.slice(projectPath.length + 1)
            : entry.name;
          navigator.clipboard.writeText(rel);
        }
        break;
    }
  };

  const handleInlineSubmit = async (value: string) => {
    if (!inlineInput || !value.trim()) {
      setInlineInput(null);
      return;
    }
    const { parentPath, type, renamePath } = inlineInput;
    setInlineInput(null);
    try {
      if (renamePath) {
        const newPath = renamePath.replace(/[^/]+$/, value.trim());
        await window.sai.fsRename(renamePath, newPath);
      } else if (type === 'file') {
        await window.sai.fsCreateFile(parentPath + '/' + value.trim());
      } else {
        await window.sai.fsCreateDir(parentPath + '/' + value.trim());
      }
      refreshDir(parentPath);
    } catch {
      // error handled silently — tree refresh will show current state
    }
  };

  const renderInlineInput = (parentPath: string) => {
    if (!inlineInput || inlineInput.parentPath !== parentPath || inlineInput.renamePath) return null;
    return <InlineNameInput initialValue={inlineInput.initialValue} onSubmit={handleInlineSubmit} onCancel={() => setInlineInput(null)} />;
  };

  const renderEntry = (entry: DirEntry, depth: number, parentPath: string) => {
    const isDir = entry.type === 'directory';
    const state = tree.get(entry.path);
    const isExpanded = state?.expanded ?? false;
    const isRenaming = inlineInput?.renamePath === entry.path;

    if (isDir) {
      return (
        <div key={entry.path}>
          <div
            className="tree-row"
            style={{ paddingLeft: depth * 16 + 8 }}
            onClick={() => toggleDir(entry.path)}
            onContextMenu={e => handleContextMenu(e, entry, parentPath)}
          >
            {isExpanded ? <ChevronDown size={14} className="tree-chevron" /> : <ChevronRight size={14} className="tree-chevron" />}
            {isExpanded ? <FolderOpen size={14} className="tree-icon folder" /> : <Folder size={14} className="tree-icon folder" />}
            {isRenaming ? (
              <InlineNameInput initialValue={inlineInput!.initialValue} onSubmit={handleInlineSubmit} onCancel={() => setInlineInput(null)} />
            ) : (
              <span className="tree-name">{entry.name}</span>
            )}
          </div>
          {isExpanded && state && (
            <>
              {state.loading && <div className="tree-row tree-loading" style={{ paddingLeft: (depth + 1) * 16 + 8 }}>Loading...</div>}
              {state.error && <div className="tree-row tree-error" style={{ paddingLeft: (depth + 1) * 16 + 8 }}>{state.error}</div>}
              {renderInlineInput(entry.path)}
              {state.entries.map(child => renderEntry(child, depth + 1, entry.path))}
            </>
          )}
        </div>
      );
    }

    const FileIcon = getFileIcon(entry.name);
    return (
      <div
        key={entry.path}
        className="tree-row"
        style={{ paddingLeft: depth * 16 + 8 }}
        onClick={() => onFileOpen(entry.path)}
        onContextMenu={e => handleContextMenu(e, entry, parentPath)}
      >
        <span style={{ width: 14, flexShrink: 0 }} />
        <FileIcon size={14} className="tree-icon file" />
        {isRenaming ? (
          <InlineNameInput initialValue={inlineInput!.initialValue} onSubmit={handleInlineSubmit} onCancel={() => setInlineInput(null)} />
        ) : (
          <span className="tree-name">{entry.name}</span>
        )}
      </div>
    );
  };

  const rootState = tree.get(projectPath);
  const projectName = projectPath.split('/').pop() ?? projectPath;

  return (
    <div
      style={{
        width: 'var(--sidebar-width)',
        minWidth: 'var(--sidebar-width)',
        background: 'var(--bg-secondary)',
        borderRight: '1px solid var(--border)',
        display: 'flex',
        flexDirection: 'column',
        overflow: 'hidden',
      }}
      onContextMenu={e => {
        if ((e.target as HTMLElement).closest('.tree-row')) return;
        handleContextMenu(e, null, projectPath);
      }}
    >
      <div
        style={{
          height: 36,
          display: 'flex',
          alignItems: 'center',
          padding: '0 12px',
          fontSize: 11,
          fontWeight: 600,
          textTransform: 'uppercase',
          letterSpacing: '0.5px',
          color: 'var(--text-muted)',
          borderBottom: '1px solid var(--border)',
          flexShrink: 0,
        }}
      >
        Explorer
      </div>

      <div
        style={{
          padding: '6px 0',
          fontSize: 11,
          fontWeight: 600,
          color: 'var(--text)',
          textTransform: 'uppercase',
          letterSpacing: '0.3px',
        }}
      >
        <div
          className="tree-row"
          style={{ paddingLeft: 8, fontWeight: 700, fontSize: 11, color: 'var(--text-secondary)' }}
          onContextMenu={e => handleContextMenu(e, null, projectPath)}
        >
          {projectName}
        </div>
      </div>

      <div style={{ flex: 1, overflowY: 'auto', fontSize: 13 }}>
        {renderInlineInput(projectPath)}
        {rootState?.entries.map(entry => renderEntry(entry, 0, projectPath))}
      </div>

      {contextMenu && (
        <ContextMenu
          x={contextMenu.x}
          y={contextMenu.y}
          entry={contextMenu.entry}
          onAction={handleContextAction}
          onClose={() => setContextMenu(null)}
        />
      )}

      <style>{`
        .tree-row {
          display: flex;
          align-items: center;
          gap: 6px;
          height: 28px;
          padding-right: 8px;
          cursor: pointer;
          color: var(--text-secondary);
          font-family: 'JetBrains Mono', 'Fira Code', monospace;
          font-size: 13px;
          white-space: nowrap;
          overflow: hidden;
        }
        .tree-row:hover {
          background: var(--bg-hover);
          color: var(--text);
        }
        .tree-chevron {
          color: var(--text-muted);
          flex-shrink: 0;
        }
        .tree-icon.folder {
          color: var(--accent);
          flex-shrink: 0;
        }
        .tree-icon.file {
          color: var(--text-muted);
          flex-shrink: 0;
        }
        .tree-name {
          overflow: hidden;
          text-overflow: ellipsis;
        }
        .tree-loading {
          color: var(--text-muted);
          font-style: italic;
          font-size: 11px;
        }
        .tree-error {
          color: var(--red);
          font-size: 11px;
        }
      `}</style>
    </div>
  );
}

function InlineNameInput({ initialValue, onSubmit, onCancel }: { initialValue: string; onSubmit: (v: string) => void; onCancel: () => void }) {
  const ref = useRef<HTMLInputElement>(null);
  const [value, setValue] = useState(initialValue);

  useEffect(() => {
    ref.current?.focus();
    ref.current?.select();
  }, []);

  return (
    <input
      ref={ref}
      value={value}
      onChange={e => setValue(e.target.value)}
      onKeyDown={e => {
        if (e.key === 'Enter') onSubmit(value);
        if (e.key === 'Escape') onCancel();
      }}
      onBlur={() => onCancel()}
      style={{
        flex: 1,
        background: 'var(--bg-input)',
        border: '1px solid var(--accent)',
        borderRadius: 3,
        color: 'var(--text)',
        fontSize: 13,
        fontFamily: "'JetBrains Mono', monospace",
        padding: '1px 6px',
        outline: 'none',
        height: 22,
      }}
    />
  );
}
```

- [ ] **Step 2: Verify the component compiles**

```bash
cd /var/home/mstephens/Documents/GitHub/sai && npx tsc --noEmit
```

Expected: No type errors (ContextMenu import will fail — that's Task 5).

- [ ] **Step 3: Commit**

```bash
git add src/components/FileExplorer/FileExplorerSidebar.tsx
git commit -m "feat: add file explorer sidebar with tree view"
```

---

### Task 5: ContextMenu Component

**Files:**
- Create: `src/components/FileExplorer/ContextMenu.tsx`

- [ ] **Step 1: Create ContextMenu component**

Create `src/components/FileExplorer/ContextMenu.tsx`:

```typescript
import { useEffect, useRef } from 'react';
import type { DirEntry } from '../../types';

interface ContextMenuProps {
  x: number;
  y: number;
  entry: DirEntry | null;
  onAction: (action: string) => void;
  onClose: () => void;
}

interface MenuItem {
  label: string;
  action: string;
  danger?: boolean;
  condition?: boolean;
}

export default function ContextMenu({ x, y, entry, onAction, onClose }: ContextMenuProps) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    };
    const keyHandler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('mousedown', handler);
    document.addEventListener('keydown', keyHandler);
    return () => {
      document.removeEventListener('mousedown', handler);
      document.removeEventListener('keydown', keyHandler);
    };
  }, [onClose]);

  // Adjust position to stay within viewport
  useEffect(() => {
    if (!ref.current) return;
    const rect = ref.current.getBoundingClientRect();
    if (rect.right > window.innerWidth) {
      ref.current.style.left = `${window.innerWidth - rect.width - 8}px`;
    }
    if (rect.bottom > window.innerHeight) {
      ref.current.style.top = `${window.innerHeight - rect.height - 8}px`;
    }
  }, []);

  const items: (MenuItem | 'separator')[] = [
    { label: 'Open', action: 'open', condition: entry?.type === 'file' },
    ...(entry?.type === 'file' ? ['separator' as const] : []),
    { label: 'New File...', action: 'newFile' },
    { label: 'New Folder...', action: 'newFolder' },
    'separator',
    { label: 'Rename...', action: 'rename', condition: entry !== null },
    { label: 'Delete', action: 'delete', danger: true, condition: entry !== null },
    'separator',
    { label: 'Copy Path', action: 'copyPath', condition: entry !== null },
    { label: 'Copy Relative Path', action: 'copyRelativePath', condition: entry !== null },
  ];

  const visibleItems = items.filter(item => {
    if (item === 'separator') return true;
    return item.condition !== false;
  });

  // Remove leading/trailing/double separators
  const cleaned: typeof visibleItems = [];
  for (let i = 0; i < visibleItems.length; i++) {
    const item = visibleItems[i];
    if (item === 'separator') {
      if (cleaned.length === 0) continue;
      if (cleaned[cleaned.length - 1] === 'separator') continue;
      if (i === visibleItems.length - 1) continue;
    }
    cleaned.push(item);
  }

  return (
    <div
      ref={ref}
      style={{
        position: 'fixed',
        left: x,
        top: y,
        background: '#1c2128',
        border: '1px solid var(--border)',
        borderRadius: 6,
        padding: '4px 0',
        minWidth: 180,
        boxShadow: '0 8px 24px rgba(0,0,0,0.4)',
        zIndex: 2000,
        fontFamily: "'JetBrains Mono', monospace",
        fontSize: 13,
      }}
    >
      {cleaned.map((item, i) => {
        if (item === 'separator') {
          return <div key={`sep-${i}`} style={{ height: 1, background: 'var(--border)', margin: '4px 0' }} />;
        }
        return (
          <div
            key={item.action}
            onClick={() => onAction(item.action)}
            style={{
              padding: '6px 16px',
              color: item.danger ? 'var(--red)' : 'var(--text)',
              cursor: 'pointer',
            }}
            onMouseEnter={e => (e.currentTarget.style.background = 'var(--bg-hover)')}
            onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
          >
            {item.label}
          </div>
        );
      })}
    </div>
  );
}
```

- [ ] **Step 2: Verify type check passes**

```bash
cd /var/home/mstephens/Documents/GitHub/sai && npx tsc --noEmit
```

Expected: No type errors related to FileExplorer components.

- [ ] **Step 3: Commit**

```bash
git add src/components/FileExplorer/ContextMenu.tsx
git commit -m "feat: add right-click context menu for file explorer"
```

---

### Task 6: EditorModal — Fullscreen Monaco Editor

**Files:**
- Create: `src/components/FileExplorer/EditorModal.tsx`

- [ ] **Step 1: Create EditorModal component**

Create `src/components/FileExplorer/EditorModal.tsx`:

```typescript
import { useEffect, useRef, useState, useCallback } from 'react';
import { X } from 'lucide-react';
import * as monaco from 'monaco-editor';

// Monaco environment setup for workers
self.MonacoEnvironment = {
  getWorker(_workerId: string, label: string) {
    const getWorkerModule = (moduleUrl: string, label: string) => {
      return new Worker(new URL(`monaco-editor/esm/vs/${moduleUrl}`, import.meta.url), {
        type: 'module',
        name: label,
      });
    };
    switch (label) {
      case 'json':
        return getWorkerModule('language/json/json.worker', label);
      case 'css':
      case 'scss':
      case 'less':
        return getWorkerModule('language/css/css.worker', label);
      case 'html':
      case 'handlebars':
      case 'razor':
        return getWorkerModule('language/html/html.worker', label);
      case 'typescript':
      case 'javascript':
        return getWorkerModule('language/typescript/ts.worker', label);
      default:
        return getWorkerModule('editor/editor.worker', label);
    }
  },
};

// Register SAI dark theme
monaco.editor.defineTheme('sai-dark', {
  base: 'vs-dark',
  inherit: true,
  rules: [],
  colors: {
    'editor.background': '#111418',
    'editor.foreground': '#bec6d0',
    'editorLineNumber.foreground': '#475262',
    'editorLineNumber.activeForeground': '#a0acbb',
    'editor.selectionBackground': '#21292f',
    'editor.lineHighlightBackground': '#161a1f',
    'editorWidget.background': '#0c0f11',
    'editorWidget.border': '#2a2e35',
    'input.background': '#161a1f',
    'input.border': '#2a2e35',
    'dropdown.background': '#1c2128',
    'list.hoverBackground': '#21292f',
    'minimap.background': '#0c0f11',
    'scrollbar.shadow': '#00000000',
    'editorOverviewRuler.border': '#00000000',
  },
});

const EXT_TO_LANG: Record<string, string> = {
  '.ts': 'typescript', '.tsx': 'typescript', '.js': 'javascript', '.jsx': 'javascript',
  '.json': 'json', '.html': 'html', '.css': 'css', '.scss': 'scss', '.less': 'less',
  '.md': 'markdown', '.py': 'python', '.rs': 'rust', '.go': 'go', '.java': 'java',
  '.c': 'c', '.cpp': 'cpp', '.h': 'c', '.yaml': 'yaml', '.yml': 'yaml',
  '.toml': 'ini', '.sh': 'shell', '.bash': 'shell', '.xml': 'xml', '.sql': 'sql',
  '.vue': 'html', '.svelte': 'html', '.graphql': 'graphql', '.gql': 'graphql',
};

function detectLanguage(filePath: string): string {
  const ext = '.' + filePath.split('.').pop()?.toLowerCase();
  return EXT_TO_LANG[ext] ?? 'plaintext';
}

interface EditorModalProps {
  filePath: string;
  content: string;
  onSave: (filePath: string, content: string) => Promise<void>;
  onClose: () => void;
}

export default function EditorModal({ filePath, content, onSave, onClose }: EditorModalProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const editorRef = useRef<monaco.editor.IStandaloneCodeEditor | null>(null);
  const [dirty, setDirty] = useState(false);
  const [saveError, setSaveError] = useState(false);
  const [cursorPosition, setCursorPosition] = useState({ line: 1, column: 1 });
  const language = detectLanguage(filePath);

  const handleSave = useCallback(async () => {
    if (!editorRef.current) return;
    const currentContent = editorRef.current.getValue();
    try {
      await onSave(filePath, currentContent);
      setDirty(false);
      setSaveError(false);
    } catch {
      setSaveError(true);
      setTimeout(() => setSaveError(false), 3000);
    }
  }, [filePath, onSave]);

  const handleClose = useCallback(() => {
    if (dirty) {
      if (!confirm('You have unsaved changes. Close anyway?')) return;
    }
    onClose();
  }, [dirty, onClose]);

  // Create editor on mount
  useEffect(() => {
    if (!containerRef.current) return;

    const editor = monaco.editor.create(containerRef.current, {
      value: content,
      language,
      theme: 'sai-dark',
      fontFamily: "'JetBrains Mono', 'Fira Code', 'Cascadia Code', monospace",
      fontSize: 13,
      lineHeight: 20,
      minimap: { enabled: true },
      scrollBeyondLastLine: false,
      automaticLayout: true,
      padding: { top: 8 },
      renderLineHighlight: 'line',
      cursorBlinking: 'smooth',
      smoothScrolling: true,
      bracketPairColorization: { enabled: true },
    });

    editorRef.current = editor;

    // Track dirty state
    editor.onDidChangeModelContent(() => {
      setDirty(true);
    });

    // Track cursor position
    editor.onDidChangeCursorPosition(e => {
      setCursorPosition({ line: e.position.lineNumber, column: e.position.column });
    });

    // Ctrl+S to save
    editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS, () => {
      handleSave();
    });

    // Focus editor
    editor.focus();

    return () => {
      editor.dispose();
    };
  }, []);  // Only run on mount

  // Escape to close (outside Monaco so it doesn't interfere with editor keybindings)
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      // Only handle Escape if focus is NOT inside the Monaco editor
      if (e.key === 'Escape' && !containerRef.current?.contains(document.activeElement)) {
        handleClose();
      }
    };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [handleClose]);

  const fileName = filePath.split('/').pop() ?? filePath;

  return (
    <div className="editor-modal-overlay" onClick={handleClose}>
      <div className="editor-modal-content" onClick={e => e.stopPropagation()}>
        {/* Header */}
        <div className="editor-modal-header">
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            {dirty && <span className="editor-dirty-dot" />}
            <span className="editor-modal-title">{filePath}</span>
            {saveError && <span style={{ color: 'var(--red)', fontSize: 11 }}>Save failed</span>}
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{ color: 'var(--text-muted)', fontSize: 11, padding: '3px 8px', border: '1px solid var(--border)', borderRadius: 4 }}>
              Ctrl+S to save
            </span>
            <button className="editor-modal-close" onClick={handleClose}><X size={18} /></button>
          </div>
        </div>

        {/* Monaco Editor Container */}
        <div ref={containerRef} style={{ flex: 1, overflow: 'hidden' }} />

        {/* Status Bar */}
        <div className="editor-modal-statusbar">
          <span>{language}</span>
          <span>Ln {cursorPosition.line}, Col {cursorPosition.column}</span>
          <span>UTF-8</span>
        </div>
      </div>

      <style>{`
        .editor-modal-overlay {
          position: fixed;
          inset: 0;
          background: rgba(0,0,0,0.7);
          display: flex;
          align-items: center;
          justify-content: center;
          z-index: 1000;
          backdrop-filter: blur(2px);
        }
        .editor-modal-content {
          background: var(--bg-primary);
          border: 1px solid var(--border);
          border-radius: 10px;
          width: 90vw;
          height: 85vh;
          display: flex;
          flex-direction: column;
          overflow: hidden;
          box-shadow: 0 16px 48px rgba(0,0,0,0.5);
        }
        .editor-modal-header {
          display: flex;
          align-items: center;
          justify-content: space-between;
          padding: 8px 16px;
          border-bottom: 1px solid var(--border);
          flex-shrink: 0;
        }
        .editor-modal-title {
          font-family: 'JetBrains Mono', monospace;
          font-size: 13px;
          color: var(--text);
        }
        .editor-dirty-dot {
          width: 8px;
          height: 8px;
          border-radius: 50%;
          background: var(--accent);
          flex-shrink: 0;
        }
        .editor-modal-close {
          background: none;
          border: none;
          color: var(--text-muted);
          cursor: pointer;
          padding: 4px;
          border-radius: 4px;
          display: flex;
        }
        .editor-modal-close:hover {
          color: var(--text);
          background: var(--bg-hover);
        }
        .editor-modal-statusbar {
          display: flex;
          align-items: center;
          justify-content: space-between;
          padding: 4px 16px;
          border-top: 1px solid var(--border);
          font-family: 'JetBrains Mono', monospace;
          font-size: 11px;
          color: var(--text-muted);
          flex-shrink: 0;
        }
      `}</style>
    </div>
  );
}
```

- [ ] **Step 2: Verify type check passes**

```bash
cd /var/home/mstephens/Documents/GitHub/sai && npx tsc --noEmit
```

Expected: No type errors. Monaco types should be available from the installed package.

- [ ] **Step 3: Commit**

```bash
git add src/components/FileExplorer/EditorModal.tsx
git commit -m "feat: add fullscreen Monaco editor modal"
```

---

### Task 7: Wire Everything Up in App.tsx

**Files:**
- Modify: `src/App.tsx`

- [ ] **Step 1: Add imports, state, and handlers**

Add the new imports at the top of `App.tsx`:

```typescript
import FileExplorerSidebar from './components/FileExplorer/FileExplorerSidebar';
import EditorModal from './components/FileExplorer/EditorModal';
```

Add new state after the `activeFilePath` state declaration:

```typescript
const [editorModal, setEditorModal] = useState<{ path: string; content: string } | null>(null);
```

Add the file open handler after the existing `handleDiffModeChange`:

```typescript
const handleFileOpen = useCallback(async (filePath: string) => {
  try {
    const content = await window.sai.fsReadFile(filePath) as string;
    setEditorModal({ path: filePath, content });
  } catch {
    // File couldn't be read (binary, permissions, etc.)
  }
}, []);

const handleEditorSave = useCallback(async (filePath: string, content: string) => {
  await window.sai.fsWriteFile(filePath, content);
}, []);
```

- [ ] **Step 2: Add FileExplorerSidebar and EditorModal to the render**

In the return JSX, add the sidebar render right after the git sidebar line:

```typescript
{sidebarOpen === 'files' && <FileExplorerSidebar projectPath={projectPath} onFileOpen={handleFileOpen} />}
```

Add the EditorModal render at the very end, just before the closing `</div>` of the `app` div:

```typescript
{editorModal && (
  <EditorModal
    filePath={editorModal.path}
    content={editorModal.content}
    onSave={handleEditorSave}
    onClose={() => setEditorModal(null)}
  />
)}
```

- [ ] **Step 3: Full updated App.tsx should look like:**

```typescript
import { useState, useCallback, useEffect } from 'react';
import NavBar from './components/NavBar';
import ChatPanel from './components/Chat/ChatPanel';
import TerminalPanel from './components/Terminal/TerminalPanel';
import GitSidebar from './components/Git/GitSidebar';
import FileExplorerSidebar from './components/FileExplorer/FileExplorerSidebar';
import EditorModal from './components/FileExplorer/EditorModal';
import TitleBar from './components/TitleBar';
import CodePanel from './components/CodePanel/CodePanel';
import { loadSessions, saveSessions, createSession, upsertSession } from './sessions';
import type { ChatSession, ChatMessage, GitFile, OpenFile } from './types';

type PermissionMode = 'default' | 'bypass';

function getStoredPermission(): PermissionMode {
  try {
    const v = localStorage.getItem('sai-permission-mode');
    return v === 'bypass' ? 'bypass' : 'default';
  } catch {
    return 'default';
  }
}

export default function App() {
  const [sidebarOpen, setSidebarOpen] = useState<string | null>(null);
  const [projectPath, setProjectPath] = useState<string>('');
  const [permissionMode, setPermissionMode] = useState<PermissionMode>(getStoredPermission);

  const [sessions, setSessions] = useState<ChatSession[]>(loadSessions);
  const [activeSession, setActiveSession] = useState<ChatSession>(createSession);

  useEffect(() => {
    window.sai.getRecentProjects().then((projects: string[]) => {
      if (projects.length > 0 && !projectPath) {
        setProjectPath(projects[0]);
      }
    });
  }, []);

  const [openFiles, setOpenFiles] = useState<OpenFile[]>([]);
  const [activeFilePath, setActiveFilePath] = useState<string | null>(null);
  const [editorModal, setEditorModal] = useState<{ path: string; content: string } | null>(null);

  const handleFileClick = useCallback((file: GitFile) => {
    setOpenFiles(prev => {
      const exists = prev.some(f => f.file.path === file.path);
      if (exists) return prev;
      return [...prev, { file, diffMode: 'unified' }];
    });
    setActiveFilePath(file.path);
  }, []);

  const handleFileClose = useCallback((path: string) => {
    setOpenFiles(prev => {
      const next = prev.filter(f => f.file.path !== path);
      if (next.length === 0) {
        setActiveFilePath(null);
      } else if (path === activeFilePath) {
        const idx = prev.findIndex(f => f.file.path === path);
        const newActive = next[Math.min(idx, next.length - 1)];
        setActiveFilePath(newActive.file.path);
      }
      return next;
    });
  }, [activeFilePath]);

  const handleCloseAllFiles = useCallback(() => {
    setOpenFiles([]);
    setActiveFilePath(null);
  }, []);

  const handleDiffModeChange = useCallback((path: string, mode: 'unified' | 'split') => {
    setOpenFiles(prev =>
      prev.map(f => f.file.path === path ? { ...f, diffMode: mode } : f)
    );
  }, []);

  const handleFileOpen = useCallback(async (filePath: string) => {
    try {
      const content = await window.sai.fsReadFile(filePath) as string;
      setEditorModal({ path: filePath, content });
    } catch {
      // File couldn't be read (binary, permissions, etc.)
    }
  }, []);

  const handleEditorSave = useCallback(async (filePath: string, content: string) => {
    await window.sai.fsWriteFile(filePath, content);
  }, []);

  const persistSession = useCallback((session: ChatSession) => {
    setSessions(prev => {
      const updated = upsertSession(prev, session);
      saveSessions(updated);
      return updated;
    });
  }, []);

  const toggleSidebar = (id: string) => {
    setSidebarOpen(prev => prev === id ? null : id);
  };

  const handleNewChat = () => {
    persistSession(activeSession);
    setActiveSession(createSession());
  };

  const handleSelectSession = (id: string) => {
    persistSession(activeSession);
    const selected = sessions.find(s => s.id === id);
    if (selected) {
      setActiveSession({ ...selected });
    }
  };

  const handleMessagesChange = useCallback((messages: ChatMessage[]) => {
    setActiveSession(prev => {
      const updated = { ...prev, messages, updatedAt: Date.now() };
      if (!updated.title) {
        const firstUserMsg = messages.find(m => m.role === 'user');
        if (firstUserMsg) {
          updated.title = firstUserMsg.content.slice(0, 40);
        }
      }
      return updated;
    });
  }, []);

  const handleSessionSave = useCallback(() => {
    setActiveSession(prev => {
      if (prev.messages.length > 0) {
        persistSession(prev);
      }
      return prev;
    });
  }, [persistSession]);

  const handlePermissionChange = (mode: PermissionMode) => {
    setPermissionMode(mode);
    localStorage.setItem('sai-permission-mode', mode);
  };

  return (
    <div className="app">
      <TitleBar
        projectPath={projectPath}
        onProjectChange={setProjectPath}
        onNewChat={handleNewChat}
        sessions={sessions}
        activeSessionId={activeSession.id}
        onSelectSession={handleSelectSession}
      />
      <div className="app-body">
        <NavBar activeSidebar={sidebarOpen} onToggle={toggleSidebar} />
        {sidebarOpen === 'files' && <FileExplorerSidebar projectPath={projectPath} onFileOpen={handleFileOpen} />}
        {sidebarOpen === 'git' && <GitSidebar projectPath={projectPath} onFileClick={handleFileClick} />}
        <div className="main-content">
          {activeFilePath ? (
            <CodePanel
              openFiles={openFiles}
              activeFilePath={activeFilePath}
              projectPath={projectPath}
              onActivate={setActiveFilePath}
              onClose={handleFileClose}
              onCloseAll={handleCloseAllFiles}
              onDiffModeChange={handleDiffModeChange}
            />
          ) : (
            <>
              <ChatPanel
                key={activeSession.id}
                projectPath={projectPath}
                permissionMode={permissionMode}
                onPermissionChange={handlePermissionChange}
                initialMessages={activeSession.messages}
                onMessagesChange={handleMessagesChange}
                onTurnComplete={handleSessionSave}
              />
              <TerminalPanel projectPath={projectPath} />
            </>
          )}
        </div>
      </div>
      {editorModal && (
        <EditorModal
          filePath={editorModal.path}
          content={editorModal.content}
          onSave={handleEditorSave}
          onClose={() => setEditorModal(null)}
        />
      )}
    </div>
  );
}
```

- [ ] **Step 4: Verify build**

```bash
cd /var/home/mstephens/Documents/GitHub/sai && npm run build
```

Expected: Build succeeds.

- [ ] **Step 5: Commit**

```bash
git add src/App.tsx
git commit -m "feat: wire up file explorer sidebar and editor modal in app"
```

---

### Task 8: Manual Verification

- [ ] **Step 1: Start the dev server**

```bash
cd /var/home/mstephens/Documents/GitHub/sai && npm run dev
```

- [ ] **Step 2: Verify NavBar buttons**

Expected: Folder icon appears above Git icon in the left navbar. Clicking folder icon opens file explorer sidebar. Clicking git icon opens git sidebar. Clicking same icon again closes the sidebar.

- [ ] **Step 3: Verify file tree**

Expected: File tree loads showing the project directory. Folders show Lucide `Folder`/`FolderOpen` icons with accent color. Files show `FileText`/`FileCode2` icons. Clicking folders expands/collapses with `ChevronDown`/`ChevronRight` arrows. Directories sorted first, then files, both alphabetical.

- [ ] **Step 4: Verify Monaco editor modal**

Expected: Clicking a file opens fullscreen modal with Monaco editor. Correct syntax highlighting for the file type. Line numbers, minimap, cursor position in status bar. SAI dark theme applied (dark background matching the app).

- [ ] **Step 5: Verify save**

Expected: Edit a file in the editor. Dirty dot appears in header. Press Ctrl+S. Dot disappears. Close and reopen the file — changes persisted.

- [ ] **Step 6: Verify context menu**

Expected: Right-click a file → context menu with Open, New File, New Folder, Rename, Delete, Copy Path, Copy Relative Path. Right-click a folder → same menu minus Open. New File → inline input appears, type name, press Enter → file created. Rename → inline input with current name, change it, Enter → file renamed. Delete → native confirmation dialog → file removed from tree.

- [ ] **Step 7: Verify edge cases**

Expected: Right-clicking empty space in the sidebar shows New File/New Folder only. Deleting a file that's open in the editor closes the modal. Permission-denied folders show error text.
