# Editor Hot-Reload on AI Edits Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** When an AI `Write`/`Edit`/`MultiEdit`/`NotebookEdit` finishes editing a file that's open in the editor, refresh that tab instantly (clean → hot reload; dirty → existing conflict banner) instead of waiting for the 5-second mtime poll.

**Architecture:** Two pure extractors parse the raw `claude:message` stream — one pulls edit `tool_use` paths from assistant messages, one pulls successful `tool_result` ids from user messages. The `App.tsx` handler correlates them via a `Map<id,path>` ref and calls a single extracted `applyExternalChange(path)` (the poll's reload-or-banner decision, now shared). No new IPC, no filesystem watcher.

**Tech Stack:** React + TypeScript, Vitest, Electron renderer.

---

## File Structure

- **Create** `src/components/CodePanel/detectFileEdits.ts` — pure `extractEditToolUses` + `successfulToolResultIds` (+ local path-resolve helpers). One responsibility: read edit info out of raw CLI message content blocks.
- **Modify** `src/App.tsx` — extract `applyExternalChange` (shared by poll + trigger), route the poll through it, add the correlation wiring in the `claude:message` handler.
- **Create** `tests/unit/components/CodePanel/detectFileEdits.test.ts`.

---

## Task 1: Pure edit-stream extractors

**Files:**
- Create: `src/components/CodePanel/detectFileEdits.ts`
- Test: `tests/unit/components/CodePanel/detectFileEdits.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `tests/unit/components/CodePanel/detectFileEdits.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { extractEditToolUses, successfulToolResultIds } from '../../../../src/components/CodePanel/detectFileEdits';

const root = '/home/u/proj';

describe('extractEditToolUses', () => {
  it('returns an absolute Write file_path unchanged', () => {
    const content = [{ type: 'tool_use', id: 'a1', name: 'Write', input: { file_path: '/home/u/proj/src/a.ts', content: 'x' } }];
    expect(extractEditToolUses(content, root)).toEqual([{ id: 'a1', path: '/home/u/proj/src/a.ts' }]);
  });

  it('resolves a relative Edit file_path against the project root', () => {
    const content = [{ type: 'tool_use', id: 'a2', name: 'Edit', input: { file_path: 'src/b.ts' } }];
    expect(extractEditToolUses(content, root)).toEqual([{ id: 'a2', path: '/home/u/proj/src/b.ts' }]);
  });

  it('returns a NotebookEdit notebook_path', () => {
    const content = [{ type: 'tool_use', id: 'a3', name: 'NotebookEdit', input: { notebook_path: '/abs/n.ipynb' } }];
    expect(extractEditToolUses(content, root)).toEqual([{ id: 'a3', path: '/abs/n.ipynb' }]);
  });

  it('excludes non-edit tools and pathless edit blocks', () => {
    const content = [
      { type: 'tool_use', id: 'r', name: 'Read', input: { file_path: '/x' } },
      { type: 'tool_use', id: 'w', name: 'Write', input: {} },
      { type: 'text', text: 'hi' },
    ];
    expect(extractEditToolUses(content, root)).toEqual([]);
  });

  it('returns every edit in a content array, in order', () => {
    const content = [
      { type: 'tool_use', id: 'a', name: 'Write', input: { file_path: '/p/a' } },
      { type: 'tool_use', id: 'b', name: 'Edit', input: { file_path: '/p/b' } },
    ];
    expect(extractEditToolUses(content, root).map(e => e.id)).toEqual(['a', 'b']);
  });

  it('returns [] for non-array content', () => {
    expect(extractEditToolUses(undefined, root)).toEqual([]);
    expect(extractEditToolUses('nope', root)).toEqual([]);
  });
});

describe('successfulToolResultIds', () => {
  it('returns ids of non-error tool_result blocks', () => {
    const content = [
      { type: 'tool_result', tool_use_id: 'ok1', is_error: false },
      { type: 'tool_result', tool_use_id: 'ok2' },
    ];
    expect(successfulToolResultIds(content)).toEqual(['ok1', 'ok2']);
  });

  it('excludes is_error results', () => {
    const content = [
      { type: 'tool_result', tool_use_id: 'bad', is_error: true },
      { type: 'tool_result', tool_use_id: 'good', is_error: false },
    ];
    expect(successfulToolResultIds(content)).toEqual(['good']);
  });

  it('returns [] for non-array content', () => {
    expect(successfulToolResultIds(null)).toEqual([]);
    expect(successfulToolResultIds(undefined)).toEqual([]);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run tests/unit/components/CodePanel/detectFileEdits.test.ts --maxWorkers=2`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the module**

Create `src/components/CodePanel/detectFileEdits.ts`:

```ts
// Pure extractors over RAW Claude CLI message content blocks (not the app's assembled
// ToolCall objects). An edit's path comes from an assistant `tool_use` block; its
// completion comes from a later user `tool_result` block. The App handler correlates them.

const EDIT_TOOLS = new Set(['Write', 'Edit', 'MultiEdit', 'NotebookEdit']);

function isAbsolute(p: string): boolean {
  return p.startsWith('/') || /^[a-zA-Z]:[\\/]/.test(p);
}

function joinPath(root: string, p: string): string {
  if (!root) return p;
  return root.replace(/[/\\]+$/, '') + '/' + p.replace(/^[/\\]+/, '');
}

/** Edit tool_use blocks → { id, absolutePath }. Non-array content yields []. */
export function extractEditToolUses(content: unknown, projectRoot: string): { id: string; path: string }[] {
  if (!Array.isArray(content)) return [];
  const out: { id: string; path: string }[] = [];
  for (const block of content) {
    if (!block || block.type !== 'tool_use' || !EDIT_TOOLS.has(block.name)) continue;
    const input = block.input || {};
    const raw = typeof input.file_path === 'string' ? input.file_path
      : typeof input.notebook_path === 'string' ? input.notebook_path
      : null;
    if (!raw || typeof block.id !== 'string') continue;
    out.push({ id: block.id, path: isAbsolute(raw) ? raw : joinPath(projectRoot, raw) });
  }
  return out;
}

/** tool_use_ids of non-error tool_result blocks. Non-array content yields []. */
export function successfulToolResultIds(content: unknown): string[] {
  if (!Array.isArray(content)) return [];
  const ids: string[] = [];
  for (const block of content) {
    if (!block || block.type !== 'tool_result' || block.is_error === true) continue;
    if (typeof block.tool_use_id === 'string') ids.push(block.tool_use_id);
  }
  return ids;
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run tests/unit/components/CodePanel/detectFileEdits.test.ts --maxWorkers=2`
Expected: PASS — all cases.

- [ ] **Step 5: Commit**

```bash
git add src/components/CodePanel/detectFileEdits.ts tests/unit/components/CodePanel/detectFileEdits.test.ts
git commit -m "feat(editor): add pure extractors for AI file edits from the message stream"
```

---

## Task 2: Wire instant hot-reload in App.tsx

**Files:**
- Modify: `src/App.tsx`

This task has no new unit test (the logic lives in the large `App.tsx`; the pure part is
tested in Task 1). Verify by `tsc` + the existing poll behavior (unchanged) + the manual
smoke in Task 3. The change: extract the poll's reload-or-banner decision into one
`applyExternalChange`, route the poll through it, and fire it instantly from the message
stream.

- [ ] **Step 1: Add the import**

Near the other component imports at the top of `src/App.tsx`, add:

```tsx
import { extractEditToolUses, successfulToolResultIds } from './components/CodePanel/detectFileEdits';
```

- [ ] **Step 2: Add the pending-edits ref**

Find the cluster of `useRef` declarations (e.g. around `App.tsx:282`, the
`emittedLifecycleRef` line). After it, add:

```tsx
  // tool_use_id → absolute path of an in-flight AI file edit, awaiting its tool_result
  // so we can hot-reload the open file the instant the edit completes.
  const pendingEditsRef = useRef<Map<string, string>>(new Map());
```

- [ ] **Step 3: Add `applyExternalChange` (+ a ref to it) just before the 5s poll effect**

Immediately BEFORE the existing poll `useEffect` (the one at `App.tsx:2030` that begins
`useEffect(() => { if (!projectPath) return; const id = setInterval(...`), insert:

```tsx
  // Reload-or-banner decision for a single open file whose on-disk content changed.
  // Clean file → swap in the new content (hot reload); dirty file → flag the conflict
  // banner so the user chooses. Shared by the 5s poll and the instant AI-edit trigger.
  const applyExternalChange = useCallback(async (projectPath: string, filePath: string) => {
    const ws = workspacesRef.current.get(projectPath);
    const file = ws?.openFiles.find(f => f.path === filePath);
    if (!file) return;
    if (file.isDirty) {
      setExternallyModified(prev => (prev.has(filePath) ? prev : new Set([...prev, filePath])));
      return;
    }
    try {
      const [content, { mtime }] = await Promise.all([
        window.sai.fsReadFile(filePath) as Promise<string>,
        window.sai.fsMtime(filePath) as Promise<{ mtime: number }>,
      ]);
      updateWorkspace(projectPath, w => ({
        ...w,
        openFiles: w.openFiles.map(f =>
          f.path === filePath
            ? { ...f, content, savedContent: content, isDirty: false, diskMtime: mtime }
            : f
        ),
      }));
    } catch {
      // File may have been deleted/moved between the signal and the read; ignore.
    }
  }, [updateWorkspace]);

  // The claude:message effect subscribes once (empty deps) and reads live values via refs,
  // so expose the latest applyExternalChange through a ref to avoid a stale closure.
  const applyExternalChangeRef = useRef(applyExternalChange);
  applyExternalChangeRef.current = applyExternalChange;
```

(`useCallback`, `useRef`, `workspacesRef`, `updateWorkspace`, and `setExternallyModified`
are all already defined above this point in the component.)

- [ ] **Step 4: Route the 5-second poll through `applyExternalChange`**

In the poll `useEffect` (`App.tsx:2038-2061`), replace the per-file body. The current loop is:

```tsx
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
```

Replace it with (detection stays in the poll; the action is now shared):

```tsx
      for (const file of editorFiles) {
        try {
          const { mtime } = await (window.sai.fsMtime(file.path) as Promise<{ mtime: number }>);
          if (mtime <= file.diskMtime!) continue;
          await applyExternalChange(projectPath, file.path);
        } catch {
          // File may have been deleted or moved; ignore
        }
      }
```

Then add `applyExternalChange` to this effect's dependency array. The effect currently
ends `}, [projectPath, updateWorkspace]);` — change it to:

```tsx
  }, [projectPath, updateWorkspace, applyExternalChange]);
```

- [ ] **Step 5: Add the instant trigger in the `claude:message` handler**

In the `claudeOnMessage` callback (`App.tsx:2118`), immediately after the guard
`if (!msg.projectPath) return;` (line 2119), insert:

```tsx
      // Hot-reload open files the AI edits: correlate an edit tool_use (which carries the
      // path) with its later successful tool_result (which signals the write completed).
      if (msg.type === 'assistant') {
        for (const { id, path } of extractEditToolUses(msg.message?.content, msg.projectPath)) {
          pendingEditsRef.current.set(id, path);
        }
      } else if (msg.type === 'user') {
        const ws = workspacesRef.current.get(msg.projectPath);
        for (const id of successfulToolResultIds(msg.message?.content)) {
          const editedPath = pendingEditsRef.current.get(id);
          if (editedPath === undefined) continue;
          pendingEditsRef.current.delete(id);
          if (ws?.openFiles.some(f => f.path === editedPath)) {
            void applyExternalChangeRef.current(msg.projectPath, editedPath);
          }
        }
      }
```

- [ ] **Step 6: Typecheck**

Run: `npx tsc --noEmit`
Expected: clean (no new errors).

- [ ] **Step 7: Run the existing App/CodePanel-related suites to confirm no regression**

Run: `npx vitest run tests/unit/components/CodePanel tests/unit/components/Chat --maxWorkers=2`
Expected: PASS (no behavior change to existing tests; the poll's outcome is unchanged).

- [ ] **Step 8: Commit**

```bash
git add src/App.tsx
git commit -m "feat(editor): hot-reload the open file the instant the AI edits it"
```

---

## Task 3: Full verification

**Files:** none (verification only)

- [ ] **Step 1: Full unit suite + typecheck**

Run: `npx vitest run --maxWorkers=2`
Expected: PASS.

Run: `npx tsc --noEmit`
Expected: clean.

- [ ] **Step 2: Manual smoke (if running the app)**

1. Open a file in the editor. Ask the AI to edit it. Confirm the editor updates **instantly**
   (not after ~5s), with no banner, since the file was clean.
2. Open a file, make an unsaved edit (leave it dirty). Ask the AI to edit the same file.
   Confirm the **"file changed on disk" banner appears instantly** (Reload / Keep My Edits),
   and your unsaved edits are not clobbered.
3. View a markdown file in preview while the AI edits it → preview refreshes.
4. Edit a file that is NOT open → nothing happens (no error).

- [ ] **Step 3: Final commit (empty if nothing to add)**

```bash
git add -A
git commit -m "test(editor): verify hot-reload on AI edits" --allow-empty
```

---

## Self-Review Notes

- **Spec coverage:** two pure extractors → Task 1; `applyExternalChange` extraction + poll routing → Task 2 steps 3-4; id-correlation instant trigger + open-file match → Task 2 step 5; behavior (clean reload / dirty banner / all views / poll fallback) preserved. ✅
- **No placeholders:** all code shown in full. ✅
- **Type consistency:** `extractEditToolUses(content, projectRoot) → {id,path}[]`, `successfulToolResultIds(content) → string[]`, `pendingEditsRef: Map<string,string>`, `applyExternalChange(projectPath, filePath)`, `applyExternalChangeRef` — consistent across tasks. ✅
- **Stale-closure safety:** the `claude:message` effect has `[]` deps and uses refs; the instant trigger calls `applyExternalChangeRef.current`, and reads workspaces via `workspacesRef`. ✅
- **Dedup/growth:** entries are deleted on their tool_result, so the map self-drains. ✅
- **Machine constraint:** vitest `--maxWorkers=2`.
