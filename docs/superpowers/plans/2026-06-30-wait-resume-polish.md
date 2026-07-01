# Wait / Resume Polish Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make Claude's mid-turn "wait then resume" behavior a legible, first-class state — a visible waiting indicator (countdown for scheduled wakeups, spinner for background work), no false completion notifications, and reliable restore of the thinking/Stop indicators on resume.

**Architecture:** Classify the CLI's `result` frame by `terminal_reason` (plus whether a scheduling tool fired this turn) into `none | background | scheduled`. The backend attaches this `wait` metadata to the turn-end IPC. The renderer routes wait-classified turn ends to a new "waiting" state instead of the completion path, suppressing notifications and rendering a waiting indicator. On resume (`streaming_start`) the waiting state clears and normal thinking/Stop return. The idle-scope sweep defers while a wakeup is pending.

**Tech Stack:** Electron main (TypeScript) + React 18 renderer + Vitest (projects: `unit` jsdom, `integration` node, `swarm` node) + Playwright e2e.

## Global Constraints

- Run vitest with capped parallelism: config already sets `maxWorkers: 2` / `forks.maxForks: 2` — respect it. Run unit tests with `npx vitest run --project unit <file>`.
- Waiting is opt-in on a **positive** signal only. Unknown or absent `terminal_reason` → treat as a real end (`none`). Never fabricate a wait, or a turn could hang in a permanent fake-waiting state.
- `terminal_reason` values (verbatim from `@anthropic-ai/claude-agent-sdk` `TerminalReason`): `'completed'`, `'background_requested'`, `'tool_deferred'`, `'max_turns'`, `'aborted_streaming'`, `'aborted_tools'`, `'hook_stopped'`, `'stop_hook_prevented'`, `'blocking_limit'`, `'rapid_refill_breaker'`, `'prompt_too_long'`, `'image_error'`, `'model_error'`.
- Scheduling tools (verbatim tool names): `ScheduleWakeup`, `CronCreate`. `/loop` maps to one of these at the tool level.
- SAI accent gold: `#c7913b`. Mono stack: `'Departure Mono','Geist Mono','JetBrains Mono',ui-monospace,monospace`.
- The existing stale-turn guard (`src/lib/turnSeqGuard.ts` `turnEndIsStale`) MUST remain in force — wait handling happens only for non-stale turn ends.

---

### Task 1: Pure wait classifier module

The linchpin: a pure function with no Electron/CLI deps, fully unit-testable.

**Files:**
- Create: `electron/services/waitClassifier.ts`
- Test: `tests/unit/waitClassifier.test.ts`

**Interfaces:**
- Produces: `type WaitKind = 'none' | 'background' | 'scheduled'`; `interface WaitMeta { kind: WaitKind; resumeInSeconds: number | null; taskCount: number | null }`; `function classifyTurnEnd(input: ClassifyInput): WaitMeta`; `function isSchedulingTool(toolName: string): boolean`.

- [ ] **Step 1: Write the failing test**

```ts
// tests/unit/waitClassifier.test.ts
import { describe, it, expect } from 'vitest';
import { classifyTurnEnd, isSchedulingTool } from '@electron/services/waitClassifier';

describe('isSchedulingTool', () => {
  it('recognizes ScheduleWakeup and CronCreate', () => {
    expect(isSchedulingTool('ScheduleWakeup')).toBe(true);
    expect(isSchedulingTool('CronCreate')).toBe(true);
  });
  it('rejects ordinary tools', () => {
    expect(isSchedulingTool('Bash')).toBe(false);
    expect(isSchedulingTool('CronList')).toBe(false);
  });
});

describe('classifyTurnEnd', () => {
  it('classifies background_requested as a background wait with task count', () => {
    expect(classifyTurnEnd({ terminalReason: 'background_requested', sawSchedulingTool: false, taskCount: 2 }))
      .toEqual({ kind: 'background', resumeInSeconds: null, taskCount: 2 });
  });
  it('classifies completed + scheduling tool as a scheduled wait with delay', () => {
    expect(classifyTurnEnd({ terminalReason: 'completed', sawSchedulingTool: true, wakeupResumeInSeconds: 252 }))
      .toEqual({ kind: 'scheduled', resumeInSeconds: 252, taskCount: null });
  });
  it('scheduled wait with unknown delay carries null resumeInSeconds', () => {
    expect(classifyTurnEnd({ terminalReason: 'completed', sawSchedulingTool: true }))
      .toEqual({ kind: 'scheduled', resumeInSeconds: null, taskCount: null });
  });
  it('completed without a scheduling tool is a real end', () => {
    expect(classifyTurnEnd({ terminalReason: 'completed', sawSchedulingTool: false }).kind).toBe('none');
  });
  it('unknown/absent terminal_reason is a real end even if a scheduling tool fired', () => {
    expect(classifyTurnEnd({ terminalReason: undefined, sawSchedulingTool: true }).kind).toBe('none');
    expect(classifyTurnEnd({ terminalReason: 'max_turns', sawSchedulingTool: true }).kind).toBe('none');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run --project unit tests/unit/waitClassifier.test.ts`
Expected: FAIL — cannot resolve `@electron/services/waitClassifier`.

- [ ] **Step 3: Write minimal implementation**

```ts
// electron/services/waitClassifier.ts
export type WaitKind = 'none' | 'background' | 'scheduled';

export interface WaitMeta {
  kind: WaitKind;
  /** Seconds until a scheduled wakeup fires, when known (ScheduleWakeup delaySeconds). */
  resumeInSeconds: number | null;
  /** In-flight background task count when the CLI reports it, else null. */
  taskCount: number | null;
}

export interface ClassifyInput {
  /** terminal_reason from the result frame; may be undefined on older CLIs. */
  terminalReason?: string | null;
  /** True if a scheduling tool_use (ScheduleWakeup/CronCreate) fired this turn. */
  sawSchedulingTool: boolean;
  /** delaySeconds captured from the latest ScheduleWakeup input this turn, else null. */
  wakeupResumeInSeconds?: number | null;
  /** Background task count if the CLI surfaced it, else null. */
  taskCount?: number | null;
}

const SCHEDULING_TOOLS = new Set(['ScheduleWakeup', 'CronCreate']);

export function isSchedulingTool(toolName: string): boolean {
  return SCHEDULING_TOOLS.has(toolName);
}

/**
 * Classify why a turn ended. Waiting is opt-in on a positive signal only:
 * an unknown/absent terminal_reason is always a real end ('none'), so a turn
 * can never hang in a fake-waiting state.
 */
export function classifyTurnEnd(input: ClassifyInput): WaitMeta {
  if (input.terminalReason === 'background_requested') {
    return { kind: 'background', resumeInSeconds: null, taskCount: input.taskCount ?? null };
  }
  if (input.terminalReason === 'completed' && input.sawSchedulingTool) {
    return { kind: 'scheduled', resumeInSeconds: input.wakeupResumeInSeconds ?? null, taskCount: null };
  }
  return { kind: 'none', resumeInSeconds: null, taskCount: null };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run --project unit tests/unit/waitClassifier.test.ts`
Expected: PASS (8 assertions).

- [ ] **Step 5: Commit**

```bash
git add electron/services/waitClassifier.ts tests/unit/waitClassifier.test.ts
git commit -m "feat(wait): pure terminal_reason -> WaitMeta classifier"
```

---

### Task 2: Countdown / wake-time formatters

Pure presentation helpers for the waiting indicator. Separated so they unit-test without React.

**Files:**
- Create: `src/components/Chat/formatCountdown.ts`
- Test: `tests/unit/formatCountdown.test.ts`

**Interfaces:**
- Produces: `function formatCountdown(secondsRemaining: number): string`; `function formatWakeTime(nowMs: number, secondsRemaining: number): string`.

- [ ] **Step 1: Write the failing test**

```ts
// tests/unit/formatCountdown.test.ts
import { describe, it, expect } from 'vitest';
import { formatCountdown, formatWakeTime } from '@/components/Chat/formatCountdown';

describe('formatCountdown', () => {
  it('coarse minutes when >= 2 min out', () => {
    expect(formatCountdown(1720)).toBe('~29m');
    expect(formatCountdown(120)).toBe('~2m');
  });
  it('live MM:SS under 2 min', () => {
    expect(formatCountdown(119)).toBe('01:59');
    expect(formatCountdown(72)).toBe('01:12');
    expect(formatCountdown(5)).toBe('00:05');
  });
  it('zero or negative shows resuming', () => {
    expect(formatCountdown(0)).toBe('resuming…');
    expect(formatCountdown(-4)).toBe('resuming…');
  });
});

describe('formatWakeTime', () => {
  it('renders a 12-hour resume time from now + remaining', () => {
    const now = new Date('2026-06-30T15:39:00').getTime();
    expect(formatWakeTime(now, 252)).toBe('resumes 3:43pm'); // +4m12s -> 15:43
  });
  it('handles midnight rollover to 12-hour am', () => {
    const now = new Date('2026-06-30T23:59:00').getTime();
    expect(formatWakeTime(now, 120)).toBe('resumes 12:01am');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run --project unit tests/unit/formatCountdown.test.ts`
Expected: FAIL — cannot resolve module.

- [ ] **Step 3: Write minimal implementation**

```ts
// src/components/Chat/formatCountdown.ts
/** Coarse '~Nm' while >= 2 min out; live 'MM:SS' under 2 min; 'resuming…' at/under 0. */
export function formatCountdown(secondsRemaining: number): string {
  const s = Math.floor(secondsRemaining);
  if (s <= 0) return 'resuming…';
  if (s >= 120) return `~${Math.round(s / 60)}m`;
  const m = Math.floor(s / 60);
  const rem = s % 60;
  return `${String(m).padStart(2, '0')}:${String(rem).padStart(2, '0')}`;
}

/** '<h>:<mm><am|pm>' resume time from an absolute now + seconds remaining. */
export function formatWakeTime(nowMs: number, secondsRemaining: number): string {
  const d = new Date(nowMs + secondsRemaining * 1000);
  let h = d.getHours();
  const m = d.getMinutes();
  const ampm = h >= 12 ? 'pm' : 'am';
  h = h % 12;
  if (h === 0) h = 12;
  return `resumes ${h}:${String(m).padStart(2, '0')}${ampm}`;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run --project unit tests/unit/formatCountdown.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/components/Chat/formatCountdown.ts tests/unit/formatCountdown.test.ts
git commit -m "feat(wait): countdown + wake-time formatters"
```

---

### Task 3: Idle-sweep defers on pending wakeup

**Files:**
- Modify: `electron/services/idleScopeSweep.ts`
- Test: `tests/unit/idleScopeSweep.test.ts` (new — no test exists today)

**Interfaces:**
- Consumes: nothing from prior tasks.
- Produces: `IdleScopeRecord` gains optional `pendingWakeup?: boolean`; `sweepIdleScopes` skips records with `pendingWakeup === true`.

- [ ] **Step 1: Write the failing test**

```ts
// tests/unit/idleScopeSweep.test.ts
import { describe, it, expect, vi } from 'vitest';
import { sweepIdleScopes } from '@electron/services/idleScopeSweep';

const base = { workspaceId: 'w', scope: 'chat', lastActivityAt: 0 };

describe('sweepIdleScopes', () => {
  it('reaps an idle, non-streaming scope past the threshold', () => {
    const stop = vi.fn();
    sweepIdleScopes({ now: 60_000, idleMs: 30_000, stop, scopes: [{ ...base, streaming: false }] });
    expect(stop).toHaveBeenCalledWith('w', 'chat');
  });
  it('does NOT reap a scope with a pending wakeup even when idle', () => {
    const stop = vi.fn();
    sweepIdleScopes({ now: 60_000, idleMs: 30_000, stop, scopes: [{ ...base, streaming: false, pendingWakeup: true }] });
    expect(stop).not.toHaveBeenCalled();
  });
  it('still skips streaming and awaitingInput scopes', () => {
    const stop = vi.fn();
    sweepIdleScopes({ now: 60_000, idleMs: 30_000, stop, scopes: [
      { ...base, streaming: true },
      { ...base, streaming: false, awaitingInput: true },
    ]});
    expect(stop).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run --project unit tests/unit/idleScopeSweep.test.ts`
Expected: FAIL — `pendingWakeup: true` scope is reaped (`stop` called) because the field isn't honored yet.

- [ ] **Step 3: Write minimal implementation**

In `electron/services/idleScopeSweep.ts`, add the field to the interface (after `awaitingInput?: boolean;`, before the closing brace of `IdleScopeRecord`):

```ts
  /** The scope is deliberately waiting on a self-scheduled wakeup (ScheduleWakeup
   *  / loop). It looks idle but must not be reaped — the timer will resume it. */
  pendingWakeup?: boolean;
```

And in `sweepIdleScopes`, add the guard immediately after the `awaitingInput` guard:

```ts
  for (const r of scopes) {
    if (r.streaming) continue;
    if (r.awaitingInput) continue;
    if (r.pendingWakeup) continue;
    if (now - r.lastActivityAt > idleMs) stop(r.workspaceId, r.scope);
  }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run --project unit tests/unit/idleScopeSweep.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add electron/services/idleScopeSweep.ts tests/unit/idleScopeSweep.test.ts
git commit -m "feat(wait): idle sweep defers scopes with a pending wakeup"
```

---

### Task 4: Scope state fields + reset on streaming_start

Adds the per-turn tracking the classifier consumes, and resets it at each turn boundary.

**Files:**
- Modify: `electron/services/workspace.ts` (`WorkspaceClaude` interface ~24-59; `newClaudeScope` ~110-135)
- Modify: `electron/services/claude.ts` (`emitStreamingStart` ~109-131)

**Interfaces:**
- Produces: `WorkspaceClaude` gains `sawSchedulingTool: boolean`, `wakeupResumeInSeconds: number | null`, `pendingWakeup: boolean`. All three reset to their empty values inside `emitStreamingStart`.

- [ ] **Step 1: Add fields to the `WorkspaceClaude` interface**

In `electron/services/workspace.ts`, immediately before the closing `}` of `WorkspaceClaude` (after the `streaming: boolean;` line ~58):

```ts
  /** Set when a scheduling tool_use (ScheduleWakeup/CronCreate) is seen during the
   *  current turn; reset at each streaming_start. Drives scheduled-wait classification. */
  sawSchedulingTool: boolean;
  /** delaySeconds from the latest ScheduleWakeup input this turn, else null. */
  wakeupResumeInSeconds: number | null;
  /** True from a scheduled-wait result until the next resume (streaming_start).
   *  Defers the idle sweep and drives the "waiting to resume" sidebar marker. */
  pendingWakeup: boolean;
```

- [ ] **Step 2: Initialize the fields in `newClaudeScope`**

In `newClaudeScope` (the returned object, near `streaming: false,` ~134):

```ts
    sawSchedulingTool: false,
    wakeupResumeInSeconds: null,
    pendingWakeup: false,
```

- [ ] **Step 3: Reset the per-turn fields in `emitStreamingStart`**

In `electron/services/claude.ts`, inside `emitStreamingStart` (function starts ~109), before it calls `emitChatMessage({ type: 'streaming_start', ... })` (~126), add:

```ts
  // A new/resumed turn boundary clears any prior wait tracking: the resume
  // itself proves the scope is active again, so it must not stay marked as
  // waiting or defer the idle sweep past this point.
  claude.sawSchedulingTool = false;
  claude.wakeupResumeInSeconds = null;
  claude.pendingWakeup = false;
```

- [ ] **Step 4: Typecheck**

Run: `npx tsc --noEmit -p tsconfig.json`
Expected: PASS — no "property does not exist" or "missing property" errors for the three new fields.

- [ ] **Step 5: Commit**

```bash
git add electron/services/workspace.ts electron/services/claude.ts
git commit -m "feat(wait): scope wait-tracking fields, reset at each turn boundary"
```

---

### Task 5: Detect scheduling tool_use during a turn

**Files:**
- Modify: `electron/services/claude.ts` (tool_use capture loop ~493-510)

**Interfaces:**
- Consumes: `isSchedulingTool` (Task 1); scope fields (Task 4).
- Produces: during a turn, `claude.sawSchedulingTool` becomes true and `claude.wakeupResumeInSeconds` is populated when a `ScheduleWakeup` with a numeric `delaySeconds` is seen.

- [ ] **Step 1: Import the classifier helpers**

At the top of `electron/services/claude.ts`, with the other `./` imports:

```ts
import { classifyTurnEnd, isSchedulingTool, type WaitMeta } from './waitClassifier';
```

- [ ] **Step 2: Record scheduling tool_use inside the tool_use loop**

In the `for (const block of content)` loop that already handles `block.type === 'tool_use'` (~496), after the existing `claude.pendingToolUse = {...}` assignment and before the `if (block.name === 'AskUserQuestion')` check, add:

```ts
              if (isSchedulingTool(block.name)) {
                claude.sawSchedulingTool = true;
                const delay = (block.input as any)?.delaySeconds;
                if (block.name === 'ScheduleWakeup' && typeof delay === 'number') {
                  claude.wakeupResumeInSeconds = delay;
                }
              }
```

- [ ] **Step 3: Typecheck**

Run: `npx tsc --noEmit -p tsconfig.json`
Expected: PASS.

- [ ] **Step 4: Manual reasoning verification (no unit test — stateful CLI glue)**

Confirm by reading: a `ScheduleWakeup` tool_use with `input.delaySeconds: 252` sets `sawSchedulingTool = true` and `wakeupResumeInSeconds = 252`; a `CronCreate` sets `sawSchedulingTool = true` and leaves `wakeupResumeInSeconds` null. Both are cleared by `emitStreamingStart` (Task 4) at the next turn.

- [ ] **Step 5: Commit**

```bash
git add electron/services/claude.ts
git commit -m "feat(wait): record scheduling tool_use + delaySeconds during a turn"
```

---

### Task 6: Attach WaitMeta to turn-end IPC + gate the completion notification

**Files:**
- Modify: `electron/services/claude.ts` (result handler ~551-572; idle-sweep record builder ~1544-1556)

**Interfaces:**
- Consumes: `classifyTurnEnd`, `WaitMeta` (Task 1); scope fields (Task 4).
- Produces: the `result` and `done` IPC messages carry `wait: WaitMeta`. `notifyCompletion` fires only when `wait.kind === 'none'`. `claude.pendingWakeup` is set true on a scheduled wait. The idle-sweep record carries `pendingWakeup`.

- [ ] **Step 1: Classify and attach in the result handler**

Replace the body of the `if (msg.type === 'result') { ... continue; }` block (~551-572) with:

```ts
        // Result signals end of a turn
        if (msg.type === 'result') {
          const wasBusy = claude.busy;
          const responseTurnSeq = claude.activeTurnSeq;
          // Classify WHY the turn ended: a background yield or a scheduled
          // wakeup is a wait, not a real completion. Unknown reasons are 'none'.
          const wait: WaitMeta = classifyTurnEnd({
            terminalReason: msg.terminal_reason,
            sawSchedulingTool: claude.sawSchedulingTool,
            wakeupResumeInSeconds: claude.wakeupResumeInSeconds,
            taskCount: Array.isArray(msg.background_tasks) ? msg.background_tasks.length : null,
          });
          claude.busy = false;
          claude.streaming = false;
          claude.activeTurnSeq = claude.turnSeq;
          // Defer the idle sweep while a scheduled wakeup is pending (cleared at
          // the next streaming_start by emitStreamingStart).
          claude.pendingWakeup = wait.kind === 'scheduled';
          emitChatMessage({ ...msg, projectPath: ws.projectPath, scope, turnSeq: responseTurnSeq, wait });
          emitChatMessage({ type: 'done', projectPath: ws.projectPath, scope, turnSeq: responseTurnSeq, wait });
          // Only notify on a genuine completion — waits stay silent.
          if (wasBusy && wait.kind === 'none') setTimeout(() => notifyCompletion(win, ws.projectPath, {
            provider: 'Claude',
            duration: msg.duration_ms,
            turns: msg.num_turns,
            cost: msg.total_cost_usd,
            summary: msg.result,
          }), 500);
          continue;
        }
```

- [ ] **Step 2: Feed `pendingWakeup` into the idle-sweep record builder**

In the `idleSweepTimer` setInterval record loop (~1544-1556), extend both the `records` element type and the pushed object. Change the type annotation to include `pendingWakeup: boolean` and add the field to the `records.push({...})`:

```ts
    const records: { workspaceId: string; scope: string; lastActivityAt: number; streaming: boolean; awaitingInput: boolean; pendingWakeup: boolean }[] = [];
    for (const ws of listAllWorkspaces()) {
      for (const [scope, claude] of ws.claudeScopes.entries()) {
        records.push({
          workspaceId: ws.projectPath,
          scope,
          lastActivityAt: claude.lastActivityAt,
          streaming: claude.streaming,
          awaitingInput: claude.awaitingQuestionAnswer || claude.awaitingApproval || claude.awaitingPlanReview,
          pendingWakeup: claude.pendingWakeup,
        });
      }
    }
```

- [ ] **Step 3: Typecheck**

Run: `npx tsc --noEmit -p tsconfig.json`
Expected: PASS. (`msg.terminal_reason` / `msg.background_tasks` are read from the parsed JSON `msg: any`, so no type error.)

- [ ] **Step 4: Full backend unit suite (regression)**

Run: `npx vitest run --project unit tests/unit/waitClassifier.test.ts tests/unit/idleScopeSweep.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add electron/services/claude.ts
git commit -m "feat(wait): attach WaitMeta to turn-end IPC, suppress notify on waits, defer sweep"
```

---

### Task 7: WaitingIndicator component

The inline pill (approved mockup). Self-contained; ticks its own countdown from `resumeInSeconds`.

**Files:**
- Create: `src/components/Chat/WaitingIndicator.tsx`
- Test: `tests/unit/WaitingIndicator.test.tsx`

**Interfaces:**
- Consumes: `WaitMeta` (Task 1, imported via a renderer-safe re-export — see Step 1); `formatCountdown` (Task 2).
- Produces: `export default function WaitingIndicator({ wait, startedAtMs, onCancel }: { wait: WaitMeta; startedAtMs: number; onCancel: () => void })`.

- [ ] **Step 1: Write the failing test**

```tsx
// tests/unit/WaitingIndicator.test.tsx
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import WaitingIndicator from '@/components/Chat/WaitingIndicator';

describe('WaitingIndicator', () => {
  it('scheduled: shows "Waiting to resume" + a countdown and fires onCancel', () => {
    const onCancel = vi.fn();
    // startedAtMs far in the past-ish but resume 90s out -> live MM:SS
    render(<WaitingIndicator wait={{ kind: 'scheduled', resumeInSeconds: 90, taskCount: null }} startedAtMs={Date.now()} onCancel={onCancel} />);
    expect(screen.getByText('Waiting to resume')).toBeTruthy();
    expect(screen.getByText(/^\d{2}:\d{2}$|^~\d+m$/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /cancel/i }));
    expect(onCancel).toHaveBeenCalledTimes(1);
  });
  it('background: shows "Waiting on background work" and no countdown pill', () => {
    render(<WaitingIndicator wait={{ kind: 'background', resumeInSeconds: null, taskCount: 2 }} startedAtMs={Date.now()} onCancel={() => {}} />);
    expect(screen.getByText('Waiting on background work')).toBeTruthy();
    expect(screen.queryByText(/^\d{2}:\d{2}$/)).toBeNull();
  });
  it('renders nothing for kind none', () => {
    const { container } = render(<WaitingIndicator wait={{ kind: 'none', resumeInSeconds: null, taskCount: null }} startedAtMs={Date.now()} onCancel={() => {}} />);
    expect(container.firstChild).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run --project unit tests/unit/WaitingIndicator.test.tsx`
Expected: FAIL — cannot resolve component.

- [ ] **Step 3: Write minimal implementation**

```tsx
// src/components/Chat/WaitingIndicator.tsx
import { useEffect, useState } from 'react';
import type { WaitMeta } from '../../../electron/services/waitClassifier';
import { formatCountdown, formatWakeTime } from './formatCountdown';

interface Props {
  wait: WaitMeta;
  /** Absolute ms when the wait began; the countdown derives from this + resumeInSeconds. */
  startedAtMs: number;
  onCancel: () => void;
}

export default function WaitingIndicator({ wait, startedAtMs, onCancel }: Props) {
  const [nowMs, setNowMs] = useState(() => Date.now());
  const isScheduled = wait.kind === 'scheduled' && typeof wait.resumeInSeconds === 'number';

  useEffect(() => {
    if (!isScheduled) return;
    const id = setInterval(() => setNowMs(Date.now()), 1000);
    return () => clearInterval(id);
  }, [isScheduled]);

  if (wait.kind === 'none') return null;

  const remaining = isScheduled
    ? (wait.resumeInSeconds as number) - Math.floor((nowMs - startedAtMs) / 1000)
    : 0;

  const label = wait.kind === 'scheduled' ? 'Waiting to resume' : 'Waiting on background work';

  return (
    <div className="sai-waiting" role="status" aria-live="polite">
      {wait.kind === 'scheduled'
        ? <span className="sai-waiting-icon sai-waiting-ring" aria-hidden>⏰</span>
        : <span className="sai-waiting-icon" aria-hidden><span className="sai-waiting-orbit" /></span>}
      <span className="sai-waiting-label">{label}</span>
      {isScheduled && (
        <span className="sai-waiting-count" title={formatWakeTime(startedAtMs, wait.resumeInSeconds as number)}>
          {formatCountdown(remaining)}
        </span>
      )}
      {!isScheduled && typeof wait.taskCount === 'number' && wait.taskCount > 0 && (
        <span className="sai-waiting-tasks">{wait.taskCount} task{wait.taskCount === 1 ? '' : 's'} running</span>
      )}
      <button className="sai-waiting-cancel" onClick={onCancel}>Cancel</button>
      <style>{`
        .sai-waiting { display:inline-flex; align-items:center; gap:10px; margin-top:7px;
          padding:7px 10px 7px 11px; border:1px solid var(--edge,#39301f); border-radius:10px;
          background:linear-gradient(180deg,#211c14,#1b1710); }
        .sai-waiting-icon { width:15px; height:15px; flex-shrink:0; color:var(--accent,#c7913b);
          display:grid; place-items:center; }
        .sai-waiting-ring { position:relative; }
        .sai-waiting-ring::after { content:''; position:absolute; inset:-4px; border-radius:50%;
          border:1.5px solid rgba(199,145,59,.4); animation:sai-wait-pulse 2s ease-out infinite; }
        @keyframes sai-wait-pulse { 0%{transform:scale(.7);opacity:.9} 100%{transform:scale(1.5);opacity:0} }
        .sai-waiting-orbit { width:14px; height:14px; border-radius:50%; border:2px solid var(--line,#2a2418);
          border-top-color:var(--accent,#c7913b); animation:sai-wait-spin 1s linear infinite; }
        @keyframes sai-wait-spin { to { transform:rotate(360deg); } }
        .sai-waiting-label { font-size:12.5px; color:var(--text,#e9e2d2); font-weight:500; }
        .sai-waiting-count { font-family:'Departure Mono','Geist Mono','JetBrains Mono',ui-monospace,monospace;
          font-size:12px; color:var(--accent,#c7913b); background:rgba(199,145,59,.10);
          border:1px solid rgba(199,145,59,.22); padding:2px 7px; border-radius:6px; font-variant-numeric:tabular-nums; }
        .sai-waiting-tasks { font-family:'Departure Mono','Geist Mono','JetBrains Mono',ui-monospace,monospace;
          font-size:12px; color:var(--text-muted,#8b8071); }
        .sai-waiting-cancel { margin-left:2px; font-size:11.5px; color:var(--text-muted,#8b8071);
          border:1px solid var(--line,#2a2418); background:transparent; border-radius:6px; padding:3px 9px;
          cursor:pointer; font-weight:500; transition:.15s; }
        .sai-waiting-cancel:hover { color:var(--text,#e9e2d2); border-color:var(--edge,#39301f);
          background:rgba(255,255,255,.03); }
        @media (prefers-reduced-motion: reduce) {
          .sai-waiting-ring::after, .sai-waiting-orbit { animation:none; }
        }
      `}</style>
    </div>
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run --project unit tests/unit/WaitingIndicator.test.tsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/components/Chat/WaitingIndicator.tsx tests/unit/WaitingIndicator.test.tsx
git commit -m "feat(wait): WaitingIndicator pill (scheduled countdown + background spinner)"
```

---

### Task 8: Renderer — waiting state + notification gating in App.tsx

Route wait-classified turn ends to a waiting state instead of the completion path; clear it on resume.

**Files:**
- Modify: `src/App.tsx` (new state near ~259; result handler ~2922-3072; streaming_start handler; the prop passed to the active ChatPanel)

**Interfaces:**
- Consumes: `WaitMeta` (Task 1); the `msg.wait` field on `result`/`done` (Task 6).
- Produces: `waitingScopes: Map<string, { wait: WaitMeta; startedAtMs: number }>` state + `waitingScopesRef`. The active chat scope's entry is passed to `ChatPanel` as a `waiting` prop (Task 9 consumes it).

- [ ] **Step 1: Add waiting state (near the streamingScopes state ~259)**

```tsx
  const [waitingScopes, setWaitingScopes] = useState<Map<string, { wait: import('./electron/services/waitClassifier').WaitMeta; startedAtMs: number }>>(new Map());
  const waitingScopesRef = useRef(waitingScopes);
  waitingScopesRef.current = waitingScopes;
```

(If the relative import path to `electron/services/waitClassifier` from `src/App.tsx` differs, use the same depth the file already uses for other `electron` imports; the `@electron` alias is `electron`-only for tests. Prefer `import type { WaitMeta } from '../electron/services/waitClassifier'` at the top of the file and reference `WaitMeta` directly.)

- [ ] **Step 2: In the result/done handler, branch on `msg.wait` before the completion side effects**

At the very top of the `if (msg.type === 'result' || msg.type === 'done')` block (right after the `turnEndIsStale` early-return at ~2946, before `wsTurnSeqRef.current.set(scopeKey, -1)`), insert:

```tsx
        const waitMeta = (msg as any).wait as import('./electron/services/waitClassifier').WaitMeta | undefined;
        const isWait = !!waitMeta && waitMeta.kind !== 'none';
        if (isWait) {
          // A wait is NOT a completion: stop the thinking indicator but do not
          // notify, toast, or mark the workspace finished. Show the waiting state.
          setWaitingScopes(prev => {
            const next = new Map(prev);
            next.set(scopeKey, { wait: waitMeta!, startedAtMs: Date.now() });
            return next;
          });
          setStreamingScopes(prev => {
            if (!prev.has(scopeKey)) return prev;
            const next = new Set(prev); next.delete(scopeKey); return next;
          });
          if ((msg.scope || 'chat') === 'chat') {
            chatStreamingSessionRef.current.delete(msg.projectPath);
            setChatStreamingWorkspaces(prev => {
              if (!prev.has(msg.projectPath)) return prev;
              const next = new Set(prev); next.delete(msg.projectPath); return next;
            });
          }
          return; // skip the completion/notification path entirely
        }
        // Not a wait — a real end clears any lingering waiting state for this scope.
        setWaitingScopes(prev => {
          if (!prev.has(scopeKey)) return prev;
          const next = new Map(prev); next.delete(scopeKey); return next;
        });
```

- [ ] **Step 3: Clear waiting state on resume (streaming_start handler)**

Find the `streaming_start` handler in `src/App.tsx` (it calls `setStreamingScopes` to add the scope). Immediately after it adds to `streamingScopes`, clear any waiting entry for that scope key so the pill collapses when the turn wakes:

```tsx
        setWaitingScopes(prev => {
          if (!prev.has(scopeKey)) return prev;
          const next = new Map(prev); next.delete(scopeKey); return next;
        });
```

(Use the same `scopeKey` variable the handler already computes for `streaming_start`.)

- [ ] **Step 4: Pass the active scope's waiting entry to ChatPanel**

At the `<ChatPanel ... isStreaming={...} />` usage for the active chat workspace, add a `waiting` prop derived from `waitingScopes` for that workspace's active scope key (mirror however `isStreaming` is derived for the active panel):

```tsx
            waiting={waitingScopes.get(activeChatScopeKey) ?? null}
```

Where `activeChatScopeKey` is the same key used to derive `isStreaming` for the active panel. If the active panel derives streaming from a per-workspace lookup, build the waiting value the same way.

- [ ] **Step 5: Typecheck + full unit suite**

Run: `npx tsc --noEmit -p tsconfig.json && npx vitest run --project unit`
Expected: PASS. (ChatPanel's new `waiting` prop is added in Task 9; until then TypeScript may flag an unknown prop — if so, land Task 9 in the same review batch. To keep this task independently green, add the optional `waiting` prop to `ChatPanelProps` as the first step of Task 9, or temporarily cast: acceptable to defer the typecheck gate to end of Task 9.)

- [ ] **Step 6: Commit**

```bash
git add src/App.tsx
git commit -m "feat(wait): renderer waiting state, suppress completion path on waits, clear on resume"
```

---

### Task 9: ChatPanel — render the indicator, Stop→Cancel, composer mirror

**Files:**
- Modify: `src/components/Chat/ChatPanel.tsx` (props ~128; `streamingForDisplay`/`showThinking` ~1345-1348; the last-assistant render ~1840; the Stop/composer area ~1906; `onStop` handlers ~1550-1557 and ~1632-1636)

**Interfaces:**
- Consumes: `waiting` prop `{ wait: WaitMeta; startedAtMs: number } | null` (Task 8); `WaitingIndicator` (Task 7).
- Produces: renders `WaitingIndicator` on the last assistant message and mirrors a compact waiting state into the composer's Stop/status area; Stop becomes Cancel while waiting.

- [ ] **Step 1: Add the `waiting` prop**

In `ChatPanelProps` (interface near ~128), add:

```tsx
  waiting?: { wait: import('./WaitingIndicator').default extends never ? never : any; startedAtMs: number } | null;
```

Prefer a clean type — import the type and use it:

```tsx
// at top of ChatPanel.tsx
import type { WaitMeta } from '../../../electron/services/waitClassifier';
// in ChatPanelProps:
  waiting?: { wait: WaitMeta; startedAtMs: number } | null;
```

And destructure it in the component signature (add `waiting = null,` alongside `isStreaming = false,`).

- [ ] **Step 2: Import the component and derive a waiting flag**

```tsx
import WaitingIndicator from './WaitingIndicator';
```

Near `streamingForDisplay`/`showThinking` (~1345):

```tsx
  const isWaiting = !!waiting && waiting.wait.kind !== 'none';
  // While waiting we are NOT thinking — suppress the thinking indicator.
  const showThinking = streamingForDisplay && !awaitingQuestion && !isWaiting;
```

(Replace the existing `showThinking` assignment with this one.)

- [ ] **Step 3: Cancel handler**

Add a cancel handler near the existing stop handlers (~1550). Cancel maps to the existing interrupt path (stops the process; for a scheduled wakeup this also ends the pending wait in-session):

```tsx
  const handleCancelWait = () => {
    window.sai.claudeStop?.(projectPath, claudeScope);
  };
```

- [ ] **Step 4: Render the indicator after the last assistant message**

Immediately after the messages `.map(...)` list closes (after the block ending ~1840 that renders `<ChatMessage .../>` per message, inside the same scroll container), render the pill when waiting:

```tsx
            {isWaiting && waiting && (
              <div className="chat-waiting-row">
                <WaitingIndicator wait={waiting.wait} startedAtMs={waiting.startedAtMs} onCancel={handleCancelWait} />
              </div>
            )}
```

- [ ] **Step 5: Mirror into the composer Stop/status area**

At the Stop control area (~1906, where `isStreaming={streamingForDisplay}` is passed to the composer/stop control), gate it so that while waiting the composer shows a compact "waiting" affordance whose action is Cancel rather than the normal Stop. Where the Stop button is rendered, wrap:

```tsx
            {isWaiting
              ? <button className="chat-composer-cancel" onClick={handleCancelWait} title="Cancel and stop waiting">
                  {waiting!.wait.kind === 'scheduled' ? 'Waiting to resume · Cancel' : 'Waiting · Cancel'}
                </button>
              : /* existing Stop button JSX unchanged */ null}
```

Keep the existing Stop button as the `else` branch (do not delete it — move the current Stop JSX into the `: (...)` position). Add minimal CSS for `.chat-composer-cancel` consistent with the existing Stop button styling.

- [ ] **Step 6: Verify (component render + e2e)**

Run: `npx tsc --noEmit -p tsconfig.json && npx vitest run --project unit`
Expected: PASS.

Manual/e2e verification (the full flow needs a live CLI wait, which the harness can drive): with the app running, trigger a `ScheduleWakeup` (e.g. ask Claude to wait ~30s then continue) and confirm: (a) the countdown pill appears, (b) no "finished" toast/notification fires, (c) on resume the pill collapses and thinking + Stop return. Capture with `sai_capture_app` if driving via the e2e story harness.

- [ ] **Step 7: Commit**

```bash
git add src/components/Chat/ChatPanel.tsx
git commit -m "feat(wait): ChatPanel renders WaitingIndicator, Stop->Cancel, composer mirror"
```

---

### Task 10: Reliable resume of thinking/Stop (StreamingAssistantHead wake path)

Guards against the known bug: the last head is already `revealed` and refuses to return to thinking.

**Files:**
- Modify: `src/components/Chat/StreamingAssistantHead.tsx` (~44-63)

**Interfaces:**
- Consumes: nothing new — relies on the resumed turn producing a fresh `streaming_start` (Task 4) and, in App/ChatPanel, a new assistant message head for the resumed output.

- [ ] **Step 1: Confirm the intended mechanism (read + reason)**

The resumed turn's new assistant output is a **new** `ChatMessage`/`StreamingAssistantHead`, so its thinking indicator is fresh and unaffected by the prior head's `revealedRef`. The fix is therefore primarily: ensure Task 8's `streaming_start` clear of `waitingScopes` + Task 9's `showThinking` re-enable actually re-arm the indicator. No change to the reveal guard is required for the new-head case.

- [ ] **Step 2: Add a wake comment + defensive same-head path**

For the case where the resumed output appends to the *existing* head (no new message id), add an explicit wake path that is allowed to leave `revealed` exactly once per resume, guarded so StrictMode double-invoke and the streamSettled debounce cannot trigger it. In the effect at ~44-63, replace the early `if (streaming) { if (!revealedRef.current) setPhase('thinking'); return; }` line with:

```tsx
    if (streaming) {
      // A resume after a wait re-arms thinking even if we'd revealed: the turn is
      // genuinely active again. Guard so a token-pause streamSettled flip (which
      // also sets streaming true) cannot strip revealed text — only a real wake,
      // signalled by content being empty again at streaming_start, re-enters thinking.
      if (!revealedRef.current) { setPhase('thinking'); return; }
      if (!content) { revealedRef.current = false; setPhase('thinking'); }
      return;
    }
```

- [ ] **Step 3: Typecheck + unit suite (StrictMode double-invoke safety)**

Run: `npx tsc --noEmit -p tsconfig.json && npx vitest run --project unit`
Expected: PASS. Confirm no existing StreamingAssistantHead test regresses (the `!content` guard means a normal reveal — which always has content — is untouched).

- [ ] **Step 4: Commit**

```bash
git add src/components/Chat/StreamingAssistantHead.tsx
git commit -m "fix(wait): re-arm thinking on true resume without stripping revealed text"
```

---

### Task 11: Sidebar marker — "waiting to resume" vs "suspended"

**Files:**
- Modify: `src/components/Chat/ChatHistorySidebar.tsx` (~346-368); `src/App.tsx` (persist/derive a per-session waiting flag if needed)

**Interfaces:**
- Consumes: `waitingScopes` (Task 8) — a session is "waiting" when its scope key is in `waitingScopes` with `kind === 'scheduled'`.

- [ ] **Step 1: Thread a waiting-session set into the sidebar**

Wherever `ChatHistorySidebar` receives `suspendedSessionIds`, also pass `waitingSessionIds: Set<string>` derived from `waitingScopes` (scheduled kind). Add the prop to the sidebar's props type.

- [ ] **Step 2: Swap the marker copy/state when waiting**

At the suspended-marker block (~346-358), prefer the waiting state when present:

```tsx
              const isWaiting = waitingSessionIds.has(session.id);
              const isSuspended = suspendedSessionIds.has(session.id);
              // ...
              title={isWaiting
                ? 'Waiting to resume — Claude scheduled a wakeup'
                : 'Suspended after 30 min idle — send a message to resume'}
```

And render the indicator with the waiting visual (reuse the existing squircle state; use the accent/pulse treatment for waiting vs the muted "inactive" for suspended). If `isWaiting`, do not show the "suspended" styling.

- [ ] **Step 3: Typecheck + unit suite**

Run: `npx tsc --noEmit -p tsconfig.json && npx vitest run --project unit`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add src/components/Chat/ChatHistorySidebar.tsx src/App.tsx
git commit -m "feat(wait): sidebar shows 'waiting to resume' distinct from 'suspended'"
```

---

### Task 12: Remove stale debug instrumentation + final gate

The `[sai-stream-debug]` logs were planted to find the distinguishing field. That field (`terminal_reason`) is now branched on, so retire the noisy logs.

**Files:**
- Modify: `electron/services/claude.ts` (~381-415), `src/App.tsx` (~3019-3028)

- [ ] **Step 1: Remove the `[sai-stream-debug]` CLI-frame + RESUME-AFTER-DONE blocks**

Delete the two `console.log('[sai-stream-debug] ...')` blocks at ~389-405 and ~406-415 in `claude.ts`, and the `[sai-stream-debug] CLEAR streamingScope` block at ~3019-3028 in `App.tsx`. Leave the resume-after-wait re-arm logic (~482-488) intact — it is the safety net, not debug.

- [ ] **Step 2: Typecheck + full unit suite + lint**

Run: `npx tsc --noEmit -p tsconfig.json && npx vitest run --project unit`
Expected: PASS.

- [ ] **Step 3: Full e2e smoke of chat (regression)**

Run the existing chat e2e to confirm nothing in the turn lifecycle regressed:
Run: `npx playwright test tests/e2e/chat.spec.ts`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add electron/services/claude.ts src/App.tsx
git commit -m "chore(wait): remove sai-stream-debug instrumentation now that terminal_reason drives behavior"
```

---

## Self-Review

**Spec coverage:**
- §1 backend classification → Tasks 1, 5, 6. ✓
- §2 waiting UI state (inline pill, composer mirror, Stop→Cancel, resume fold-back) → Tasks 7, 9, 10. ✓
- §3 countdown format (coarse→live, wake-time hover) → Task 2 + WaitingIndicator title (Task 7). ✓
- §4 notifications (suppress waits chat+background, notify only on true completion) → Task 6 (backend `notifyCompletion` gate) + Task 8 (renderer completion-path skip covers the background `notifyOnComplete` branch by early-return before it). ✓
- §5 reliable resume → Task 8 (clear waiting on streaming_start) + Task 9 (`showThinking` re-enable) + Task 10 (head wake path). ✓
- §6 idle-sweep defer + "waiting to resume" marker → Tasks 3, 6 (record wiring), 11. ✓
- Error handling (unknown terminal_reason → none; countdown floor at 0 → "resuming…") → Task 1 + Task 2. ✓

**Placeholder scan:** No TBD/TODO. The one soft spot is Task 8 Step 4 / Task 9 Step 1 (`activeChatScopeKey` / active-panel prop derivation) — flagged explicitly to mirror the existing `isStreaming` derivation rather than invent a key. Task 9 Step 1's first type sketch is immediately replaced with the clean `WaitMeta` import.

**Type consistency:** `WaitMeta`/`WaitKind` defined in Task 1 and imported everywhere (Tasks 6, 7, 8, 9). `pendingWakeup` consistent across `WorkspaceClaude` (Task 4), `IdleScopeRecord` (Task 3), and the record builder (Task 6). `waitingScopes` value shape `{ wait: WaitMeta; startedAtMs: number }` consistent between App (Task 8) and ChatPanel prop (Task 9) and WaitingIndicator props (Task 7). `handleCancelWait`/`onCancel` names consistent (Tasks 7, 9).

**Open item carried from spec (non-blocking):** `/loop`/`CronCreate` with no `delaySeconds` → `resumeInSeconds: null` → WaitingIndicator shows the scheduled label with no countdown pill (Task 7 renders the count only when `isScheduled` with numeric `resumeInSeconds`). Behaves as designed.

---

### Task 13: Grace timeout — bound the scheduled wait (pill + sweep-defer)

Implements the spec's promised "or timeout resolves it": a scheduled wait that never resumes must not pin the pill or defer the idle sweep forever.

**Files:**
- Modify: `electron/services/waitClassifier.ts` (export the grace constant)
- Modify: `electron/services/workspace.ts` (`WorkspaceClaude` + `newClaudeScope`)
- Modify: `electron/services/claude.ts` (result handler, `emitStreamingStart`, `interruptImpl`, idle-sweep record builder)
- Modify: `src/App.tsx` (renderer pill sweeper)

**Interfaces:**
- Produces: `export const WAKEUP_GRACE_MS = 60_000` from `waitClassifier`; `WorkspaceClaude.wakeupDeadline: number | null`.

- [ ] **Step 1: Export the grace constant**

In `electron/services/waitClassifier.ts`, add near the top (after the type exports):

```ts
/** Extra slack after a scheduled wakeup's fire time before we treat it as
 *  abandoned (drop the pill, stop deferring the idle sweep). */
export const WAKEUP_GRACE_MS = 60_000;
```

- [ ] **Step 2: Add the deadline field**

In `electron/services/workspace.ts`, in `WorkspaceClaude` (next to `pendingWakeup`):

```ts
  /** Absolute ms deadline for a pending scheduled wakeup (fire time + grace).
   *  Null when no wakeup is pending or its delay is unknown. Past this, the idle
   *  sweep stops deferring the scope. */
  wakeupDeadline: number | null;
```

And initialize in `newClaudeScope` (next to `pendingWakeup: false,`):

```ts
    wakeupDeadline: null,
```

- [ ] **Step 3: Set the deadline on a scheduled wait**

In `electron/services/claude.ts`, import the constant with the existing classifier import:

```ts
import { classifyTurnEnd, isSchedulingTool, WAKEUP_GRACE_MS, type WaitMeta } from './waitClassifier';
```

In the result handler, right where `claude.pendingWakeup = wait.kind === 'scheduled';` is set, add:

```ts
          claude.wakeupDeadline = (wait.kind === 'scheduled' && typeof wait.resumeInSeconds === 'number')
            ? Date.now() + wait.resumeInSeconds * 1000 + WAKEUP_GRACE_MS
            : null;
```

- [ ] **Step 4: Reset the deadline on resume and interrupt**

In `emitStreamingStart` (alongside the existing `claude.pendingWakeup = false;` reset) add `claude.wakeupDeadline = null;`. In `interruptImpl` (alongside the `claude.pendingWakeup = false;` added in the post-review fix) add `claude.wakeupDeadline = null;`.

- [ ] **Step 5: Bound the sweep defer**

In the idle-sweep record builder (`records.push({...})`), replace the `pendingWakeup: claude.pendingWakeup,` line with:

```ts
          pendingWakeup: claude.pendingWakeup && (claude.wakeupDeadline == null || Date.now() < claude.wakeupDeadline),
```

(A null deadline — scheduled wait with no known delay — still defers; the common ScheduleWakeup-with-delay case is bounded.)

- [ ] **Step 6: Renderer pill sweeper**

In `src/App.tsx`, import the constant (type-import file already references waitClassifier):

```ts
import { WAKEUP_GRACE_MS } from '../electron/services/waitClassifier';
```

(match the relative depth used by the existing `import type { WaitMeta } from '../electron/services/waitClassifier'`.)

Add a one-time effect (near the other top-level effects) that drops a scheduled pill whose grace deadline has passed:

```tsx
  // Grace timeout: a scheduled wakeup that never fires must not pin the pill
  // forever. Sweep every 5s; drop a scheduled entry past fire time + grace.
  useEffect(() => {
    const id = setInterval(() => {
      setWaitingScopes(prev => {
        const now = Date.now();
        let changed = false;
        const next = new Map(prev);
        for (const [k, v] of prev) {
          if (v.wait.kind === 'scheduled' && typeof v.wait.resumeInSeconds === 'number'
              && now > v.startedAtMs + v.wait.resumeInSeconds * 1000 + WAKEUP_GRACE_MS) {
            next.delete(k); changed = true;
          }
        }
        return changed ? next : prev;
      });
    }, 5000);
    return () => clearInterval(id);
  }, []);
```

- [ ] **Step 7: Verify**

Run: `npx tsc --noEmit -p tsconfig.json` — clean.
Run: `npx vitest run --project unit tests/unit/waitClassifier.test.ts tests/unit/idleScopeSweep.test.ts` — PASS.
Run: `npx vitest run --project unit` — full suite green (~1906), no regression.

Reasoning check (state in report): a scheduled wait with `resumeInSeconds: 300` sets `wakeupDeadline = now + 360_000`; the sweep defers until then, after which the scope is reclaimable; the renderer drops the pill within ~5s of the same deadline. A resume (`emitStreamingStart`) or interrupt clears the deadline early.

- [ ] **Step 8: Commit**

```bash
git add electron/services/waitClassifier.ts electron/services/workspace.ts electron/services/claude.ts src/App.tsx
git commit -m "feat(wait): grace timeout bounds a stale scheduled wakeup (pill + sweep defer)"
```
