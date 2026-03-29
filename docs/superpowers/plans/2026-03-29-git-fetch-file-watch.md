# Git Fetch & External File Change Detection Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Periodically fetch from git remote so the pull button stays current, and detect when open editor files are modified on disk externally (e.g., by Claude tools), auto-reloading clean files and prompting for dirty ones.

**Architecture:** Pure polling — a 60s `setInterval` calls `git fetch`, and a 5s `setInterval` compares open file mtimes to `diskMtime` recorded at open/save time. A banner in `CodePanel` handles the dirty-file prompt. No new libraries needed.

**Tech Stack:** Electron IPC (`ipcMain.handle`), `simple-git`, Node `fs.stat`, React `useState`/`useEffect`/`useRef`

---

## File Map

| File | Change |
|------|--------|
| `electron/services/git.ts` | Add `git:fetch` IPC handler |
| `electron/services/fs.ts` | Add `fs:mtime` IPC handler |
| `electron/preload.ts` | Expose `gitFetch` and `fsMtime` on `window.sai` |
| `src/types.ts` | Add `diskMtime?: number` to `OpenFile` |
| `src/App.tsx` | Add fetch interval, mtime poll, `externallyModified` state, reload/keep handlers, pass new props to `CodePanel` |
| `src/components/CodePanel/CodePanel.tsx` | Accept new props and render external-change banner |

---

## Task 1: Add `git:fetch` IPC handler and preload binding

**Files:**
- Modify: `electron/services/git.ts`
- Modify: `electron/preload.ts`

- [ ] **Step 1: Add `git:fetch` handler to `electron/services/git.ts`**

  Add after the closing brace of the `git:pull` handler (after line 38):

  ```typescript
  ipcMain.handle('git:fetch', async (_event, cwd: string) => {
    await simpleGit(cwd).fetch();
  });
  ```

- [ ] **Step 2: Expose `gitFetch` in `electron/preload.ts`**

  Add after the `gitPull` line (after line 26):

  ```typescript
  gitFetch: (cwd: string) => ipcRenderer.invoke('git:fetch', cwd),
  ```

- [ ] **Step 3: Verify it compiles**

  ```bash
  cd /var/home/mstephens/Documents/GitHub/sai && npm run build 2>&1 | tail -20
  ```

  Expected: no TypeScript errors

- [ ] **Step 4: Commit**

  ```bash
  git add electron/services/git.ts electron/preload.ts
  git commit -m "feat: add git:fetch IPC handler and preload binding"
  ```

---

## Task 2: Add `fs:mtime` IPC handler and preload binding

**Files:**
- Modify: `electron/services/fs.ts`
- Modify: `electron/preload.ts`

- [ ] **Step 1: Add `fs:mtime` handler to `electron/services/fs.ts`**

  Add inside `registerFsHandlers`, after the `fs:readFile` handler (after line 23):

  ```typescript
  ipcMain.handle('fs:mtime', async (_event, filePath: string) => {
    const stat = await fs.promises.stat(filePath);
    return { mtime: stat.mtimeMs };
  });
  ```

- [ ] **Step 2: Expose `fsMtime` in `electron/preload.ts`**

  Add after the `fsReadFile` line (after line 34):

  ```typescript
  fsMtime: (filePath: string) => ipcRenderer.invoke('fs:mtime', filePath),
  ```

- [ ] **Step 3: Verify it compiles**

  ```bash
  cd /var/home/mstephens/Documents/GitHub/sai && npm run build 2>&1 | tail -20
  ```

  Expected: no TypeScript errors

- [ ] **Step 4: Commit**

  ```bash
  git add electron/services/fs.ts electron/preload.ts
  git commit -m "feat: add fs:mtime IPC handler and preload binding"
  ```

---

## Task 3: Add `diskMtime` to `OpenFile` and record it on open/save

**Files:**
- Modify: `src/types.ts` (line 42 — add field to `OpenFile`)
- Modify: `src/App.tsx` (lines 245–266 `handleFileOpen`, lines 342–350 `handleEditorSave`)

- [ ] **Step 1: Add `diskMtime` to `OpenFile` in `src/types.ts`**

  Replace the `OpenFile` interface (lines 32–42) with:

  ```typescript
  export interface OpenFile {
    path: string;
    viewMode: 'diff' | 'editor';
    // diff mode fields
    file?: GitFile;
    diffMode?: 'unified' | 'split';
    // editor mode fields
    content?: string;
    savedContent?: string;
    isDirty?: boolean;
    diskMtime?: number;
  }
  ```

- [ ] **Step 2: Record `diskMtime` when opening a file in `handleFileOpen` (`src/App.tsx` lines 245–266)**

  Replace the `handleFileOpen` callback with:

  ```typescript
  const handleFileOpen = useCallback(async (filePath: string) => {
    if (!activeProjectPath) return;
    try {
      const [content, { mtime }] = await Promise.all([
        window.sai.fsReadFile(filePath) as Promise<string>,
        window.sai.fsMtime(filePath) as Promise<{ mtime: number }>,
      ]);
      updateWorkspace(activeProjectPath, ws => {
        const exists = ws.openFiles.some(f => f.path === filePath);
        return {
          ...ws,
          openFiles: exists ? ws.openFiles : [...ws.openFiles, { path: filePath, viewMode: 'editor', content, savedContent: content, diskMtime: mtime }],
          activeFilePath: filePath,
        };
      });
      setExpanded(prev => {
        if (prev.includes('editor')) return prev;
        const next = [...prev, 'editor' as PanelId];
        setSplitRatio(0.66);
        return next.length > 2 ? next.slice(1) : next;
      });
    } catch {
      // File couldn't be read
    }
  }, [activeProjectPath, updateWorkspace]);
  ```

- [ ] **Step 3: Update `diskMtime` after saving in `handleEditorSave` (`src/App.tsx` lines 342–350)**

  Replace the `handleEditorSave` callback with:

  ```typescript
  const handleEditorSave = useCallback(async (filePath: string, content: string) => {
    await window.sai.fsWriteFile(filePath, content);
    const { mtime } = await window.sai.fsMtime(filePath) as { mtime: number };
    if (activeProjectPath) {
      updateWorkspace(activeProjectPath, ws => ({
        ...ws,
        openFiles: ws.openFiles.map(f => f.path === filePath ? { ...f, savedContent: content, isDirty: false, diskMtime: mtime } : f),
      }));
    }
  }, [activeProjectPath, updateWorkspace]);
  ```

- [ ] **Step 4: Verify it compiles**

  ```bash
  cd /var/home/mstephens/Documents/GitHub/sai && npm run build 2>&1 | tail -20
  ```

  Expected: no TypeScript errors

- [ ] **Step 5: Commit**

  ```bash
  git add src/types.ts src/App.tsx
  git commit -m "feat: record diskMtime on file open and save"
  ```

---

## Task 4: Add periodic `git fetch` interval in `App.tsx`

**Files:**
- Modify: `src/App.tsx` (add a `useEffect` after the existing git status poll, ~line 122)

- [ ] **Step 1: Add the 60s fetch interval**

  Add the following `useEffect` directly after the closing brace of the git status `useEffect` (after line 122):

  ```typescript
  useEffect(() => {
    if (!projectPath) return;
    const id = setInterval(() => {
      (window.sai.gitFetch(projectPath) as Promise<void>).catch(() => {});
    }, 60000);
    return () => clearInterval(id);
  }, [projectPath]);
  ```

- [ ] **Step 2: Verify it compiles**

  ```bash
  cd /var/home/mstephens/Documents/GitHub/sai && npm run build 2>&1 | tail -20
  ```

  Expected: no TypeScript errors

- [ ] **Step 3: Manually verify fetch runs**

  Start the app in dev mode (`npm run dev`) with a project that has a remote, wait 60s, and confirm the pull button's behind count updates without a manual pull.

- [ ] **Step 4: Commit**

  ```bash
  git add src/App.tsx
  git commit -m "feat: add 60s background git fetch interval"
  ```

---

## Task 5: Add file mtime polling and `externallyModified` state in `App.tsx`

**Files:**
- Modify: `src/App.tsx`

- [ ] **Step 1: Add `externallyModified` state and `workspacesRef`**

  Add these two declarations directly below the `wsMessagesRef` line (~line 29):

  ```typescript
  const [externallyModified, setExternallyModified] = useState<Set<string>>(new Set());
  const workspacesRef = useRef(workspaces);
  ```

  Then add a sync effect directly below those declarations:

  ```typescript
  useEffect(() => { workspacesRef.current = workspaces; }, [workspaces]);
  ```

- [ ] **Step 2: Clear `externallyModified` on project switch**

  Add a `useEffect` directly after the `workspacesRef` sync effect:

  ```typescript
  useEffect(() => {
    setExternallyModified(new Set());
  }, [activeProjectPath]);
  ```

- [ ] **Step 3: Add the 5s mtime polling interval**

  Add the following `useEffect` after the 60s git fetch interval added in Task 4:

  ```typescript
  useEffect(() => {
    if (!projectPath) return;
    const id = setInterval(async () => {
      const ws = workspacesRef.current.get(projectPath);
      if (!ws) return;
      const editorFiles = ws.openFiles.filter(
        f => f.viewMode === 'editor' && f.diskMtime !== undefined
      );
      for (const file of editorFiles) {
        try {
          const { mtime } = await (window.sai.fsMtime(file.path) as Promise<{ mtime: number }>);
          if (mtime <= file.diskMtime!) continue;
          if (!file.isDirty) {
            const content = await (window.sai.fsReadFile(file.path) as Promise<string>);
            updateWorkspace(projectPath, w => ({
              ...w,
              openFiles: w.openFiles.map(f =>
                f.path === file.path
                  ? { ...f, content, savedContent: content, isDirty: false, diskMtime: mtime }
                  : f
              ),
            }));
          } else {
            setExternallyModified(prev => {
              if (prev.has(file.path)) return prev;
              return new Set([...prev, file.path]);
            });
          }
        } catch {
          // File may have been deleted or moved; ignore
        }
      }
    }, 5000);
    return () => clearInterval(id);
  }, [projectPath, updateWorkspace]);
  ```

- [ ] **Step 4: Add `handleReloadFile` and `handleKeepMyEdits` callbacks**

  Add these two callbacks after `handleEditorDirtyChange` (~line 366):

  ```typescript
  const handleReloadFile = useCallback(async (filePath: string) => {
    if (!activeProjectPath) return;
    try {
      const [content, { mtime }] = await Promise.all([
        window.sai.fsReadFile(filePath) as Promise<string>,
        window.sai.fsMtime(filePath) as Promise<{ mtime: number }>,
      ]);
      updateWorkspace(activeProjectPath, ws => ({
        ...ws,
        openFiles: ws.openFiles.map(f =>
          f.path === filePath
            ? { ...f, content, savedContent: content, isDirty: false, diskMtime: mtime }
            : f
        ),
      }));
    } catch { }
    setExternallyModified(prev => {
      const next = new Set(prev);
      next.delete(filePath);
      return next;
    });
  }, [activeProjectPath, updateWorkspace]);

  const handleKeepMyEdits = useCallback(async (filePath: string) => {
    try {
      const { mtime } = await (window.sai.fsMtime(filePath) as Promise<{ mtime: number }>);
      updateWorkspace(activeProjectPath, ws => ({
        ...ws,
        openFiles: ws.openFiles.map(f =>
          f.path === filePath ? { ...f, diskMtime: mtime } : f
        ),
      }));
    } catch { }
    setExternallyModified(prev => {
      const next = new Set(prev);
      next.delete(filePath);
      return next;
    });
  }, [activeProjectPath, updateWorkspace]);
  ```

- [ ] **Step 5: Pass new props to `CodePanel` in the `renderPanel` function (~line 572)**

  Replace the `<CodePanel ... />` JSX with:

  ```tsx
  <CodePanel
    openFiles={openFiles}
    activeFilePath={activeFilePath}
    projectPath={projectPath}
    externallyModified={externallyModified}
    onActivate={(path: string) => {
      if (activeProjectPath) {
        updateWorkspace(activeProjectPath, ws => ({ ...ws, activeFilePath: path }));
      }
    }}
    onClose={handleFileClose}
    onCloseAll={handleCloseAllFiles}
    onDiffModeChange={handleDiffModeChange}
    onEditorSave={handleEditorSave}
    onEditorContentChange={handleEditorContentChange}
    onEditorDirtyChange={handleEditorDirtyChange}
    onReloadFile={handleReloadFile}
    onKeepMyEdits={handleKeepMyEdits}
  />
  ```

- [ ] **Step 6: Verify it compiles**

  ```bash
  cd /var/home/mstephens/Documents/GitHub/sai && npm run build 2>&1 | tail -20
  ```

  Expected: TypeScript errors about `CodePanel` not accepting the new props yet — that's fine, Task 6 fixes them.

- [ ] **Step 7: Commit**

  ```bash
  git add src/App.tsx
  git commit -m "feat: add file mtime polling and externallyModified state"
  ```

---

## Task 6: Add external change banner to `CodePanel`

**Files:**
- Modify: `src/components/CodePanel/CodePanel.tsx`

- [ ] **Step 1: Add new props to the `CodePanelProps` interface**

  Replace the `CodePanelProps` interface (lines 7–18) with:

  ```typescript
  interface CodePanelProps {
    openFiles: OpenFile[];
    activeFilePath: string;
    projectPath: string;
    externallyModified: Set<string>;
    onActivate: (path: string) => void;
    onClose: (path: string) => void;
    onCloseAll: () => void;
    onDiffModeChange: (path: string, mode: 'unified' | 'split') => void;
    onEditorSave: (filePath: string, content: string) => Promise<void>;
    onEditorContentChange?: (filePath: string, content: string) => void;
    onEditorDirtyChange?: (filePath: string, dirty: boolean) => void;
    onReloadFile: (path: string) => void;
    onKeepMyEdits: (path: string) => void;
  }
  ```

- [ ] **Step 2: Destructure the new props in the function signature**

  Replace the function signature (lines 20–30) with:

  ```typescript
  export default function CodePanel({
    openFiles,
    activeFilePath,
    projectPath,
    externallyModified,
    onActivate,
    onClose,
    onCloseAll,
    onDiffModeChange,
    onEditorSave,
    onEditorContentChange,
    onEditorDirtyChange,
    onReloadFile,
    onKeepMyEdits,
  }: CodePanelProps) {
  ```

- [ ] **Step 3: Render the external change banner between the toolbar and content area**

  The content section starts at line 179 with `{/* Content */}`. Add the banner JSX directly before it (between the closing `</div>` of the toolbar section at line 177 and `{/* Content */}`):

  ```tsx
  {/* External change banner */}
  {externallyModified.has(activeFilePath) && (
    <div style={{
      display: 'flex',
      alignItems: 'center',
      gap: 8,
      padding: '6px 12px',
      background: 'var(--bg-secondary)',
      borderBottom: '1px solid var(--border)',
      flexShrink: 0,
      fontSize: 12,
      color: 'var(--text-muted)',
    }}>
      <span style={{ color: 'var(--text-warning, #e8a838)' }}>⚠</span>
      <span>File changed on disk</span>
      <div style={{ marginLeft: 'auto', display: 'flex', gap: 6 }}>
        <button
          onClick={() => onReloadFile(activeFilePath)}
          style={{
            background: 'var(--accent)',
            border: 'none',
            borderRadius: 4,
            color: '#fff',
            cursor: 'pointer',
            fontSize: 11,
            padding: '3px 10px',
          }}
        >
          Reload
        </button>
        <button
          onClick={() => onKeepMyEdits(activeFilePath)}
          style={{
            background: 'none',
            border: '1px solid var(--border)',
            borderRadius: 4,
            color: 'var(--text-muted)',
            cursor: 'pointer',
            fontSize: 11,
            padding: '3px 10px',
          }}
        >
          Keep My Edits
        </button>
      </div>
    </div>
  )}
  ```

- [ ] **Step 4: Verify it compiles with no errors**

  ```bash
  cd /var/home/mstephens/Documents/GitHub/sai && npm run build 2>&1 | tail -20
  ```

  Expected: clean build, no TypeScript errors

- [ ] **Step 5: Manual end-to-end test**

  Start the app: `npm run dev`

  **Scenario A — clean auto-reload:**
  1. Open a file in the editor, make no edits
  2. From a terminal, write new content to that file: `echo "// changed" >> <filepath>`
  3. Wait up to 5s — the editor content should update silently, no banner

  **Scenario B — dirty file banner:**
  1. Open a file in the editor, type a character (make it dirty, dot appears in tab)
  2. From a terminal, write to the same file: `echo "// changed" >> <filepath>`
  3. Wait up to 5s — the yellow banner "File changed on disk" should appear
  4. Click **Keep My Edits** — banner disappears, your edits stay, no re-appearance
  5. Repeat steps 1–3, then click **Reload** — banner disappears, file content replaced with disk version, tab is clean

  **Scenario C — git fetch:**
  1. Open a project with a remote that has new commits
  2. Wait 60s — the pull button behind count should increment without clicking anything

- [ ] **Step 6: Commit**

  ```bash
  git add src/components/CodePanel/CodePanel.tsx
  git commit -m "feat: add external file change banner to CodePanel"
  ```
