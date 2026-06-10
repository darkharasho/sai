# Swarm WS1 — Task Persistence + Restart Reconcile Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make swarm tasks survive an app reload (they are currently in-memory only and silently lost), reconcile "zombie" in-flight tasks to a resumable state on restart, and prune approval rows whose task no longer exists.

**Architecture:** Persistence funnels through **one** mechanism instead of being scattered across the ~18 `setSwarmTasksByWs` call sites. A single React effect watches `swarmTasksByWs`, diffs it against the last-persisted snapshot, and upserts changed tasks / deletes removed ones into the existing IndexedDB store (`src/swarmDb.ts`). On workspace activation, a hydrate effect loads persisted tasks, runs `reconcileTasksOnStartup` (now also demoting `awaiting_approval`→`paused`), prunes orphaned approvals, and seeds state. The diff and prune logic are extracted into pure, unit-tested helpers. Because the in-memory React task object is the full record, persistence writes the whole record (`put`) — there is no partial-patch read-modify-write, so the WS1-spec "concurrent lost-update" race cannot occur; writes are still serialized through a small FIFO for IndexedDB hygiene.

**Tech Stack:** TypeScript, React (hooks), IndexedDB via `src/swarmDb.ts`, Vitest (`--maxWorkers=2`, `fake-indexeddb/auto` for DB tests). Path alias `@/` → `src/`. This is WS1 of `docs/superpowers/specs/2026-06-03-swarm-hardening-design.md`; WS0 (tool taxonomy) is already merged on branch `swarm-hardening`.

---

## Background the engineer needs

`src/App.tsx` holds swarm tasks in `swarmTasksByWs: Map<workspaceId, SwarmTask[]>` (state at `App.tsx:173`). Tasks are created in `spawnSwarmTask` (`App.tsx:921-945`), mutated by the status mirror (`App.tsx:1988-2010`, via `deriveSwarmMirror`/`applySwarmPatch`), and by lifecycle handlers (pause/resume/land/discard in the `swarmHost`, `App.tsx:1046-1138`). Land and discard **remove** the task from the in-memory list.

Today none of this is persisted: the init effect (`App.tsx:526-537`) only calls `swarmInit()`, comments explicitly say tasks are "ephemeral," and `swarmCreateTask`/`swarmGetTasks`/`swarmUpdateTask`/`reconcileTasksOnStartup` have zero callers (dead code, though their tests pass). Approvals *are* persisted and reloaded (`App.tsx:555-567`).

The DB API already exists in `src/swarmDb.ts`: `swarmInit`, `swarmCreateTask` (a full-record `put`, so it doubles as upsert), `swarmGetTasks(ws)`, `swarmUpdateTask(id, patch)`, `swarmDeleteTask(id)`, `swarmGetApprovals(ws)`, `swarmResolveApproval(id)` (deletes the row). `reconcileTasksOnStartup` lives in `src/lib/swarmReconcile.ts`.

## File Structure

- **Modify** `src/lib/swarmReconcile.ts` — extend `reconcileTasksOnStartup` to demote `awaiting_approval`→`paused`; add pure `findOrphanApprovalIds`.
- **Modify** `tests/swarm/swarmReconcile.test.ts` — update the awaiting_approval expectation; add orphan-prune tests.
- **Create** `src/lib/swarmPersistenceDiff.ts` — pure `diffSwarmTasks(prev, next)` → `{ upserts, deletes }`.
- **Create** `tests/swarm/swarmPersistenceDiff.test.ts` — unit tests.
- **Modify** `src/App.tsx` — add a hydrate effect + a persistence diff effect; import the DB/reconcile functions; remove the stale "ephemeral" comments.

---

## Task 1: Extend reconcile to demote awaiting_approval

**Files:**
- Modify: `src/lib/swarmReconcile.ts:9-27`
- Test: `tests/swarm/swarmReconcile.test.ts:47-52`

Per the WS1 design decision: on restart the provider process is gone, so a task left mid-approval is stale and must become resumable. Demote both `streaming` and `awaiting_approval` to `paused`.

- [ ] **Step 1: Update the test to pin the new behavior**

In `tests/swarm/swarmReconcile.test.ts`, replace the test at lines 47-52 (`'leaves awaiting_approval untouched'`) with:

```typescript
  it('demotes awaiting_approval to paused', async () => {
    await swarmCreateTask(makeTask({ id: 'y', status: 'awaiting_approval' }));
    await reconcileTasksOnStartup('/p');
    const [t] = await swarmGetTasks('/p');
    expect(t.status).toBe('paused');
  });
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run tests/swarm/swarmReconcile.test.ts --maxWorkers=2`
Expected: FAIL — the awaiting_approval task is still `awaiting_approval` (current code only demotes `streaming`).

- [ ] **Step 3: Update the implementation**

In `src/lib/swarmReconcile.ts`, update the docstring and the loop body of `reconcileTasksOnStartup`. Replace lines 9-27 with:

```typescript
/**
 * On app start, demote any task that was left mid-flight (`streaming` or
 * `awaiting_approval`) to `paused`. The provider process did not survive the
 * relaunch, so the task cannot still be running and any pending approval is
 * stale; the user must explicitly resume. Other statuses (`queued`, `paused`,
 * `done`, `failed`, `landed`, `discarded`) are preserved as-is.
 */
export async function reconcileTasksOnStartup(
  workspaceId: string,
  deps?: ReconcileDeps
): Promise<void> {
  const getTasks = deps?.getTasks ?? swarmGetTasks;
  const updateTask = deps?.updateTask ?? swarmUpdateTask;
  const tasks = await getTasks(workspaceId);
  for (const t of tasks) {
    if (t.status === 'streaming' || t.status === 'awaiting_approval') {
      await updateTask(t.id, { status: 'paused' });
    }
  }
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run tests/swarm/swarmReconcile.test.ts --maxWorkers=2`
Expected: PASS (all tests, including `demotes streaming to paused`, the new `demotes awaiting_approval to paused`, and `leaves other statuses untouched`).

- [ ] **Step 5: Commit**

```bash
git add src/lib/swarmReconcile.ts tests/swarm/swarmReconcile.test.ts
git commit -m "fix(swarm): reconcile demotes awaiting_approval to paused on restart

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 2: Add pure orphan-approval finder

**Files:**
- Modify: `src/lib/swarmReconcile.ts` (add a new export)
- Test: `tests/swarm/swarmReconcile.test.ts` (add a new describe block)

- [ ] **Step 1: Write the failing test**

Add to the top imports of `tests/swarm/swarmReconcile.test.ts` (the existing import from `@/lib/swarmReconcile`):

```typescript
import { reconcileTasksOnStartup, findOrphanApprovalIds } from '@/lib/swarmReconcile';
```

(Replace the existing `import { reconcileTasksOnStartup } from '@/lib/swarmReconcile';` line with the line above.)

Then append this describe block at the end of the file:

```typescript
describe('findOrphanApprovalIds', () => {
  const appr = (id: string, taskId: string) => ({
    id, taskId, workspaceId: '/p', toolName: 'Bash', toolUseId: 'u', createdAt: 1,
  });

  it('returns approvals whose taskId has no live task', () => {
    const tasks = [makeTask({ id: 't1' })];
    const approvals = [appr('a1', 't1'), appr('a2', 'gone'), appr('a3', 'alsoGone')];
    expect(findOrphanApprovalIds(tasks, approvals).sort()).toEqual(['a2', 'a3']);
  });

  it('returns empty when every approval has a live task', () => {
    const tasks = [makeTask({ id: 't1' }), makeTask({ id: 't2' })];
    const approvals = [appr('a1', 't1'), appr('a2', 't2')];
    expect(findOrphanApprovalIds(tasks, approvals)).toEqual([]);
  });

  it('treats all approvals as orphans when there are no tasks', () => {
    const approvals = [appr('a1', 't1'), appr('a2', 't2')];
    expect(findOrphanApprovalIds([], approvals).sort()).toEqual(['a1', 'a2']);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run tests/swarm/swarmReconcile.test.ts --maxWorkers=2`
Expected: FAIL — `findOrphanApprovalIds` is not exported.

- [ ] **Step 3: Write the implementation**

In `src/lib/swarmReconcile.ts`, update the type import on line 1 and append the new function at the end of the file. The current line 1 is `import type { SwarmTask } from '../types';` — change it to:

```typescript
import type { SwarmTask, SwarmApproval } from '../types';
```

Append at the end of the file:

```typescript
/**
 * Given the live task set and persisted approval rows, return the ids of
 * approvals whose `taskId` no longer matches any task. These are orphans
 * (their task was lost/discarded) and should be pruned on startup so they
 * don't inflate counts or render as un-actionable cards.
 */
export function findOrphanApprovalIds(
  tasks: Pick<SwarmTask, 'id'>[],
  approvals: Pick<SwarmApproval, 'id' | 'taskId'>[],
): string[] {
  const liveTaskIds = new Set(tasks.map(t => t.id));
  return approvals.filter(a => !liveTaskIds.has(a.taskId)).map(a => a.id);
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run tests/swarm/swarmReconcile.test.ts --maxWorkers=2`
Expected: PASS (all reconcile + orphan tests).

- [ ] **Step 5: Commit**

```bash
git add src/lib/swarmReconcile.ts tests/swarm/swarmReconcile.test.ts
git commit -m "feat(swarm): findOrphanApprovalIds for startup approval pruning

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 3: Pure task-diff helper for persistence

**Files:**
- Create: `src/lib/swarmPersistenceDiff.ts`
- Test: `tests/swarm/swarmPersistenceDiff.test.ts`

This computes what to write when `swarmTasksByWs` changes: which tasks to upsert (new or changed) and which ids to delete (present before, gone now). Equality is a shallow field comparison — the status mirror and lifecycle handlers always produce new objects with changed fields, so shallow comparison is correct and cheap.

- [ ] **Step 1: Write the failing test**

Create `tests/swarm/swarmPersistenceDiff.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { diffSwarmTasks } from '@/lib/swarmPersistenceDiff';
import type { SwarmTask } from '@/types';

const t = (over: Partial<SwarmTask> = {}): SwarmTask => ({
  id: 'a', workspaceId: '/p', sessionId: 's', title: 't', prompt: 'p',
  provider: 'claude', model: 'opus', approvalPolicy: 'auto-read',
  status: 'queued', branch: 'b', baseBranch: 'main', worktreePath: null,
  createdAt: 1, lastActivityAt: 1, costEstimate: 0, toolCallCount: 0, ...over,
});

describe('diffSwarmTasks', () => {
  it('upserts brand-new tasks', () => {
    const { upserts, deletes } = diffSwarmTasks([], [t({ id: 'a' }), t({ id: 'b' })]);
    expect(upserts.map(u => u.id).sort()).toEqual(['a', 'b']);
    expect(deletes).toEqual([]);
  });

  it('deletes tasks no longer present', () => {
    const { upserts, deletes } = diffSwarmTasks([t({ id: 'a' }), t({ id: 'b' })], [t({ id: 'a' })]);
    expect(upserts).toEqual([]);
    expect(deletes).toEqual(['b']);
  });

  it('upserts tasks whose fields changed', () => {
    const prev = [t({ id: 'a', status: 'queued' })];
    const next = [t({ id: 'a', status: 'streaming' })];
    const { upserts, deletes } = diffSwarmTasks(prev, next);
    expect(upserts.map(u => u.id)).toEqual(['a']);
    expect(deletes).toEqual([]);
  });

  it('emits nothing when nothing changed', () => {
    const prev = [t({ id: 'a' })];
    const next = [t({ id: 'a' })];
    const { upserts, deletes } = diffSwarmTasks(prev, next);
    expect(upserts).toEqual([]);
    expect(deletes).toEqual([]);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run tests/swarm/swarmPersistenceDiff.test.ts --maxWorkers=2`
Expected: FAIL — cannot resolve `@/lib/swarmPersistenceDiff`.

- [ ] **Step 3: Write the implementation**

Create `src/lib/swarmPersistenceDiff.ts`:

```typescript
import type { SwarmTask } from '../types';

export interface SwarmTaskDiff {
  upserts: SwarmTask[];
  deletes: string[];
}

function shallowEqualTask(a: SwarmTask, b: SwarmTask): boolean {
  const ak = Object.keys(a) as (keyof SwarmTask)[];
  const bk = Object.keys(b) as (keyof SwarmTask)[];
  if (ak.length !== bk.length) return false;
  for (const k of ak) {
    if (a[k] !== b[k]) return false;
  }
  return true;
}

/**
 * Compute the persistence actions needed to move the store from `prev` to
 * `next` for a single workspace's task list:
 *  - upserts: tasks in `next` that are new or whose fields changed (shallow).
 *  - deletes: ids present in `prev` but absent from `next`.
 * The in-memory React task object is the full record, so callers persist the
 * whole object (a put), avoiding any partial-patch read-modify-write race.
 */
export function diffSwarmTasks(prev: SwarmTask[], next: SwarmTask[]): SwarmTaskDiff {
  const prevById = new Map(prev.map(t => [t.id, t]));
  const nextById = new Map(next.map(t => [t.id, t]));
  const upserts: SwarmTask[] = [];
  for (const t of next) {
    const before = prevById.get(t.id);
    if (!before || !shallowEqualTask(before, t)) upserts.push(t);
  }
  const deletes: string[] = [];
  for (const id of prevById.keys()) {
    if (!nextById.has(id)) deletes.push(id);
  }
  return { upserts, deletes };
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run tests/swarm/swarmPersistenceDiff.test.ts --maxWorkers=2`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add src/lib/swarmPersistenceDiff.ts tests/swarm/swarmPersistenceDiff.test.ts
git commit -m "feat(swarm): pure diffSwarmTasks helper for persistence

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 4: Wire persistence + hydrate into App.tsx

**Files:**
- Modify: `src/App.tsx` (imports near line 44; init/hydrate effect near 526-551; new persistence effect)

This is the integration task. It funnels all persistence through one diff effect and hydrates per workspace on activation. No changes to the 18 `setSwarmTasksByWs` sites are needed — the diff effect observes their net result.

- [ ] **Step 1: Extend the swarmDb / reconcile imports**

In `src/App.tsx`, line 44 currently reads:

```typescript
import { swarmInit, swarmGetApprovals, swarmResolveApproval, swarmCreateApproval } from './swarmDb';
```

Replace it with:

```typescript
import { swarmInit, swarmGetApprovals, swarmResolveApproval, swarmCreateApproval, swarmGetTasks, swarmCreateTask, swarmDeleteTask } from './swarmDb';
import { reconcileTasksOnStartup, findOrphanApprovalIds } from './lib/swarmReconcile';
import { diffSwarmTasks } from './lib/swarmPersistenceDiff';
```

(If `./lib/swarmReconcile` or `./lib/swarmPersistenceDiff` are already imported for other reasons, merge rather than duplicate. `findOrphanApprovalIds` and `reconcileTasksOnStartup` come from `swarmReconcile`.)

- [ ] **Step 2: Add the hydration refs**

Find the persistence snapshot needs a ref. Near the other swarm refs (e.g. just after `const swarmTasksByWsRef = useRef(swarmTasksByWs);` at `App.tsx:268`), add:

```typescript
  // Workspaces whose persisted swarm tasks have already been hydrated this
  // session (so we don't re-load and clobber live in-memory state).
  const hydratedWorkspacesRef = useRef<Set<string>>(new Set());
  // Last task list persisted per workspace, for diffing on change.
  const persistedTasksRef = useRef<Map<string, SwarmTask[]>>(new Map());
  // FIFO so overlapping persistence flushes don't interleave IndexedDB txns.
  const persistQueueRef = useRef<Promise<unknown>>(Promise.resolve());
```

- [ ] **Step 3: Replace the init effect with init + hydrate**

In `src/App.tsx`, replace the entire init effect at lines 526-537 (the block starting with the `// Initialize the swarm IndexedDB once.` comment and ending at `}, []);`) with:

```typescript
  // Initialize the swarm IndexedDB once.
  useEffect(() => {
    (async () => {
      try {
        await swarmInit();
      } catch {
        /* best-effort: ignore init failures */
      }
    })();
  }, []);

  // Hydrate persisted swarm tasks for a workspace the first time it becomes
  // active: load tasks, reconcile zombie (streaming/awaiting_approval) tasks to
  // paused, prune approvals whose task is gone, then seed in-memory state.
  useEffect(() => {
    const ws = activeProjectPath;
    if (!ws || hydratedWorkspacesRef.current.has(ws)) return;
    hydratedWorkspacesRef.current.add(ws);
    let cancelled = false;
    (async () => {
      try {
        await swarmInit();
        await reconcileTasksOnStartup(ws);
        const tasks = await swarmGetTasks(ws);
        const approvals = await swarmGetApprovals(ws);
        const orphanIds = findOrphanApprovalIds(tasks, approvals);
        await Promise.all(orphanIds.map(id => swarmResolveApproval(id)));
        const liveApprovals = approvals.filter(a => !orphanIds.includes(a.id));
        if (cancelled) return;
        persistedTasksRef.current.set(ws, tasks);
        setSwarmTasksByWs(prev => {
          const m = new Map(prev);
          // Don't clobber any tasks spawned before hydrate resolved.
          const existing = m.get(ws) ?? [];
          const existingIds = new Set(existing.map(t => t.id));
          const merged = [...existing, ...tasks.filter(t => !existingIds.has(t.id))];
          m.set(ws, merged);
          return m;
        });
        setSwarmApprovalsByWs(prev => {
          const m = new Map(prev);
          m.set(ws, liveApprovals);
          return m;
        });
      } catch {
        // best-effort: a hydrate failure shouldn't crash the workspace.
        hydratedWorkspacesRef.current.delete(ws);
      }
    })();
    return () => { cancelled = true; };
  }, [activeProjectPath]);
```

Note: the old comment at lines 545-551 (the "Reset the swarm sidebar selection… Tasks themselves are ephemeral" effect) — keep the effect but update its comment. Change the comment block above that effect to:

```typescript
  // Reset the swarm sidebar selection to the Overview pin whenever the
  // active workspace changes.
```

(Leave the effect body `if (!activeProjectPath) return; setSwarmSelected('overview');` unchanged.)

- [ ] **Step 4: Add the persistence diff effect**

Add this effect immediately after the approvals-refresh effect that ends at `App.tsx:567` (the one with dep array `[activeProjectPath, swarmTasksByWs]`):

```typescript
  // Persist swarm task changes. All ~dozen setSwarmTasksByWs sites funnel here:
  // we diff the new map against the last-persisted snapshot per workspace and
  // upsert changed tasks / delete removed ones. Writes are serialized via a
  // FIFO. The full task object is persisted (put), so there is no partial-patch
  // read-modify-write race.
  useEffect(() => {
    const snapshot = swarmTasksByWs;
    persistQueueRef.current = persistQueueRef.current.then(async () => {
      for (const [ws, nextTasks] of snapshot.entries()) {
        // Only persist workspaces that have been hydrated, so the diff baseline
        // is correct (avoids deleting persisted tasks before they're loaded).
        if (!hydratedWorkspacesRef.current.has(ws)) continue;
        const prevTasks = persistedTasksRef.current.get(ws) ?? [];
        const { upserts, deletes } = diffSwarmTasks(prevTasks, nextTasks);
        for (const task of upserts) {
          try { await swarmCreateTask(task); } catch { /* ignore */ }
        }
        for (const id of deletes) {
          try { await swarmDeleteTask(id); } catch { /* ignore */ }
        }
        persistedTasksRef.current.set(ws, nextTasks);
      }
    }).catch(() => { /* keep the queue alive on error */ });
  }, [swarmTasksByWs]);
```

Important: a workspace that spawns a task before hydrate completes — `spawnSwarmTask` only runs for the active workspace, and hydrate adds the active workspace to `hydratedWorkspacesRef` synchronously at its start, so by the time a spawn happens the workspace is marked hydrated and its tasks persist. The hydrate's own `setSwarmTasksByWs` updates `persistedTasksRef` first, so the diff effect sees no spurious churn.

- [ ] **Step 5: Typecheck and run the swarm suite**

Run: `npx tsc --noEmit`
Expected: exit 0.

Run: `npx vitest run tests/swarm --maxWorkers=2`
Expected: PASS (all swarm tests, including WS0 + the three WS1 helper test files).

- [ ] **Step 6: Commit**

```bash
git add src/App.tsx
git commit -m "feat(swarm): persist tasks + hydrate/reconcile on workspace activation

Tasks now survive reload. A single diff effect funnels all task-state changes
into IndexedDB; on first activation a workspace hydrates persisted tasks,
demotes zombie streaming/awaiting_approval tasks to paused, and prunes orphaned
approvals.

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 5: Full verification

**Files:** none (verification only)

- [ ] **Step 1: Full unit suite**

Run: `npx vitest run --maxWorkers=2`
Expected: PASS (no regressions across the whole suite, not just swarm).

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit`
Expected: exit 0.

- [ ] **Step 3: Confirm dead-code is now live**

Run: `grep -rn "swarmCreateTask\|swarmGetTasks\|swarmDeleteTask\|reconcileTasksOnStartup\|findOrphanApprovalIds\|diffSwarmTasks" src/App.tsx`
Expected: all of these are imported and called in `src/App.tsx` (no longer dead code).

- [ ] **Step 4: Confirm stale "ephemeral" comments are gone**

Run: `grep -rn "ephemeral" src/App.tsx`
Expected: no matches referring to swarm tasks being ephemeral/never-persisted (the comments at the old 526-528 and 545-547 should be updated/removed).

---

## Self-review notes

- **Spec coverage (WS1 section of the design):** tasks persisted on change (Task 4 diff effect → `swarmCreateTask`); loaded per workspace on activation (Task 4 hydrate); reconcile demotes `streaming`+`awaiting_approval`→`paused` (Task 1); orphan approvals pruned (Task 2 + hydrate); concurrent lost-update race avoided by full-record `put` from single-source React state, with FIFO serialization (Task 3 + Task 4). The spec's "small store wrapper / per-id write queue" is realized as the FIFO + full-record puts; rationale documented in the Architecture section.
- **Type consistency:** `diffSwarmTasks(prev, next) → { upserts: SwarmTask[]; deletes: string[] }`, `findOrphanApprovalIds(tasks, approvals) → string[]`, `reconcileTasksOnStartup(ws, deps?)` — used identically in App.tsx Task 4.
- **No placeholders:** every code step is complete. The one judgement point (hydrate-vs-spawn ordering) is documented inline in Task 4 Step 4.
- **Out of scope (later workstreams):** persisting per-task `costEstimate` (WS2), approval routing by own workspace (WS3), DB migration ladder (deferred). Land/discard intentionally let the diff effect delete the task from the store (terminal tasks drop from the sidebar; the underlying ChatSession persists separately in chat history).
