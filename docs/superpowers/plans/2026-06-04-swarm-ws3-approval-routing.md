# Swarm WS3 — Approval Routing + Lifecycle Cleanup Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Route swarm tool approve/deny to the approval's **own** workspace (not whichever workspace is currently active), so acting on a background-workspace approval reaches the right provider session instead of misrouting and hanging the task. Make resolution idempotent (no double approve/deny), and delete a task's approval rows when it terminates (land/discard/done/failed) so stale, un-actionable approvals don't linger.

**Architecture:** Two seams. (1) New `swarmDb` primitives: `swarmGetApproval(id)` (direct get by the store's `id` keyPath — finds an approval regardless of workspace) and `swarmDeleteApprovalsByTask(taskId)` (delete all rows for a task via the `taskId` index). (2) A pure `approvalRoutingTarget(approval, tasksByWs)` helper that yields `{ workspaceId, task, toolUseId }` keyed off `approval.workspaceId`. The `App.tsx` `swarmHost` approve/deny are rewritten to look the approval up by id, route the provider IPC by `approval.workspaceId`, guard against re-entrancy, and clear state for that workspace. Land/discard and terminal mirror patches call `swarmDeleteApprovalsByTask`.

**Tech Stack:** TypeScript, Vitest (`--maxWorkers=2`, `fake-indexeddb/auto`). Branch `swarm-hardening`. WS3 of `docs/superpowers/specs/2026-06-03-swarm-hardening-design.md` (WS0–WS2 already on the branch).

---

## Background the engineer needs

In `src/App.tsx` the `swarmHost` is memoized with `ws = activeProjectPath`. `approve(approvalId)`/`deny(approvalId)` (≈ lines 1144-1195) currently do `swarmGetApprovals(ws)` (active workspace only), find the approval, and call `resolveProviderApproval(task, toolUseId, approved)` — which sends `claudeApprove(ws, …)` using the **active** `ws` closure (`resolveProviderApproval` ≈ line 1077). So an approval belonging to a background workspace B, acted on while A is active, is (a) possibly not found (wrong-workspace query) and (b) dispatched to A's provider session — the real tool call in B never resolves and B's task hangs in `awaiting_approval`.

The IndexedDB approvals store (`src/swarmDb.ts`) uses `keyPath: 'id'` and has a `taskId` index and a `workspaceId` index. `SwarmApproval` carries `id`, `taskId`, `workspaceId`, `toolUseId`, `toolName`, `createdAt`. `swarmResolveApproval(id)` already deletes one row by id.

Lifecycle sites: `swarmHost.land`/`discard` remove the task from `swarmTasksByWs` (≈ 1196-1219). Terminal status patches (`done`/`failed`) are applied in the `claude:message` handler where `deriveSwarmMirror`'s patch is applied (≈ line 2085), inside `if (mirror.patch.kind === 'status' && patchedTask) { … }` (≈ 2095). `swarmTasksByWsRef.current` holds all workspaces' tasks (a ref, already used at ≈ line 2071).

## File Structure

- **Modify** `src/swarmDb.ts` — add `swarmGetApproval(id)` and `swarmDeleteApprovalsByTask(taskId)`.
- **Modify** `tests/swarm/swarmDb.test.ts` — tests for both.
- **Create** `src/lib/swarmApprovalRouting.ts` — pure `approvalRoutingTarget`.
- **Create** `tests/swarm/swarmApprovalRouting.test.ts` — unit tests.
- **Modify** `src/App.tsx` — rewrite approve/deny (route by `approval.workspaceId` + idempotency), cleanup approvals on land/discard and on terminal mirror patch.

---

## Task 1: swarmDb helpers + pure routing helper

**Files:**
- Modify: `src/swarmDb.ts`
- Test: `tests/swarm/swarmDb.test.ts`
- Create: `src/lib/swarmApprovalRouting.ts`
- Create: `tests/swarm/swarmApprovalRouting.test.ts`

- [ ] **Step 1: Write the failing tests**

Add to `tests/swarm/swarmDb.test.ts` — first extend the import to include the two new functions:
```typescript
import {
  swarmInit, swarmCreateTask, swarmGetTasks, swarmUpdateTask,
  swarmDeleteTask, swarmCreateApproval, swarmGetApprovals,
  swarmResolveApproval, swarmClearDb, swarmGetApproval, swarmDeleteApprovalsByTask,
} from '@/swarmDb';
```
Then append this describe block at the end of the file:
```typescript
describe('swarmDb approval helpers', () => {
  const appr = (id: string, taskId: string, ws = '/p') => ({
    id, taskId, workspaceId: ws, toolName: 'Bash', toolUseId: `u-${id}`, createdAt: 1,
  });

  it('gets an approval by id regardless of workspace', async () => {
    await swarmCreateApproval(appr('a1', 't1', '/wsA'));
    await swarmCreateApproval(appr('a2', 't2', '/wsB'));
    const got = await swarmGetApproval('a2');
    expect(got?.workspaceId).toBe('/wsB');
    expect(got?.taskId).toBe('t2');
    expect(await swarmGetApproval('missing')).toBeUndefined();
  });

  it('deletes all approvals for a task', async () => {
    await swarmCreateApproval(appr('a1', 't1'));
    await swarmCreateApproval(appr('a2', 't1'));
    await swarmCreateApproval(appr('a3', 't2'));
    await swarmDeleteApprovalsByTask('t1');
    const rows = await swarmGetApprovals('/p');
    expect(rows.map(r => r.id)).toEqual(['a3']);
  });
});
```

Create `tests/swarm/swarmApprovalRouting.test.ts`:
```typescript
import { describe, it, expect } from 'vitest';
import { approvalRoutingTarget } from '@/lib/swarmApprovalRouting';
import type { SwarmTask, SwarmApproval } from '@/types';

const task = (over: Partial<SwarmTask> = {}): SwarmTask => ({
  id: 'tB', workspaceId: '/wsB', sessionId: 'sessB', title: 't', prompt: 'p',
  provider: 'claude', model: 'opus', approvalPolicy: 'auto-read', status: 'awaiting_approval',
  branch: 'b', baseBranch: 'main', worktreePath: null, createdAt: 1, lastActivityAt: 1,
  costEstimate: 0, toolCallCount: 0, ...over,
});
const appr = (over: Partial<SwarmApproval> = {}): SwarmApproval => ({
  id: 'a1', taskId: 'tB', workspaceId: '/wsB', toolName: 'Bash', toolUseId: 'u1', createdAt: 1, ...over,
});

describe('approvalRoutingTarget', () => {
  it('routes by the approval own workspaceId, not any active workspace', () => {
    const tasksByWs = new Map<string, SwarmTask[]>([
      ['/wsA', [task({ id: 'tA', workspaceId: '/wsA', sessionId: 'sessA' })]],
      ['/wsB', [task()]],
    ]);
    const r = approvalRoutingTarget(appr(), tasksByWs);
    expect(r.workspaceId).toBe('/wsB');
    expect(r.task?.id).toBe('tB');
    expect(r.task?.sessionId).toBe('sessB');
    expect(r.toolUseId).toBe('u1');
  });

  it('returns task undefined when the task is gone (orphan approval)', () => {
    const tasksByWs = new Map<string, SwarmTask[]>([['/wsB', []]]);
    const r = approvalRoutingTarget(appr(), tasksByWs);
    expect(r.workspaceId).toBe('/wsB');
    expect(r.task).toBeUndefined();
    expect(r.toolUseId).toBe('u1');
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run tests/swarm/swarmDb.test.ts tests/swarm/swarmApprovalRouting.test.ts --maxWorkers=2`
Expected: FAIL — `swarmGetApproval`/`swarmDeleteApprovalsByTask` not exported; `@/lib/swarmApprovalRouting` unresolved.

- [ ] **Step 3: Implement the swarmDb helpers**

In `src/swarmDb.ts`, in the Approvals section (after `swarmResolveApproval`), add:
```typescript
export async function swarmGetApproval(id: string): Promise<SwarmApproval | undefined> {
  const db = await openDb();
  const tx = db.transaction(APPR, 'readonly');
  return idbReq(tx.objectStore(APPR).get(id)) as Promise<SwarmApproval | undefined>;
}

export async function swarmDeleteApprovalsByTask(taskId: string): Promise<void> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(APPR, 'readwrite');
    const store = tx.objectStore(APPR);
    const idx = store.index('taskId');
    const req = idx.openKeyCursor(IDBKeyRange.only(taskId));
    req.onsuccess = () => {
      const cursor = req.result;
      if (cursor) {
        store.delete(cursor.primaryKey);
        cursor.continue();
      }
    };
    req.onerror = () => reject(req.error);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}
```

- [ ] **Step 4: Implement the pure routing helper**

Create `src/lib/swarmApprovalRouting.ts`:
```typescript
import type { SwarmTask, SwarmApproval } from '../types';

export interface ApprovalRoutingTarget {
  /** The workspace that owns the approval (and its provider session). */
  workspaceId: string;
  /** The live task for this approval, or undefined if it's an orphan. */
  task: SwarmTask | undefined;
  toolUseId: string;
}

/**
 * Resolve where an approve/deny should be dispatched. Routing keys off the
 * approval's OWN `workspaceId` — never the currently-active workspace — so a
 * background-workspace approval reaches the correct provider session. The task
 * (for its provider + session scope) is looked up within that workspace; a
 * missing task means the approval is orphaned (provider gone).
 */
export function approvalRoutingTarget(
  approval: SwarmApproval,
  tasksByWs: ReadonlyMap<string, SwarmTask[]>,
): ApprovalRoutingTarget {
  const workspaceId = approval.workspaceId;
  const task = (tasksByWs.get(workspaceId) ?? []).find(t => t.id === approval.taskId);
  return { workspaceId, task, toolUseId: approval.toolUseId };
}
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npx vitest run tests/swarm/swarmDb.test.ts tests/swarm/swarmApprovalRouting.test.ts --maxWorkers=2`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/swarmDb.ts tests/swarm/swarmDb.test.ts src/lib/swarmApprovalRouting.ts tests/swarm/swarmApprovalRouting.test.ts
git commit -m "feat(swarm): swarmGetApproval / deleteApprovalsByTask + routing helper

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 2: Route approve/deny by the approval's workspace + lifecycle cleanup

**Files:**
- Modify: `src/App.tsx`

- [ ] **Step 1: Extend imports**

Update the `./swarmDb` import (line 44) to add the two new functions:
```typescript
import { swarmInit, swarmGetApprovals, swarmResolveApproval, swarmCreateApproval, swarmCreateTask, swarmDeleteTask, swarmGetApproval, swarmDeleteApprovalsByTask } from './swarmDb';
```
Add a new import near the other `./lib/swarm*` imports:
```typescript
import { approvalRoutingTarget } from './lib/swarmApprovalRouting';
```

- [ ] **Step 2: Add the re-entrancy guard ref**

Near the other swarm refs (e.g. after `hydrationInFlightRef`), add:
```typescript
  // Approval ids currently being resolved, to make approve/deny idempotent
  // against double-clicks / approve-then-deny.
  const resolvingApprovalsRef = useRef<Set<string>>(new Set());
```

- [ ] **Step 3: Replace `resolveProviderApproval` and the approve/deny handlers**

In the `swarmHost` useMemo, DELETE the `resolveProviderApproval` function (≈ lines 1077-1084) and REPLACE the `approve:` and `deny:` handlers (≈ lines 1144-1195) with a shared resolver. Insert this `resolveApproval` definition just before the `const host: SwarmHost = {` line, and reference it from `approve`/`deny`:

```typescript
    // Resolve an approval by id, routed to the approval's OWN workspace (not
    // the active one), idempotent against double-resolution.
    const resolveApproval = async (approvalId: string, approved: boolean) => {
      if (resolvingApprovalsRef.current.has(approvalId)) return;
      resolvingApprovalsRef.current.add(approvalId);
      try {
        const a = await swarmGetApproval(approvalId);
        if (!a) return;
        const { workspaceId, task, toolUseId } = approvalRoutingTarget(a, swarmTasksByWsRef.current);
        if (task) {
          const scope = task.sessionId;
          const p = task.provider;
          // codex/gemini approve may be absent in preload; degrade gracefully.
          if (p === 'codex') (window.sai as any).codexApprove?.(workspaceId, toolUseId, approved, undefined, scope);
          else if (p === 'gemini') (window.sai as any).geminiApprove?.(workspaceId, toolUseId, approved, undefined, scope);
          else (window.sai as any).claudeApprove?.(workspaceId, toolUseId, approved, undefined, scope);
        }
        await swarmResolveApproval(a.id);
        setSwarmApprovalsByWs(prev => {
          const m = new Map(prev);
          m.set(workspaceId, (m.get(workspaceId) ?? []).filter(x => x.id !== approvalId));
          return m;
        });
        // Eagerly clear the banner entry in case approval_resolved is delayed.
        if (task) {
          setApprovalSessions(prev => {
            const inner = prev.get(workspaceId);
            if (!inner || !inner.has(task.sessionId)) return prev;
            const next = new Map(prev);
            const innerNext = new Map(inner);
            innerNext.delete(task.sessionId);
            if (innerNext.size === 0) next.delete(workspaceId);
            else next.set(workspaceId, innerNext);
            return next;
          });
        }
      } finally {
        resolvingApprovalsRef.current.delete(approvalId);
      }
    };
```

Then the handlers in `const host: SwarmHost = { … }` become:
```typescript
      approve: async (approvalId) => { await resolveApproval(approvalId, true); },
      deny: async (approvalId) => { await resolveApproval(approvalId, false); },
```

(If `swarmGetApprovals` is no longer referenced anywhere in App.tsx after this change, leave its import — it is still used by the approvals-refresh effect and the hydrate path; do NOT remove it.)

- [ ] **Step 4: Cleanup approvals on land/discard**

In `swarmHost.land` (inside `if (r.ok) { … }`, after the `setSwarmTasksByWs` that drops the task) add:
```typescript
          void swarmDeleteApprovalsByTask(t.id);
          setSwarmApprovalsByWs(prev => {
            const m = new Map(prev);
            m.set(ws, (m.get(ws) ?? []).filter(x => x.taskId !== t.id));
            return m;
          });
```
In `swarmHost.discard`, after its `setSwarmTasksByWs` that drops the task, add the identical block.

- [ ] **Step 5: Cleanup approvals on terminal mirror patch (done/failed)**

In the `claude:message` handler, inside the block `if (mirror.patch.kind === 'status' && patchedTask) {` (≈ line 2095), add — right at the top of that block, before the dedupe logic:
```typescript
            // A task that reached a terminal status can have no actionable
            // pending approval; prune any stale rows for it.
            void swarmDeleteApprovalsByTask(patchedTask.id);
            setSwarmApprovalsByWs(prev => {
              const list = prev.get(msg.projectPath) ?? [];
              if (!list.some(x => x.taskId === patchedTask.id)) return prev;
              const m = new Map(prev);
              m.set(msg.projectPath, list.filter(x => x.taskId !== patchedTask.id));
              return m;
            });
```

- [ ] **Step 6: Typecheck + swarm suite**

Run: `npx tsc --noEmit` → expect exit 0 (this flags any dangling reference to the removed `resolveProviderApproval`).
Run: `npx vitest run tests/swarm --maxWorkers=2` → expect all pass.

- [ ] **Step 7: Commit**

```bash
git add src/App.tsx
git commit -m "fix(swarm): route approve/deny by approval workspace; idempotent; cleanup on terminal

approve/deny look the approval up by id and dispatch to its own workspaceId's
provider session (no longer the active workspace), guarded against double
resolution. Approvals are pruned when a task lands/discards or reaches a
terminal status.

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

## Before You Begin (Task 2)
Read the `swarmHost` useMemo region (≈ 1077-1223) and the mirror-application block (≈ 2069-2125) to confirm the exact current text before editing. The `ws` closure in the host is `activeProjectPath ?? ''`; keep using `ws` for land/discard's own task-list mutation (those operate on the active workspace's task, which is correct — land/discard are invoked for the active workspace's selected task), but use the approval's `workspaceId` for all approval routing. If the structure differs materially from the plan, report NEEDS_CONTEXT rather than guessing.

---

## Task 3: Full verification

**Files:** none (verification only)

- [ ] **Step 1: Full unit suite** — `npx vitest run --maxWorkers=2` → PASS (no repo-wide regressions).
- [ ] **Step 2: Typecheck** — `npx tsc --noEmit` → exit 0.
- [ ] **Step 3: Confirm the bug fix shape** — `grep -n "resolveProviderApproval\|claudeApprove(ws\|approvalRoutingTarget\|resolvingApprovalsRef" src/App.tsx`. Expected: no `resolveProviderApproval` left; no `claudeApprove(ws` (routing now uses `workspaceId`); `approvalRoutingTarget` and `resolvingApprovalsRef` are referenced.

---

## Self-review notes

- **Spec coverage (WS3):** route by approval's own workspace (Task 1 helper + Task 2 wiring via `approval.workspaceId`); idempotency guard (`resolvingApprovalsRef`); delete approvals on land/discard (Task 2 Step 4) and on terminal done/failed (Task 2 Step 5); `swarmDeleteApprovalsByTask` added (Task 1).
- **Type consistency:** `approvalRoutingTarget(approval, tasksByWs) → { workspaceId, task, toolUseId }`; `swarmGetApproval(id) → SwarmApproval | undefined`; `swarmDeleteApprovalsByTask(taskId) → void`.
- **Why DB lookup by id:** `swarmGetApproval` reads by the store's `id` keyPath, so it finds an approval even when its workspace isn't the active one and its in-memory list isn't loaded — the crux of the cross-workspace fix.
- **Out of scope (later WS):** the `approval_resolved` event mislabeling multiple pending cards (MED-1 in the audit) and the `auto_approved` interception path (already correct after WS0). Land/discard continue to operate on the active workspace's selected task (correct — those are user actions on the active sidebar).
