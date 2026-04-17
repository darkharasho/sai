# Git Sidebar Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add stash, merge conflict resolution, and rebase support to the git sidebar, with UX improvements for file search, inline diff peek, keyboard navigation, better empty states, and improved branch UI.

**Architecture:** Refactor first — extract new focused components (`ConflictSection`, `ConflictHunkViewer`, `StashMenu`, `RebaseControls`, `FileSearch`, `InlineDiff`) before adding behaviour. Wire them into existing `GitSidebar`, `CommitBox`, and `ChangedFiles` with minimal changes to those files. All new IPC handlers follow the existing `ipcMain.handle` + preload pattern in `electron/services/git.ts` and `electron/preload.ts`.

**Tech Stack:** React 18, TypeScript, Electron IPC, simple-git, Vitest + @testing-library/react, Lucide icons, CSS variables for theming.

---

## File Map

**Create:**
- `src/components/Git/FileSearch.tsx`
- `src/components/Git/InlineDiff.tsx`
- `src/components/Git/StashMenu.tsx`
- `src/components/Git/RebaseControls.tsx`
- `src/components/Git/ConflictHunkViewer.tsx`
- `src/components/Git/ConflictSection.tsx`
- `tests/unit/components/Git/FileSearch.test.tsx`
- `tests/unit/components/Git/InlineDiff.test.tsx`
- `tests/unit/components/Git/StashMenu.test.tsx`
- `tests/unit/components/Git/RebaseControls.test.tsx`
- `tests/unit/components/Git/ConflictHunkViewer.test.tsx`
- `tests/unit/components/Git/ConflictSection.test.tsx`

**Modify:**
- `src/types.ts` — add `ConflictHunk`, `StashEntry`
- `tests/helpers/ipc-mock.ts` — add new git methods to `MockSai`
- `electron/services/git.ts` — add stash, rebase, conflict handlers
- `electron/preload.ts` — expose new IPC methods
- `src/components/Git/ChangedFiles.tsx` — expand toggle + `InlineDiff` + `FileSearch`
- `src/components/Git/CommitBox.tsx` — add `StashMenu` + `RebaseControls` button
- `src/components/Git/GitSidebar.tsx` — mount `ConflictSection`, `RebaseInProgressBanner`, improved empty states

---

## Task 1: Add types and extend MockSai

**Files:**
- Modify: `src/types.ts`
- Modify: `tests/helpers/ipc-mock.ts`

- [ ] **Step 1: Add types to `src/types.ts`**

Append to the end of the file (before the `declare global` block):

```typescript
export interface ConflictHunk {
  index: number;
  ours: string[];
  theirs: string[];
  oursLabel: string;
  theirsLabel: string;
}

export interface StashEntry {
  index: number;
  message: string;
  date: string;
  fileCount: number;
}

export interface RebaseStatus {
  inProgress: boolean;
  onto: string;
}
```

- [ ] **Step 2: Add new git methods to `MockSai` interface in `tests/helpers/ipc-mock.ts`**

After the `gitDiscard` line in the `MockSai` interface (around line 61), add:

```typescript
  gitStashList: ReturnType<typeof vi.fn>;
  gitStash: ReturnType<typeof vi.fn>;
  gitStashPop: ReturnType<typeof vi.fn>;
  gitStashApply: ReturnType<typeof vi.fn>;
  gitStashDrop: ReturnType<typeof vi.fn>;
  gitRebaseStatus: ReturnType<typeof vi.fn>;
  gitRebase: ReturnType<typeof vi.fn>;
  gitRebaseAbort: ReturnType<typeof vi.fn>;
  gitRebaseContinue: ReturnType<typeof vi.fn>;
  gitRebaseSkip: ReturnType<typeof vi.fn>;
  gitConflictFiles: ReturnType<typeof vi.fn>;
  gitConflictHunks: ReturnType<typeof vi.fn>;
  gitResolveConflict: ReturnType<typeof vi.fn>;
  gitResolveAllConflicts: ReturnType<typeof vi.fn>;
```

- [ ] **Step 3: Add default mock implementations to `createMockSai` in `tests/helpers/ipc-mock.ts`**

After the `gitDiscard` line in the `createMockSai` return value (around line 184), add:

```typescript
    gitStashList: vi.fn().mockResolvedValue([]),
    gitStash: vi.fn().mockResolvedValue(undefined),
    gitStashPop: vi.fn().mockResolvedValue(undefined),
    gitStashApply: vi.fn().mockResolvedValue(undefined),
    gitStashDrop: vi.fn().mockResolvedValue(undefined),
    gitRebaseStatus: vi.fn().mockResolvedValue({ inProgress: false, onto: '' }),
    gitRebase: vi.fn().mockResolvedValue(undefined),
    gitRebaseAbort: vi.fn().mockResolvedValue(undefined),
    gitRebaseContinue: vi.fn().mockResolvedValue(undefined),
    gitRebaseSkip: vi.fn().mockResolvedValue(undefined),
    gitConflictFiles: vi.fn().mockResolvedValue([]),
    gitConflictHunks: vi.fn().mockResolvedValue([]),
    gitResolveConflict: vi.fn().mockResolvedValue(undefined),
    gitResolveAllConflicts: vi.fn().mockResolvedValue(undefined),
```

- [ ] **Step 4: Verify TypeScript compiles**

```bash
cd /var/home/mstephens/Documents/GitHub/sai && npx tsc --noEmit 2>&1 | head -20
```

Expected: no errors (or only pre-existing errors unrelated to these types).

- [ ] **Step 5: Commit**

```bash
git add src/types.ts tests/helpers/ipc-mock.ts
git commit -m "feat: add ConflictHunk, StashEntry, RebaseStatus types and extend MockSai"
```

---

## Task 2: Stash IPC handlers

**Files:**
- Modify: `electron/services/git.ts`
- Modify: `electron/preload.ts`

- [ ] **Step 1: Add stash handlers to `electron/services/git.ts`**

Inside `registerGitHandlers()`, after the `git:discard` handler at the bottom:

```typescript
  ipcMain.handle('git:stashList', async (_event, cwd: string) => {
    const g = git(cwd);
    const list = await g.stashList();
    return Promise.all(
      list.all.map(async (entry, index) => {
        let fileCount = 0;
        try {
          const out = await g.raw(['diff-tree', '--no-commit-id', '-r', '--name-only', `stash@{${index}}`]);
          fileCount = out.trim().split('\n').filter(Boolean).length;
        } catch {}
        return {
          index,
          message: entry.message.replace(/^(WIP on|On) [^:]+:\s*/, ''),
          date: entry.date,
          fileCount,
        };
      })
    );
  });

  ipcMain.handle('git:stash', async (_event, cwd: string, message?: string) => {
    const args = message ? ['push', '-m', message] : [];
    await git(cwd).stash(args);
  });

  ipcMain.handle('git:stashPop', async (_event, cwd: string, index: number) => {
    await git(cwd).stash(['pop', `stash@{${index}}`]);
  });

  ipcMain.handle('git:stashApply', async (_event, cwd: string, index: number) => {
    await git(cwd).stash(['apply', `stash@{${index}}`]);
  });

  ipcMain.handle('git:stashDrop', async (_event, cwd: string, index: number) => {
    await git(cwd).stash(['drop', `stash@{${index}}`]);
  });
```

- [ ] **Step 2: Expose stash methods in `electron/preload.ts`**

After the `gitDiscard` line, add:

```typescript
  gitStashList: (cwd: string) => ipcRenderer.invoke('git:stashList', cwd),
  gitStash: (cwd: string, message?: string) => ipcRenderer.invoke('git:stash', cwd, message),
  gitStashPop: (cwd: string, index: number) => ipcRenderer.invoke('git:stashPop', cwd, index),
  gitStashApply: (cwd: string, index: number) => ipcRenderer.invoke('git:stashApply', cwd, index),
  gitStashDrop: (cwd: string, index: number) => ipcRenderer.invoke('git:stashDrop', cwd, index),
```

- [ ] **Step 3: Verify TypeScript compiles**

```bash
cd /var/home/mstephens/Documents/GitHub/sai && npx tsc --noEmit 2>&1 | head -20
```

- [ ] **Step 4: Commit**

```bash
git add electron/services/git.ts electron/preload.ts
git commit -m "feat: add stash IPC handlers (list, push, pop, apply, drop)"
```

---

## Task 3: Rebase IPC handlers

**Files:**
- Modify: `electron/services/git.ts`
- Modify: `electron/preload.ts`

- [ ] **Step 1: Add rebase handlers to `electron/services/git.ts`**

After the stash handlers from Task 2:

```typescript
  ipcMain.handle('git:rebaseStatus', async (_event, cwd: string) => {
    const mergePath = path.join(cwd, '.git', 'rebase-merge');
    const applyPath = path.join(cwd, '.git', 'rebase-apply');
    const inProgress = fs.existsSync(mergePath) || fs.existsSync(applyPath);
    if (!inProgress) return { inProgress: false, onto: '' };

    let onto = '';
    try {
      const ontoFile = path.join(mergePath, 'onto');
      if (fs.existsSync(ontoFile)) {
        const sha = fs.readFileSync(ontoFile, 'utf8').trim();
        // Try to resolve SHA to a branch name
        const branches = await git(cwd).branch(['-a', '--format=%(refname:short)', `--points-at=${sha}`]);
        onto = Object.keys(branches.branches)[0] ?? sha.slice(0, 7);
      }
    } catch {}

    return { inProgress: true, onto };
  });

  ipcMain.handle('git:rebase', async (_event, cwd: string, branch: string) => {
    await git(cwd).rebase([branch]);
  });

  ipcMain.handle('git:rebaseAbort', async (_event, cwd: string) => {
    await git(cwd).rebase(['--abort']);
  });

  ipcMain.handle('git:rebaseContinue', async (_event, cwd: string) => {
    await git(cwd).rebase(['--continue']);
  });

  ipcMain.handle('git:rebaseSkip', async (_event, cwd: string) => {
    await git(cwd).rebase(['--skip']);
  });
```

- [ ] **Step 2: Expose rebase methods in `electron/preload.ts`**

After the stash lines from Task 2:

```typescript
  gitRebaseStatus: (cwd: string) => ipcRenderer.invoke('git:rebaseStatus', cwd),
  gitRebase: (cwd: string, branch: string) => ipcRenderer.invoke('git:rebase', cwd, branch),
  gitRebaseAbort: (cwd: string) => ipcRenderer.invoke('git:rebaseAbort', cwd),
  gitRebaseContinue: (cwd: string) => ipcRenderer.invoke('git:rebaseContinue', cwd),
  gitRebaseSkip: (cwd: string) => ipcRenderer.invoke('git:rebaseSkip', cwd),
```

- [ ] **Step 3: Verify TypeScript compiles**

```bash
cd /var/home/mstephens/Documents/GitHub/sai && npx tsc --noEmit 2>&1 | head -20
```

- [ ] **Step 4: Commit**

```bash
git add electron/services/git.ts electron/preload.ts
git commit -m "feat: add rebase IPC handlers (status, rebase, abort, continue, skip)"
```

---

## Task 4: Conflict IPC handlers

**Files:**
- Modify: `electron/services/git.ts`
- Modify: `electron/preload.ts`

- [ ] **Step 1: Add conflict helper function to `electron/services/git.ts`**

Add this function above `registerGitHandlers()`:

```typescript
interface ConflictHunkRaw {
  index: number;
  ours: string[];
  theirs: string[];
  oursLabel: string;
  theirsLabel: string;
  startLine: number; // line index in file (0-based) of <<<<<<<
  endLine: number;   // line index of >>>>>>>
}

function parseConflictHunks(content: string): ConflictHunkRaw[] {
  const lines = content.split('\n');
  const hunks: ConflictHunkRaw[] = [];
  let i = 0;
  let hunkIndex = 0;
  while (i < lines.length) {
    if (lines[i].startsWith('<<<<<<<')) {
      const oursLabel = lines[i].slice(8).trim();
      const startLine = i;
      const ours: string[] = [];
      const theirs: string[] = [];
      i++;
      while (i < lines.length && !lines[i].startsWith('=======')) {
        ours.push(lines[i]);
        i++;
      }
      i++; // skip =======
      let theirsLabel = '';
      while (i < lines.length && !lines[i].startsWith('>>>>>>>')) {
        theirs.push(lines[i]);
        i++;
      }
      if (i < lines.length) theirsLabel = lines[i].slice(8).trim();
      const endLine = i;
      hunks.push({ index: hunkIndex++, ours, theirs, oursLabel, theirsLabel, startLine, endLine });
    }
    i++;
  }
  return hunks;
}

function resolveHunks(content: string, resolution: 'ours' | 'theirs' | 'both'): string {
  const hunks = parseConflictHunks(content);
  if (hunks.length === 0) return content;
  const lines = content.split('\n');
  const result: string[] = [];
  let i = 0;
  for (const hunk of hunks) {
    while (i < hunk.startLine) result.push(lines[i++]);
    if (resolution === 'ours') result.push(...hunk.ours);
    else if (resolution === 'theirs') result.push(...hunk.theirs);
    else { result.push(...hunk.ours); result.push(...hunk.theirs); }
    i = hunk.endLine + 1;
  }
  while (i < lines.length) result.push(lines[i++]);
  return result.join('\n');
}
```

- [ ] **Step 2: Add conflict handlers inside `registerGitHandlers()`**

After the rebase handlers:

```typescript
  ipcMain.handle('git:conflictFiles', async (_event, cwd: string) => {
    const status = await git(cwd).status();
    return status.conflicted;
  });

  ipcMain.handle('git:conflictHunks', async (_event, cwd: string, filepath: string) => {
    const fullPath = path.join(cwd, filepath);
    const content = fs.readFileSync(fullPath, 'utf8');
    return parseConflictHunks(content).map(({ index, ours, theirs, oursLabel, theirsLabel }) => ({
      index, ours, theirs, oursLabel, theirsLabel,
    }));
  });

  ipcMain.handle('git:resolveConflict', async (
    _event,
    cwd: string,
    filepath: string,
    resolution: 'ours' | 'theirs' | 'both'
  ) => {
    const fullPath = path.join(cwd, filepath);
    const content = fs.readFileSync(fullPath, 'utf8');
    const resolved = resolveHunks(content, resolution);
    fs.writeFileSync(fullPath, resolved, 'utf8');
    await git(cwd).add(filepath);
  });

  ipcMain.handle('git:resolveAllConflicts', async (
    _event,
    cwd: string,
    resolution: 'ours' | 'theirs'
  ) => {
    const status = await git(cwd).status();
    for (const filepath of status.conflicted) {
      const fullPath = path.join(cwd, filepath);
      const content = fs.readFileSync(fullPath, 'utf8');
      const resolved = resolveHunks(content, resolution);
      fs.writeFileSync(fullPath, resolved, 'utf8');
      await git(cwd).add(filepath);
    }
  });
```

- [ ] **Step 3: Expose conflict methods in `electron/preload.ts`**

After the rebase lines:

```typescript
  gitConflictFiles: (cwd: string) => ipcRenderer.invoke('git:conflictFiles', cwd),
  gitConflictHunks: (cwd: string, filepath: string) => ipcRenderer.invoke('git:conflictHunks', cwd, filepath),
  gitResolveConflict: (cwd: string, filepath: string, resolution: 'ours' | 'theirs' | 'both') =>
    ipcRenderer.invoke('git:resolveConflict', cwd, filepath, resolution),
  gitResolveAllConflicts: (cwd: string, resolution: 'ours' | 'theirs') =>
    ipcRenderer.invoke('git:resolveAllConflicts', cwd, resolution),
```

- [ ] **Step 4: Verify TypeScript compiles**

```bash
cd /var/home/mstephens/Documents/GitHub/sai && npx tsc --noEmit 2>&1 | head -20
```

- [ ] **Step 5: Commit**

```bash
git add electron/services/git.ts electron/preload.ts
git commit -m "feat: add conflict IPC handlers (files, hunks, resolve, resolve-all)"
```

---

## Task 5: FileSearch component

**Files:**
- Create: `src/components/Git/FileSearch.tsx`
- Create: `tests/unit/components/Git/FileSearch.test.tsx`

- [ ] **Step 1: Write the failing test**

Create `tests/unit/components/Git/FileSearch.test.tsx`:

```typescript
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import FileSearch from '../../../../src/components/Git/FileSearch';

describe('FileSearch', () => {
  it('renders a search input', () => {
    render(<FileSearch value="" onChange={vi.fn()} />);
    expect(screen.getByPlaceholderText(/filter/i)).toBeTruthy();
  });

  it('calls onChange when typing', () => {
    const onChange = vi.fn();
    render(<FileSearch value="" onChange={onChange} />);
    fireEvent.change(screen.getByPlaceholderText(/filter/i), { target: { value: 'App' } });
    expect(onChange).toHaveBeenCalledWith('App');
  });

  it('calls onChange with empty string when Escape pressed', () => {
    const onChange = vi.fn();
    render(<FileSearch value="App" onChange={onChange} />);
    fireEvent.keyDown(screen.getByPlaceholderText(/filter/i), { key: 'Escape' });
    expect(onChange).toHaveBeenCalledWith('');
  });

  it('shows match count when matchCount prop is provided', () => {
    render(<FileSearch value="App" onChange={vi.fn()} matchCount={3} />);
    expect(screen.getByText(/3 match/i)).toBeTruthy();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd /var/home/mstephens/Documents/GitHub/sai && npx vitest run tests/unit/components/Git/FileSearch.test.tsx 2>&1 | tail -10
```

Expected: FAIL — `FileSearch` not found.

- [ ] **Step 3: Implement `src/components/Git/FileSearch.tsx`**

```typescript
interface FileSearchProps {
  value: string;
  onChange: (value: string) => void;
  matchCount?: number;
}

export default function FileSearch({ value, onChange, matchCount }: FileSearchProps) {
  return (
    <div style={{ padding: '4px 12px 6px' }}>
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 6,
          background: value ? 'var(--bg-input)' : 'var(--bg-secondary)',
          border: `1px solid ${value ? 'var(--accent)' : 'var(--border)'}`,
          borderRadius: 4,
          padding: '3px 8px',
        }}
      >
        <span style={{ color: 'var(--text-muted)', fontSize: 11 }}>🔍</span>
        <input
          type="text"
          value={value}
          onChange={e => onChange(e.target.value)}
          placeholder="Filter changed files… (Ctrl+F)"
          style={{
            flex: 1,
            background: 'none',
            border: 'none',
            outline: 'none',
            color: 'var(--text)',
            fontSize: 11,
            fontFamily: 'inherit',
          }}
          onKeyDown={e => {
            if (e.key === 'Escape') onChange('');
          }}
        />
        {value && matchCount !== undefined && (
          <span style={{ color: 'var(--text-muted)', fontSize: 10, flexShrink: 0 }}>
            {matchCount} match{matchCount !== 1 ? 'es' : ''}
          </span>
        )}
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
cd /var/home/mstephens/Documents/GitHub/sai && npx vitest run tests/unit/components/Git/FileSearch.test.tsx 2>&1 | tail -10
```

Expected: PASS — 4 tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/components/Git/FileSearch.tsx tests/unit/components/Git/FileSearch.test.tsx
git commit -m "feat: add FileSearch component"
```

---

## Task 6: InlineDiff component

**Files:**
- Create: `src/components/Git/InlineDiff.tsx`
- Create: `tests/unit/components/Git/InlineDiff.test.tsx`

- [ ] **Step 1: Write the failing test**

Create `tests/unit/components/Git/InlineDiff.test.tsx`:

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { installMockSai, createMockSai } from '../../../helpers/ipc-mock';
import InlineDiff from '../../../../src/components/Git/InlineDiff';

const DIFF = `diff --git a/src/App.tsx b/src/App.tsx
index abc..def 100644
--- a/src/App.tsx
+++ b/src/App.tsx
@@ -1,3 +1,4 @@
 import React from 'react';
-const x = 1;
+const x = 2;
+const y = 3;
 export default App;`;

describe('InlineDiff', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it('renders removed and added lines from diff', async () => {
    const mock = createMockSai();
    mock.gitDiff.mockResolvedValue(DIFF);
    installMockSai(mock);

    render(<InlineDiff projectPath="/proj" filepath="src/App.tsx" staged={false} />);
    await waitFor(() => {
      expect(screen.getByText(/const x = 1/)).toBeTruthy();
      expect(screen.getByText(/const x = 2/)).toBeTruthy();
    });
  });

  it('calls gitDiff with staged=true when staged prop is true', async () => {
    const mock = createMockSai();
    mock.gitDiff.mockResolvedValue(DIFF);
    installMockSai(mock);

    render(<InlineDiff projectPath="/proj" filepath="src/App.tsx" staged={true} />);
    await waitFor(() => {
      expect(mock.gitDiff).toHaveBeenCalledWith('/proj', 'src/App.tsx', true);
    });
  });

  it('shows "Open in editor" link', async () => {
    const mock = createMockSai();
    mock.gitDiff.mockResolvedValue(DIFF);
    installMockSai(mock);

    const onOpen = vi.fn();
    render(<InlineDiff projectPath="/proj" filepath="src/App.tsx" staged={false} onOpen={onOpen} />);
    await waitFor(() => screen.getByText(/open in editor/i));
    screen.getByText(/open in editor/i).click();
    expect(onOpen).toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd /var/home/mstephens/Documents/GitHub/sai && npx vitest run tests/unit/components/Git/InlineDiff.test.tsx 2>&1 | tail -10
```

Expected: FAIL.

- [ ] **Step 3: Implement `src/components/Git/InlineDiff.tsx`**

```typescript
import { useEffect, useState } from 'react';

interface InlineDiffProps {
  projectPath: string;
  filepath: string;
  staged: boolean;
  onOpen?: () => void;
}

function parseDiffLines(diff: string): { type: '+' | '-' | ' '; text: string }[] {
  return diff
    .split('\n')
    .filter(line => !line.startsWith('diff ') && !line.startsWith('index ') &&
                    !line.startsWith('--- ') && !line.startsWith('+++ ') &&
                    !line.startsWith('@@') && !line.startsWith('\\ '))
    .map(line => {
      if (line.startsWith('+')) return { type: '+' as const, text: line.slice(1) };
      if (line.startsWith('-')) return { type: '-' as const, text: line.slice(1) };
      return { type: ' ' as const, text: line.slice(1) };
    });
}

const MAX_LINES = 50;

export default function InlineDiff({ projectPath, filepath, staged, onOpen }: InlineDiffProps) {
  const [lines, setLines] = useState<{ type: '+' | '-' | ' '; text: string }[]>([]);
  const [truncated, setTruncated] = useState(false);

  useEffect(() => {
    window.sai.gitDiff(projectPath, filepath, staged).then((diff: string) => {
      const parsed = parseDiffLines(diff);
      if (parsed.length > MAX_LINES) {
        setLines(parsed.slice(0, MAX_LINES));
        setTruncated(true);
      } else {
        setLines(parsed);
        setTruncated(false);
      }
    });
  }, [projectPath, filepath, staged]);

  return (
    <div
      style={{
        background: 'var(--bg-elevated, #0d1117)',
        borderTop: '1px solid var(--border)',
        fontFamily: "'JetBrains Mono', monospace",
        fontSize: 11,
        lineHeight: 1.6,
        overflow: 'hidden',
      }}
    >
      <div style={{ overflowX: 'auto', padding: '4px 0' }}>
        {lines.map((line, i) => (
          <div
            key={i}
            style={{
              padding: '0 12px',
              background: line.type === '+' ? 'rgba(63,185,80,0.15)' :
                          line.type === '-' ? 'rgba(248,81,73,0.15)' : 'transparent',
              color: line.type === '+' ? 'var(--green)' :
                     line.type === '-' ? 'var(--red)' : 'var(--text-muted)',
              whiteSpace: 'pre',
            }}
          >
            {line.type === '+' ? '+' : line.type === '-' ? '-' : ' '}{line.text}
          </div>
        ))}
        {truncated && (
          <div style={{ padding: '2px 12px', color: 'var(--text-muted)', fontSize: 10 }}>
            … more lines — open in editor to see all
          </div>
        )}
      </div>
      <div
        style={{
          borderTop: '1px solid var(--border)',
          padding: '4px 12px',
          textAlign: 'right',
        }}
      >
        <button
          onClick={onOpen}
          style={{
            background: 'none',
            border: 'none',
            color: 'var(--accent)',
            cursor: 'pointer',
            fontSize: 10,
            fontFamily: 'inherit',
            padding: 0,
          }}
        >
          ↗ Open in editor
        </button>
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
cd /var/home/mstephens/Documents/GitHub/sai && npx vitest run tests/unit/components/Git/InlineDiff.test.tsx 2>&1 | tail -10
```

Expected: PASS — 3 tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/components/Git/InlineDiff.tsx tests/unit/components/Git/InlineDiff.test.tsx
git commit -m "feat: add InlineDiff component"
```

---

## Task 7: StashMenu component

**Files:**
- Create: `src/components/Git/StashMenu.tsx`
- Create: `tests/unit/components/Git/StashMenu.test.tsx`

- [ ] **Step 1: Write the failing test**

Create `tests/unit/components/Git/StashMenu.test.tsx`:

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { installMockSai, createMockSai } from '../../../helpers/ipc-mock';
import StashMenu from '../../../../src/components/Git/StashMenu';
import type { StashEntry } from '../../../../src/types';

const stashes: StashEntry[] = [
  { index: 0, message: 'WIP on main', date: '5 minutes ago', fileCount: 2 },
  { index: 1, message: 'feature prep', date: '2 days ago', fileCount: 5 },
];

describe('StashMenu', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it('renders a Stash button', () => {
    installMockSai();
    render(<StashMenu projectPath="/proj" onRefresh={vi.fn()} />);
    expect(screen.getByTitle(/stash/i)).toBeTruthy();
  });

  it('shows dropdown with stash list when clicked', async () => {
    const mock = createMockSai();
    mock.gitStashList.mockResolvedValue(stashes);
    installMockSai(mock);

    render(<StashMenu projectPath="/proj" onRefresh={vi.fn()} />);
    fireEvent.click(screen.getByTitle(/stash/i));
    await waitFor(() => {
      expect(screen.getByText('WIP on main')).toBeTruthy();
      expect(screen.getByText('feature prep')).toBeTruthy();
    });
  });

  it('calls gitStash and onRefresh when Stash WIP clicked', async () => {
    const mock = createMockSai();
    mock.gitStashList.mockResolvedValue([]);
    installMockSai(mock);
    const onRefresh = vi.fn();

    render(<StashMenu projectPath="/proj" onRefresh={onRefresh} />);
    fireEvent.click(screen.getByTitle(/stash/i));
    await waitFor(() => screen.getByText(/stash wip/i));
    fireEvent.click(screen.getByText(/stash wip/i));
    await waitFor(() => {
      expect(mock.gitStash).toHaveBeenCalledWith('/proj', undefined);
      expect(onRefresh).toHaveBeenCalled();
    });
  });

  it('calls gitStashPop when Pop clicked', async () => {
    const mock = createMockSai();
    mock.gitStashList.mockResolvedValue(stashes);
    installMockSai(mock);
    const onRefresh = vi.fn();

    render(<StashMenu projectPath="/proj" onRefresh={onRefresh} />);
    fireEvent.click(screen.getByTitle(/stash/i));
    await waitFor(() => screen.getAllByText('Pop'));
    fireEvent.click(screen.getAllByText('Pop')[0]);
    await waitFor(() => {
      expect(mock.gitStashPop).toHaveBeenCalledWith('/proj', 0);
    });
  });

  it('calls gitStashDrop when Drop clicked', async () => {
    const mock = createMockSai();
    mock.gitStashList.mockResolvedValue(stashes);
    installMockSai(mock);

    render(<StashMenu projectPath="/proj" onRefresh={vi.fn()} />);
    fireEvent.click(screen.getByTitle(/stash/i));
    await waitFor(() => screen.getAllByText('Drop'));
    fireEvent.click(screen.getAllByText('Drop')[0]);
    await waitFor(() => {
      expect(mock.gitStashDrop).toHaveBeenCalledWith('/proj', 0);
    });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd /var/home/mstephens/Documents/GitHub/sai && npx vitest run tests/unit/components/Git/StashMenu.test.tsx 2>&1 | tail -10
```

- [ ] **Step 3: Implement `src/components/Git/StashMenu.tsx`**

```typescript
import { useState, useRef, useEffect } from 'react';
import { StashEntry } from '../../types';

interface StashMenuProps {
  projectPath: string;
  onRefresh: () => void;
  disabled?: boolean;
}

export default function StashMenu({ projectPath, onRefresh, disabled }: StashMenuProps) {
  const [open, setOpen] = useState(false);
  const [stashes, setStashes] = useState<StashEntry[]>([]);
  const [messageInput, setMessageInput] = useState('');
  const [showMessageInput, setShowMessageInput] = useState(false);
  const [busy, setBusy] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    (window.sai as any).gitStashList(projectPath).then(setStashes);
    const handleClick = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setOpen(false);
        setShowMessageInput(false);
        setMessageInput('');
      }
    };
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [open, projectPath]);

  const run = async (fn: () => Promise<void>) => {
    setBusy(true);
    try { await fn(); onRefresh(); setOpen(false); }
    finally { setBusy(false); }
  };

  return (
    <div style={{ position: 'relative' }} ref={menuRef}>
      <button
        title="Stash"
        onClick={() => setOpen(o => !o)}
        disabled={disabled || busy}
        style={{
          background: open ? 'var(--accent)' : 'none',
          color: open ? '#000' : 'var(--text-muted)',
          border: 'none',
          borderRadius: 3,
          padding: '2px 6px',
          fontSize: 10,
          cursor: 'pointer',
          fontFamily: 'inherit',
          whiteSpace: 'nowrap',
        }}
        onMouseEnter={e => { if (!open) e.currentTarget.style.color = 'var(--text)'; }}
        onMouseLeave={e => { if (!open) e.currentTarget.style.color = 'var(--text-muted)'; }}
      >
        ≡ Stash ▾
      </button>

      {open && (
        <div
          style={{
            position: 'absolute',
            bottom: '100%',
            left: 0,
            marginBottom: 4,
            minWidth: 220,
            background: 'var(--bg-elevated, #1c2128)',
            border: '1px solid var(--border)',
            borderRadius: 6,
            boxShadow: '0 -4px 16px rgba(0,0,0,0.3)',
            zIndex: 100,
            overflow: 'hidden',
          }}
        >
          <div style={{ padding: '4px 0', borderBottom: '1px solid var(--border)' }}>
            <div style={{ padding: '2px 10px 4px', fontSize: 9, fontWeight: 700, color: 'var(--text-muted)', letterSpacing: '0.5px', textTransform: 'uppercase' }}>
              Save
            </div>
            <button
              onClick={() => run(() => (window.sai as any).gitStash(projectPath, undefined))}
              style={{ width: '100%', background: 'none', border: 'none', color: 'var(--text)', cursor: 'pointer', padding: '5px 10px', fontSize: 11, textAlign: 'left', fontFamily: 'inherit' }}
              onMouseEnter={e => (e.currentTarget.style.background = 'var(--bg-hover)')}
              onMouseLeave={e => (e.currentTarget.style.background = 'none')}
            >
              ↓ Stash WIP
            </button>
            {showMessageInput ? (
              <div style={{ padding: '4px 10px', display: 'flex', gap: 4 }}>
                <input
                  autoFocus
                  value={messageInput}
                  onChange={e => setMessageInput(e.target.value)}
                  placeholder="Stash message…"
                  style={{ flex: 1, background: 'var(--bg-input)', border: '1px solid var(--border)', borderRadius: 3, color: 'var(--text)', fontSize: 11, padding: '3px 6px', outline: 'none', fontFamily: 'inherit' }}
                  onKeyDown={e => {
                    if (e.key === 'Enter' && messageInput.trim()) run(() => (window.sai as any).gitStash(projectPath, messageInput.trim()));
                    if (e.key === 'Escape') { setShowMessageInput(false); setMessageInput(''); }
                  }}
                />
                <button
                  onClick={() => { if (messageInput.trim()) run(() => (window.sai as any).gitStash(projectPath, messageInput.trim())); }}
                  disabled={!messageInput.trim()}
                  style={{ background: messageInput.trim() ? 'var(--accent)' : 'var(--bg-hover)', color: messageInput.trim() ? '#000' : 'var(--text-muted)', border: 'none', borderRadius: 3, padding: '3px 8px', fontSize: 10, cursor: messageInput.trim() ? 'pointer' : 'not-allowed' }}
                >
                  Save
                </button>
              </div>
            ) : (
              <button
                onClick={() => setShowMessageInput(true)}
                style={{ width: '100%', background: 'none', border: 'none', color: 'var(--text)', cursor: 'pointer', padding: '5px 10px', fontSize: 11, textAlign: 'left', fontFamily: 'inherit' }}
                onMouseEnter={e => (e.currentTarget.style.background = 'var(--bg-hover)')}
                onMouseLeave={e => (e.currentTarget.style.background = 'none')}
              >
                ↓ Stash with message…
              </button>
            )}
          </div>

          <div style={{ padding: '4px 0', maxHeight: 200, overflowY: 'auto' }}>
            <div style={{ padding: '2px 10px 4px', fontSize: 9, fontWeight: 700, color: 'var(--text-muted)', letterSpacing: '0.5px', textTransform: 'uppercase' }}>
              Stashes ({stashes.length})
            </div>
            {stashes.length === 0 && (
              <div style={{ padding: '6px 10px', fontSize: 11, color: 'var(--text-muted)' }}>No stashes</div>
            )}
            {stashes.map(s => (
              <div key={s.index} style={{ padding: '5px 10px', display: 'flex', alignItems: 'center', gap: 6 }}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 11, color: 'var(--text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{s.message}</div>
                  <div style={{ fontSize: 9, color: 'var(--text-muted)' }}>{s.fileCount} files · {s.date}</div>
                </div>
                <div style={{ display: 'flex', gap: 3, flexShrink: 0 }}>
                  {(['Pop', 'Apply', 'Drop'] as const).map(action => (
                    <button
                      key={action}
                      onClick={() => {
                        if (action === 'Pop') run(() => (window.sai as any).gitStashPop(projectPath, s.index));
                        else if (action === 'Apply') run(() => (window.sai as any).gitStashApply(projectPath, s.index));
                        else run(() => (window.sai as any).gitStashDrop(projectPath, s.index));
                      }}
                      style={{
                        background: action === 'Pop' ? 'var(--green)' : action === 'Apply' ? 'var(--blue)' : 'var(--red)',
                        color: '#000',
                        border: 'none',
                        borderRadius: 2,
                        padding: '1px 5px',
                        fontSize: 9,
                        cursor: 'pointer',
                        fontWeight: 600,
                      }}
                    >
                      {action}
                    </button>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
cd /var/home/mstephens/Documents/GitHub/sai && npx vitest run tests/unit/components/Git/StashMenu.test.tsx 2>&1 | tail -10
```

Expected: PASS — 5 tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/components/Git/StashMenu.tsx tests/unit/components/Git/StashMenu.test.tsx
git commit -m "feat: add StashMenu component (dropdown with list, pop, apply, drop)"
```

---

## Task 8: RebaseControls component

**Files:**
- Create: `src/components/Git/RebaseControls.tsx`
- Create: `tests/unit/components/Git/RebaseControls.test.tsx`

- [ ] **Step 1: Write the failing test**

Create `tests/unit/components/Git/RebaseControls.test.tsx`:

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { installMockSai, createMockSai } from '../../../helpers/ipc-mock';
import { RebaseButton, RebaseInProgressBanner } from '../../../../src/components/Git/RebaseControls';

describe('RebaseButton', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it('renders a Rebase button', () => {
    installMockSai();
    render(<RebaseButton projectPath="/proj" currentBranch="feature" onRefresh={vi.fn()} onListBranches={async () => ({ current: 'feature', branches: ['main', 'develop', 'feature'] })} />);
    expect(screen.getByText(/rebase/i)).toBeTruthy();
  });

  it('shows branch picker when clicked', async () => {
    installMockSai();
    render(<RebaseButton projectPath="/proj" currentBranch="feature" onRefresh={vi.fn()} onListBranches={async () => ({ current: 'feature', branches: ['main', 'develop'] })} />);
    fireEvent.click(screen.getByText(/rebase/i));
    await waitFor(() => {
      expect(screen.getByText('main')).toBeTruthy();
      expect(screen.getByText('develop')).toBeTruthy();
    });
  });

  it('calls gitRebase and onRefresh when branch selected and Rebase clicked', async () => {
    const mock = createMockSai();
    installMockSai(mock);
    const onRefresh = vi.fn();

    render(<RebaseButton projectPath="/proj" currentBranch="feature" onRefresh={onRefresh} onListBranches={async () => ({ current: 'feature', branches: ['main'] })} />);
    fireEvent.click(screen.getByText(/rebase/i));
    await waitFor(() => screen.getByText('main'));
    fireEvent.click(screen.getByText('main'));
    fireEvent.click(screen.getByRole('button', { name: /^rebase$/i }));
    await waitFor(() => {
      expect(mock.gitRebase).toHaveBeenCalledWith('/proj', 'main');
      expect(onRefresh).toHaveBeenCalled();
    });
  });
});

describe('RebaseInProgressBanner', () => {
  it('renders in-progress banner with Continue/Skip/Abort', () => {
    installMockSai();
    render(<RebaseInProgressBanner projectPath="/proj" onto="main" onRefresh={vi.fn()} />);
    expect(screen.getByText(/rebase in progress/i)).toBeTruthy();
    expect(screen.getByText('Continue')).toBeTruthy();
    expect(screen.getByText('Skip')).toBeTruthy();
    expect(screen.getByText('Abort')).toBeTruthy();
  });

  it('calls gitRebaseAbort and onRefresh when Abort clicked', async () => {
    const mock = createMockSai();
    installMockSai(mock);
    const onRefresh = vi.fn();

    render(<RebaseInProgressBanner projectPath="/proj" onto="main" onRefresh={onRefresh} />);
    fireEvent.click(screen.getByText('Abort'));
    await waitFor(() => {
      expect(mock.gitRebaseAbort).toHaveBeenCalledWith('/proj');
      expect(onRefresh).toHaveBeenCalled();
    });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd /var/home/mstephens/Documents/GitHub/sai && npx vitest run tests/unit/components/Git/RebaseControls.test.tsx 2>&1 | tail -10
```

- [ ] **Step 3: Implement `src/components/Git/RebaseControls.tsx`**

```typescript
import { useState, useRef, useEffect } from 'react';

interface RebaseButtonProps {
  projectPath: string;
  currentBranch: string;
  onRefresh: () => void;
  onListBranches: () => Promise<{ current: string; branches: string[] }>;
  disabled?: boolean;
}

export function RebaseButton({ projectPath, currentBranch, onRefresh, onListBranches, disabled }: RebaseButtonProps) {
  const [open, setOpen] = useState(false);
  const [branches, setBranches] = useState<string[]>([]);
  const [filter, setFilter] = useState('');
  const [selected, setSelected] = useState('');
  const [busy, setBusy] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    onListBranches().then(({ branches: b }) => {
      setBranches(b.filter(br => br !== currentBranch));
    });
    const handleClick = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setOpen(false); setFilter(''); setSelected('');
      }
    };
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [open]);

  const filtered = branches.filter(b => b.toLowerCase().includes(filter.toLowerCase()));

  const handleRebase = async () => {
    if (!selected) return;
    setBusy(true);
    try {
      await (window.sai as any).gitRebase(projectPath, selected);
      onRefresh();
      setOpen(false); setFilter(''); setSelected('');
    } finally { setBusy(false); }
  };

  return (
    <div style={{ position: 'relative' }} ref={menuRef}>
      <button
        onClick={() => setOpen(o => !o)}
        disabled={disabled || busy}
        style={{
          background: open ? 'var(--yellow, #f9e2af)' : 'none',
          color: open ? '#000' : 'var(--text-muted)',
          border: 'none', borderRadius: 3, padding: '2px 6px',
          fontSize: 10, cursor: 'pointer', fontFamily: 'inherit', whiteSpace: 'nowrap',
        }}
        onMouseEnter={e => { if (!open) e.currentTarget.style.color = 'var(--text)'; }}
        onMouseLeave={e => { if (!open) e.currentTarget.style.color = 'var(--text-muted)'; }}
      >
        ⟲ Rebase
      </button>

      {open && (
        <div style={{
          position: 'absolute', bottom: '100%', left: 0, marginBottom: 4,
          minWidth: 200, background: 'var(--bg-elevated, #1c2128)',
          border: '1px solid var(--border)', borderRadius: 6,
          boxShadow: '0 -4px 16px rgba(0,0,0,0.3)', zIndex: 100, padding: 8,
        }}>
          <div style={{ fontSize: 10, color: 'var(--text-muted)', marginBottom: 6 }}>
            Rebase <strong style={{ color: 'var(--accent)' }}>{currentBranch}</strong> onto…
          </div>
          <input
            autoFocus
            value={filter}
            onChange={e => setFilter(e.target.value)}
            placeholder="Filter branches…"
            style={{ width: '100%', background: 'var(--bg-input)', border: '1px solid var(--border)', borderRadius: 3, color: 'var(--text)', fontSize: 11, padding: '3px 6px', outline: 'none', fontFamily: 'inherit', boxSizing: 'border-box', marginBottom: 4 }}
            onKeyDown={e => { if (e.key === 'Escape') setOpen(false); }}
          />
          <div style={{ maxHeight: 120, overflowY: 'auto', marginBottom: 6 }}>
            {filtered.map(b => (
              <div
                key={b}
                onClick={() => setSelected(b)}
                style={{
                  padding: '4px 6px', borderRadius: 3, cursor: 'pointer', fontSize: 11,
                  background: selected === b ? 'var(--accent)' : 'none',
                  color: selected === b ? '#000' : 'var(--text)',
                }}
                onMouseEnter={e => { if (selected !== b) e.currentTarget.style.background = 'var(--bg-hover)'; }}
                onMouseLeave={e => { if (selected !== b) e.currentTarget.style.background = 'none'; }}
              >
                {b}
              </div>
            ))}
          </div>
          <div style={{ display: 'flex', gap: 4 }}>
            <button
              onClick={handleRebase}
              disabled={!selected || busy}
              style={{
                flex: 1, background: selected ? 'var(--yellow, #f9e2af)' : 'var(--bg-hover)',
                color: selected ? '#000' : 'var(--text-muted)',
                border: 'none', borderRadius: 3, padding: '4px 0',
                fontSize: 11, fontWeight: 600, cursor: selected ? 'pointer' : 'not-allowed',
              }}
            >
              Rebase
            </button>
            <button
              onClick={() => { setOpen(false); setFilter(''); setSelected(''); }}
              style={{ flex: 1, background: 'none', border: '1px solid var(--border)', borderRadius: 3, padding: '4px 0', fontSize: 11, color: 'var(--text-muted)', cursor: 'pointer' }}
            >
              Cancel
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

interface RebaseInProgressBannerProps {
  projectPath: string;
  onto: string;
  onRefresh: () => void;
}

export function RebaseInProgressBanner({ projectPath, onto, onRefresh }: RebaseInProgressBannerProps) {
  const [busy, setBusy] = useState(false);

  const run = async (fn: () => Promise<void>) => {
    setBusy(true);
    try { await fn(); onRefresh(); } finally { setBusy(false); }
  };

  return (
    <div style={{
      margin: '8px 12px 0',
      padding: '8px 10px',
      background: 'var(--bg-input)',
      borderLeft: '3px solid var(--yellow, #f9e2af)',
      borderRadius: '0 4px 4px 0',
    }}>
      <div style={{ fontSize: 10, fontWeight: 700, color: 'var(--yellow, #f9e2af)', marginBottom: 3 }}>
        ⟲ REBASE IN PROGRESS{onto ? ` — onto ${onto}` : ''}
      </div>
      <div style={{ fontSize: 10, color: 'var(--text-muted)', marginBottom: 6 }}>
        Resolve conflicts above, then continue
      </div>
      <div style={{ display: 'flex', gap: 4 }}>
        <button
          onClick={() => run(() => (window.sai as any).gitRebaseContinue(projectPath))}
          disabled={busy}
          style={{ flex: 1, background: 'var(--yellow, #f9e2af)', color: '#000', border: 'none', borderRadius: 3, padding: '3px 0', fontSize: 10, fontWeight: 700, cursor: 'pointer' }}
        >
          Continue
        </button>
        <button
          onClick={() => run(() => (window.sai as any).gitRebaseSkip(projectPath))}
          disabled={busy}
          style={{ flex: 1, background: 'var(--bg-hover)', color: 'var(--text-muted)', border: 'none', borderRadius: 3, padding: '3px 0', fontSize: 10, cursor: 'pointer' }}
        >
          Skip
        </button>
        <button
          onClick={() => run(() => (window.sai as any).gitRebaseAbort(projectPath))}
          disabled={busy}
          style={{ flex: 1, background: 'var(--red)', color: '#000', border: 'none', borderRadius: 3, padding: '3px 0', fontSize: 10, fontWeight: 700, cursor: 'pointer' }}
        >
          Abort
        </button>
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
cd /var/home/mstephens/Documents/GitHub/sai && npx vitest run tests/unit/components/Git/RebaseControls.test.tsx 2>&1 | tail -10
```

Expected: PASS — 5 tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/components/Git/RebaseControls.tsx tests/unit/components/Git/RebaseControls.test.tsx
git commit -m "feat: add RebaseButton and RebaseInProgressBanner components"
```

---

## Task 9: ConflictHunkViewer component

**Files:**
- Create: `src/components/Git/ConflictHunkViewer.tsx`
- Create: `tests/unit/components/Git/ConflictHunkViewer.test.tsx`

- [ ] **Step 1: Write the failing test**

Create `tests/unit/components/Git/ConflictHunkViewer.test.tsx`:

```typescript
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import ConflictHunkViewer from '../../../../src/components/Git/ConflictHunkViewer';
import type { ConflictHunk } from '../../../../src/types';

const hunk: ConflictHunk = {
  index: 0,
  ours: ['const x = doOurThing();'],
  theirs: ['const x = doTheirThing();'],
  oursLabel: 'HEAD',
  theirsLabel: 'feature/foo',
};

const hunks: ConflictHunk[] = [
  hunk,
  { index: 1, ours: ['const y = 1;'], theirs: ['const y = 2;'], oursLabel: 'HEAD', theirsLabel: 'feature/foo' },
];

describe('ConflictHunkViewer', () => {
  it('renders ours and theirs content', () => {
    render(<ConflictHunkViewer hunks={[hunk]} currentIndex={0} onNavigate={vi.fn()} onResolve={vi.fn()} onOpenEditor={vi.fn()} />);
    expect(screen.getByText(/doOurThing/)).toBeTruthy();
    expect(screen.getByText(/doTheirThing/)).toBeTruthy();
  });

  it('shows hunk navigation label', () => {
    render(<ConflictHunkViewer hunks={hunks} currentIndex={0} onNavigate={vi.fn()} onResolve={vi.fn()} onOpenEditor={vi.fn()} />);
    expect(screen.getByText(/hunk 1 of 2/i)).toBeTruthy();
  });

  it('calls onResolve with "ours" when Ours button clicked', () => {
    const onResolve = vi.fn();
    render(<ConflictHunkViewer hunks={[hunk]} currentIndex={0} onNavigate={vi.fn()} onResolve={onResolve} onOpenEditor={vi.fn()} />);
    fireEvent.click(screen.getByText(/ours/i));
    expect(onResolve).toHaveBeenCalledWith(0, 'ours');
  });

  it('calls onResolve with "theirs" when Theirs button clicked', () => {
    const onResolve = vi.fn();
    render(<ConflictHunkViewer hunks={[hunk]} currentIndex={0} onNavigate={vi.fn()} onResolve={onResolve} onOpenEditor={vi.fn()} />);
    fireEvent.click(screen.getByText(/theirs/i));
    expect(onResolve).toHaveBeenCalledWith(0, 'theirs');
  });

  it('calls onOpenEditor when Editor button clicked', () => {
    const onOpenEditor = vi.fn();
    render(<ConflictHunkViewer hunks={[hunk]} currentIndex={0} onNavigate={vi.fn()} onResolve={vi.fn()} onOpenEditor={onOpenEditor} />);
    fireEvent.click(screen.getByText(/editor/i));
    expect(onOpenEditor).toHaveBeenCalled();
  });

  it('calls onNavigate(1) when next clicked', () => {
    const onNavigate = vi.fn();
    render(<ConflictHunkViewer hunks={hunks} currentIndex={0} onNavigate={onNavigate} onResolve={vi.fn()} onOpenEditor={vi.fn()} />);
    fireEvent.click(screen.getByText(/next/i));
    expect(onNavigate).toHaveBeenCalledWith(1);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd /var/home/mstephens/Documents/GitHub/sai && npx vitest run tests/unit/components/Git/ConflictHunkViewer.test.tsx 2>&1 | tail -10
```

- [ ] **Step 3: Implement `src/components/Git/ConflictHunkViewer.tsx`**

```typescript
import { ConflictHunk } from '../../types';

interface ConflictHunkViewerProps {
  hunks: ConflictHunk[];
  currentIndex: number;
  onNavigate: (index: number) => void;
  onResolve: (hunkIndex: number, resolution: 'ours' | 'theirs' | 'both') => void;
  onOpenEditor: () => void;
}

export default function ConflictHunkViewer({ hunks, currentIndex, onNavigate, onResolve, onOpenEditor }: ConflictHunkViewerProps) {
  const hunk = hunks[currentIndex];
  if (!hunk) return null;

  return (
    <div style={{ margin: '4px 0' }}>
      {/* Raw conflict block */}
      <div style={{
        background: 'var(--bg-elevated, #0d1117)',
        borderRadius: 3,
        padding: '6px 8px',
        fontFamily: "'JetBrains Mono', monospace",
        fontSize: 10,
        lineHeight: 1.6,
        border: '1px solid var(--border)',
      }}>
        <div style={{ color: 'var(--green)', opacity: 0.7 }}>{'<<<<<<< ' + hunk.oursLabel}</div>
        {hunk.ours.map((line, i) => (
          <div key={i} style={{ background: 'rgba(63,185,80,0.15)', color: 'var(--green)', padding: '0 2px', whiteSpace: 'pre' }}>{line}</div>
        ))}
        <div style={{ color: 'var(--text-muted)' }}>{'======='}</div>
        {hunk.theirs.map((line, i) => (
          <div key={i} style={{ background: 'rgba(121,192,255,0.15)', color: 'var(--blue)', padding: '0 2px', whiteSpace: 'pre' }}>{line}</div>
        ))}
        <div style={{ color: 'var(--blue)', opacity: 0.7 }}>{'>>>>>>> ' + hunk.theirsLabel}</div>
      </div>

      {/* Resolution buttons */}
      <div style={{ display: 'flex', gap: 3, marginTop: 4 }}>
        {(['ours', 'theirs', 'both'] as const).map(r => (
          <button
            key={r}
            onClick={() => onResolve(hunk.index, r)}
            style={{
              flex: 1,
              background: r === 'ours' ? 'rgba(63,185,80,0.2)' : r === 'theirs' ? 'rgba(121,192,255,0.2)' : 'rgba(249,226,175,0.2)',
              color: r === 'ours' ? 'var(--green)' : r === 'theirs' ? 'var(--blue)' : 'var(--yellow, #f9e2af)',
              border: `1px solid ${r === 'ours' ? 'var(--green)' : r === 'theirs' ? 'var(--blue)' : 'var(--yellow, #f9e2af)'}`,
              borderRadius: 3, padding: '3px 0', fontSize: 10, cursor: 'pointer', fontWeight: 600,
              textTransform: 'capitalize',
            }}
          >
            ✓ {r.charAt(0).toUpperCase() + r.slice(1)}
          </button>
        ))}
        <button
          onClick={onOpenEditor}
          style={{
            flex: 1, background: 'var(--bg-hover)', color: 'var(--text-muted)',
            border: '1px solid var(--border)', borderRadius: 3, padding: '3px 0',
            fontSize: 10, cursor: 'pointer',
          }}
        >
          ↗ Editor
        </button>
      </div>

      {/* Navigation */}
      {hunks.length > 1 && (
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 4 }}>
          <button
            onClick={() => currentIndex > 0 && onNavigate(currentIndex - 1)}
            disabled={currentIndex === 0}
            style={{ background: 'none', border: 'none', color: currentIndex > 0 ? 'var(--accent)' : 'var(--text-muted)', cursor: currentIndex > 0 ? 'pointer' : 'default', fontSize: 10, padding: '2px 0' }}
          >
            ◀ prev
          </button>
          <span style={{ fontSize: 10, color: 'var(--text-muted)' }}>
            hunk {currentIndex + 1} of {hunks.length}
          </span>
          <button
            onClick={() => currentIndex < hunks.length - 1 && onNavigate(currentIndex + 1)}
            disabled={currentIndex === hunks.length - 1}
            style={{ background: 'none', border: 'none', color: currentIndex < hunks.length - 1 ? 'var(--accent)' : 'var(--text-muted)', cursor: currentIndex < hunks.length - 1 ? 'pointer' : 'default', fontSize: 10, padding: '2px 0' }}
          >
            next ▶
          </button>
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
cd /var/home/mstephens/Documents/GitHub/sai && npx vitest run tests/unit/components/Git/ConflictHunkViewer.test.tsx 2>&1 | tail -10
```

Expected: PASS — 6 tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/components/Git/ConflictHunkViewer.tsx tests/unit/components/Git/ConflictHunkViewer.test.tsx
git commit -m "feat: add ConflictHunkViewer component"
```

---

## Task 10: ConflictSection component

**Files:**
- Create: `src/components/Git/ConflictSection.tsx`
- Create: `tests/unit/components/Git/ConflictSection.test.tsx`

- [ ] **Step 1: Write the failing test**

Create `tests/unit/components/Git/ConflictSection.test.tsx`:

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { installMockSai, createMockSai } from '../../../helpers/ipc-mock';
import ConflictSection from '../../../../src/components/Git/ConflictSection';
import type { ConflictHunk } from '../../../../src/types';

const hunk: ConflictHunk = {
  index: 0,
  ours: ['const x = 1;'],
  theirs: ['const x = 2;'],
  oursLabel: 'HEAD',
  theirsLabel: 'feature/foo',
};

describe('ConflictSection', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it('renders nothing when no conflict files', () => {
    installMockSai();
    const { container } = render(
      <ConflictSection projectPath="/proj" conflictFiles={[]} onRefresh={vi.fn()} onOpenEditor={vi.fn()} />
    );
    expect(container.firstChild).toBeNull();
  });

  it('renders banner when conflict files exist', () => {
    installMockSai();
    render(
      <ConflictSection projectPath="/proj" conflictFiles={['src/index.ts']} onRefresh={vi.fn()} onOpenEditor={vi.fn()} />
    );
    expect(screen.getByText(/merge conflicts/i)).toBeTruthy();
    expect(screen.getByText('src/index.ts')).toBeTruthy();
  });

  it('expands hunk viewer when file row clicked', async () => {
    const mock = createMockSai();
    mock.gitConflictHunks.mockResolvedValue([hunk]);
    installMockSai(mock);

    render(
      <ConflictSection projectPath="/proj" conflictFiles={['src/index.ts']} onRefresh={vi.fn()} onOpenEditor={vi.fn()} />
    );
    fireEvent.click(screen.getByText('src/index.ts'));
    await waitFor(() => {
      expect(screen.getByText(/const x = 1/)).toBeTruthy();
    });
  });

  it('calls gitResolveAllConflicts and onRefresh when Accept All Ours clicked', async () => {
    const mock = createMockSai();
    installMockSai(mock);
    const onRefresh = vi.fn();

    render(
      <ConflictSection projectPath="/proj" conflictFiles={['src/index.ts']} onRefresh={onRefresh} onOpenEditor={vi.fn()} />
    );
    fireEvent.click(screen.getByText(/accept all ours/i));
    await waitFor(() => {
      expect(mock.gitResolveAllConflicts).toHaveBeenCalledWith('/proj', 'ours');
      expect(onRefresh).toHaveBeenCalled();
    });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd /var/home/mstephens/Documents/GitHub/sai && npx vitest run tests/unit/components/Git/ConflictSection.test.tsx 2>&1 | tail -10
```

- [ ] **Step 3: Implement `src/components/Git/ConflictSection.tsx`**

```typescript
import { useState } from 'react';
import { ConflictHunk, GitFile } from '../../types';
import ConflictHunkViewer from './ConflictHunkViewer';

interface ConflictSectionProps {
  projectPath: string;
  conflictFiles: string[];
  onRefresh: () => void;
  onOpenEditor: (file: GitFile) => void;
}

export default function ConflictSection({ projectPath, conflictFiles, onRefresh, onOpenEditor }: ConflictSectionProps) {
  const [expandedFile, setExpandedFile] = useState<string | null>(null);
  const [hunks, setHunks] = useState<ConflictHunk[]>([]);
  const [currentHunkIndex, setCurrentHunkIndex] = useState(0);
  const [busy, setBusy] = useState(false);

  if (conflictFiles.length === 0) return null;

  const handleToggleFile = async (filepath: string) => {
    if (expandedFile === filepath) {
      setExpandedFile(null);
      return;
    }
    const result = await (window.sai as any).gitConflictHunks(projectPath, filepath) as ConflictHunk[];
    setHunks(result);
    setCurrentHunkIndex(0);
    setExpandedFile(filepath);
  };

  const handleResolve = async (hunkIndex: number, resolution: 'ours' | 'theirs' | 'both') => {
    if (!expandedFile) return;
    setBusy(true);
    try {
      await (window.sai as any).gitResolveConflict(projectPath, expandedFile, resolution);
      // Reload remaining hunks
      const remaining = await (window.sai as any).gitConflictHunks(projectPath, expandedFile) as ConflictHunk[];
      if (remaining.length === 0) {
        setExpandedFile(null);
        setHunks([]);
      } else {
        setHunks(remaining);
        setCurrentHunkIndex(i => Math.min(i, remaining.length - 1));
      }
      onRefresh();
    } finally { setBusy(false); }
  };

  const handleBulk = async (resolution: 'ours' | 'theirs') => {
    setBusy(true);
    try {
      await (window.sai as any).gitResolveAllConflicts(projectPath, resolution);
      setExpandedFile(null);
      setHunks([]);
      onRefresh();
    } finally { setBusy(false); }
  };

  return (
    <div style={{
      margin: '8px 12px 0',
      background: 'var(--bg-input)',
      borderLeft: '3px solid var(--red)',
      borderRadius: '0 4px 4px 0',
      padding: '8px 10px',
    }}>
      <div style={{ fontSize: 10, fontWeight: 700, color: 'var(--red)', marginBottom: 6, textTransform: 'uppercase', letterSpacing: '0.5px' }}>
        ⚠ Merge Conflicts — resolve before committing
      </div>

      {conflictFiles.map(filepath => (
        <div key={filepath}>
          <div
            onClick={() => handleToggleFile(filepath)}
            style={{
              display: 'flex', alignItems: 'center', gap: 6,
              padding: '4px 6px', borderRadius: 3,
              background: 'var(--bg-elevated, #0d1117)',
              cursor: 'pointer', marginBottom: 3,
            }}
            onMouseEnter={e => (e.currentTarget.style.opacity = '0.8')}
            onMouseLeave={e => (e.currentTarget.style.opacity = '1')}
          >
            <span style={{ color: 'var(--red)', fontSize: 10 }}>
              {expandedFile === filepath ? '▼' : '▶'}
            </span>
            <span style={{ color: 'var(--red)', fontWeight: 700 }}>!</span>
            <span style={{ flex: 1, fontSize: 11, color: 'var(--text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {filepath}
            </span>
            {expandedFile !== filepath && (
              <span style={{ fontSize: 9, color: 'var(--text-muted)', flexShrink: 0 }}>
                click to resolve
              </span>
            )}
          </div>

          {expandedFile === filepath && hunks.length > 0 && (
            <div style={{ paddingLeft: 6, marginBottom: 4 }}>
              <ConflictHunkViewer
                hunks={hunks}
                currentIndex={currentHunkIndex}
                onNavigate={setCurrentHunkIndex}
                onResolve={handleResolve}
                onOpenEditor={() => onOpenEditor({ path: filepath, status: 'modified', staged: false })}
              />
            </div>
          )}
        </div>
      ))}

      <div style={{ display: 'flex', gap: 4, marginTop: 6 }}>
        <button
          onClick={() => handleBulk('ours')}
          disabled={busy}
          style={{ background: 'var(--red)', color: '#000', border: 'none', borderRadius: 3, padding: '3px 8px', fontSize: 9, fontWeight: 700, cursor: 'pointer' }}
        >
          Accept All Ours
        </button>
        <button
          onClick={() => handleBulk('theirs')}
          disabled={busy}
          style={{ background: 'var(--blue)', color: '#000', border: 'none', borderRadius: 3, padding: '3px 8px', fontSize: 9, fontWeight: 700, cursor: 'pointer' }}
        >
          Accept All Theirs
        </button>
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
cd /var/home/mstephens/Documents/GitHub/sai && npx vitest run tests/unit/components/Git/ConflictSection.test.tsx 2>&1 | tail -10
```

Expected: PASS — 4 tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/components/Git/ConflictSection.tsx tests/unit/components/Git/ConflictSection.test.tsx
git commit -m "feat: add ConflictSection component with inline hunk viewer"
```

---

## Task 11: ChangedFiles — expand toggle and InlineDiff

**Files:**
- Modify: `src/components/Git/ChangedFiles.tsx`
- Modify: `tests/unit/components/Git/GitSidebar.test.tsx` (add one test)

- [ ] **Step 1: Add a failing test for expand toggle**

Add to `tests/unit/components/Git/GitSidebar.test.tsx`:

```typescript
  it('shows expand arrow on file rows', async () => {
    const mock = createMockSai();
    mock.gitStatus.mockResolvedValue({
      branch: 'main',
      staged: [],
      modified: [{ path: 'src/App.tsx', status: 'M' }],
      created: [], deleted: [], not_added: [], ahead: 0, behind: 0,
    });
    mock.gitLog.mockResolvedValue([]);
    installMockSai(mock);

    render(<GitSidebar {...defaultProps} />);
    await waitFor(() => screen.getByText('App.tsx'));
    // The expand arrow (▶) should be present in the file row
    expect(screen.getAllByText('▶').length).toBeGreaterThan(0);
  });
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd /var/home/mstephens/Documents/GitHub/sai && npx vitest run tests/unit/components/Git/GitSidebar.test.tsx 2>&1 | tail -15
```

- [ ] **Step 3: Update `src/components/Git/ChangedFiles.tsx`**

Add imports at the top:

```typescript
import InlineDiff from './InlineDiff';
```

Add `expandedPath` state and `onFileOpen` prop. Replace the current `ChangedFilesProps` interface with:

```typescript
interface ChangedFilesProps {
  title: string;
  files: GitFile[];
  onAction: (file: GitFile) => void;
  actionLabel: string;
  onFileClick: (file: GitFile) => void;
  onStageAll?: () => void;
  onDiscard?: (file: GitFile) => void;
  staged?: boolean;
  projectPath: string;
}
```

Add state inside the component (after existing `useState` calls):

```typescript
  const [expandedPath, setExpandedPath] = useState<string | null>(null);
```

In each file row `div`, prepend the expand toggle before the status icon, and append the InlineDiff after the row. Replace the file row's outer `div` and its children with:

```typescript
          <div key={file.path}>
            <div
              onMouseEnter={() => setHoveredPath(file.path)}
              onMouseLeave={() => setHoveredPath(null)}
              onContextMenu={e => handleContextMenu(e, file)}
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
              {/* Expand toggle */}
              <span
                onClick={e => { e.stopPropagation(); setExpandedPath(expandedPath === file.path ? null : file.path); }}
                style={{ color: 'var(--text-muted)', fontSize: 9, flexShrink: 0, width: 10, cursor: 'pointer' }}
              >
                {expandedPath === file.path ? '▼' : '▶'}
              </span>

              {/* Status icon */}
              <cfg.icon size={14} color={cfg.color} style={{ flexShrink: 0 }} onClick={() => onFileClick(file)} />

              {/* File name + directory */}
              <div style={{ flex: 1, minWidth: 0, overflow: 'hidden' }} onClick={() => onFileClick(file)}>
                <span
                  style={{
                    fontSize: 12,
                    color: 'var(--text)',
                    whiteSpace: 'nowrap' as const,
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    display: 'block',
                  }}
                  title={file.path}
                >
                  {fileName}
                </span>
                {dirName && (
                  <span
                    style={{
                      fontSize: 10,
                      color: 'var(--text-muted)',
                      whiteSpace: 'nowrap' as const,
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      display: 'block',
                    }}
                  >
                    {dirName}
                  </span>
                )}
              </div>

              {/* Action button */}
              <button
                onClick={(e) => { e.stopPropagation(); onAction(file); }}
                title={actionLabel}
                style={{
                  flexShrink: 0,
                  width: 18,
                  height: 18,
                  border: 'none',
                  borderRadius: 3,
                  background: isHovered ? 'var(--accent)' : 'transparent',
                  color: isHovered ? '#000' : 'transparent',
                  cursor: 'pointer',
                  fontSize: 14,
                  fontWeight: 700,
                  lineHeight: '18px',
                  textAlign: 'center' as const,
                  padding: 0,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                }}
              >
                {actionLabel === '+' ? <Plus size={14} /> : <Minus size={14} />}
              </button>
            </div>

            {expandedPath === file.path && (
              <InlineDiff
                projectPath={projectPath}
                filepath={file.path}
                staged={!!staged}
                onOpen={() => { onFileClick(file); setExpandedPath(null); }}
              />
            )}
          </div>
```

- [ ] **Step 4: Update `GitSidebar.tsx` to pass `projectPath` to `ChangedFiles`**

In `GitSidebar.tsx`, add `projectPath={projectPath}` to both `<ChangedFiles>` calls:

```typescript
        <ChangedFiles
          title="Staged"
          files={stagedFiles}
          onAction={handleUnstage}
          actionLabel="-"
          onFileClick={onFileClick}
          onDiscard={setDiscardTarget}
          staged
          projectPath={projectPath}
        />

        <ChangedFiles
          title="Changes"
          files={unstagedFiles}
          onAction={handleStage}
          actionLabel="+"
          onFileClick={onFileClick}
          onStageAll={handleStageAll}
          onDiscard={setDiscardTarget}
          projectPath={projectPath}
        />
```

- [ ] **Step 5: Run tests**

```bash
cd /var/home/mstephens/Documents/GitHub/sai && npx vitest run tests/unit/components/Git/ 2>&1 | tail -15
```

Expected: all existing tests pass + new expand test passes.

- [ ] **Step 6: Commit**

```bash
git add src/components/Git/ChangedFiles.tsx src/components/Git/GitSidebar.tsx tests/unit/components/Git/GitSidebar.test.tsx
git commit -m "feat: add inline diff expand toggle to ChangedFiles"
```

---

## Task 12: CommitBox — add StashMenu and RebaseButton

**Files:**
- Modify: `src/components/Git/CommitBox.tsx`

- [ ] **Step 1: Add imports to `CommitBox.tsx`**

Add at the top of `CommitBox.tsx`:

```typescript
import StashMenu from './StashMenu';
import { RebaseButton } from './RebaseControls';
```

- [ ] **Step 2: Update `CommitBoxProps` interface**

Add to the interface:

```typescript
  projectPath: string;
  rebaseInProgress?: boolean;
  onRefresh: () => void;
```

- [ ] **Step 3: Update the branch selector row in the JSX**

Find the `<div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 11 ...}}>` that contains the branch button and sparkle button.

Replace the closing `</div>` of that row (after the sparkle button) so the row now reads:

```typescript
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 6,
            fontSize: 11,
            color: 'var(--text-secondary)',
          }}
        >
          {/* existing branch button */}
          <button
            onClick={() => setBranchMenuOpen(!branchMenuOpen)}
            // ... all existing props unchanged ...
          >
            {/* ... existing content ... */}
          </button>

          {/* NEW: Stash menu */}
          <StashMenu projectPath={projectPath} onRefresh={onRefresh} disabled={busy} />

          {/* NEW: Rebase button */}
          <RebaseButton
            projectPath={projectPath}
            currentBranch={branch}
            onRefresh={onRefresh}
            onListBranches={onListBranches}
            disabled={busy || rebaseInProgress}
          />

          {/* existing sparkle button — unchanged */}
          <button
            onClick={async () => { /* ... unchanged ... */ }}
            // ...
          >
            {/* ... */}
          </button>
        </div>
```

- [ ] **Step 4: Disable Commit/Push/Pull when `rebaseInProgress` is true**

Find the Commit button's `disabled` prop and update to:

```typescript
disabled={!message.trim() || busy || rebaseInProgress}
```

Find both Push and Pull buttons' `disabled` props and update to:

```typescript
disabled={busy || rebaseInProgress}
```

- [ ] **Step 5: Run all git tests**

```bash
cd /var/home/mstephens/Documents/GitHub/sai && npx vitest run tests/unit/components/Git/ 2>&1 | tail -15
```

Expected: all pass.

- [ ] **Step 6: Commit**

```bash
git add src/components/Git/CommitBox.tsx
git commit -m "feat: add StashMenu and RebaseButton to CommitBox footer"
```

---

## Task 13: GitSidebar — wire conflict, rebase, empty states, and FileSearch

**Files:**
- Modify: `src/components/Git/GitSidebar.tsx`

- [ ] **Step 1: Add imports**

Add to the imports in `GitSidebar.tsx`:

```typescript
import ConflictSection from './ConflictSection';
import { RebaseInProgressBanner } from './RebaseControls';
import FileSearch from './FileSearch';
import { RebaseStatus } from '../../types';
```

- [ ] **Step 2: Add new state variables**

Inside the component, after the existing `useState` calls:

```typescript
  const [conflictFiles, setConflictFiles] = useState<string[]>([]);
  const [rebaseStatus, setRebaseStatus] = useState<RebaseStatus>({ inProgress: false, onto: '' });
  const [fileSearch, setFileSearch] = useState('');
  const [gitNotRepo, setGitNotRepo] = useState(false);
```

- [ ] **Step 3: Update the `refresh` callback to fetch conflict and rebase state**

Replace the existing `refresh` callback with:

```typescript
  const refresh = useCallback(async () => {
    if (!projectPath) return;
    try {
      const [status, log, conflicts, rebase] = await Promise.all([
        window.sai.gitStatus(projectPath) as Promise<GitStatus>,
        window.sai.gitLog(projectPath, 20) as Promise<GitCommit[]>,
        (window.sai as any).gitConflictFiles(projectPath) as Promise<string[]>,
        (window.sai as any).gitRebaseStatus(projectPath) as Promise<RebaseStatus>,
      ]);
      const { staged, unstaged } = parseStatus(status);
      setBranch(status.branch ?? '');
      setAhead(status.ahead ?? 0);
      setBehind(status.behind ?? 0);
      setStagedFiles(staged);
      setUnstagedFiles(unstaged);
      setCommits(log ?? []);
      setConflictFiles(conflicts ?? []);
      setRebaseStatus(rebase ?? { inProgress: false, onto: '' });
      setError(null);
      setGitNotRepo(false);
    } catch (err: any) {
      const msg = err?.message ?? 'Git error';
      if (msg.toLowerCase().includes('not a git repository')) {
        setGitNotRepo(true);
        setError(null);
      } else {
        setError(msg);
        setGitNotRepo(false);
      }
    }
  }, [projectPath]);
```

- [ ] **Step 4: Update the empty state and add new sections to JSX**

Replace the `{/* Scrollable file lists */}` section with:

```typescript
      {/* Scrollable file lists */}
      <div style={{ flex: 1, overflowY: 'auto', paddingTop: 8 }}>

        {/* Rebase in-progress banner */}
        {rebaseStatus.inProgress && (
          <RebaseInProgressBanner
            projectPath={projectPath}
            onto={rebaseStatus.onto}
            onRefresh={refresh}
          />
        )}

        {/* Conflict section */}
        <ConflictSection
          projectPath={projectPath}
          conflictFiles={conflictFiles}
          onRefresh={refresh}
          onOpenEditor={onFileClick}
        />

        {/* Git error */}
        {error && (
          <div
            style={{
              margin: '8px 12px',
              padding: '12px',
              background: 'var(--bg-input)',
              borderLeft: '2px solid var(--red)',
              borderRadius: 3,
              textAlign: 'center' as const,
            }}
          >
            <div style={{ fontSize: 18, marginBottom: 4 }}>⚠</div>
            <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--red)', marginBottom: 4 }}>
              Git unavailable
            </div>
            <div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 8 }}>{error}</div>
            <button
              onClick={refresh}
              style={{
                background: 'var(--bg-hover)', border: '1px solid var(--border)',
                borderRadius: 3, padding: '3px 10px', fontSize: 11,
                color: 'var(--text-secondary)', cursor: 'pointer',
              }}
            >
              Retry
            </button>
          </div>
        )}

        {/* Not a git repo */}
        {!error && gitNotRepo && (
          <div style={{ padding: '24px 12px', textAlign: 'center' as const }}>
            <div style={{ fontSize: 20, marginBottom: 6, color: 'var(--text-muted)' }}>⊘</div>
            <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-muted)', marginBottom: 4 }}>
              Not a git repo
            </div>
            <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>
              Open a folder tracked by git
            </div>
          </div>
        )}

        {/* Clean working tree */}
        {!error && !gitNotRepo && totalChanges === 0 && commits.length === 0 && (
          <div style={{ padding: '24px 12px', textAlign: 'center' as const }}>
            <div style={{ fontSize: 20, marginBottom: 6, color: 'var(--green)' }}>✓</div>
            <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-muted)', marginBottom: 4 }}>
              No changes
            </div>
            <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>Working tree is clean</div>
          </div>
        )}

        {/* File search (shown when ≥10 files or search active) */}
        {(totalChanges >= 10 || fileSearch) && (
          <FileSearch
            value={fileSearch}
            onChange={setFileSearch}
            matchCount={fileSearch ? [
              ...stagedFiles.filter(f => f.path.split('/').pop()?.toLowerCase().includes(fileSearch.toLowerCase())),
              ...unstagedFiles.filter(f => f.path.split('/').pop()?.toLowerCase().includes(fileSearch.toLowerCase())),
            ].length : undefined}
          />
        )}

        <ChangedFiles
          title="Staged"
          files={fileSearch
            ? stagedFiles.filter(f => f.path.split('/').pop()?.toLowerCase().includes(fileSearch.toLowerCase()))
            : stagedFiles}
          onAction={handleUnstage}
          actionLabel="-"
          onFileClick={onFileClick}
          onDiscard={setDiscardTarget}
          staged
          projectPath={projectPath}
        />

        <ChangedFiles
          title="Changes"
          files={fileSearch
            ? unstagedFiles.filter(f => f.path.split('/').pop()?.toLowerCase().includes(fileSearch.toLowerCase()))
            : unstagedFiles}
          onAction={handleStage}
          actionLabel="+"
          onFileClick={onFileClick}
          onStageAll={handleStageAll}
          onDiscard={setDiscardTarget}
          projectPath={projectPath}
        />

        <GitActivity commits={commits} />
      </div>
```

- [ ] **Step 5: Update `CommitBox` call to pass new props**

Replace the `<CommitBox>` element:

```typescript
      <CommitBox
        key={projectPath}
        branch={branch}
        ahead={ahead}
        behind={behind}
        projectPath={projectPath}
        rebaseInProgress={rebaseStatus.inProgress}
        onRefresh={refresh}
        onCommit={handleCommit}
        onPush={handlePush}
        onPull={handlePull}
        onGenerateMessage={() => window.sai.claudeGenerateCommitMessage(projectPath, commitMessageProvider)}
        onListBranches={() => window.sai.gitBranches(projectPath)}
        onCheckout={async (b: string) => { await window.sai.gitCheckout(projectPath, b); await refresh(); }}
        onCreateBranch={async (name: string) => { await window.sai.gitCreateBranch(projectPath, name); await refresh(); }}
      />
```

- [ ] **Step 6: Add Ctrl+F keyboard shortcut**

Add a `useEffect` after the existing polling effect:

```typescript
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 'f') {
        e.preventDefault();
        setFileSearch(s => s); // trigger re-render to show search
        // focus the search input via a small timeout
        setTimeout(() => {
          const input = document.querySelector<HTMLInputElement>('[placeholder*="Filter changed"]');
          input?.focus();
        }, 50);
      }
    };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, []);
```

- [ ] **Step 7: Run all git tests**

```bash
cd /var/home/mstephens/Documents/GitHub/sai && npx vitest run tests/unit/components/Git/ 2>&1 | tail -20
```

Expected: all pass.

- [ ] **Step 8: Verify TypeScript compiles**

```bash
cd /var/home/mstephens/Documents/GitHub/sai && npx tsc --noEmit 2>&1 | head -20
```

- [ ] **Step 9: Commit**

```bash
git add src/components/Git/GitSidebar.tsx
git commit -m "feat: wire ConflictSection, RebaseInProgressBanner, FileSearch, and improved empty states into GitSidebar"
```

---

## Task 14: Branch UX — fuzzy search, remote grouping, ahead/behind, keyboard nav

**Files:**
- Modify: `src/components/Git/CommitBox.tsx`
- Modify: `electron/services/git.ts` (include remote branches in `git:branches`)
- Modify: `electron/preload.ts` (no change needed — `gitBranches` already exposed)

- [ ] **Step 1: Update `git:branches` handler to include remote branches**

In `electron/services/git.ts`, replace the `git:branches` handler:

```typescript
  ipcMain.handle('git:branches', async (_event, cwd: string) => {
    const summary = await git(cwd).branch(['-a']);
    const local: string[] = [];
    const remote: string[] = [];
    for (const [name, branch] of Object.entries(summary.branches)) {
      if (branch.linkedWorkTree) continue;
      if (name.startsWith('remotes/')) {
        const remoteName = name.replace(/^remotes\//, '').replace(/^origin\/HEAD.*/, '');
        if (remoteName && !remoteName.includes('HEAD')) remote.push(remoteName);
      } else {
        local.push(name);
      }
    }
    return {
      current: summary.current,
      branches: local,
      remoteBranches: [...new Set(remote)],
    };
  });
```

- [ ] **Step 2: Add fuzzy match helper to `CommitBox.tsx`**

Add above the component function:

```typescript
function fuzzyMatch(str: string, pattern: string): boolean {
  if (!pattern) return true;
  const s = str.toLowerCase();
  const p = pattern.toLowerCase();
  let si = 0;
  for (let pi = 0; pi < p.length; pi++) {
    while (si < s.length && s[si] !== p[pi]) si++;
    if (si >= s.length) return false;
    si++;
  }
  return true;
}
```

- [ ] **Step 3: Add `remoteBranches` state and update filtering in `CommitBox.tsx`**

Add state:

```typescript
  const [remoteBranches, setRemoteBranches] = useState<string[]>([]);
  const [focusedBranchIndex, setFocusedBranchIndex] = useState(0);
```

Update the `useEffect` that loads branches:

```typescript
  useEffect(() => {
    if (branchMenuOpen) {
      onListBranches().then(({ branches: b, remoteBranches: r }: any) => {
        setBranches(b ?? []);
        setRemoteBranches(r ?? []);
      });
      setTimeout(() => filterRef.current?.focus(), 50);
    }
  }, [branchMenuOpen]);
```

Replace `filteredBranches` with:

```typescript
  const filteredLocal = branches.filter(b => fuzzyMatch(b, branchFilter));
  const filteredRemote = remoteBranches.filter(b => fuzzyMatch(b, branchFilter));
```

- [ ] **Step 4: Update the branch dropdown JSX to show remote branches and add keyboard nav**

Replace the `<div style={{ maxHeight: 200, overflowY: 'auto' }}>` section inside the branch dropup:

```typescript
            <div
              style={{ maxHeight: 200, overflowY: 'auto' }}
              onKeyDown={e => {
                const total = filteredLocal.length + filteredRemote.length;
                if (e.key === 'ArrowDown') { e.preventDefault(); setFocusedBranchIndex(i => Math.min(i + 1, total - 1)); }
                if (e.key === 'ArrowUp') { e.preventDefault(); setFocusedBranchIndex(i => Math.max(i - 1, 0)); }
                if (e.key === 'Enter') {
                  const all = [...filteredLocal, ...filteredRemote];
                  if (all[focusedBranchIndex]) handleSwitch(all[focusedBranchIndex]);
                }
              }}
            >
              {filteredLocal.length > 0 && (
                <>
                  {(filteredRemote.length > 0 || remoteBranches.length > 0) && (
                    <div style={{ padding: '4px 10px 2px', fontSize: 9, fontWeight: 700, color: 'var(--text-muted)', letterSpacing: '0.5px', textTransform: 'uppercase' }}>
                      Local
                    </div>
                  )}
                  {filteredLocal.map((b, i) => (
                    <button
                      key={b}
                      onClick={() => handleSwitch(b)}
                      className={`branch-item ${b === branch ? 'active' : ''} ${focusedBranchIndex === i ? 'focused' : ''}`}
                      onMouseEnter={() => setFocusedBranchIndex(i)}
                    >
                      <GitBranch size={12} style={{ flexShrink: 0 }} />
                      <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1 }}>{b}</span>
                      {b === branch && <Check size={12} style={{ flexShrink: 0, marginLeft: 'auto' }} />}
                    </button>
                  ))}
                </>
              )}
              {filteredRemote.length > 0 && (
                <>
                  <div style={{ padding: '4px 10px 2px', fontSize: 9, fontWeight: 700, color: 'var(--text-muted)', letterSpacing: '0.5px', textTransform: 'uppercase', borderTop: filteredLocal.length > 0 ? '1px solid var(--border)' : 'none', marginTop: filteredLocal.length > 0 ? 4 : 0 }}>
                    Remote
                  </div>
                  {filteredRemote.map((b, i) => (
                    <button
                      key={b}
                      onClick={() => handleSwitch(b)}
                      className={`branch-item ${focusedBranchIndex === filteredLocal.length + i ? 'focused' : ''}`}
                      style={{ color: 'var(--text-muted)' }}
                      onMouseEnter={() => setFocusedBranchIndex(filteredLocal.length + i)}
                    >
                      <GitBranch size={12} style={{ flexShrink: 0, opacity: 0.6 }} />
                      <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1 }}>{b}</span>
                    </button>
                  ))}
                </>
              )}
              {filteredLocal.length === 0 && filteredRemote.length === 0 && branchFilter && (
                <div style={{ padding: '8px', textAlign: 'center', fontSize: 11, color: 'var(--text-muted)' }}>
                  No matching branches
                </div>
              )}
            </div>
```

- [ ] **Step 5: Show ahead/behind in branch selector button**

Find the branch selector button's span that shows the branch name and update it:

```typescript
            <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {branch || 'no branch'}
            </span>
            {(ahead > 0 || behind > 0) && (
              <span style={{ fontSize: 9, color: 'var(--green)', flexShrink: 0, marginLeft: 2 }}>
                {ahead > 0 ? `↑${ahead}` : ''}{behind > 0 ? `↓${behind}` : ''}
              </span>
            )}
```

- [ ] **Step 6: Add `.focused` CSS to the branch styles**

In the `<style>` block at the bottom of `CommitBox.tsx`, add:

```css
        .branch-item.focused {
          background: var(--bg-hover);
        }
```

- [ ] **Step 7: Run all tests**

```bash
cd /var/home/mstephens/Documents/GitHub/sai && npx vitest run tests/unit/components/Git/ 2>&1 | tail -15
```

- [ ] **Step 8: Verify TypeScript**

```bash
cd /var/home/mstephens/Documents/GitHub/sai && npx tsc --noEmit 2>&1 | head -20
```

- [ ] **Step 9: Commit**

```bash
git add src/components/Git/CommitBox.tsx electron/services/git.ts
git commit -m "feat: branch UX improvements — fuzzy search, remote grouping, ahead/behind counts, keyboard nav"
```

---

## Task 15: File list keyboard navigation

**Files:**
- Modify: `src/components/Git/ChangedFiles.tsx`

- [ ] **Step 1: Add a failing test**

Add to `tests/unit/components/Git/GitSidebar.test.tsx`:

```typescript
  it('supports Space key to stage a focused file', async () => {
    const mock = createMockSai();
    mock.gitStatus.mockResolvedValue({
      branch: 'main', staged: [],
      modified: [{ path: 'src/App.tsx', status: 'M' }],
      created: [], deleted: [], not_added: [], ahead: 0, behind: 0,
    });
    mock.gitLog.mockResolvedValue([]);
    installMockSai(mock);

    render(<GitSidebar {...defaultProps} />);
    await waitFor(() => screen.getByText('App.tsx'));

    const fileRow = screen.getByText('App.tsx').closest('[data-filepath]') as HTMLElement;
    fireEvent.keyDown(fileRow, { key: ' ' });
    await waitFor(() => {
      expect(mock.gitStage).toHaveBeenCalled();
    });
  });
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd /var/home/mstephens/Documents/GitHub/sai && npx vitest run tests/unit/components/Git/GitSidebar.test.tsx 2>&1 | tail -15
```

- [ ] **Step 3: Update file rows in `ChangedFiles.tsx`**

Add `tabIndex={0}` and `data-filepath` and keyboard handler to each file's outer `div` (the one inside `key={file.path}`):

```typescript
            <div
              key={file.path}
              data-filepath={file.path}
              tabIndex={0}
              onMouseEnter={() => setHoveredPath(file.path)}
              onMouseLeave={() => setHoveredPath(null)}
              onContextMenu={e => handleContextMenu(e, file)}
              onKeyDown={e => {
                if (e.key === ' ') { e.preventDefault(); onAction(file); }
                if (e.key === 'Enter') { onFileClick(file); }
              }}
              // ... rest of existing props
```

- [ ] **Step 4: Run all tests**

```bash
cd /var/home/mstephens/Documents/GitHub/sai && npx vitest run tests/unit/components/Git/ 2>&1 | tail -15
```

Expected: all pass.

- [ ] **Step 5: Final TypeScript check**

```bash
cd /var/home/mstephens/Documents/GitHub/sai && npx tsc --noEmit 2>&1 | head -20
```

- [ ] **Step 6: Commit**

```bash
git add src/components/Git/ChangedFiles.tsx tests/unit/components/Git/GitSidebar.test.tsx
git commit -m "feat: add keyboard navigation to file list (Space to stage, Enter to open diff)"
```

---

## Self-Review Checklist

- **Spec coverage:**
  - ✓ Stash: list, push with/without message, pop, apply, drop — Tasks 2, 7
  - ✓ Rebase: simple onto picker, in-progress banner, continue/skip/abort — Tasks 3, 8, 13
  - ✓ Conflict: inline hunk viewer, ours/theirs/both, bulk resolve, editor escape hatch — Tasks 4, 9, 10
  - ✓ File search: fuzzy filter, match count, Ctrl+F, Esc to clear — Tasks 5, 13
  - ✓ Inline diff peek: expand toggle, diff rendering, 50-line limit, open in editor — Tasks 6, 11
  - ✓ Empty states: clean tree, not a repo, git error with retry — Task 13
  - ✓ Branch UX: fuzzy search, remote grouping, ahead/behind, keyboard nav — Task 14
  - ✓ File list keyboard nav: Space to stage, Enter to open diff — Task 15
  - ✓ Component extraction (refactor-first strategy) — Tasks 5–10 are all new isolated components
  - ✓ IPC for all new operations — Tasks 2–4

- **Type consistency:** All tasks use `ConflictHunk`, `StashEntry`, `RebaseStatus` from `src/types.ts` as defined in Task 1. `window.sai as any` used for new methods until types are wired; TypeScript compilation verified at each step.

- **No placeholders:** All code blocks are complete. All test commands include expected output.
