# Swarm WS1 Follow-up — Testable Hydrate Orchestration

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Pin the swarm hydrate orchestration (load → reconcile zombies → prune orphan approvals) under test by extracting it from the `App.tsx` effect into a dependency-injected pure-orchestration helper, addressing the WS1 final-review gap (the riskiest piece had no regression test).

**Architecture:** New `src/lib/swarmHydrate.ts` exports `hydrateWorkspaceSwarm(workspaceId, deps?)` returning `{ tasks, liveApprovals }`. It runs `swarmInit` → `reconcileTasksOnStartup` → `swarmGetTasks` → `swarmGetApprovals` → `findOrphanApprovalIds` → resolve orphans, with all deps defaulting to the real `swarmDb`/`swarmReconcile` functions (same injectable pattern as `reconcileTasksOnStartup`). The `App.tsx` hydrate effect calls it and keeps only the React-specific baseline-set + mark-hydrated (adjacent, no await between) + state seed.

**Tech Stack:** TypeScript, Vitest (`--maxWorkers=2`, `fake-indexeddb/auto`). Branch `swarm-hardening`. Part of WS1 (`docs/superpowers/specs/2026-06-03-swarm-hardening-design.md`).

---

## Task 1: Extract + test `hydrateWorkspaceSwarm`

**Files:**
- Create: `src/lib/swarmHydrate.ts`
- Test: `tests/swarm/swarmHydrate.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/swarm/swarmHydrate.test.ts`:

```typescript
import 'fake-indexeddb/auto';
import { describe, it, expect, beforeEach } from 'vitest';
import {
  swarmInit, swarmCreateTask, swarmCreateApproval, swarmGetApprovals, swarmClearDb,
} from '@/swarmDb';
import { hydrateWorkspaceSwarm } from '@/lib/swarmHydrate';
import type { SwarmTask } from '@/types';

const task = (over: Partial<SwarmTask> = {}): SwarmTask => ({
  id: 'a', workspaceId: '/p', sessionId: 's', title: 't', prompt: 'p',
  provider: 'claude', model: 'opus', approvalPolicy: 'auto-read',
  status: 'queued', branch: 'b', baseBranch: 'main', worktreePath: null,
  createdAt: 1, lastActivityAt: 1, costEstimate: 0, toolCallCount: 0, ...over,
});

beforeEach(async () => {
  await swarmClearDb();
  await swarmInit();
});

describe('hydrateWorkspaceSwarm', () => {
  it('reconciles zombies, prunes orphan approvals, returns live state', async () => {
    await swarmCreateTask(task({ id: 'streaming1', status: 'streaming' }));
    await swarmCreateTask(task({ id: 'awaiting1', status: 'awaiting_approval' }));
    await swarmCreateTask(task({ id: 'queued1', status: 'queued' }));
    // live approval for a real task, orphan approval for a missing task
    await swarmCreateApproval({ id: 'live', taskId: 'queued1', workspaceId: '/p', toolName: 'Bash', toolUseId: 'u1', createdAt: 1 });
    await swarmCreateApproval({ id: 'orphan', taskId: 'gone', workspaceId: '/p', toolName: 'Bash', toolUseId: 'u2', createdAt: 1 });

    const { tasks, liveApprovals } = await hydrateWorkspaceSwarm('/p');

    const byId = Object.fromEntries(tasks.map(t => [t.id, t.status]));
    expect(byId.streaming1).toBe('paused');
    expect(byId.awaiting1).toBe('paused');
    expect(byId.queued1).toBe('queued');

    expect(liveApprovals.map(a => a.id)).toEqual(['live']);
    // orphan was deleted from the DB, not just filtered from the return value
    expect((await swarmGetApprovals('/p')).map(a => a.id)).toEqual(['live']);
  });

  it('returns empty state for a workspace with nothing persisted', async () => {
    const { tasks, liveApprovals } = await hydrateWorkspaceSwarm('/empty');
    expect(tasks).toEqual([]);
    expect(liveApprovals).toEqual([]);
  });

  it('uses injected deps when provided', async () => {
    const calls: string[] = [];
    const result = await hydrateWorkspaceSwarm('/p', {
      init: async () => { calls.push('init'); },
      reconcile: async () => { calls.push('reconcile'); },
      getTasks: async () => { calls.push('getTasks'); return [task({ id: 'x' })]; },
      getApprovals: async () => { calls.push('getApprovals'); return []; },
      resolveApproval: async () => { calls.push('resolveApproval'); },
    });
    expect(calls).toEqual(['init', 'reconcile', 'getTasks', 'getApprovals']);
    expect(result.tasks.map(t => t.id)).toEqual(['x']);
    expect(result.liveApprovals).toEqual([]);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run tests/swarm/swarmHydrate.test.ts --maxWorkers=2`
Expected: FAIL — cannot resolve `@/lib/swarmHydrate`.

- [ ] **Step 3: Write the implementation**

Create `src/lib/swarmHydrate.ts`:

```typescript
import type { SwarmTask, SwarmApproval } from '../types';
import { swarmInit, swarmGetTasks, swarmGetApprovals, swarmResolveApproval } from '../swarmDb';
import { reconcileTasksOnStartup, findOrphanApprovalIds } from './swarmReconcile';

export interface HydrateDeps {
  init: () => Promise<void>;
  reconcile: (workspaceId: string) => Promise<void>;
  getTasks: (workspaceId: string) => Promise<SwarmTask[]>;
  getApprovals: (workspaceId: string) => Promise<SwarmApproval[]>;
  resolveApproval: (id: string) => Promise<void>;
}

export interface HydrateResult {
  tasks: SwarmTask[];
  liveApprovals: SwarmApproval[];
}

/**
 * Load a workspace's persisted swarm state for hydration on activation:
 *   1. init the DB,
 *   2. reconcile zombie (streaming/awaiting_approval) tasks to `paused`,
 *   3. load the reconciled tasks,
 *   4. prune approvals whose task no longer exists (delete + drop from result).
 * Orchestration over injectable deps (default to the real swarmDb/reconcile),
 * so it is unit-testable without mounting the App.
 */
export async function hydrateWorkspaceSwarm(
  workspaceId: string,
  deps?: Partial<HydrateDeps>,
): Promise<HydrateResult> {
  const init = deps?.init ?? swarmInit;
  const reconcile = deps?.reconcile ?? reconcileTasksOnStartup;
  const getTasks = deps?.getTasks ?? swarmGetTasks;
  const getApprovals = deps?.getApprovals ?? swarmGetApprovals;
  const resolveApproval = deps?.resolveApproval ?? swarmResolveApproval;

  await init();
  await reconcile(workspaceId);
  const tasks = await getTasks(workspaceId);
  const approvals = await getApprovals(workspaceId);
  const orphanIds = findOrphanApprovalIds(tasks, approvals);
  await Promise.all(orphanIds.map(id => resolveApproval(id)));
  const orphanSet = new Set(orphanIds);
  const liveApprovals = approvals.filter(a => !orphanSet.has(a.id));
  return { tasks, liveApprovals };
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run tests/swarm/swarmHydrate.test.ts --maxWorkers=2`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add src/lib/swarmHydrate.ts tests/swarm/swarmHydrate.test.ts
git commit -m "feat(swarm): extract testable hydrateWorkspaceSwarm orchestration

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 2: Use `hydrateWorkspaceSwarm` in the App effect

**Files:**
- Modify: `src/App.tsx` (hydrate effect + imports)

- [ ] **Step 1: Add the import**

Add near the existing `./lib/swarmReconcile` / `./lib/swarmPersistenceDiff` imports:

```typescript
import { hydrateWorkspaceSwarm } from './lib/swarmHydrate';
```

- [ ] **Step 2: Replace the load sequence inside the hydrate effect**

Inside the hydrate effect's `try` block, replace the explicit sequence:

```typescript
        await swarmInit();
        await reconcileTasksOnStartup(ws);
        const tasks = await swarmGetTasks(ws);
        const approvals = await swarmGetApprovals(ws);
        const orphanIds = findOrphanApprovalIds(tasks, approvals);
        await Promise.all(orphanIds.map(id => swarmResolveApproval(id)));
        const liveApprovals = approvals.filter(a => !orphanIds.includes(a.id));
        if (cancelled) return;
```

with:

```typescript
        const { tasks, liveApprovals } = await hydrateWorkspaceSwarm(ws);
        if (cancelled) return;
```

Leave everything after `if (cancelled) return;` unchanged — the baseline set (`persistedTasksRef.current.set(ws, tasks)`) and `hydratedWorkspacesRef.current.add(ws)` must remain adjacent with no `await` between them, followed by the two `setSwarmTasksByWs`/`setSwarmApprovalsByWs` seeds.

- [ ] **Step 3: Clean up now-unused imports**

`reconcileTasksOnStartup` and `findOrphanApprovalIds` are no longer referenced in `App.tsx` after Step 2 — remove them from the `./lib/swarmReconcile` import (delete that import line entirely if it leaves nothing). `swarmGetTasks` is also no longer referenced in App.tsx — remove it from the `./swarmDb` import. **Keep** `swarmGetApprovals` (used by the approvals-refresh effect), `swarmResolveApproval` (used by approve/deny), `swarmCreateTask`, `swarmDeleteTask`, `swarmInit`, `swarmCreateApproval`.

Verify with: `grep -n "reconcileTasksOnStartup\|findOrphanApprovalIds\|swarmGetTasks" src/App.tsx` — expect NO matches after cleanup. If any of these are still used somewhere unexpected, keep that import and note it.

- [ ] **Step 4: Typecheck + swarm suite**

Run: `npx tsc --noEmit` → expect exit 0 (catches any over-removed import).
Run: `npx vitest run tests/swarm --maxWorkers=2` → expect all pass.

- [ ] **Step 5: Commit**

```bash
git add src/App.tsx
git commit -m "refactor(swarm): App hydrate effect uses hydrateWorkspaceSwarm

Thins the effect to the React-specific baseline+flag+seed; load/reconcile/prune
is now the unit-tested hydrateWorkspaceSwarm helper.

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Self-review notes

- **Gap addressed:** the load → reconcile → prune orchestration is now pinned by `swarmHydrate.test.ts` (real fake-indexeddb round-trip + injected-deps ordering). The remaining React-effect-internal invariant (baseline-set and hydrated-flag adjacency, no await between) stays documented in the effect and is now isolated to a 2-line tail.
- **Type consistency:** `hydrateWorkspaceSwarm(ws, deps?) → { tasks: SwarmTask[]; liveApprovals: SwarmApproval[] }` used identically in App Task 2.
- **No behavior change:** the helper performs the exact same sequence the effect did; only the call site moved.
