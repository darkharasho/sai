# Swarm Hardening & Stabilization — Design

**Date:** 2026-06-03
**Status:** Approved (design); pending implementation plan
**Scope:** Critical + High severity correctness/stability fixes for the swarm feature, delivered test-first.

## Background

The swarm feature (parallel coding agents driven by an orchestrator chat) has its pure
helpers (`src/lib/swarm*.ts`, `orchestrator*.ts`) reasonably well unit-tested, but the
**live wiring** — concentrated in `src/App.tsx` (~4,570 lines, 322 swarm references),
`electron/main.ts`, and `electron/services/claude.ts` — is largely untested. A read-only
audit (6 parallel investigators, findings cross-corroborated and spot-verified against
source) surfaced a class of bugs there, plus a **false-coverage problem**: several passing
tests exercise dead code or pin incorrect behavior.

This spec covers the **Critical (🔴)** and **High (🟠)** findings. Medium/Low findings are
recorded at the end as deferred follow-ups.

## Method

Every fix follows **extract → failing test → fix → green** (Approach 1, approved):

1. Pull the buggy logic out of `App.tsx`/`main.ts`/`claude.ts` into a small, pure or
   dependency-injected module, following the pattern the repo already uses
   (`swarmTaskRunner.ts`, `swarmScheduler.ts`, `swarmLanding.ts` — all take injected deps
   and are unit-tested).
2. Write a test that pins the **correct** behavior; confirm it fails.
3. Fix until green. `App.tsx` becomes thin wiring over the extracted module.
4. Delete or repurpose tests that pin dead/wrong code.

Extractions stay surgical — only what each fix needs, not a wholesale `App.tsx` rewrite.
This serves both the test-coverage goal and the architecture-cleanup goal (App.tsx shrinks).

Tests run under vitest with `--maxWorkers=2` (already pinned in `vitest.config.ts`).

## Verified findings driving this work

| # | Severity | Finding | Key locations (verified) |
|---|----------|---------|---------------------------|
| 1 | 🔴 | Tasks are never persisted — all in-flight swarm work is lost on reload. `swarmCreateTask`/`swarmGetTasks`/`swarmUpdateTask` and `swarmReconcile.ts` are dead code (0 callers), yet their tests pass. | `App.tsx:526-528, 941`; `swarmDb.ts:74-128`; `swarmReconcile.ts` |
| 2 | 🔴 | `auto-read` approval silently degrades to `always-ask`: `READ_TOOLS` uses `read_file`/`grep`/`glob` but real names are `Read`/`Grep`/`Glob`. Same root cause mis-classifies `Edit` in `materializeIfNeeded`. Three divergent tool-name vocabularies. | `swarmApprovalPolicy.ts:3`; `App.tsx:2191`; `swarmScheduler.ts:3`; `ApprovalTray.tsx:20`; `claude.ts:341,345,799` |
| 3 | 🔴 | Errored/crashed task reported as `done` (false success); any stderr line → sticky `failed` that a later real `result` can't undo. `isTurnErrored()` exists but is not consulted. Per-task `costEstimate` never populated. | `swarmStatusMirror.ts:37-50`; `claude.ts:392-403,449-481`; `chatActivity.ts:21-27` |
| 4 | 🔴 | Approve/deny route via the **active** workspace, not the approval's own `workspaceId` → background-workspace approvals misroute and the task hangs. Orphaned approval rows survive restart and silently no-op. | `App.tsx:950,1063-1094,2231` |
| 5 | 🟠 | Manual resume bypasses the scheduler cap (calls `runSwarmTask` directly, flips to `streaming`). | `App.tsx:3398-3413` |
| 6 | 🟠 | Queued tasks in non-active workspaces are never promoted (scheduler only ticks the active workspace) → starvation. | `App.tsx:780-856` |
| 7 | 🟠 | No watchdog: a provider that dies silently leaves a task `streaming` forever, holding a cap slot. | `swarmStatusMirror.ts`; `App.tsx` |
| 8 | 🟠 | Rebase-on-land can wedge a worktree (no `--abort` on conflict; "rebase + retry" re-runs into an in-progress rebase). Land partial-completion + swallowed worktree-remove errors orphan worktrees. No GC for stale `.sai-swarm` worktrees/branches. | `swarmLanding.ts:41`; `swarm.ts:22-25`; `git.ts:469-471`; `App.tsx:3595-3609` |
| 9 | 🟠 | MCP wedge: no transport-side timeout; main's 60s timeout never sends an error frame; dropped orchestrator socket leaves pending calls hung; synthetic cards dropped on session-registration race; unvalidated tool input. Dead synthetic-card helpers inflate coverage. | `electron/main.ts:444-490,457-471`; `swarmMcpHost.ts:147`; `swarm-mcp-server.ts:312`; `swarmOrchestratorDispatcher.ts:13-112` |

## Workstreams

Each workstream is independently shippable (its own PR/commit), test-first.

### WS0 — Canonical tool taxonomy (foundation for #2)

**Change.** Add one module (e.g. `src/lib/swarmToolTaxonomy.ts`) that classifies the *actual*
provider tool names case-insensitively: reads (`Read`, `Grep`, `Glob`, `LS`, `WebFetch`,
`NotebookRead`…) vs writes (`Edit`, `Write`, `Bash`, `NotebookEdit`, `MultiEdit`…). Collapse the
three existing vocabularies (`swarmApprovalPolicy.READ_TOOLS`, `swarmScheduler.WRITE_TOOLS`,
`ApprovalTray.READ_TOOLS`) into it. Rewire `shouldRequireApproval`, `materializeIfNeeded`, and
the tray "approve all reads" gate to consume it.

**Tests.** `shouldRequireApproval('auto-read','Read') === false`;
`shouldRequireApproval('auto-read','Edit') === true`; `isWriteTool('Edit') === true`;
case-insensitivity; the materialize path creates a worktree on a real `Edit`.

### WS1 — Task persistence + restart reconcile (#1)

**Decision:** tasks **should** persist (regression, not intentional).

**Change.** Call `swarmCreateTask` on spawn; replace `noopUpdateTask` with a real persisting
update; load `swarmGetTasks` per workspace on mount and seed `swarmTasksByWs`. Serialize
per-task writes (a small store wrapper / per-id write queue) to eliminate the concurrent
lost-update race (full-object `put` is last-write-wins). On startup run reconcile:

- `streaming` → `paused`  (provider process is gone; user can resume)
- `awaiting_approval` → `paused`  (the pending approval is stale)
- `queued` → unchanged (never started)
- `done`/`failed`/`landed`/`discarded`/`paused` → unchanged
- **Prune approvals** whose `taskId` is absent from the loaded task set.

**Tests.** Persistence round-trip (create→reload→present); reconcile demotion matrix;
orphan-approval pruning; two concurrent `swarmUpdateTask` patches preserve both fields.
(Repurposes the currently-dead `swarmReconcile.test.ts` / `swarmDb.test.ts` to test live code.)

### WS2 — Status mirror correctness (#3 + cost)

**Change.** In `deriveSwarmMirror`, consult `isTurnErrored(msg)` on `result`/`done` → emit
`failed` vs `done`. Stop treating raw stderr lines as terminal failures: `claude.ts` emits a
**structured terminal event** only on nonzero exit code / signal, or `result.is_error`. Allow
`done`/`result` to terminalize a task in `awaiting_approval` (not just `streaming`). Emit a
`cost` patch sourced from `result.total_cost_usd` with **replace** semantics (CLI reports
cumulative per-session cost) so it doesn't double-count on resume.

**Tests.** `result{is_error:true}` → `failed`; `subtype:'error_max_turns'` → `failed`;
stderr-warning-then-clean-`result` → `done` (not sticky `failed`); `done` while
`awaiting_approval` → `done`; cost patch set from `total_cost_usd`.

### WS3 — Approval routing + lifecycle (#4)

**Change.** Extract a pure resolver:
`resolveApproval(approvalId, allApprovalsByWs, tasksByWs) → {workspaceId, toolUseId, approved} | null`.
Route the provider IPC (`claudeApprove`) by the approval's **own** `workspaceId`, not the active
workspace. Add an idempotency guard so a second approve/deny (or approve-then-deny) for the same
id is a no-op. Delete a task's approvals on land / discard / fail (add
`swarmDeleteApprovalsByTask` to `swarmDb.ts`).

**Tests.** Approve a background-workspace approval → routes to that ws + correct `toolUseId`;
double approve→deny → `resolveProviderApproval` fires at most once; discard a task with a pending
approval → approval row + in-memory entry removed.

### WS4 — Scheduler hardening (#5, #6, #7 + slot-leak)

**Change.**
- Resume routes through the scheduler (set status `queued`, let the scheduler promote under the
  cap) instead of calling `runSwarmTask` directly.
- Scheduler ticks **all** workspaces with queued tasks, not only the active one. Each workspace's
  scheduler receives `setTasks` on every relevant state change regardless of which is active.
- Watchdog: a periodic sweep marks `streaming` tasks whose `lastActivityAt` exceeds a threshold as
  `failed`, freeing the cap slot. Extract `findStaleTasks(tasks, now, thresholdMs)`.
- Replace the scheduler's in-place `status = 'streaming'` mutation with a `pending-start`
  `Set<taskId>` cleared on confirmed start or failure, so a throwing `onStart` doesn't permanently
  consume a slot.

**Tests.** `streaming` count never exceeds cap across a resume; non-active-workspace queued tasks
get promoted; `findStaleTasks` flags an idle streaming task; `onStart` that throws frees the slot
on the next tick.

### WS5 — Land / worktree resilience (#8)

**Change.**
- On rebase failure in `landTask`, run `git rebase --abort` (new `rebaseAbort` dep on `LandDeps`)
  before surfacing `{ok:false, reason:'rebase-needed'}`, leaving the worktree clean. "Rebase +
  retry" (`onRebaseRetry`) aborts-then-rebases (or detects an in-progress rebase first) and routes
  through `landQueueRef`.
- Stop swallowing `gitWorktreeRemove` failures silently in `swarm.ts`: if the worktree still
  exists, do not delete the branch; surface the failure.
- Startup GC: `git worktree prune` + remove stale `.sai-swarm/<ws>/*` dirs and `swarm/*` branches
  that have no corresponding live task.

**Tests.** `landTask` with rebase-reject → `rebaseAbort` invoked and result `rebase-needed`;
`worktreeRemove` rejection during land → branch not deleted / failure surfaced; GC identifies a
stale worktree + dangling branch with no live task.

### WS6 — MCP robustness (#9 + dead-code cleanup)

**Change.**
- Add a per-call timeout in the MCP server transport (`swarm-mcp-server.ts call()`).
- On main's 60s timeout, `safeWrite` an error frame to the originating socket (not just reject the
  local promise). Correlate `pendingMcpCalls` entries to their socket and reject them on socket
  `close`.
- Register the orchestrator session eagerly (when the orchestrator process starts) or buffer
  synthetic emissions per workspace and flush on registration, so tool-call cards are never
  silently dropped on the open race.
- Validate tool inputs in `dispatchSwarmTool` (e.g. `spawn_tasks` requires `prompts[]`) → return
  structured errors instead of raw `TypeError`.
- Delete the dead `buildSyntheticToolUseMessage` / `applySyntheticToolResult` /
  `routeOrchestratorToolUse` and their false-coverage tests (the live path is `main.ts:444-490`).

**Tests.** Server `call()` rejects on transport timeout; main timeout emits an error frame; socket
drop with a pending call rejects it; malformed tool input → structured error; (extract the
`main.ts` emit logic into a testable helper to cover the live synthetic-card path).

## Sequencing

Dependency-ordered: **WS0 → WS1 → WS2 → WS3 → WS4 → WS5 → WS6.**

- WS0 unblocks WS3 (approval classification) and WS4 (materialize classification).
- WS1 (persistence) underpins WS3 (orphan pruning) and WS4 (cross-workspace task state).
- WS2, WS5, WS6 are largely independent and may be reordered/parallelized.

Each workstream lands independently behind passing tests.

## Cross-cutting cleanup

- Remove tests that pin dead or incorrect behavior as part of the workstream that makes the code
  live/correct (notably the reconcile/DB tests in WS1 and the synthetic-card helper tests in WS6).
- Consolidate duplicated tool-name vocabularies into the WS0 module.

## Deferred (Medium/Low — recorded, out of scope for this pass)

- Concurrent `materializeIfNeeded` double `git worktree add` (in-flight promise cache).
- Double-persist race when a backgrounded task is focused mid-stream (`mergePersistedWithBuffer`
  can't reconcile ChatPanel-authored ids).
- Renderer task message-buffer leak for tasks that never reach `done`.
- IndexedDB `DB_VERSION` migration ladder + `schemaVersion` field.
- Scheduler LIFO ordering (sort queued by `createdAt`).
- Stale `baseBranch` vs live checkout at land time; `gitFastForwardMerge` locale-dependent
  "diverged" detection.
- `query_status` `filter` argument ignored by the live host.
- Lifecycle-card dedupe key collision on re-run (`done→re-run→done`).
- `swarmMcpConfig` tmp-file leak + secret file permissions (`mode 0o600`, cleanup on exit).

## Success criteria

- All nine 🔴/🟠 findings have a regression test that fails before the fix and passes after.
- `auto-read` auto-approves real reads and pauses on real writes.
- Tasks survive reload; zombie `streaming`/`awaiting_approval` tasks reconcile to `paused`;
  orphaned approvals are pruned.
- Errored/crashed tasks report `failed`; benign stderr never marks a task failed.
- Approvals route by their own workspace; cap is never exceeded; no permanently-stuck `streaming`
  tasks; rebase-on-land never wedges a worktree; the MCP bridge never hangs indefinitely.
- No remaining tests that pin dead code.
