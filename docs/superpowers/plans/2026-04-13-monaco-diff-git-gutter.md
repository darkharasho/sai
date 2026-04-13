# Monaco Diff Editor & Git Gutter Decorations Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the custom Shiki diff viewer with Monaco's built-in diff editor (gaining minimap), and add VS Code-style git change indicators to the regular editor's gutter and minimap.

**Architecture:** Two new IPC handlers (`git:show` for file content at a ref, `git:diffLines` for structured change ranges) power the features. DiffViewer.tsx is fully rewritten to use `monaco.editor.createDiffEditor()`. MonacoEditor.tsx gains decoration logic that fetches diff data on mount/save and applies gutter + minimap decorations.

**Tech Stack:** Monaco Editor (already installed), simple-git `.show()` and `.diff()`, Vitest for tests.

---

### Task 1: Add `git:show` IPC handler

**Files:**
- Modify: `electron/services/git.ts:118` (add before `git:diff` handler)
- Modify: `electron/preload.ts:60` (add `gitShow` bridge method)
- Modify: `tests/helpers/ipc-mock.ts:58` (add `gitShow` to MockSai)
- Test: `tests/unit/services/git.test.ts`

- [ ] **Step 1: Write the failing tests**

Add to `tests/unit/services/git.test.ts` at the bottom, before the closing of the file:

```typescript
// ===========================================================================
// git:show
// ===========================================================================

describe('git:show', () => {
  it('returns file content at HEAD', async () => {
    await setup();
    mockGitInstance.show.mockResolvedValue('console.log("hello");');

    const result = await mockIpcMain._invoke('git:show', '/repo', 'src/index.ts', 'HEAD');

    expect(mockGitInstance.show).toHaveBeenCalledWith(['HEAD:src/index.ts']);
    expect(result).toBe('console.log("hello");');
  });

  it('returns staged content when ref is colon prefix', async () => {
    await setup();
    mockGitInstance.show.mockResolvedValue('staged content');

    const result = await mockIpcMain._invoke('git:show', '/repo', 'src/index.ts', ':');

    expect(mockGitInstance.show).toHaveBeenCalledWith([':src/index.ts']);
    expect(result).toBe('staged content');
  });

  it('returns empty string when file does not exist at ref', async () => {
    await setup();
    mockGitInstance.show.mockRejectedValue(new Error('fatal: path not found'));

    const result = await mockIpcMain._invoke('git:show', '/repo', 'new-file.ts', 'HEAD');

    expect(result).toBe('');
  });
});
```

- [ ] **Step 2: Add `show` to mockGitInstance**

In `tests/unit/services/git.test.ts`, find the `mockGitInstance` object in the `vi.hoisted` block and add after the `diff` line:

```typescript
    show: vi.fn(),
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `npx vitest run tests/unit/services/git.test.ts --reporter=verbose 2>&1 | tail -20`
Expected: 3 FAIL results for `git:show` tests (no handler registered)

- [ ] **Step 4: Implement `git:show` handler**

In `electron/services/git.ts`, add this handler after the `git:diff` handler (after line 121):

```typescript
  ipcMain.handle('git:show', async (_event, cwd: string, filepath: string, ref: string) => {
    try {
      return await git(cwd).show([`${ref}${ref.endsWith(':') ? '' : ':'}${filepath}`]);
    } catch {
      return '';
    }
  });
```

- [ ] **Step 5: Add preload bridge method**

In `electron/preload.ts`, add after the `gitDiff` line (after line 61):

```typescript
  gitShow: (cwd: string, filepath: string, ref: string) =>
    ipcRenderer.invoke('git:show', cwd, filepath, ref),
```

- [ ] **Step 6: Add `gitShow` to MockSai**

In `tests/helpers/ipc-mock.ts`, add to the `MockSai` interface after `gitDiff`:

```typescript
  gitShow: ReturnType<typeof vi.fn>;
```

And in `createMockSai()`, add after the `gitDiff` line:

```typescript
    gitShow: vi.fn().mockResolvedValue(''),
```

- [ ] **Step 7: Run tests to verify they pass**

Run: `npx vitest run tests/unit/services/git.test.ts --reporter=verbose 2>&1 | tail -20`
Expected: All tests PASS including the 3 new `git:show` tests

- [ ] **Step 8: Commit**

```bash
git add electron/services/git.ts electron/preload.ts tests/unit/services/git.test.ts tests/helpers/ipc-mock.ts
git commit -m "feat: add git:show IPC handler for file content at any ref"
```

---

### Task 2: Add `git:diffLines` IPC handler

**Files:**
- Modify: `electron/services/git.ts` (add after `git:show` handler)
- Modify: `electron/preload.ts` (add `gitDiffLines` bridge method)
- Modify: `tests/helpers/ipc-mock.ts` (add `gitDiffLines` to MockSai)
- Test: `tests/unit/services/git.test.ts`

- [ ] **Step 1: Write the failing tests**

Add to `tests/unit/services/git.test.ts`:

```typescript
// ===========================================================================
// git:diffLines
// ===========================================================================

describe('git:diffLines', () => {
  it('classifies pure additions (old count = 0)', async () => {
    await setup();
    // Hunk: @@ -5,0 +6,3 @@ means 3 lines added after line 5
    mockGitInstance.diff.mockResolvedValue(
      'diff --git a/f b/f\n--- a/f\n+++ b/f\n@@ -5,0 +6,3 @@\n+line1\n+line2\n+line3\n'
    );

    const result = await mockIpcMain._invoke('git:diffLines', '/repo', 'f') as {
      added: Array<{ startLine: number; endLine: number }>;
      modified: Array<{ startLine: number; endLine: number }>;
      deleted: number[];
    };

    expect(result.added).toEqual([{ startLine: 6, endLine: 8 }]);
    expect(result.modified).toEqual([]);
    expect(result.deleted).toEqual([]);
  });

  it('classifies pure deletions (new count = 0)', async () => {
    await setup();
    // Hunk: @@ -3,2 +3,0 @@ means 2 lines deleted at line 3
    mockGitInstance.diff.mockResolvedValue(
      'diff --git a/f b/f\n--- a/f\n+++ b/f\n@@ -3,2 +3,0 @@\n-old1\n-old2\n'
    );

    const result = await mockIpcMain._invoke('git:diffLines', '/repo', 'f') as {
      added: Array<{ startLine: number; endLine: number }>;
      modified: Array<{ startLine: number; endLine: number }>;
      deleted: number[];
    };

    expect(result.added).toEqual([]);
    expect(result.modified).toEqual([]);
    expect(result.deleted).toEqual([3]);
  });

  it('classifies modifications (both old and new content)', async () => {
    await setup();
    // Hunk: @@ -10,2 +10,3 @@ means 2 lines replaced by 3
    mockGitInstance.diff.mockResolvedValue(
      'diff --git a/f b/f\n--- a/f\n+++ b/f\n@@ -10,2 +10,3 @@\n-old1\n-old2\n+new1\n+new2\n+new3\n'
    );

    const result = await mockIpcMain._invoke('git:diffLines', '/repo', 'f') as {
      added: Array<{ startLine: number; endLine: number }>;
      modified: Array<{ startLine: number; endLine: number }>;
      deleted: number[];
    };

    expect(result.added).toEqual([]);
    expect(result.modified).toEqual([{ startLine: 10, endLine: 12 }]);
    expect(result.deleted).toEqual([]);
  });

  it('handles multiple hunks', async () => {
    await setup();
    mockGitInstance.diff.mockResolvedValue(
      'diff --git a/f b/f\n--- a/f\n+++ b/f\n' +
      '@@ -1,0 +1,2 @@\n+a\n+b\n' +
      '@@ -10,3 +12,0 @@\n-x\n-y\n-z\n'
    );

    const result = await mockIpcMain._invoke('git:diffLines', '/repo', 'f') as {
      added: Array<{ startLine: number; endLine: number }>;
      modified: Array<{ startLine: number; endLine: number }>;
      deleted: number[];
    };

    expect(result.added).toEqual([{ startLine: 1, endLine: 2 }]);
    expect(result.deleted).toEqual([12]);
  });

  it('returns empty result when no diff', async () => {
    await setup();
    mockGitInstance.diff.mockResolvedValue('');

    const result = await mockIpcMain._invoke('git:diffLines', '/repo', 'f') as {
      added: Array<{ startLine: number; endLine: number }>;
      modified: Array<{ startLine: number; endLine: number }>;
      deleted: number[];
    };

    expect(result).toEqual({ added: [], modified: [], deleted: [] });
  });

  it('returns empty result on error', async () => {
    await setup();
    mockGitInstance.diff.mockRejectedValue(new Error('not a git repo'));

    const result = await mockIpcMain._invoke('git:diffLines', '/repo', 'f') as {
      added: Array<{ startLine: number; endLine: number }>;
      modified: Array<{ startLine: number; endLine: number }>;
      deleted: number[];
    };

    expect(result).toEqual({ added: [], modified: [], deleted: [] });
  });

  it('calls git diff with HEAD and filepath', async () => {
    await setup();
    mockGitInstance.diff.mockResolvedValue('');

    await mockIpcMain._invoke('git:diffLines', '/repo', 'src/app.ts');

    expect(mockGitInstance.diff).toHaveBeenCalledWith(['HEAD', '--', 'src/app.ts']);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/unit/services/git.test.ts --reporter=verbose 2>&1 | tail -30`
Expected: 7 FAIL results for `git:diffLines` tests

- [ ] **Step 3: Implement `git:diffLines` handler**

In `electron/services/git.ts`, add this after the `git:show` handler:

```typescript
  ipcMain.handle('git:diffLines', async (_event, cwd: string, filepath: string) => {
    const empty = { added: [] as { startLine: number; endLine: number }[], modified: [] as { startLine: number; endLine: number }[], deleted: [] as number[] };
    try {
      const raw = await git(cwd).diff(['HEAD', '--', filepath]);
      if (!raw || !raw.trim()) return empty;

      const result = { added: [] as { startLine: number; endLine: number }[], modified: [] as { startLine: number; endLine: number }[], deleted: [] as number[] };
      const hunkRe = /@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/g;
      let match;

      while ((match = hunkRe.exec(raw)) !== null) {
        const oldCount = match[2] !== undefined ? parseInt(match[2], 10) : 1;
        const newStart = parseInt(match[3], 10);
        const newCount = match[4] !== undefined ? parseInt(match[4], 10) : 1;

        if (oldCount === 0 && newCount > 0) {
          result.added.push({ startLine: newStart, endLine: newStart + newCount - 1 });
        } else if (newCount === 0 && oldCount > 0) {
          result.deleted.push(newStart);
        } else if (oldCount > 0 && newCount > 0) {
          result.modified.push({ startLine: newStart, endLine: newStart + newCount - 1 });
        }
      }

      return result;
    } catch {
      return empty;
    }
  });
```

- [ ] **Step 4: Add preload bridge method**

In `electron/preload.ts`, add after the `gitShow` line:

```typescript
  gitDiffLines: (cwd: string, filepath: string) =>
    ipcRenderer.invoke('git:diffLines', cwd, filepath),
```

- [ ] **Step 5: Add `gitDiffLines` to MockSai**

In `tests/helpers/ipc-mock.ts`, add to the `MockSai` interface after `gitShow`:

```typescript
  gitDiffLines: ReturnType<typeof vi.fn>;
```

And in `createMockSai()`, add after `gitShow`:

```typescript
    gitDiffLines: vi.fn().mockResolvedValue({ added: [], modified: [], deleted: [] }),
```

- [ ] **Step 6: Run tests to verify they pass**

Run: `npx vitest run tests/unit/services/git.test.ts --reporter=verbose 2>&1 | tail -30`
Expected: All tests PASS

- [ ] **Step 7: Commit**

```bash
git add electron/services/git.ts electron/preload.ts tests/unit/services/git.test.ts tests/helpers/ipc-mock.ts
git commit -m "feat: add git:diffLines IPC for structured change ranges"
```

---

### Task 3: Rewrite DiffViewer with Monaco diff editor

**Files:**
- Rewrite: `src/components/CodePanel/DiffViewer.tsx`
- Modify: `src/components/CodePanel/CodePanel.tsx:314` (pass `minimap` prop)
- Update: `tests/unit/components/Git/DiffViewer.test.tsx`

- [ ] **Step 1: Update DiffViewer tests for Monaco diff editor**

Monaco editor requires a DOM element and can't run in jsdom, so the tests need to mock `monaco.editor.createDiffEditor`. Replace `tests/unit/components/Git/DiffViewer.test.tsx` entirely:

```tsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { installMockSai, createMockSai } from '../../../helpers/ipc-mock';

// Mock monaco-editor — jsdom doesn't support canvas/webgl
const mockSetModel = vi.fn();
const mockUpdateOptions = vi.fn();
const mockDispose = vi.fn();
const mockDiffEditor = {
  setModel: mockSetModel,
  updateOptions: mockUpdateOptions,
  dispose: mockDispose,
};
vi.mock('monaco-editor', () => ({
  editor: {
    createDiffEditor: vi.fn(() => mockDiffEditor),
    createModel: vi.fn((content: string, lang: string) => ({ content, lang, dispose: vi.fn() })),
    defineTheme: vi.fn(),
    setTheme: vi.fn(),
  },
  KeyMod: { CtrlCmd: 2048 },
  KeyCode: { KeyS: 49 },
}));

// Mock theme helpers
vi.mock('../../../../src/themes', () => ({
  getActiveHighlightTheme: vi.fn().mockReturnValue('monokai'),
  buildMonacoThemeData: vi.fn().mockResolvedValue({
    base: 'vs-dark',
    rules: [],
    colors: {},
  }),
}));

import DiffViewer from '../../../../src/components/CodePanel/DiffViewer';

const defaultProps = {
  projectPath: '/home/user/project',
  filePath: 'src/index.ts',
  staged: false,
  mode: 'unified' as const,
  minimap: true,
};

describe('DiffViewer (Monaco)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('shows loading state initially', () => {
    const mock = createMockSai();
    mock.gitShow.mockImplementation(() => new Promise(() => {}));
    mock.fsReadFile.mockImplementation(() => new Promise(() => {}));
    installMockSai(mock);

    render(<DiffViewer {...defaultProps} />);
    expect(screen.getByText('Loading diff...')).toBeTruthy();
  });

  it('fetches HEAD content and working tree content for unstaged diff', async () => {
    const mock = createMockSai();
    mock.gitShow.mockResolvedValue('original content');
    mock.fsReadFile.mockResolvedValue('modified content');
    installMockSai(mock);

    render(<DiffViewer {...defaultProps} />);
    await waitFor(() => {
      expect(mock.gitShow).toHaveBeenCalledWith('/home/user/project', 'src/index.ts', 'HEAD');
      expect(mock.fsReadFile).toHaveBeenCalled();
    });
  });

  it('fetches staged content when staged=true', async () => {
    const mock = createMockSai();
    mock.gitShow.mockResolvedValue('content');
    installMockSai(mock);

    render(<DiffViewer {...defaultProps} staged={true} />);
    await waitFor(() => {
      expect(mock.gitShow).toHaveBeenCalledWith('/home/user/project', 'src/index.ts', 'HEAD');
      expect(mock.gitShow).toHaveBeenCalledWith('/home/user/project', 'src/index.ts', ':');
    });
  });

  it('creates a diff editor after content loads', async () => {
    const mock = createMockSai();
    mock.gitShow.mockResolvedValue('old');
    mock.fsReadFile.mockResolvedValue('new');
    installMockSai(mock);

    const { default: monaco } = await import('monaco-editor');

    render(<DiffViewer {...defaultProps} />);
    await waitFor(() => {
      expect(monaco.editor.createDiffEditor).toHaveBeenCalled();
    });
  });

  it('shows error message when fetch fails', async () => {
    const mock = createMockSai();
    mock.gitShow.mockRejectedValue(new Error('fatal error'));
    mock.fsReadFile.mockRejectedValue(new Error('file not found'));
    installMockSai(mock);

    render(<DiffViewer {...defaultProps} />);
    await waitFor(() => {
      expect(screen.getByText(/fatal error|file not found/)).toBeTruthy();
    });
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/unit/components/Git/DiffViewer.test.tsx --reporter=verbose 2>&1 | tail -20`
Expected: FAIL (DiffViewer still uses Shiki, not Monaco)

- [ ] **Step 3: Rewrite DiffViewer.tsx**

Replace `src/components/CodePanel/DiffViewer.tsx` entirely:

```tsx
import { useState, useEffect, useRef } from 'react';
import * as monaco from 'monaco-editor';
import { getActiveHighlightTheme, buildMonacoThemeData } from '../../themes';
import { detectLanguage } from '../FileExplorer/MonacoEditor';

interface DiffViewerProps {
  projectPath: string;
  filePath: string;
  staged: boolean;
  mode: 'unified' | 'split';
  minimap?: boolean;
}

export default function DiffViewer({ projectPath, filePath, staged, mode, minimap = true }: DiffViewerProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const editorRef = useRef<monaco.editor.IStandaloneDiffEditor | null>(null);
  const originalModelRef = useRef<monaco.editor.ITextModel | null>(null);
  const modifiedModelRef = useRef<monaco.editor.ITextModel | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Fetch content and create diff editor
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);

    const language = detectLanguage(filePath);

    async function load() {
      try {
        const originalContent = await window.sai.gitShow(projectPath, filePath, 'HEAD');
        if (cancelled) return;

        let modifiedContent: string;
        if (staged) {
          modifiedContent = await window.sai.gitShow(projectPath, filePath, ':');
        } else {
          const fullPath = projectPath.endsWith('/')
            ? projectPath + filePath
            : projectPath + '/' + filePath;
          modifiedContent = await window.sai.fsReadFile(fullPath);
        }
        if (cancelled) return;

        if (!containerRef.current) return;

        // Dispose previous editor and models
        editorRef.current?.dispose();
        originalModelRef.current?.dispose();
        modifiedModelRef.current?.dispose();

        const originalModel = monaco.editor.createModel(originalContent, language);
        const modifiedModel = monaco.editor.createModel(modifiedContent, language);
        originalModelRef.current = originalModel;
        modifiedModelRef.current = modifiedModel;

        const diffEditor = monaco.editor.createDiffEditor(containerRef.current, {
          theme: 'sai-dark',
          fontFamily: "'JetBrains Mono', 'Fira Code', 'Cascadia Code', monospace",
          fontSize: 12,
          lineHeight: 20,
          minimap: { enabled: minimap },
          renderSideBySide: mode === 'split',
          readOnly: true,
          originalEditable: false,
          scrollBeyondLastLine: false,
          automaticLayout: true,
          renderOverviewRuler: true,
        });

        diffEditor.setModel({ original: originalModel, modified: modifiedModel });
        editorRef.current = diffEditor;

        setLoading(false);
      } catch (err: unknown) {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : 'Failed to load diff');
        setLoading(false);
      }
    }

    load();

    return () => {
      cancelled = true;
      editorRef.current?.dispose();
      originalModelRef.current?.dispose();
      modifiedModelRef.current?.dispose();
      editorRef.current = null;
      originalModelRef.current = null;
      modifiedModelRef.current = null;
    };
  }, [projectPath, filePath, staged]);

  // Update side-by-side mode without remounting
  useEffect(() => {
    editorRef.current?.updateOptions({ renderSideBySide: mode === 'split' });
  }, [mode]);

  // Update minimap setting without remounting
  useEffect(() => {
    editorRef.current?.updateOptions({ minimap: { enabled: minimap } });
  }, [minimap]);

  // Listen for theme changes
  useEffect(() => {
    const handler = (e: Event) => {
      const data = (e as CustomEvent).detail;
      monaco.editor.defineTheme('sai-dark', {
        base: data.base,
        inherit: true,
        rules: data.rules,
        colors: data.colors,
      });
      monaco.editor.setTheme('sai-dark');
    };
    window.addEventListener('sai-monaco-theme', handler);
    return () => window.removeEventListener('sai-monaco-theme', handler);
  }, []);

  // Apply saved highlight theme on mount
  useEffect(() => {
    const hlTheme = getActiveHighlightTheme();
    if (hlTheme !== 'monokai') {
      buildMonacoThemeData(hlTheme).then(data => {
        monaco.editor.defineTheme('sai-dark', {
          base: data.base,
          inherit: true,
          rules: data.rules,
          colors: data.colors,
        });
        monaco.editor.setTheme('sai-dark');
      });
    }
  }, []);

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
    <div
      ref={containerRef}
      style={{ flex: 1, overflow: 'hidden' }}
    />
  );
}
```

- [ ] **Step 4: Pass `minimap` prop from CodePanel**

In `src/components/CodePanel/CodePanel.tsx`, find the DiffViewer usage (around line 314) and add the `minimap` prop:

Change:
```tsx
        <DiffViewer
          projectPath={projectPath}
          filePath={activeFile.file.path}
          staged={activeFile.file.staged}
          mode={activeFile.diffMode ?? 'unified'}
        />
```

To:
```tsx
        <DiffViewer
          projectPath={projectPath}
          filePath={activeFile.file.path}
          staged={activeFile.file.staged}
          mode={activeFile.diffMode ?? 'unified'}
          minimap={editorMinimap}
        />
```

- [ ] **Step 5: Run DiffViewer tests**

Run: `npx vitest run tests/unit/components/Git/DiffViewer.test.tsx --reporter=verbose 2>&1 | tail -20`
Expected: All tests PASS

- [ ] **Step 6: Run full test suite to check for regressions**

Run: `npx vitest run --reporter=verbose 2>&1 | tail -40`
Expected: No regressions

- [ ] **Step 7: TypeScript check**

Run: `npx tsc --noEmit 2>&1 | tail -20`
Expected: No errors

- [ ] **Step 8: Commit**

```bash
git add src/components/CodePanel/DiffViewer.tsx src/components/CodePanel/CodePanel.tsx tests/unit/components/Git/DiffViewer.test.tsx
git commit -m "feat: replace Shiki DiffViewer with Monaco diff editor with minimap"
```

---

### Task 4: Add git gutter decorations to MonacoEditor

**Files:**
- Modify: `src/components/FileExplorer/MonacoEditor.tsx`
- Modify: `src/components/CodePanel/CodePanel.tsx:326` (pass `projectPath` to MonacoEditor)

- [ ] **Step 1: Add `projectPath` prop and gutter decoration logic to MonacoEditor**

In `src/components/FileExplorer/MonacoEditor.tsx`:

**Add `projectPath` to the props interface** (line 71-82). Change the interface to:

```typescript
interface MonacoEditorProps {
  filePath: string;
  content: string;
  fontSize?: number;
  minimap?: boolean;
  initialLine?: number;
  projectPath?: string;
  onSave: (filePath: string, content: string) => Promise<void>;
  onDirtyChange?: (dirty: boolean) => void;
  onContentChange?: (filePath: string, content: string) => void;
  onLineRevealed?: () => void;
  onTogglePreview?: () => void;
}
```

**Update the component signature** (line 84) to destructure `projectPath`:

```typescript
export default function MonacoEditor({ filePath, content, fontSize = 13, minimap = true, initialLine, projectPath, onSave, onDirtyChange, onContentChange, onLineRevealed, onTogglePreview }: MonacoEditorProps) {
```

**Add a ref to track decoration IDs** after the existing refs (around line 89):

```typescript
  const decorationsRef = useRef<string[]>([]);
```

**Add the gutter decoration fetch-and-apply function** after the `handleSave` callback (after line 106):

```typescript
  const applyGitDecorations = useCallback(async () => {
    if (!editorRef.current || !projectPath) return;
    try {
      const info = await window.sai.gitDiffLines(projectPath, filePath);
      const decorations: monaco.editor.IModelDeltaDecoration[] = [];

      for (const range of info.added) {
        decorations.push({
          range: new monaco.Range(range.startLine, 1, range.endLine, 1),
          options: {
            isWholeLine: true,
            linesDecorationsClassName: 'git-gutter-added',
            minimap: { color: '#2ea04370', position: monaco.editor.MinimapPosition.Gutter },
          },
        });
      }

      for (const range of info.modified) {
        decorations.push({
          range: new monaco.Range(range.startLine, 1, range.endLine, 1),
          options: {
            isWholeLine: true,
            linesDecorationsClassName: 'git-gutter-modified',
            minimap: { color: '#0078d470', position: monaco.editor.MinimapPosition.Gutter },
          },
        });
      }

      for (const lineNum of info.deleted) {
        decorations.push({
          range: new monaco.Range(lineNum, 1, lineNum, 1),
          options: {
            linesDecorationsClassName: 'git-gutter-deleted',
            minimap: { color: '#f8514970', position: monaco.editor.MinimapPosition.Gutter },
          },
        });
      }

      decorationsRef.current = editorRef.current.deltaDecorations(
        decorationsRef.current,
        decorations,
      );
    } catch {
      // Silently ignore — decorations are non-critical
    }
  }, [projectPath, filePath]);
```

**Call `applyGitDecorations` after editor creation** — inside the `useEffect` that creates the editor (around line 108-173), add after `editor.focus();` (line 165):

```typescript
    applyGitDecorations();
```

**Call `applyGitDecorations` after save** — in `handleSave` (around line 94-106), add after `setSaveError(false);` (line 101):

```typescript
      applyGitDecorations();
```

- [ ] **Step 2: Add CSS for gutter decorations**

In `src/components/FileExplorer/MonacoEditor.tsx`, add to the `<style>` block (around line 233, inside the template literal):

```css
        .git-gutter-added {
          border-left: 3px solid #2ea043 !important;
          margin-left: 3px;
        }
        .git-gutter-modified {
          border-left: 3px solid #1b81e5 !important;
          margin-left: 3px;
        }
        .git-gutter-deleted {
          margin-left: 3px;
          width: 0 !important;
          height: 0 !important;
          border-left: 5px solid transparent;
          border-right: 5px solid transparent;
          border-top: 5px solid #f85149;
          position: relative;
          top: -2px;
        }
```

- [ ] **Step 3: Pass `projectPath` from CodePanel**

In `src/components/CodePanel/CodePanel.tsx`, find the MonacoEditor usage (around line 326-338) and add `projectPath`:

Change:
```tsx
        <MonacoEditor
          key={activeFile.path}
          filePath={activeFile.path}
          content={activeFile.content}
          fontSize={editorFontSize}
          minimap={editorMinimap}
```

To:
```tsx
        <MonacoEditor
          key={activeFile.path}
          filePath={activeFile.path}
          content={activeFile.content}
          fontSize={editorFontSize}
          minimap={editorMinimap}
          projectPath={projectPath}
```

- [ ] **Step 4: TypeScript check**

Run: `npx tsc --noEmit 2>&1 | tail -20`
Expected: No errors

- [ ] **Step 5: Run full test suite**

Run: `npx vitest run --reporter=verbose 2>&1 | tail -40`
Expected: All tests pass

- [ ] **Step 6: Commit**

```bash
git add src/components/FileExplorer/MonacoEditor.tsx src/components/CodePanel/CodePanel.tsx
git commit -m "feat: add VS Code-style git gutter decorations to editor"
```

---

### Task 5: Build verification and manual testing

- [ ] **Step 1: Run production build**

Run: `npx vite build 2>&1 | tail -20`
Expected: Build completes without errors

- [ ] **Step 2: Run the app and verify diff view**

Start the dev server and open a file with git changes in diff view. Verify:
- Monaco diff editor renders (not the old Shiki viewer)
- Minimap is visible in the diff view
- Unified/split toggle works
- Syntax highlighting works
- Staged vs unstaged diffs show correctly

- [ ] **Step 3: Verify git gutter decorations in editor**

Open a file with uncommitted changes in the regular editor. Verify:
- Green bars appear in the gutter for added lines
- Blue bars appear for modified lines  
- Red triangles appear where lines were deleted
- Minimap shows colored stripes for all change types
- After saving, decorations update correctly

- [ ] **Step 4: Final commit if any fixes needed**

```bash
git add -A
git commit -m "fix: address issues found during manual testing"
```
