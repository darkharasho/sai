# Swarm WS5 — Land / Worktree Resilience Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stop a failed rebase-on-land from wedging a worktree, stop a swallowed worktree-remove from orphaning a branch, and provide a tested pure helper for identifying stale swarm worktrees/branches at startup (destructive GC wiring deferred until it can be verified in a running Electron app).

**Architecture:** Keep land/worktree decision logic in DI'd pure modules under the pattern the repo already uses (`src/lib/swarmLanding.ts`). Add an optional `rebaseAbort` to `LandDeps`, a pure `rebaseRetry` orchestrator, a pure `removeWorktreeAndBranch` cleanup helper (electron side), and a pure `findOrphanWorktrees` detector. Wire the renderer (`src/App.tsx`) and the electron IPC (`electron/services/swarm.ts`) over these helpers.

**Tech Stack:** TypeScript, React renderer (`src/App.tsx`), Electron main (`electron/services/swarm.ts`, `electron/services/git.ts`), Vitest (`--maxWorkers=2`). Renderer tests import via `@/…`; electron tests import via relative `../../electron/…` (see `tests/swarm/claudeExit.test.ts`). Spec: `docs/superpowers/specs/2026-06-03-swarm-hardening-design.md` (WS5, finding #8).

---

## Background facts (verified against current code)

- `landTask` (`src/lib/swarmLanding.ts:14-53`): on FF failure it optionally `rebase`s and retries; if rebase throws it returns `{ok:false, reason:'rebase-needed', detail}` **without aborting** — leaving the worktree mid-rebase (wedged). `LandDeps` (`:3-12`) has no `rebaseAbort`.
- `electron/services/swarm.ts:22-25` (`swarm:worktree-remove`): `await gitWorktreeRemove(...).catch(() => {})` **swallows** the failure, then always `gitDeleteBranch(...)` — so a still-present worktree gets its branch deleted (orphan).
- `gitWorktreeRemove` (`electron/services/git.ts:124-126`) runs `worktree remove --force`; `gitDeleteBranch` (`:128-130`) runs `branch -D` and swallows its own error.
- IPC `git:rebaseAbort` exists (`electron/services/git.ts:473-475`) and is exposed as `window.sai.gitRebaseAbort(cwd)` (`electron/preload.ts:100`). `git:rebaseStatus` (`:443-467`) returns `{ inProgress: boolean, onto: string }`. `window.sai.gitRebaseStatus` is exposed (`preload.ts:98`).
- Renderer land wiring `landDeps` (`src/App.tsx:1103-1121`) already passes `rebase: (wt, base) => window.sai.gitRebase(wt, base)`.
- `onRebaseRetry` (`src/App.tsx:3758-3773`) rebases directly then lands — no in-progress detection, no abort-on-failure, and is **not** routed through `landQueueRef` (`src/App.tsx:1287,1302,1335`).
- Worktree path layout (`electron/services/swarm.ts:8-14`): `<dirname(project)>/.sai-swarm/<basename(project)>/<taskId>`.

---

## File structure

- **Modify** `src/lib/swarmLanding.ts` — add `rebaseAbort?` to `LandDeps`; abort on rebase failure; add `rebaseRetry`.
- **Create** `electron/services/swarmWorktreeCleanup.ts` — pure `removeWorktreeAndBranch` + pure `findOrphanWorktrees`.
- **Modify** `electron/services/swarm.ts` — use `removeWorktreeAndBranch` in the `swarm:worktree-remove` handler.
- **Modify** `src/App.tsx` — pass `rebaseAbort` into `landDeps`; rewrite `onRebaseRetry` over `rebaseRetry` + `landQueueRef`.
- **Tests:** `tests/swarm/swarmLanding.test.ts`, `tests/swarm/swarmWorktreeCleanup.test.ts` (new).

---

## Task 1: `landTask` aborts a failed rebase

**Files:**
- Modify: `src/lib/swarmLanding.ts:3-46`
- Test: `tests/swarm/swarmLanding.test.ts`

- [ ] **Step 1: Write the failing test**

Add to `tests/swarm/swarmLanding.test.ts`:

```typescript
  it('aborts the rebase and reports rebase-needed when rebase fails', async () => {
    const rebaseAbort = vi.fn().mockResolvedValue(undefined);
    const task = { id: 't', workspaceId: '/p', branch: 'swarm/x', baseBranch: 'main', worktreePath: '/wt' } as any;
    const r = await landTask(task, {
      canFastForward: () => Promise.resolve(false),
      ffMerge: vi.fn(),
      worktreeRemove: vi.fn(),
      updateTask: vi.fn(),
      rebase: () => Promise.reject(new Error('conflict')),
      rebaseAbort,
    });
    expect(rebaseAbort).toHaveBeenCalledWith('/wt');
    expect(r).toMatchObject({ ok: false, reason: 'rebase-needed' });
  });
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run tests/swarm/swarmLanding.test.ts --maxWorkers=2`
Expected: FAIL — `rebaseAbort` never called (not in deps / not invoked).

- [ ] **Step 3: Implement**

In `src/lib/swarmLanding.ts`, add to `LandDeps` (after the `rebase?` field):

```typescript
  /** Optional: abort an in-progress rebase, leaving the worktree clean. Called
   *  when `rebase` throws so a failed land doesn't wedge the worktree. */
  rebaseAbort?: (worktreePath: string) => Promise<void>;
```

Replace the rebase catch block (`src/lib/swarmLanding.ts:40-44`):

```typescript
    try {
      await deps.rebase(task.worktreePath, task.baseBranch);
    } catch (err) {
      // Leave the worktree clean so the next attempt / retry isn't blocked by an
      // in-progress rebase.
      if (deps.rebaseAbort) {
        try { await deps.rebaseAbort(task.worktreePath); } catch { /* best-effort */ }
      }
      return { ok: false, reason: 'rebase-needed', detail: err instanceof Error ? err.message : String(err) };
    }
```

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run tests/swarm/swarmLanding.test.ts --maxWorkers=2`
Expected: PASS (new test + the 3 existing).

- [ ] **Step 5: Commit**

```bash
git add src/lib/swarmLanding.ts tests/swarm/swarmLanding.test.ts
git commit -m "fix(swarm): abort a failed rebase on land so the worktree isn't wedged"
```

---

## Task 2: `rebaseRetry` orchestrator (abort-if-in-progress → rebase → abort-on-failure)

**Files:**
- Modify: `src/lib/swarmLanding.ts` (append)
- Test: `tests/swarm/swarmLanding.test.ts`

- [ ] **Step 1: Write the failing tests**

Add to `tests/swarm/swarmLanding.test.ts` (and add `rebaseRetry` to the import on line 2):

```typescript
describe('rebaseRetry', () => {
  it('aborts an in-progress rebase before retrying', async () => {
    const calls: string[] = [];
    const r = await rebaseRetry('/wt', 'main', {
      rebaseStatus: async () => { calls.push('status'); return { inProgress: true }; },
      rebaseAbort: async () => { calls.push('abort'); },
      rebase: async () => { calls.push('rebase'); },
    });
    expect(r).toEqual({ ok: true });
    expect(calls).toEqual(['status', 'abort', 'rebase']);
  });

  it('skips abort when no rebase is in progress', async () => {
    const rebaseAbort = vi.fn();
    const r = await rebaseRetry('/wt', 'main', {
      rebaseStatus: async () => ({ inProgress: false }),
      rebaseAbort,
      rebase: async () => {},
    });
    expect(r).toEqual({ ok: true });
    expect(rebaseAbort).not.toHaveBeenCalled();
  });

  it('aborts and returns ok:false when the rebase throws', async () => {
    const rebaseAbort = vi.fn().mockResolvedValue(undefined);
    const r = await rebaseRetry('/wt', 'main', {
      rebaseStatus: async () => ({ inProgress: false }),
      rebaseAbort,
      rebase: async () => { throw new Error('conflict'); },
    });
    expect(rebaseAbort).toHaveBeenCalledWith('/wt');
    expect(r).toMatchObject({ ok: false });
    expect((r as any).detail).toContain('conflict');
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run tests/swarm/swarmLanding.test.ts -t rebaseRetry --maxWorkers=2`
Expected: FAIL — `rebaseRetry` not exported.

- [ ] **Step 3: Implement** — append to `src/lib/swarmLanding.ts`:

```typescript
export interface RebaseRetryDeps {
  rebaseStatus: (worktreePath: string) => Promise<{ inProgress: boolean }>;
  rebaseAbort: (worktreePath: string) => Promise<void>;
  rebase: (worktreePath: string, baseBranch: string) => Promise<void>;
}

/**
 * Re-run a rebase for a "rebase + retry" land. Clears any in-progress rebase
 * first (re-running into an in-progress rebase is the wedge bug), then rebases.
 * On failure it aborts so the worktree is left clean.
 */
export async function rebaseRetry(
  worktreePath: string,
  baseBranch: string,
  deps: RebaseRetryDeps,
): Promise<{ ok: true } | { ok: false; detail: string }> {
  try {
    const status = await deps.rebaseStatus(worktreePath);
    if (status.inProgress) await deps.rebaseAbort(worktreePath);
    await deps.rebase(worktreePath, baseBranch);
    return { ok: true };
  } catch (err) {
    try { await deps.rebaseAbort(worktreePath); } catch { /* best-effort */ }
    return { ok: false, detail: err instanceof Error ? err.message : String(err) };
  }
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run tests/swarm/swarmLanding.test.ts -t rebaseRetry --maxWorkers=2`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/swarmLanding.ts tests/swarm/swarmLanding.test.ts
git commit -m "feat(swarm): rebaseRetry clears an in-progress rebase and aborts on failure"
```

---

## Task 3: `removeWorktreeAndBranch` — don't delete the branch while the worktree survives

**Files:**
- Create: `electron/services/swarmWorktreeCleanup.ts`
- Test: `tests/swarm/swarmWorktreeCleanup.test.ts`
- Modify: `electron/services/swarm.ts:1-25`

- [ ] **Step 1: Write the failing tests**

Create `tests/swarm/swarmWorktreeCleanup.test.ts`:

```typescript
import { describe, it, expect, vi } from 'vitest';
import { removeWorktreeAndBranch } from '../../electron/services/swarmWorktreeCleanup';

describe('removeWorktreeAndBranch', () => {
  it('removes the worktree then deletes the branch on success', async () => {
    const worktreeRemove = vi.fn().mockResolvedValue(undefined);
    const deleteBranch = vi.fn().mockResolvedValue(undefined);
    const worktreeExists = vi.fn().mockReturnValue(false);
    await removeWorktreeAndBranch('/p', '/wt', 'swarm/x', { worktreeRemove, deleteBranch, worktreeExists });
    expect(worktreeRemove).toHaveBeenCalledWith('/p', '/wt');
    expect(deleteBranch).toHaveBeenCalledWith('/p', 'swarm/x');
  });

  it('does NOT delete the branch and surfaces the error when the worktree still exists', async () => {
    const worktreeRemove = vi.fn().mockRejectedValue(new Error('locked'));
    const deleteBranch = vi.fn();
    const worktreeExists = vi.fn().mockReturnValue(true);
    await expect(
      removeWorktreeAndBranch('/p', '/wt', 'swarm/x', { worktreeRemove, deleteBranch, worktreeExists })
    ).rejects.toThrow('locked');
    expect(deleteBranch).not.toHaveBeenCalled();
  });

  it('still deletes the branch if remove errored but the worktree is gone anyway', async () => {
    const worktreeRemove = vi.fn().mockRejectedValue(new Error('already removed'));
    const deleteBranch = vi.fn().mockResolvedValue(undefined);
    const worktreeExists = vi.fn().mockReturnValue(false);
    await removeWorktreeAndBranch('/p', '/wt', 'swarm/x', { worktreeRemove, deleteBranch, worktreeExists });
    expect(deleteBranch).toHaveBeenCalledWith('/p', 'swarm/x');
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run tests/swarm/swarmWorktreeCleanup.test.ts --maxWorkers=2`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement** — create `electron/services/swarmWorktreeCleanup.ts`:

```typescript
import * as fs from 'node:fs';

export interface WorktreeCleanupDeps {
  worktreeRemove: (repoCwd: string, worktreePath: string) => Promise<void>;
  deleteBranch: (repoCwd: string, branch: string) => Promise<void>;
  /** Whether the worktree directory still exists after a remove attempt. */
  worktreeExists: (worktreePath: string) => boolean;
}

/**
 * Remove a swarm worktree, then delete its branch — but only if the worktree is
 * actually gone. Deleting the branch while its worktree still exists orphans the
 * worktree (git refuses to reuse the branch). On a remove failure where the
 * worktree survives, surface the error and leave the branch intact.
 */
export async function removeWorktreeAndBranch(
  repoCwd: string,
  worktreePath: string,
  branch: string,
  deps: WorktreeCleanupDeps,
): Promise<void> {
  try {
    await deps.worktreeRemove(repoCwd, worktreePath);
  } catch (err) {
    if (deps.worktreeExists(worktreePath)) throw err; // worktree survived → keep the branch
    // else: remove "failed" but the worktree is gone → safe to continue
  }
  await deps.deleteBranch(repoCwd, branch);
}

export const defaultWorktreeExists = (worktreePath: string): boolean => fs.existsSync(worktreePath);
```

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run tests/swarm/swarmWorktreeCleanup.test.ts --maxWorkers=2`
Expected: PASS.

- [ ] **Step 5: Wire it into the IPC handler**

In `electron/services/swarm.ts`, update the import block and the handler:

```typescript
import { removeWorktreeAndBranch, defaultWorktreeExists } from './swarmWorktreeCleanup';
```

Replace the `swarm:worktree-remove` handler body (`electron/services/swarm.ts:22-25`):

```typescript
  ipcMain.handle('swarm:worktree-remove', async (_e, projectPath: string, worktreePath: string, branch: string) => {
    await removeWorktreeAndBranch(projectPath, worktreePath, branch, {
      worktreeRemove: gitWorktreeRemove,
      deleteBranch: gitDeleteBranch,
      worktreeExists: defaultWorktreeExists,
    });
  });
```

- [ ] **Step 6: Typecheck + commit**

Run: `npx tsc --noEmit`
Expected: clean.

```bash
git add electron/services/swarmWorktreeCleanup.ts electron/services/swarm.ts tests/swarm/swarmWorktreeCleanup.test.ts
git commit -m "fix(swarm): don't delete a task branch while its worktree still exists"
```

---

## Task 4: `findOrphanWorktrees` pure detector (GC deletion wiring deferred)

**Files:**
- Modify: `electron/services/swarmWorktreeCleanup.ts` (append)
- Test: `tests/swarm/swarmWorktreeCleanup.test.ts`

> **Deferred:** the destructive startup GC (actually running `git worktree prune`, removing dirs, deleting branches) is intentionally NOT wired here — it can't be verified without a running Electron app and operates on real repos. This task lands the tested pure detector so the wiring is a small, reviewable follow-up.

- [ ] **Step 1: Write the failing test**

Add to `tests/swarm/swarmWorktreeCleanup.test.ts` (add `findOrphanWorktrees` to the import):

```typescript
describe('findOrphanWorktrees', () => {
  it('returns worktree dirs whose taskId has no live task', () => {
    const orphans = findOrphanWorktrees(
      ['t1', 't2', 't3'],            // dir entries under .sai-swarm/<ws>/
      new Set(['t2']),               // live task ids
    );
    expect(orphans.sort()).toEqual(['t1', 't3']);
  });

  it('returns empty when every dir maps to a live task', () => {
    expect(findOrphanWorktrees(['t1'], new Set(['t1']))).toEqual([]);
  });

  it('returns empty for no dirs', () => {
    expect(findOrphanWorktrees([], new Set(['t1']))).toEqual([]);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run tests/swarm/swarmWorktreeCleanup.test.ts -t findOrphanWorktrees --maxWorkers=2`
Expected: FAIL — not exported.

- [ ] **Step 3: Implement** — append to `electron/services/swarmWorktreeCleanup.ts`:

```typescript
/**
 * Given the task-id directory names found under a workspace's `.sai-swarm/<ws>/`
 * folder and the set of live (persisted, non-terminal-removed) task ids, return
 * the directory names that no longer correspond to a live task — candidates for
 * GC. Pure: callers do the actual fs/git removal.
 */
export function findOrphanWorktrees(
  worktreeDirTaskIds: readonly string[],
  liveTaskIds: ReadonlySet<string>,
): string[] {
  return worktreeDirTaskIds.filter(id => !liveTaskIds.has(id));
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run tests/swarm/swarmWorktreeCleanup.test.ts -t findOrphanWorktrees --maxWorkers=2`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add electron/services/swarmWorktreeCleanup.ts tests/swarm/swarmWorktreeCleanup.test.ts
git commit -m "feat(swarm): findOrphanWorktrees detector (GC deletion wiring deferred)"
```

---

## Task 5: Wire `rebaseAbort` + `rebaseRetry` into the renderer

**Files:**
- Modify: `src/App.tsx:1116-1121` (landDeps), `src/App.tsx:3758-3773` (onRebaseRetry)

- [ ] **Step 1: Add `rebaseAbort` to `landDeps`**

In `src/App.tsx`, in the `landDeps` object (after the `rebase:` field at `:1119-1120`), add:

```typescript
      rebaseAbort: (worktreePath: string) =>
        (window.sai as any).gitRebaseAbort(worktreePath),
```

- [ ] **Step 2: Rewrite `onRebaseRetry` over `rebaseRetry` + `landQueueRef`**

Add `rebaseRetry` to the landing import (`src/App.tsx:50`):

```typescript
import { landTask, discardTask, rebaseRetry } from './lib/swarmLanding';
```

Replace the `onRebaseRetry` handler (`src/App.tsx:3758-3773`):

```typescript
                          onRebaseRetry={async (taskRef) => {
                            const t = (swarmTasksByWs.get(wsPath) ?? []).find(x => x.id === taskRef);
                            if (!t || !t.worktreePath) {
                              console.warn('swarm: rebase-retry skipped, task or worktree missing', taskRef);
                              return;
                            }
                            const wt = t.worktreePath;
                            // Serialize behind the land queue so a retry never
                            // races a concurrent land. Clear any in-progress
                            // rebase first, then rebase, then land.
                            const next = landQueueRef.current.then(async () => {
                              const sai = window.sai as any;
                              const r = await rebaseRetry(wt, t.baseBranch, {
                                rebaseStatus: (p: string) => sai.gitRebaseStatus(p),
                                rebaseAbort: (p: string) => sai.gitRebaseAbort(p),
                                rebase: (p: string, base: string) => sai.gitRebase(p, base),
                              });
                              if (!r.ok) {
                                console.error('swarm: rebase failed', r.detail);
                                window.alert(`Rebase failed: ${r.detail}`);
                                return;
                              }
                              try { await landWithCard(taskRef); }
                              catch (err) { console.error('swarm: post-rebase land failed', err); }
                            });
                            landQueueRef.current = next.catch(() => {});
                            await next;
                          }}
```

- [ ] **Step 3: Typecheck + full swarm suite**

Run: `npx tsc --noEmit && npx vitest run tests/swarm --maxWorkers=2`
Expected: clean; all pass.

- [ ] **Step 4: Commit**

```bash
git add src/App.tsx
git commit -m "fix(swarm): land aborts wedged rebases; rebase-retry serializes through the land queue"
```

---

## Final verification

- [ ] **Full suite**: `npx vitest run --maxWorkers=2` → all pass (baseline after WS4: 1554 passed / 3 skipped; WS5 adds ~9 tests).
- [ ] **Typecheck**: `npx tsc --noEmit` → clean.

---

## Self-review notes (spec coverage)

| Spec WS5 requirement | Task |
|---|---|
| On rebase failure in landTask, `git rebase --abort` before `rebase-needed` (new `rebaseAbort` dep) | Task 1 |
| "Rebase + retry" aborts-then-rebases (or detects in-progress first) and routes through `landQueueRef` | Tasks 2 + 5 |
| Stop swallowing `gitWorktreeRemove` failures; if worktree exists, don't delete branch; surface failure | Task 3 |
| Startup GC: prune + remove stale `.sai-swarm/<ws>/*` dirs and `swarm/*` branches with no live task | Task 4 (**pure detector only; destructive wiring deferred — see note**) |
| Test: `landTask` rebase-reject → `rebaseAbort` invoked + `rebase-needed` | Task 1 |
| Test: `worktreeRemove` rejection during land → branch not deleted / failure surfaced | Task 3 |
| Test: GC identifies a stale worktree + dangling branch with no live task | Task 4 |

**Deferred to a verifiable follow-up:** the electron startup GC that actually runs `git worktree prune` and removes orphan dirs/branches. It needs the renderer's live-task set (IndexedDB) over IPC and operates destructively on real repos, so it should be wired and tested against a running app rather than blind.
