# Diff Viewer Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a tabbed diff viewer that replaces the chat+terminal area when clicking dirty files in the git sidebar, with unified/split toggle and syntax-highlighted diffs via diff2html.

**Architecture:** New `CodePanel` component conditionally rendered in `main-content` instead of ChatPanel+TerminalPanel when files are open. New `DiffViewer` child component fetches diffs via a new `git:diff` IPC handler and renders with diff2html. State managed in App.tsx.

**Tech Stack:** React, TypeScript, diff2html, simple-git, Electron IPC

---

### Task 1: Install diff2html dependency

**Files:**
- Modify: `package.json`

- [ ] **Step 1: Install diff2html**

```bash
npm install diff2html
```

- [ ] **Step 2: Verify installation**

```bash
node -e "require('diff2html'); console.log('ok')"
```

Expected: `ok`

- [ ] **Step 3: Commit**

```bash
git add package.json package-lock.json
git commit -m "chore: add diff2html dependency"
```

---

### Task 2: Add OpenFile type to types.ts

**Files:**
- Modify: `src/types.ts`

- [ ] **Step 1: Add OpenFile interface**

Add after the `GitFile` interface (line 28):

```ts
export interface OpenFile {
  file: GitFile;
  diffMode: 'unified' | 'split';
}
```

- [ ] **Step 2: Commit**

```bash
git add src/types.ts
git commit -m "feat: add OpenFile type"
```

---

### Task 3: Add git:diff backend handler

**Files:**
- Modify: `electron/services/git.ts` (add new handler after line 50, before closing `}`)
- Modify: `electron/preload.ts` (add new method)

- [ ] **Step 1: Add IPC handler in git.ts**

Add before the closing `}` of `registerGitHandlers()` (after the `git:log` handler at line 50):

```ts
  ipcMain.handle('git:diff', async (_event, cwd: string, filepath: string, staged: boolean) => {
    const git = simpleGit(cwd);
    const args = staged ? ['--cached', '--', filepath] : ['--', filepath];
    return await git.diff(args);
  });
```

- [ ] **Step 2: Expose in preload.ts**

Add after the `gitLog` line (line 27) in `electron/preload.ts`:

```ts
  gitDiff: (cwd: string, filepath: string, staged: boolean) =>
    ipcRenderer.invoke('git:diff', cwd, filepath, staged),
```

- [ ] **Step 3: Verify the app still builds**

```bash
npm run build
```

Expected: No TypeScript or build errors.

- [ ] **Step 4: Commit**

```bash
git add electron/services/git.ts electron/preload.ts
git commit -m "feat: add git:diff IPC handler"
```

---

### Task 4: Create DiffViewer component

**Files:**
- Create: `src/components/CodePanel/DiffViewer.tsx`

- [ ] **Step 1: Create the DiffViewer component**

Create directory and file `src/components/CodePanel/DiffViewer.tsx`:

```tsx
import { useState, useEffect } from 'react';
import { html as diff2html } from 'diff2html';
import 'diff2html/bundles/css/diff2html.min.css';

interface DiffViewerProps {
  projectPath: string;
  filePath: string;
  staged: boolean;
  mode: 'unified' | 'split';
}

export default function DiffViewer({ projectPath, filePath, staged, mode }: DiffViewerProps) {
  const [diffHtml, setDiffHtml] = useState<string>('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);

    window.vsai.gitDiff(projectPath, filePath, staged)
      .then((raw: string) => {
        if (cancelled) return;
        if (!raw || !raw.trim()) {
          setDiffHtml('<div class="diff-empty">No changes</div>');
        } else {
          const html = diff2html(raw, {
            drawFileList: false,
            outputFormat: mode === 'split' ? 'side-by-side' : 'line-by-line',
            matching: 'lines',
          });
          setDiffHtml(html);
        }
        setLoading(false);
      })
      .catch((err: Error) => {
        if (cancelled) return;
        setError(err.message || 'Failed to load diff');
        setLoading(false);
      });

    return () => { cancelled = true; };
  }, [projectPath, filePath, staged, mode]);

  if (loading) {
    return (
      <div style={{
        flex: 1,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        color: 'var(--text-muted)',
        fontSize: 13,
      }}>
        Loading diff...
      </div>
    );
  }

  if (error) {
    return (
      <div style={{
        flex: 1,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        color: 'var(--red)',
        fontSize: 13,
      }}>
        {error}
      </div>
    );
  }

  return (
    <>
      <div
        style={{ flex: 1, overflow: 'auto' }}
        dangerouslySetInnerHTML={{ __html: diffHtml }}
      />
      <style>{`
        /* Override diff2html for dark theme */
        .d2h-wrapper {
          background: var(--bg-primary);
          color: var(--text);
          font-family: 'JetBrains Mono', 'Fira Code', monospace;
          font-size: 12px;
        }
        .d2h-file-wrapper {
          border: none;
          margin: 0;
          border-radius: 0;
        }
        .d2h-file-header {
          display: none;
        }
        .d2h-diff-table {
          font-family: 'JetBrains Mono', 'Fira Code', monospace;
          font-size: 12px;
        }
        .d2h-code-linenumber {
          background: var(--bg-secondary);
          color: var(--text-muted);
          border-right: 1px solid var(--border);
        }
        .d2h-code-line {
          background: var(--bg-primary);
          color: var(--text);
        }
        .d2h-code-side-line {
          background: var(--bg-primary);
          color: var(--text);
        }
        .d2h-del {
          background: rgba(227, 85, 53, 0.15);
          border-color: transparent;
        }
        .d2h-ins {
          background: rgba(0, 168, 132, 0.15);
          border-color: transparent;
        }
        .d2h-del .d2h-code-line-ctn {
          color: var(--red);
          background: transparent;
        }
        .d2h-ins .d2h-code-line-ctn {
          color: var(--green);
          background: transparent;
        }
        .d2h-del .d2h-code-side-line {
          background: rgba(227, 85, 53, 0.15);
        }
        .d2h-ins .d2h-code-side-line {
          background: rgba(0, 168, 132, 0.15);
        }
        .d2h-info {
          background: var(--bg-secondary);
          color: var(--text-muted);
          border-bottom: 1px solid var(--border);
        }
        .d2h-code-line-prefix {
          color: var(--text-muted);
        }
        .d2h-diff-tbody tr {
          border-color: var(--border);
        }
        .d2h-file-diff {
          overflow-x: auto;
        }
        .d2h-emptyplaceholder {
          background: var(--bg-secondary);
          border-color: var(--border);
        }
        .diff-empty {
          display: flex;
          align-items: center;
          justify-content: center;
          height: 100%;
          color: var(--text-muted);
          font-size: 13px;
          padding: 48px;
        }
      `}</style>
    </>
  );
}
```

- [ ] **Step 2: Verify it compiles**

```bash
npm run build
```

Expected: No errors (component isn't used yet, but imports should resolve).

- [ ] **Step 3: Commit**

```bash
git add src/components/CodePanel/DiffViewer.tsx
git commit -m "feat: add DiffViewer component with diff2html rendering"
```

---

### Task 5: Create CodePanel component

**Files:**
- Create: `src/components/CodePanel/CodePanel.tsx`

- [ ] **Step 1: Create the CodePanel component**

Create `src/components/CodePanel/CodePanel.tsx`:

```tsx
import { useEffect } from 'react';
import { X } from 'lucide-react';
import type { OpenFile } from '../../types';
import DiffViewer from './DiffViewer';

interface CodePanelProps {
  openFiles: OpenFile[];
  activeFilePath: string;
  projectPath: string;
  onActivate: (path: string) => void;
  onClose: (path: string) => void;
  onCloseAll: () => void;
  onDiffModeChange: (path: string, mode: 'unified' | 'split') => void;
}

export default function CodePanel({
  openFiles,
  activeFilePath,
  projectPath,
  onActivate,
  onClose,
  onCloseAll,
  onDiffModeChange,
}: CodePanelProps) {
  const activeFile = openFiles.find(f => f.file.path === activeFilePath);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose(activeFilePath);
      }
    };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [activeFilePath, onClose]);

  if (!activeFile) return null;

  return (
    <div style={{
      flex: 1,
      display: 'flex',
      flexDirection: 'column',
      overflow: 'hidden',
      background: 'var(--bg-primary)',
    }}>
      {/* Tab bar */}
      <div style={{
        display: 'flex',
        alignItems: 'stretch',
        background: 'var(--bg-secondary)',
        borderBottom: '1px solid var(--border)',
        flexShrink: 0,
        overflow: 'hidden',
      }}>
        <div style={{
          display: 'flex',
          flex: 1,
          overflow: 'hidden',
        }}>
          {openFiles.map(({ file }) => {
            const isActive = file.path === activeFilePath;
            const fileName = file.path.split('/').pop() ?? file.path;
            return (
              <div
                key={file.path}
                onClick={() => onActivate(file.path)}
                onMouseDown={(e) => {
                  if (e.button === 1) {
                    e.preventDefault();
                    onClose(file.path);
                  }
                }}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 6,
                  padding: '0 12px',
                  height: 35,
                  fontSize: 12,
                  cursor: 'pointer',
                  color: isActive ? 'var(--text)' : 'var(--text-muted)',
                  background: isActive ? 'var(--bg-primary)' : 'transparent',
                  borderBottom: isActive ? '2px solid var(--accent)' : '2px solid transparent',
                  borderRight: '1px solid var(--border)',
                  userSelect: 'none' as const,
                  flexShrink: 0,
                }}
              >
                <span style={{
                  fontFamily: "'JetBrains Mono', monospace",
                  fontSize: 12,
                  whiteSpace: 'nowrap' as const,
                }}>
                  {fileName}
                </span>
                <button
                  onClick={(e) => { e.stopPropagation(); onClose(file.path); }}
                  style={{
                    background: 'none',
                    border: 'none',
                    color: isActive ? 'var(--text-muted)' : 'transparent',
                    cursor: 'pointer',
                    padding: 2,
                    borderRadius: 3,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                  }}
                  onMouseEnter={(e) => {
                    (e.target as HTMLElement).style.color = 'var(--text)';
                    (e.target as HTMLElement).style.background = 'var(--bg-hover)';
                  }}
                  onMouseLeave={(e) => {
                    (e.target as HTMLElement).style.color = isActive ? 'var(--text-muted)' : 'transparent';
                    (e.target as HTMLElement).style.background = 'none';
                  }}
                >
                  <X size={14} />
                </button>
              </div>
            );
          })}
        </div>

        {/* Close all button */}
        {openFiles.length > 1 && (
          <button
            onClick={onCloseAll}
            title="Close all tabs"
            style={{
              background: 'none',
              border: 'none',
              borderLeft: '1px solid var(--border)',
              color: 'var(--text-muted)',
              cursor: 'pointer',
              padding: '0 10px',
              fontSize: 11,
              flexShrink: 0,
            }}
          >
            Close All
          </button>
        )}
      </div>

      {/* Toolbar */}
      <div style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        padding: '4px 12px',
        background: 'var(--bg-secondary)',
        borderBottom: '1px solid var(--border)',
        flexShrink: 0,
      }}>
        <span style={{
          fontFamily: "'JetBrains Mono', monospace",
          fontSize: 11,
          color: 'var(--text-muted)',
        }}>
          {activeFile.file.path}
        </span>

        {/* Unified / Split toggle */}
        <div style={{
          display: 'flex',
          borderRadius: 4,
          overflow: 'hidden',
          border: '1px solid var(--border)',
        }}>
          {(['unified', 'split'] as const).map((m) => (
            <button
              key={m}
              onClick={() => onDiffModeChange(activeFilePath, m)}
              style={{
                background: activeFile.diffMode === m ? 'var(--bg-hover)' : 'transparent',
                color: activeFile.diffMode === m ? 'var(--text)' : 'var(--text-muted)',
                border: 'none',
                padding: '3px 10px',
                fontSize: 11,
                cursor: 'pointer',
                textTransform: 'capitalize' as const,
              }}
            >
              {m}
            </button>
          ))}
        </div>
      </div>

      {/* Diff content */}
      <DiffViewer
        projectPath={projectPath}
        filePath={activeFile.file.path}
        staged={activeFile.file.staged}
        mode={activeFile.diffMode}
      />
    </div>
  );
}
```

- [ ] **Step 2: Verify it compiles**

```bash
npm run build
```

Expected: No errors.

- [ ] **Step 3: Commit**

```bash
git add src/components/CodePanel/CodePanel.tsx
git commit -m "feat: add CodePanel with tabbed interface and diff mode toggle"
```

---

### Task 6: Add onFileClick to ChangedFiles

**Files:**
- Modify: `src/components/Git/ChangedFiles.tsx`

- [ ] **Step 1: Add onFileClick prop to interface**

In `src/components/Git/ChangedFiles.tsx`, replace the `ChangedFilesProps` interface (lines 11-16):

```ts
interface ChangedFilesProps {
  title: string;
  files: GitFile[];
  onAction: (file: GitFile) => void;
  actionLabel: string;
  onFileClick: (file: GitFile) => void;
}
```

- [ ] **Step 2: Update component signature and add click handler**

Replace the function signature (line 18):

```ts
export default function ChangedFiles({ title, files, onAction, actionLabel, onFileClick }: ChangedFilesProps) {
```

- [ ] **Step 3: Add onClick to the file row div**

Replace the file row `<div>` opening tag (lines 48-60) with:

```tsx
          <div
            key={file.path}
            onMouseEnter={() => setHoveredPath(file.path)}
            onMouseLeave={() => setHoveredPath(null)}
            onClick={() => onFileClick(file)}
            style={{
              display: 'flex',
              alignItems: 'center',
              padding: '3px 12px',
              gap: 6,
              background: isHovered ? 'var(--bg-hover)' : 'transparent',
              cursor: 'pointer',
              minWidth: 0,
            }}
          >
```

- [ ] **Step 4: Add stopPropagation to the action button**

Replace the action button's `onClick` (line 109):

```tsx
              onClick={(e) => { e.stopPropagation(); onAction(file); }}
```

- [ ] **Step 5: Verify it compiles**

```bash
npm run build
```

Expected: Build will fail because GitSidebar doesn't pass `onFileClick` yet — that's expected and fixed in the next task.

- [ ] **Step 6: Commit**

```bash
git add src/components/Git/ChangedFiles.tsx
git commit -m "feat: add onFileClick prop to ChangedFiles"
```

---

### Task 7: Wire everything through GitSidebar and App.tsx

**Files:**
- Modify: `src/components/Git/GitSidebar.tsx`
- Modify: `src/App.tsx`

- [ ] **Step 1: Add onFileClick prop to GitSidebar**

In `src/components/Git/GitSidebar.tsx`, update the `GitSidebarProps` interface (line 23-25):

```ts
interface GitSidebarProps {
  projectPath: string;
  onFileClick: (file: GitFile) => void;
}
```

- [ ] **Step 2: Destructure new prop in GitSidebar**

Update the function signature (line 59):

```ts
export default function GitSidebar({ projectPath, onFileClick }: GitSidebarProps) {
```

- [ ] **Step 3: Pass onFileClick to both ChangedFiles instances**

Update the staged ChangedFiles (lines 199-204):

```tsx
        <ChangedFiles
          title="Staged"
          files={stagedFiles}
          onAction={handleUnstage}
          actionLabel="-"
          onFileClick={onFileClick}
        />
```

Update the unstaged ChangedFiles (lines 206-211):

```tsx
        <ChangedFiles
          title="Changes"
          files={unstagedFiles}
          onAction={handleStage}
          actionLabel="+"
          onFileClick={onFileClick}
        />
```

- [ ] **Step 4: Add open file state and handlers to App.tsx**

In `src/App.tsx`, add the import for CodePanel and OpenFile type. Replace the imports at the top (lines 1-8):

```ts
import { useState, useCallback } from 'react';
import NavBar from './components/NavBar';
import ChatPanel from './components/Chat/ChatPanel';
import TerminalPanel from './components/Terminal/TerminalPanel';
import GitSidebar from './components/Git/GitSidebar';
import TitleBar from './components/TitleBar';
import CodePanel from './components/CodePanel/CodePanel';
import { loadSessions, saveSessions, createSession, upsertSession } from './sessions';
import type { ChatSession, ChatMessage, GitFile, OpenFile } from './types';
```

- [ ] **Step 5: Add state and handlers inside the App component**

Add after the `activeSession` state (after line 27):

```ts
  const [openFiles, setOpenFiles] = useState<OpenFile[]>([]);
  const [activeFilePath, setActiveFilePath] = useState<string | null>(null);

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
```

- [ ] **Step 6: Pass onFileClick to GitSidebar in JSX**

Update the GitSidebar line (line 97) in the return JSX:

```tsx
        {sidebarOpen === 'git' && <GitSidebar projectPath={projectPath} onFileClick={handleFileClick} />}
```

- [ ] **Step 7: Conditionally render CodePanel or Chat+Terminal**

Replace the `main-content` div (lines 98-109):

```tsx
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
```

- [ ] **Step 8: Verify the app builds**

```bash
npm run build
```

Expected: No errors.

- [ ] **Step 9: Commit**

```bash
git add src/App.tsx src/components/Git/GitSidebar.tsx
git commit -m "feat: wire diff viewer through GitSidebar and App"
```

---

### Task 8: Manual smoke test

- [ ] **Step 1: Start the app**

```bash
npm run dev
```

- [ ] **Step 2: Test the diff viewer flow**

1. Open the git sidebar (click git icon in navbar)
2. Make sure there are dirty files visible
3. Click a dirty file row — verify CodePanel appears with the diff
4. Click another file — verify a new tab opens
5. Toggle between unified and split views
6. Close a tab with X button — verify it closes
7. Close all tabs — verify chat+terminal return
8. Middle-click a tab — verify it closes
9. Press Escape — verify active tab closes

- [ ] **Step 3: Commit any fixes if needed**

```bash
git add -A
git commit -m "fix: address smoke test issues"
```
