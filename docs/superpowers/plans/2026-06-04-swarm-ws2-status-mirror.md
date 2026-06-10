# Swarm WS2 — Status-Mirror Error/Done Semantics + Cost Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Fix swarm task terminal-status correctness: a turn that errored (CLI `result.is_error`/error subtype, or a non-zero/signal process exit) must mark the task `failed`, not `done`; a benign stderr line must NOT mark a healthy task `failed` (and must not stick); a turn completing while `awaiting_approval` must still terminalize; and per-task `costEstimate` must be populated from `result.total_cost_usd`.

**Architecture:** Two seams. (1) `deriveSwarmMirror` (pure, `src/lib/swarmStatusMirror.ts`) decides task status from a `claude:message`; it will consult the existing `isTurnErrored()` helper to choose `failed` vs `done`, terminalize from `awaiting_approval` as well as `streaming`, only treat errors flagged `fatal` as task failures, and carry `costEstimate` on the terminal patch. (2) The provider (`electron/services/claude.ts`) must actually emit those signals: a crashed process (non-zero exit / signal while busy) currently emits a plain `done` (false success) — that becomes a `fatal` error followed by `done`; the spawn-`error` event gets a `fatal` flag; benign stderr stays a non-`fatal` `error`. The crash→events decision is extracted into a pure, unit-tested helper.

**Tech Stack:** TypeScript, Vitest (`--maxWorkers=2`). `isTurnErrored` lives in `src/lib/chatActivity.ts`. Branch `swarm-hardening`. WS2 of `docs/superpowers/specs/2026-06-03-swarm-hardening-design.md` (WS0+WS1 already on the branch).

---

## Background the engineer needs

`deriveSwarmMirror(msg, tasksForWorkspace, now)` (`src/lib/swarmStatusMirror.ts`) maps a `claude:message` to a `SwarmTaskPatch` for the matching task (by `sessionId === msg.scope`). Current behavior (the bugs):
- `done`/`result` → `done` **only if** `status==='streaming'`, ignoring `is_error` → a CLI turn that errored is reported as success, and a turn finishing while `awaiting_approval` is dropped.
- Any `error` message → `failed` (if in-flight) → a benign stderr line marks the task failed, and because a later `result` only terminalizes from `streaming`, the false `failed` is sticky.

`isTurnErrored(msg)` (`src/lib/chatActivity.ts:21-27`) already returns true for a `result` with `is_error===true` or `subtype` of `error_during_execution`/`error_max_turns`, and false for any non-`result` envelope.

Provider emission (`electron/services/claude.ts`):
- `result` (line 392-411): emits the result `{...msg}` (carrying `total_cost_usd`, `is_error`, `subtype`) with `scope`, then a synthetic `{type:'done'}`. Sets `busy=false`.
- stderr (line 449-455): every non-empty line → `{type:'error', text}` with `scope`.
- exit (line 457-481): if `wasBusy`, emits `{type:'done'}` — regardless of exit code/signal (the false-success-on-crash path).
- spawn error (line 483-497): emits `{type:'error', text:'Claude process error: …'}`.

`applySwarmPatch` is applied at the single mirror call site in `App.tsx`; extending the `status` patch with an optional `costEstimate` needs NO `App.tsx` change.

## File Structure

- **Modify** `src/lib/swarmStatusMirror.ts` — patch type + `deriveSwarmMirror` + `applySwarmPatch`.
- **Modify** `tests/swarm/swarmStatusMirror.test.ts` — update the error test, add failed/cost/awaiting tests.
- **Create** `electron/services/claudeExit.ts` — pure `exitTerminalEvents(code, signal, wasBusy)`.
- **Create** `tests/swarm/claudeExit.test.ts` — unit tests.
- **Modify** `electron/services/claude.ts` — use `exitTerminalEvents`; add `fatal` to the spawn-error emit.

---

## Task 1: Status-mirror error/done semantics + cost (pure)

**Files:**
- Modify: `src/lib/swarmStatusMirror.ts`
- Test: `tests/swarm/swarmStatusMirror.test.ts`

- [ ] **Step 1: Update/extend the tests**

In `tests/swarm/swarmStatusMirror.test.ts`, replace the single test `'emits failed patch on error'` (lines 50-54) with the following set of tests (covering the new semantics). Also add an `applySwarmPatch` cost test. Paste these in place of the old error test (and add the cost test inside the `applySwarmPatch` describe):

Replace lines 50-54 with:
```typescript
  it('marks failed when a result reports is_error', () => {
    const t = makeTask();
    const r = deriveSwarmMirror({ type: 'result', scope: 'sess-abc', is_error: true }, [t], 50);
    expect(r).toEqual({ taskId: 't1', patch: { kind: 'status', status: 'failed', lastActivityAt: 50 } });
  });

  it('marks failed on an error_max_turns result subtype', () => {
    const t = makeTask();
    const r = deriveSwarmMirror({ type: 'result', scope: 'sess-abc', subtype: 'error_max_turns' }, [t], 50);
    expect(r?.patch).toMatchObject({ kind: 'status', status: 'failed' });
  });

  it('marks failed only on a fatal error message, not benign stderr', () => {
    const t = makeTask();
    // benign stderr-style error: no fatal flag → no transition
    expect(deriveSwarmMirror({ type: 'error', scope: 'sess-abc', text: 'warning: deprecated' }, [t], 50)).toBeNull();
    // fatal error (e.g. process crash / spawn failure) → failed
    const r = deriveSwarmMirror({ type: 'error', scope: 'sess-abc', fatal: true, text: 'crash' }, [t], 50);
    expect(r).toEqual({ taskId: 't1', patch: { kind: 'status', status: 'failed', lastActivityAt: 50 } });
  });

  it('terminalizes a task that completes while awaiting_approval', () => {
    const t = makeTask({ status: 'awaiting_approval' });
    const r = deriveSwarmMirror({ type: 'result', scope: 'sess-abc' }, [t], 50);
    expect(r).toEqual({ taskId: 't1', patch: { kind: 'status', status: 'done', lastActivityAt: 50 } });
  });

  it('carries costEstimate from total_cost_usd on the terminal patch', () => {
    const t = makeTask();
    const r = deriveSwarmMirror({ type: 'result', scope: 'sess-abc', total_cost_usd: 0.42 }, [t], 50);
    expect(r).toEqual({ taskId: 't1', patch: { kind: 'status', status: 'done', costEstimate: 0.42, lastActivityAt: 50 } });
  });
```

Add inside the `describe('applySwarmPatch', …)` block:
```typescript
  it('applies costEstimate from a status patch when present', () => {
    const t = makeTask({ costEstimate: 0 });
    const next = applySwarmPatch(t, { kind: 'status', status: 'done', costEstimate: 0.42, lastActivityAt: 99 });
    expect(next.costEstimate).toBe(0.42);
    expect(next.status).toBe('done');
  });
```

Note: the existing tests `'emits done patch when streaming task sees done/result'` and `'does not transition non-streaming tasks on done'` remain valid and must still pass (a `done`/`result` with no error and a `streaming` task → `done`; a task already `done` → null).

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run tests/swarm/swarmStatusMirror.test.ts --maxWorkers=2`
Expected: FAIL — current code marks any `error` failed (so the benign-stderr case wrongly returns a patch), ignores `is_error` on `result`, doesn't terminalize from `awaiting_approval`, and never sets `costEstimate`.

- [ ] **Step 3: Update the implementation**

In `src/lib/swarmStatusMirror.ts`:

Add the import near the top (after the `SwarmTask` import):
```typescript
import { isTurnErrored } from './chatActivity';
```

Replace the `SwarmTaskPatch` type (lines 9-11) with:
```typescript
export type SwarmTaskPatch =
  | { kind: 'status'; status: 'done' | 'failed'; costEstimate?: number; lastActivityAt: number }
  | { kind: 'toolCount'; delta: number; lastActivityAt: number };
```

Replace the done/result and error branches (lines 36-50) with:
```typescript
  // Turn completion → terminalize a still-in-flight task. A turn that ended in
  // an error (result.is_error / error subtype) marks the task failed, not done.
  // Cost, when reported, rides on the same terminal patch.
  if (msg.type === 'done' || msg.type === 'result') {
    if (task.status === 'streaming' || task.status === 'awaiting_approval') {
      const status = isTurnErrored(msg) ? 'failed' : 'done';
      const patch: SwarmTaskPatch = { kind: 'status', status, lastActivityAt: now };
      if (typeof msg.total_cost_usd === 'number') patch.costEstimate = msg.total_cost_usd;
      return { taskId: task.id, patch };
    }
    return null;
  }

  // Only a fatal error (process crash / spawn failure, flagged by the provider)
  // fails the task. Benign stderr lines arrive as non-fatal error messages and
  // must not mark a healthy task failed.
  if (msg.type === 'error') {
    if (msg.fatal === true && (task.status === 'streaming' || task.status === 'awaiting_approval' || task.status === 'queued')) {
      return { taskId: task.id, patch: { kind: 'status', status: 'failed', lastActivityAt: now } };
    }
    return null;
  }
```

Replace `applySwarmPatch`'s status branch (lines 67-70) so it applies cost when present:
```typescript
export function applySwarmPatch(task: SwarmTask, patch: SwarmTaskPatch): SwarmTask {
  if (patch.kind === 'status') {
    return {
      ...task,
      status: patch.status,
      lastActivityAt: patch.lastActivityAt,
      ...(patch.costEstimate != null ? { costEstimate: patch.costEstimate } : {}),
    };
  }
```
(Leave the `toolCount` branch unchanged.)

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run tests/swarm/swarmStatusMirror.test.ts --maxWorkers=2`
Expected: PASS (all, including the unchanged done/streaming and non-streaming tests).

- [ ] **Step 5: Commit**

```bash
git add src/lib/swarmStatusMirror.ts tests/swarm/swarmStatusMirror.test.ts
git commit -m "fix(swarm): mirror marks errored turns failed, ignores benign stderr, tracks cost

deriveSwarmMirror now uses isTurnErrored to choose failed vs done, terminalizes
from awaiting_approval, only fails on fatal errors (not benign stderr), and
carries costEstimate from result.total_cost_usd.

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 2: Provider crash → fatal terminal events

**Files:**
- Create: `electron/services/claudeExit.ts`
- Test: `tests/swarm/claudeExit.test.ts`
- Modify: `electron/services/claude.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/swarm/claudeExit.test.ts`:
```typescript
import { describe, it, expect } from 'vitest';
import { exitTerminalEvents } from '../../electron/services/claudeExit';

describe('exitTerminalEvents', () => {
  it('emits nothing when the process was not busy', () => {
    expect(exitTerminalEvents(0, null, false)).toEqual([]);
    expect(exitTerminalEvents(1, 'SIGKILL', false)).toEqual([]);
  });

  it('emits a single done on a clean exit while busy', () => {
    expect(exitTerminalEvents(0, null, true)).toEqual([{ type: 'done' }]);
  });

  it('emits a fatal error then done on a non-zero exit while busy', () => {
    const events = exitTerminalEvents(1, null, true);
    expect(events).toHaveLength(2);
    expect(events[0]).toMatchObject({ type: 'error', fatal: true });
    expect(typeof events[0].text).toBe('string');
    expect(events[1]).toEqual({ type: 'done' });
  });

  it('emits a fatal error then done when killed by a signal while busy', () => {
    const events = exitTerminalEvents(null, 'SIGKILL', true);
    expect(events[0]).toMatchObject({ type: 'error', fatal: true });
    expect(events[1]).toEqual({ type: 'done' });
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run tests/swarm/claudeExit.test.ts --maxWorkers=2`
Expected: FAIL — cannot resolve `../../electron/services/claudeExit`.

- [ ] **Step 3: Write the implementation**

Create `electron/services/claudeExit.ts`:
```typescript
/**
 * Pure mapping from a Claude CLI process exit to the terminal `claude:message`
 * events the renderer should receive. A turn normally ends via a `result`
 * message (which clears `busy` before exit), so `wasBusy` is true here only
 * when the process died WITHOUT finishing its turn — i.e. a crash. A non-zero
 * exit code or a terminating signal in that case is a fatal error (so swarm
 * tasks mark `failed` rather than the previous false `done`). A clean exit
 * while busy still emits a plain `done`.
 */
export interface ExitTerminalEvent {
  type: 'error' | 'done';
  fatal?: boolean;
  text?: string;
}

export function exitTerminalEvents(
  code: number | null,
  signal: NodeJS.Signals | string | null,
  wasBusy: boolean,
): ExitTerminalEvent[] {
  if (!wasBusy) return [];
  const crashed = (code != null && code !== 0) || signal != null;
  if (!crashed) return [{ type: 'done' }];
  const detail = signal != null ? `signal ${signal}` : `code ${code}`;
  return [
    { type: 'error', fatal: true, text: `Claude process exited unexpectedly (${detail})` },
    { type: 'done' },
  ];
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run tests/swarm/claudeExit.test.ts --maxWorkers=2`
Expected: PASS (4 tests).

- [ ] **Step 5: Wire the helper into claude.ts**

In `electron/services/claude.ts`:

Add an import near the other `./` service imports at the top of the file:
```typescript
import { exitTerminalEvents } from './claudeExit';
```

In the `proc.on('exit', (code, signal) => {` handler, replace the tail (currently):
```typescript
    if (wasBusy) {
      emitChatMessage({ type: 'done', projectPath: ws.projectPath, scope, turnSeq: claude.turnSeq });
    }
```
with:
```typescript
    for (const ev of exitTerminalEvents(code, signal, wasBusy)) {
      emitChatMessage({ ...ev, projectPath: ws.projectPath, scope, turnSeq: claude.turnSeq });
    }
```

In the `proc.on('error', (err) => {` handler, add `fatal: true` to the emitted error so a spawn failure fails the task. Change:
```typescript
    emitChatMessage({
      type: 'error', text: `Claude process error: ${err.message}`, projectPath: ws.projectPath, scope
    });
```
to:
```typescript
    emitChatMessage({
      type: 'error', fatal: true, text: `Claude process error: ${err.message}`, projectPath: ws.projectPath, scope
    });
```

Do NOT change the stderr handler (`proc.stderr?.on('data', …)`) — benign stderr must remain a non-`fatal` error (the mirror now ignores those for task status, and chat display is unchanged).

- [ ] **Step 6: Typecheck and run swarm suite**

Run: `npx tsc --noEmit` → expect exit 0.
Run: `npx vitest run tests/swarm --maxWorkers=2` → expect all pass.

- [ ] **Step 7: Commit**

```bash
git add electron/services/claudeExit.ts tests/swarm/claudeExit.test.ts electron/services/claude.ts
git commit -m "fix(swarm): provider emits fatal error on crash instead of false done

A non-zero/signal process exit while a turn was in flight now emits a fatal
error (then done) so swarm tasks mark failed; spawn errors are flagged fatal.
Benign stderr stays non-fatal. Crash-to-events decision is the unit-tested
exitTerminalEvents helper.

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 3: Full verification

**Files:** none (verification only)

- [ ] **Step 1: Full unit suite**

Run: `npx vitest run --maxWorkers=2`
Expected: PASS (no regressions repo-wide).

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit`
Expected: exit 0.

- [ ] **Step 3: Sanity-grep the new semantics**

Run: `grep -n "isTurnErrored\|fatal" src/lib/swarmStatusMirror.ts`
Expected: `deriveSwarmMirror` references `isTurnErrored` and gates the error branch on `fatal`.

---

## Self-review notes

- **Spec coverage (WS2):** errored turn → `failed` via `isTurnErrored` (Task 1); benign stderr no longer fails / no sticky-failed (Task 1 fatal-gate + Task 2 keeps stderr non-fatal); crash → `failed` not `done` (Task 2 `exitTerminalEvents`); terminalize from `awaiting_approval` (Task 1); `costEstimate` from `total_cost_usd`, replace semantics via `applySwarmPatch` (Task 1).
- **Type consistency:** `SwarmTaskPatch` status variant gains optional `costEstimate?: number`, applied in `applySwarmPatch`; `exitTerminalEvents(code, signal, wasBusy): ExitTerminalEvent[]` used identically in `claude.ts`.
- **No App.tsx change needed:** cost rides the existing single-patch `applySwarmPatch` call; the mirror call site is untouched.
- **Out of scope (later WS):** the stuck-`streaming` watchdog for a process that dies with NO exit event at all (WS4); per-task cost UI surfacing beyond storing the value.
