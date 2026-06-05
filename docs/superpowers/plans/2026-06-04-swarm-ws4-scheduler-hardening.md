# Swarm WS4 — Scheduler Hardening Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the swarm scheduler enforce the concurrency cap correctly across resume, promote queued tasks in *all* workspaces (not just the active one), reclaim cap slots from silently-dead tasks via a watchdog, and never permanently leak a slot when a start attempt fails.

**Architecture:** Keep the cap/promotion logic in the already-unit-tested `SwarmScheduler` class (`src/lib/swarmScheduler.ts`) and add a pure `findStaleTasks` helper there. Move the manual "resume" path off its direct `runSwarmTask` call so it simply enqueues (`status: 'queued'`) and lets the scheduler promote under the cap. Replace the scheduler's in-place `status = 'streaming'` mutation with an internal `pendingStart` set so a throwing/failing `onStart` frees the slot. Wire the App so every workspace with tasks has a scheduler that receives `setTasks` on every relevant state change, plus a periodic watchdog sweep.

**Tech Stack:** TypeScript, React (renderer `src/App.tsx`), Vitest (`--maxWorkers=2`, pinned in `vitest.config.ts`). Test files live under `tests/swarm/`. Spec: `docs/superpowers/specs/2026-06-03-swarm-hardening-design.md` (WS4, findings #5/#6/#7 + slot-leak).

---

## Background facts (verified against current code)

- `SwarmScheduler` (`src/lib/swarmScheduler.ts:34-62`): `tick()` counts `streaming` tasks, computes `free = cap - streaming`, and for each `queued` task **mutates `t.status = 'streaming'` in place** then calls `onStart(t)`. The in-place mutation also mutates the React state object (same reference passed via `setTasks`).
- The scheduler is wired once per **active** workspace in the effect at `src/App.tsx:885-961`. It calls `s.setTasks(swarmTasksByWs.get(activeProjectPath) ?? [])` — **only the active workspace** is ever ticked → non-active queued tasks starve (finding #6).
- `onStart` (`src/App.tsx:891-956`) is `async`: it flips the task to `streaming` via `setSwarmTasksByWs`, eagerly materializes a worktree for likely-write tasks, then calls `runSwarmTask`. On every failure path it calls `removeFromList()` and `return`s (resolves, never rejects).
- Manual resume (`src/App.tsx:3525-3559`, the `onResume` handler) sets `status: 'queued'` then **immediately calls `runSwarmTask` directly** and flips to `streaming`, bypassing the cap (finding #5).
- `SwarmTask.lastActivityAt` (`src/types.ts:392`) is refreshed on every status/toolCount patch by `applySwarmPatch` (`src/lib/swarmStatusMirror.ts:75-89`). A silently-dead `streaming` task keeps a stale `lastActivityAt` → usable watchdog signal (finding #7).
- `SwarmTaskStatus` (`src/types.ts:361-369`): `'queued' | 'streaming' | 'awaiting_approval' | 'paused' | 'done' | 'failed' | 'landed' | 'discarded'`.
- Existing scheduler tests: `tests/swarm/swarmScheduler.test.ts`.

---

## File structure

- **Modify** `src/lib/swarmScheduler.ts` — add `pendingStart` slot tracking to `SwarmScheduler`; widen `onStart` return type to `void | Promise<unknown>`; add pure `findStaleTasks`.
- **Modify** `tests/swarm/swarmScheduler.test.ts` — add cap-across-resume, slot-leak, and `findStaleTasks` tests.
- **Modify** `src/App.tsx` — (a) scheduler effect ticks all workspaces; (b) resume handler enqueues instead of dispatching; (c) `onStart` rejects on failure; (d) watchdog interval.

---

## Task 1: Scheduler slot tracking via `pendingStart`

**Files:**
- Modify: `src/lib/swarmScheduler.ts:29-62`
- Test: `tests/swarm/swarmScheduler.test.ts`

- [ ] **Step 1: Write the failing tests**

Add to `tests/swarm/swarmScheduler.test.ts`:

```typescript
describe('SwarmScheduler — slot accounting', () => {
  it('counts a pending (not-yet-streaming) start against the cap', async () => {
    const onStart = vi.fn(() => new Promise<void>(() => { /* never resolves */ }));
    const s = new SwarmScheduler({ cap: 1, onStart });
    s.setTasks([{ id: 'a', status: 'queued' }, { id: 'b', status: 'queued' }] as any);
    // Only one slot: 'a' is promoted (pending), 'b' must wait even though
    // 'a' has not yet flipped to 'streaming' in external state.
    expect(onStart).toHaveBeenCalledTimes(1);
    expect(onStart).toHaveBeenCalledWith(expect.objectContaining({ id: 'a' }));
  });

  it('does not double-promote a task already pending across re-ticks', () => {
    const onStart = vi.fn(() => new Promise<void>(() => {}));
    const s = new SwarmScheduler({ cap: 2, onStart });
    s.setTasks([{ id: 'a', status: 'queued' }] as any);
    // Same still-queued task list arrives again (e.g. unrelated state change).
    s.setTasks([{ id: 'a', status: 'queued' }] as any);
    expect(onStart).toHaveBeenCalledTimes(1);
  });

  it('stops counting a pending task once external state reports it streaming', () => {
    const onStart = vi.fn(() => new Promise<void>(() => {}));
    const s = new SwarmScheduler({ cap: 1, onStart });
    s.setTasks([{ id: 'a', status: 'queued' }, { id: 'b', status: 'queued' }] as any);
    expect(onStart).toHaveBeenCalledTimes(1); // a pending
    // a is now confirmed streaming; b still queued. Cap 1 is full → no new start.
    s.setTasks([{ id: 'a', status: 'streaming' }, { id: 'b', status: 'queued' }] as any);
    expect(onStart).toHaveBeenCalledTimes(1);
  });

  it('frees the slot after a synchronous onStart throw (promotes on the next tick)', () => {
    const onStart = vi.fn()
      .mockImplementationOnce(() => { throw new Error('boom'); }) // a fails
      .mockImplementation(() => new Promise<void>(() => {}));      // later tasks hang
    const s = new SwarmScheduler({ cap: 1, onStart });
    s.setTasks([{ id: 'a', status: 'queued' }, { id: 'b', status: 'queued' }] as any);
    // a was attempted and threw, releasing its reserved slot.
    expect(onStart).toHaveBeenCalledTimes(1);
    // App removes the failed task from state; the next tick fills the free slot.
    s.setTasks([{ id: 'b', status: 'queued' }] as any);
    expect(onStart).toHaveBeenCalledTimes(2);
    expect(onStart).toHaveBeenNthCalledWith(2, expect.objectContaining({ id: 'b' }));
  });

  it('frees the slot when onStart rejects, promoting another on the next tick', async () => {
    const onStart = vi.fn()
      .mockImplementationOnce(() => Promise.reject(new Error('async boom'))) // a
      .mockImplementation(() => new Promise<void>(() => {}));                 // b hangs
    const s = new SwarmScheduler({ cap: 1, onStart });
    s.setTasks([{ id: 'a', status: 'queued' }, { id: 'b', status: 'queued' }] as any);
    // a is pending; b waits until a's rejection frees the slot.
    expect(onStart).toHaveBeenCalledTimes(1);
    await Promise.resolve(); await Promise.resolve(); // flush microtasks
    // Mirror real App behavior: failed task is removed from state, scheduler re-ticked.
    s.setTasks([{ id: 'b', status: 'queued' }] as any);
    expect(onStart).toHaveBeenCalledWith(expect.objectContaining({ id: 'b' }));
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run tests/swarm/swarmScheduler.test.ts --maxWorkers=2`
Expected: the new tests FAIL (current impl mutates `status` in place and has no pending accounting; e.g. the "never resolves" case still counts only `streaming`, and the throw case currently leaves a mutated-streaming object).

- [ ] **Step 3: Rewrite `SwarmScheduler` with `pendingStart`**

Replace the `SchedulerOptions` interface and `SwarmScheduler` class (`src/lib/swarmScheduler.ts:29-62`) with:

```typescript
export interface SchedulerOptions {
  cap: number;
  /**
   * Start a promoted task. May be sync or async. A thrown error or a rejected
   * promise signals the start failed, freeing the reserved slot. Returning
   * normally means the task is starting; the scheduler keeps the slot reserved
   * until external state (via setTasks) reports the task as no longer 'queued'.
   */
  onStart: (task: SwarmTask) => void | Promise<unknown>;
}

export class SwarmScheduler {
  private tasks: SwarmTask[] = [];
  // Tasks we've called onStart for but whose 'streaming' status hasn't yet been
  // reflected back through setTasks. Reserved against the cap so we never exceed
  // it during the async gap, and cleared on confirmed start or failure.
  private pendingStart = new Set<string>();
  constructor(private opts: SchedulerOptions) {}

  setTasks(tasks: SwarmTask[]) {
    this.tasks = tasks;
    // Drop pending reservations for tasks external state now reports as no
    // longer queued (started → streaming, terminalized, or removed).
    const statusById = new Map(tasks.map(t => [t.id, t.status] as const));
    for (const id of [...this.pendingStart]) {
      if (statusById.get(id) !== 'queued') this.pendingStart.delete(id);
    }
    this.tick();
  }

  setCap(cap: number) {
    this.opts.cap = cap;
    this.tick();
  }

  /** Slots in use: distinct streaming tasks plus outstanding pending starts. */
  private occupiedCount(): number {
    const ids = new Set<string>();
    for (const t of this.tasks) if (t.status === 'streaming') ids.add(t.id);
    for (const id of this.pendingStart) ids.add(id);
    return ids.size;
  }

  tick() {
    let free = this.opts.cap - this.occupiedCount();
    if (free <= 0) return;
    for (const t of this.tasks) {
      if (free === 0) break;
      if (t.status === 'queued' && !this.pendingStart.has(t.id)) {
        this.pendingStart.add(t.id);
        free--;
        this.launch(t);
      }
    }
  }

  private launch(task: SwarmTask) {
    let result: void | Promise<unknown>;
    try {
      result = this.opts.onStart(task);
    } catch {
      // Synchronous failure: release the slot immediately and let the same
      // tick loop fill it.
      this.pendingStart.delete(task.id);
      return;
    }
    if (result && typeof (result as Promise<unknown>).then === 'function') {
      (result as Promise<unknown>).then(undefined, () => {
        // Async failure: release the slot. The next setTasks/setCap drives
        // promotion (App removes/terminalizes the failed task, which re-ticks).
        this.pendingStart.delete(task.id);
      });
    }
  }
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run tests/swarm/swarmScheduler.test.ts --maxWorkers=2`
Expected: PASS (all new tests plus the two pre-existing ones).

- [ ] **Step 5: Commit**

```bash
git add src/lib/swarmScheduler.ts tests/swarm/swarmScheduler.test.ts
git commit -m "feat(swarm): scheduler reserves slots via pendingStart; frees on failed start"
```

---

## Task 2: Pure `findStaleTasks` watchdog helper

**Files:**
- Modify: `src/lib/swarmScheduler.ts` (append helper)
- Test: `tests/swarm/swarmScheduler.test.ts`

- [ ] **Step 1: Write the failing test**

Add to `tests/swarm/swarmScheduler.test.ts` (and add `findStaleTasks` to the import on line 2):

```typescript
describe('findStaleTasks', () => {
  const mk = (id: string, status: string, lastActivityAt: number) =>
    ({ id, status, lastActivityAt } as any);

  it('flags streaming tasks idle longer than the threshold', () => {
    const now = 100_000;
    const stale = findStaleTasks(
      [
        mk('a', 'streaming', now - 90_000), // idle 90s
        mk('b', 'streaming', now - 1_000),  // fresh
        mk('c', 'queued', 0),               // not streaming → ignored
        mk('d', 'awaiting_approval', 0),    // not streaming → ignored
      ],
      now,
      60_000,
    );
    expect(stale.map(t => t.id)).toEqual(['a']);
  });

  it('returns empty when nothing is stale', () => {
    const now = 100_000;
    expect(findStaleTasks([mk('a', 'streaming', now)], now, 60_000)).toEqual([]);
  });

  it('treats exactly-at-threshold as not yet stale', () => {
    const now = 100_000;
    expect(findStaleTasks([mk('a', 'streaming', now - 60_000)], now, 60_000)).toEqual([]);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run tests/swarm/swarmScheduler.test.ts -t findStaleTasks --maxWorkers=2`
Expected: FAIL with "findStaleTasks is not exported" / not defined.

- [ ] **Step 3: Implement `findStaleTasks`**

Append to `src/lib/swarmScheduler.ts`:

```typescript
/**
 * Streaming tasks whose last activity is strictly older than `thresholdMs`.
 * Used by the watchdog to reclaim cap slots from providers that died silently
 * (no terminal `done`/`result`/fatal `error` ever arrived).
 */
export function findStaleTasks(
  tasks: readonly SwarmTask[],
  now: number,
  thresholdMs: number,
): SwarmTask[] {
  return tasks.filter(
    t => t.status === 'streaming' && now - t.lastActivityAt > thresholdMs,
  );
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run tests/swarm/swarmScheduler.test.ts -t findStaleTasks --maxWorkers=2`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/swarmScheduler.ts tests/swarm/swarmScheduler.test.ts
git commit -m "feat(swarm): add findStaleTasks watchdog helper"
```

---

## Task 3: `onStart` rejects on failure (so the slot frees)

**Files:**
- Modify: `src/App.tsx:891-956` (the scheduler `onStart` callback)

Currently each failure path calls `removeFromList()` then `return`s, so the promise resolves and the scheduler can't tell it failed. Make failures reject (after cleanup) so `launch()` releases the pending slot. `removeFromList()` still runs for state cleanup; the reject is additive.

- [ ] **Step 1: Update the three failure paths**

In `src/App.tsx`, within the `onStart: async (task) => { … }` callback:

Replace the worktree-materialization failure (currently `console.error(...); removeFromList(); return;`):

```typescript
            } catch (err) {
              console.error('swarm: worktree materialization failed', err);
              removeFromList();
              throw err; // free the scheduler slot
            }
```

Replace the unsupported-provider branch (currently ends with `removeFromList();` inside `if (!dispatched) { … }`):

```typescript
            if (!dispatched) {
              console.warn(`swarm: provider '${task.provider}' is not yet supported for task runner; marking failed`);
              try {
                void (window.sai as any).swarmEmitCard?.(task.workspaceId, 'task_failed', {
                  taskId: task.id,
                  title: task.title,
                  branch: task.branch,
                  prompt: task.prompt,
                  reason: 'Task runner currently supports Claude only. Codex / Gemini support is a planned follow-up.',
                });
              } catch { /* best-effort */ }
              removeFromList();
              throw new Error(`unsupported provider: ${task.provider}`); // free the slot
            }
```

Replace the runner-throw catch (currently `console.error(...); removeFromList();`):

```typescript
          } catch (err) {
            console.error('swarm: provider runner failed to start', err);
            removeFromList();
            throw err; // free the scheduler slot
          }
```

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit`
Expected: no new errors.

- [ ] **Step 3: Commit**

```bash
git add src/App.tsx
git commit -m "fix(swarm): onStart rejects on failure so the scheduler frees the slot"
```

---

## Task 4: Resume routes through the scheduler

**Files:**
- Modify: `src/App.tsx:3525-3559` (the `onResume` handler)

The resume handler must only enqueue; the per-workspace scheduler (Task 5 guarantees one exists and is ticked) promotes it under the cap.

- [ ] **Step 1: Replace the `onResume` body**

Replace the handler body (`src/App.tsx:3525-3559`) with:

```typescript
                    onResume={async () => {
                      if (!focusedSwarmTask) return;
                      const task = focusedSwarmTask;
                      // Note: Claude CLI spawns a fresh process per turn, so a
                      // true "resume" isn't possible — this re-dispatches the
                      // original prompt as a new turn. Enqueue and let the
                      // scheduler promote it under the concurrency cap rather
                      // than starting it directly (which would bypass the cap).
                      setSwarmTasksByWs(prev => {
                        const m = new Map(prev);
                        const list = (m.get(activeProjectPath) ?? []).map(t =>
                          t.id === task.id ? { ...t, status: 'queued' as const } : t
                        );
                        m.set(activeProjectPath, list);
                        return m;
                      });
                    }}
```

This removes the direct `runSwarmTask` call and the subsequent `streaming` flip. The `swarmTasksByWs` change triggers the scheduler effect, which ticks and (if under cap) promotes via `onStart`.

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit`
Expected: no new errors. (If `runSwarmTask` becomes unused at this call site but is still used by `onStart`, the import stays.)

- [ ] **Step 3: Commit**

```bash
git add src/App.tsx
git commit -m "fix(swarm): resume enqueues through the scheduler instead of bypassing the cap"
```

---

## Task 5: Scheduler ticks all workspaces with tasks

**Files:**
- Modify: `src/App.tsx:885-961` (the scheduler effect)

Today the effect lazily creates a scheduler for the **active** workspace and only calls `setTasks` for it. Change it so every workspace present in `swarmTasksByWs` has a scheduler and receives `setTasks` whenever `swarmTasksByWs` changes. Extract the `onStart` factory so it can be reused per workspace.

- [ ] **Step 1: Extract an `onStart` factory above the effect**

Immediately before the scheduler effect (just before `src/App.tsx:885`), add a stable callback factory. It is the current `onStart` body, parameterized by nothing extra (it already reads `task.workspaceId`). Wrap with `useCallback`:

```typescript
  const makeSwarmOnStart = useCallback(() => async (task: SwarmTask) => {
    const now = Date.now();
    setSwarmTasksByWs(prev => {
      const m = new Map(prev);
      const list = (m.get(task.workspaceId) ?? []).map(t =>
        t.id === task.id ? { ...t, status: 'streaming' as const, lastActivityAt: now } : t
      );
      m.set(task.workspaceId, list);
      return m;
    });
    const removeFromList = () => {
      setSwarmTasksByWs(prev => {
        const m = new Map(prev);
        m.set(task.workspaceId, (m.get(task.workspaceId) ?? []).filter(t => t.id !== task.id));
        return m;
      });
    };
    let effectiveWorktreePath: string | null = task.worktreePath;
    if (!isLikelyReadOnlyPrompt(task.prompt) && !task.worktreePath) {
      try {
        const wt = await (window.sai as any).swarm.worktreeAdd(task.projectPath ?? task.workspaceId, task.id, task.branch, task.baseBranch);
        effectiveWorktreePath = wt;
        setSwarmTasksByWs(prev => {
          const m = new Map(prev);
          const list = (m.get(task.workspaceId) ?? []).map(t =>
            t.id === task.id ? { ...t, worktreePath: wt } : t
          );
          m.set(task.workspaceId, list);
          return m;
        });
      } catch (err) {
        console.error('swarm: worktree materialization failed', err);
        removeFromList();
        throw err;
      }
    }
    try {
      const sai = window.sai as any;
      const dispatched = await runSwarmTask(
        { ...task, worktreePath: effectiveWorktreePath },
        { claudeStart: sai.claudeStart, claudeSend: sai.claudeSend },
      );
      if (!dispatched) {
        console.warn(`swarm: provider '${task.provider}' is not yet supported for task runner; marking failed`);
        try {
          void (window.sai as any).swarmEmitCard?.(task.workspaceId, 'task_failed', {
            taskId: task.id,
            title: task.title,
            branch: task.branch,
            prompt: task.prompt,
            reason: 'Task runner currently supports Claude only. Codex / Gemini support is a planned follow-up.',
          });
        } catch { /* best-effort */ }
        removeFromList();
        throw new Error(`unsupported provider: ${task.provider}`);
      }
    } catch (err) {
      console.error('swarm: provider runner failed to start', err);
      removeFromList();
      throw err;
    }
  }, []);
```

> Note: this folds in Task 3's reject-on-failure changes. If Task 3 was already committed, copy its current body here verbatim.

- [ ] **Step 2: Add a helper that ensures a scheduler exists for a workspace**

Just after `makeSwarmOnStart`, add:

```typescript
  const ensureSwarmScheduler = useCallback((ws: string): SwarmScheduler => {
    let s = swarmSchedulers.current.get(ws);
    if (!s) {
      s = new SwarmScheduler({
        cap: swarmSettingsRef.current.concurrencyCap,
        onStart: makeSwarmOnStart(),
      });
      swarmSchedulers.current.set(ws, s);
    }
    return s;
  }, [makeSwarmOnStart]);
```

- [ ] **Step 3: Replace the scheduler effect to tick all workspaces**

Replace the whole effect at (original) `src/App.tsx:885-961` with:

```typescript
  useEffect(() => {
    // Ensure every workspace that has tasks has a scheduler, and feed each its
    // current task list. Ticking all workspaces (not just the active one) lets
    // queued tasks in background workspaces start under the cap.
    for (const [ws, tasks] of swarmTasksByWs.entries()) {
      ensureSwarmScheduler(ws).setTasks(tasks);
    }
  }, [swarmTasksByWs, ensureSwarmScheduler]);
```

- [ ] **Step 4: Typecheck and run the full swarm suite**

Run: `npx tsc --noEmit && npx vitest run tests/swarm --maxWorkers=2`
Expected: typecheck clean; all swarm tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/App.tsx
git commit -m "fix(swarm): scheduler promotes queued tasks across all workspaces, not just active"
```

---

## Task 6: Watchdog sweep marks stale streaming tasks failed

**Files:**
- Modify: `src/App.tsx` (add a watchdog effect near the scheduler effect)

A periodic sweep flags `streaming` tasks idle beyond a threshold as `failed`, freeing the cap slot. Reuse `findStaleTasks` (Task 2).

- [ ] **Step 1: Add the watchdog constant near the other swarm constants**

Find `SWARM_DEFAULT_CAP` (used at `src/App.tsx:839`) and add beside its definition (search for `const SWARM_DEFAULT_CAP`):

```typescript
const SWARM_STALE_THRESHOLD_MS = 10 * 60 * 1000; // 10 min of no activity → presumed dead
const SWARM_WATCHDOG_INTERVAL_MS = 60 * 1000;    // sweep cadence
```

- [ ] **Step 2: Add the `findStaleTasks` import**

Update the import on `src/App.tsx:48`:

```typescript
import { SwarmScheduler, isLikelyReadOnlyPrompt, findStaleTasks } from './lib/swarmScheduler';
```

- [ ] **Step 3: Add the watchdog effect** after the scheduler effect

```typescript
  // Watchdog: periodically fail streaming tasks that have gone silent (provider
  // died without emitting a terminal event), reclaiming their cap slots. Reads
  // tasks via a ref to avoid resetting the interval on every state change.
  useEffect(() => {
    const id = setInterval(() => {
      const now = Date.now();
      let changed = false;
      const next = new Map(swarmTasksByWsRef.current);
      for (const [ws, tasks] of next.entries()) {
        const stale = findStaleTasks(tasks, now, SWARM_STALE_THRESHOLD_MS);
        if (stale.length === 0) continue;
        const staleIds = new Set(stale.map(t => t.id));
        next.set(ws, tasks.map(t =>
          staleIds.has(t.id) ? { ...t, status: 'failed' as const, lastActivityAt: now } : t
        ));
        changed = true;
      }
      if (changed) setSwarmTasksByWs(next);
    }, SWARM_WATCHDOG_INTERVAL_MS);
    return () => clearInterval(id);
  }, []);
```

> `swarmTasksByWsRef` already exists and is kept in sync (`src/App.tsx:521`). Confirm with `grep -n 'swarmTasksByWsRef' src/App.tsx`; if absent, add `const swarmTasksByWsRef = useRef(swarmTasksByWs);` plus a sync effect mirroring the existing ref-sync effects.

- [ ] **Step 4: Typecheck and run the full swarm suite**

Run: `npx tsc --noEmit && npx vitest run tests/swarm --maxWorkers=2`
Expected: typecheck clean; all swarm tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/App.tsx
git commit -m "feat(swarm): watchdog fails silently-dead streaming tasks to reclaim cap slots"
```

---

## Final verification

- [ ] **Run the full test suite**

Run: `npx vitest run --maxWorkers=2`
Expected: all tests pass (baseline before WS4: 1546 passed / 3 skipped).

- [ ] **Typecheck**

Run: `npx tsc --noEmit`
Expected: clean.

---

## Self-review notes (spec coverage)

| Spec WS4 requirement | Task |
|---|---|
| Resume routes through scheduler (set `queued`, scheduler promotes under cap) — finding #5 | Task 4 |
| Scheduler ticks **all** workspaces with queued tasks — finding #6 | Task 5 |
| Watchdog sweep marks idle `streaming` → `failed`; extract `findStaleTasks(tasks, now, thresholdMs)` — finding #7 | Tasks 2 + 6 |
| Replace in-place `status='streaming'` with `pending-start` set cleared on confirmed start/failure (slot-leak) | Tasks 1 + 3 |
| Tests: streaming count never exceeds cap across resume | Task 1 (slot accounting) + Task 4 |
| Tests: non-active-workspace queued tasks get promoted | Task 5 (covered by all-workspace ticking; scheduler promotion itself unit-tested in Task 1) |
| Tests: `findStaleTasks` flags an idle streaming task | Task 2 |
| Tests: `onStart` that throws frees the slot on the next tick | Task 1 |
