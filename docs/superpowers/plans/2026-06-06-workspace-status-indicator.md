# Workspace Status Indicator Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace five inconsistent dot/spinner implementations with two shared components (`WorkspaceSquircle` + `StatusSlot`) and harden the App.tsx state machine that drives them.

**Architecture:** New `workspaceStatus.ts` util + `WorkspaceSquircle.tsx` component are created first; all five consumer files are then migrated in parallel; three targeted App.tsx state bugs are fixed last. No existing behaviour changes except the visual appearance of the indicators.

**Tech Stack:** React 18, TypeScript, Vite, Vitest (unit tests in `tests/unit/`)

---

## File Map

| Action | Path | Purpose |
|--------|------|---------|
| Create | `src/lib/workspaceStatus.ts` | `IndicatorState` type, `workspaceDisplayState()`, `TRIANGLE_MASK_URL` |
| Create | `src/components/shared/WorkspaceSquircle.css` | Keyframe animations for all 5 states |
| Create | `src/components/shared/WorkspaceSquircle.tsx` | `WorkspaceSquircle` + `StatusSlot` components |
| Create | `tests/unit/lib/workspaceStatus.test.ts` | Unit tests for `workspaceDisplayState` |
| Modify | `src/components/Chat/ChatHistorySidebar.tsx` | Replace 5 ad-hoc indicators |
| Modify | `src/components/TitleBar.tsx` | Replace indicators in header button + picker rows |
| Modify | `src/renderer-remote/chat/WorkspaceHeader.tsx` | Replace `StatusDot` + `ws-dot-*` variants |
| Modify | `src/components/CommandPalette.tsx` | Replace `cp-status-dot` |
| Modify | `src/components/NavBar.tsx` | Replace `nav-status-dot nav-status-*` |
| Modify | `src/App.tsx` | 3 state hardening fixes |

---

## Task 1: `workspaceStatus.ts` utility

**Files:**
- Create: `src/lib/workspaceStatus.ts`
- Create: `tests/unit/lib/workspaceStatus.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// tests/unit/lib/workspaceStatus.test.ts
import { describe, it, expect } from 'vitest';
import { workspaceDisplayState } from '../../../src/lib/workspaceStatus';

describe('workspaceDisplayState', () => {
  it('returns inactive when no flags and not open', () => {
    expect(workspaceDisplayState(undefined)).toBe('inactive');
    expect(workspaceDisplayState({}, false)).toBe('inactive');
  });

  it('returns alive when isOpen and no active flags', () => {
    expect(workspaceDisplayState(undefined, { isOpen: true })).toBe('alive');
    expect(workspaceDisplayState({}, { isOpen: true })).toBe('alive');
  });

  it('approval beats everything', () => {
    expect(workspaceDisplayState({ approval: true, busy: true, completed: true }, { isOpen: true })).toBe('approval');
  });

  it('busy beats done and alive', () => {
    expect(workspaceDisplayState({ busy: true, completed: true }, { isOpen: true })).toBe('busy');
    expect(workspaceDisplayState({ streaming: true }, { isOpen: true })).toBe('busy');
    expect(workspaceDisplayState({ awaitingQuestion: true }, { isOpen: true })).toBe('busy');
  });

  it('done when completed and not busy', () => {
    expect(workspaceDisplayState({ completed: true }, { isOpen: true })).toBe('done');
    expect(workspaceDisplayState({ completed: true })).toBe('done');
  });

  it('inactive when not open and no flags', () => {
    expect(workspaceDisplayState({ completed: false })).toBe('inactive');
  });
});
```

- [ ] **Step 2: Run test to confirm it fails**

```bash
npx vitest run tests/unit/lib/workspaceStatus.test.ts --reporter=verbose
```

Expected: FAIL — `workspaceDisplayState` not found.

- [ ] **Step 3: Implement `workspaceStatus.ts`**

```ts
// src/lib/workspaceStatus.ts
export const TRIANGLE_MASK_URL =
  "data:image/svg+xml;utf8,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='3 3.5 18.5 16'%3E%3Cpath d='M8.97 9.25 Q12 4 15.03 9.25 L17.63 13.75 Q20.66 19 14.6 19 L9.4 19 Q3.34 19 6.37 13.75 Z' fill='%23000'/%3E%3C/svg%3E";

export type IndicatorState = 'inactive' | 'alive' | 'busy' | 'done' | 'approval';

export interface WorkspaceStatusFlags {
  approval?: boolean;
  busy?: boolean;
  streaming?: boolean;
  awaitingQuestion?: boolean;
  completed?: boolean;
}

export function workspaceDisplayState(
  flags: WorkspaceStatusFlags | undefined,
  opts?: { isOpen?: boolean },
): IndicatorState {
  if (flags?.approval) return 'approval';
  if (flags?.busy || flags?.streaming || flags?.awaitingQuestion) return 'busy';
  if (flags?.completed) return 'done';
  if (opts?.isOpen) return 'alive';
  return 'inactive';
}
```

- [ ] **Step 4: Run test to confirm it passes**

```bash
npx vitest run tests/unit/lib/workspaceStatus.test.ts --reporter=verbose
```

Expected: all 6 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/workspaceStatus.ts tests/unit/lib/workspaceStatus.test.ts
git commit -m "feat: workspaceDisplayState utility + tests"
```

---

## Task 2: `WorkspaceSquircle` component

**Files:**
- Create: `src/components/shared/WorkspaceSquircle.css`
- Create: `src/components/shared/WorkspaceSquircle.tsx`

- [ ] **Step 1: Create the CSS file**

```css
/* src/components/shared/WorkspaceSquircle.css */
.ws-sq { display: inline-block; flex-shrink: 0; }
.ws-sq-inactive { background: #555; width: 9px; height: 9px; }
.ws-sq-alive    { background: #22c55e; width: 9px; height: 9px; animation: ws-sq-breathe 2.5s ease-in-out infinite; }
.ws-sq-busy     { background: #d4a72c; width: 9px; height: 9px; animation: ws-sq-shrink 1.4s ease-in-out infinite; }
.ws-sq-done     { background: #e0e0e0; width: 9px; height: 9px; animation: ws-sq-blink 1.8s ease-in-out infinite; }
.ws-sq-approval { background: #f97316; width: 16px; height: 16px; animation: ws-sq-flash 1.2s ease-in-out infinite; }

@keyframes ws-sq-breathe { 0%,100% { opacity: 1; } 50% { opacity: 0.45; } }
@keyframes ws-sq-shrink  { 0%,100% { opacity: 1; transform: scale(1); } 50% { opacity: 0.5; transform: scale(0.82); } }
@keyframes ws-sq-blink   { 0%,100% { opacity: 1; } 50% { opacity: 0.25; } }
@keyframes ws-sq-flash   { 0%,100% { opacity: 1; } 50% { opacity: 0.35; } }

.ws-status-slot {
  width: 18px;
  min-width: 18px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
}
```

- [ ] **Step 2: Create the component**

```tsx
// src/components/shared/WorkspaceSquircle.tsx
import './WorkspaceSquircle.css';
import { DOT_MASK_URL } from '../../lib/assets';
import { TRIANGLE_MASK_URL, type IndicatorState } from '../../lib/workspaceStatus';

interface WorkspaceSquircleProps {
  state: IndicatorState;
  title?: string;
  className?: string;
  'data-testid'?: string;
}

interface StatusSlotProps {
  children: React.ReactNode;
  className?: string;
}

const SQ_MASK = `url("${DOT_MASK_URL}") center / contain no-repeat`;
const TRI_MASK = `url("${TRIANGLE_MASK_URL}") center / contain no-repeat`;

export function WorkspaceSquircle({ state, title, className, 'data-testid': testId }: WorkspaceSquircleProps) {
  const isApproval = state === 'approval';
  return (
    <span
      className={`ws-sq ws-sq-${state}${className ? ` ${className}` : ''}`}
      title={title}
      data-testid={testId}
      style={{
        WebkitMask: isApproval ? TRI_MASK : SQ_MASK,
        mask: isApproval ? TRI_MASK : SQ_MASK,
      }}
    />
  );
}

export function StatusSlot({ children, className }: StatusSlotProps) {
  return (
    <span className={`ws-status-slot${className ? ` ${className}` : ''}`}>
      {children}
    </span>
  );
}
```

- [ ] **Step 3: Verify it type-checks**

```bash
npx tsc --noEmit 2>&1 | grep WorkspaceSquircle
```

Expected: no output (no errors).

- [ ] **Step 4: Commit**

```bash
git add src/components/shared/WorkspaceSquircle.css src/components/shared/WorkspaceSquircle.tsx
git commit -m "feat: WorkspaceSquircle + StatusSlot shared components"
```

---

## Task 3: App.tsx state hardening

**Files:**
- Modify: `src/App.tsx` (lines ~2342–2360, ~2659–2698)

This task fixes three state-machine bugs. No new files.

- [ ] **Step 1: Fix — clear `completedWorkspaces` atomically with `setBusyWorkspaces` on `streaming_start`**

Find the `streaming_start` handler (around line 2342). The current block is:

```ts
if (msg.type === 'streaming_start') {
  if (msg.turnSeq != null) wsTurnSeqRef.current.set(scopeKey, msg.turnSeq);
  const count = busyScopeCountRef.current.get(msg.projectPath) || 0;
  busyScopeCountRef.current.set(msg.projectPath, count + 1);
  setBusyWorkspaces(prev => new Set(prev).add(msg.projectPath));
```

Add `setCompletedWorkspaces` immediately after `setBusyWorkspaces`:

```ts
if (msg.type === 'streaming_start') {
  if (msg.turnSeq != null) wsTurnSeqRef.current.set(scopeKey, msg.turnSeq);
  const count = busyScopeCountRef.current.get(msg.projectPath) || 0;
  busyScopeCountRef.current.set(msg.projectPath, count + 1);
  setBusyWorkspaces(prev => new Set(prev).add(msg.projectPath));
  setCompletedWorkspaces(prev => {
    if (!prev.has(msg.projectPath)) return prev;
    const next = new Set(prev);
    next.delete(msg.projectPath);
    return next;
  });
```

- [ ] **Step 2: Fix — move `setChatStreamingWorkspaces` clear inside `setBusyWorkspaces` block**

Currently `setChatStreamingWorkspaces` clears at line ~2661 (separate React state update, before `setBusyWorkspaces`). Move its logic to fire after `setBusyWorkspaces` to keep them in the same React 18 batch.

Find the `done`/`result` handler. The current flow around line 2659:

```ts
if ((msg.scope || 'chat') === 'chat') {
  chatStreamingSessionRef.current.delete(msg.projectPath);
  setChatStreamingWorkspaces(prev => {          // ← separate call, fires first
    if (!prev.has(msg.projectPath)) return prev;
    const next = new Set(prev);
    next.delete(msg.projectPath);
    return next;
  });
}
// ... setStreamingScopes ...
if (newCount === 0) {
  setBusyWorkspaces(prev => { ... });           // ← fires second
}
```

Restructure so `setChatStreamingWorkspaces` fires after `setBusyWorkspaces`:

```ts
if ((msg.scope || 'chat') === 'chat') {
  chatStreamingSessionRef.current.delete(msg.projectPath);
}
setStreamingScopes(prev => {
  if (!prev.has(scopeKey)) return prev;
  const next = new Set(prev);
  next.delete(scopeKey);
  return next;
});
const count = busyScopeCountRef.current.get(msg.projectPath) || 0;
const newCount = Math.max(0, count - 1);
busyScopeCountRef.current.set(msg.projectPath, newCount);
if (newCount === 0) {
  setBusyWorkspaces(prev => {
    if (!prev.has(msg.projectPath)) return prev;
    const next = new Set(prev);
    next.delete(msg.projectPath);
    if (msg.projectPath !== activeProjectPathRef.current) {
      const wsName = basename(msg.projectPath);
      setTimeout(() => {
        setCompletedWorkspaces(p => new Set(p).add(msg.projectPath));
        setNotificationCounts(p => {
          const next = new Map(p);
          next.set(msg.projectPath, (next.get(msg.projectPath) || 0) + 1);
          return next;
        });
        setToast({ message: `${wsName} has finished`, key: Date.now() });
      }, 300);
    }
    return next;
  });
  // Clear chatStreamingWorkspaces in the same batch as busyWorkspaces
  if ((msg.scope || 'chat') === 'chat') {
    setChatStreamingWorkspaces(prev => {
      if (!prev.has(msg.projectPath)) return prev;
      const next = new Set(prev);
      next.delete(msg.projectPath);
      return next;
    });
  }
}
```

- [ ] **Step 3: Type-check**

```bash
npx tsc --noEmit 2>&1 | grep -E "App\.tsx|error"
```

Expected: no new errors.

- [ ] **Step 4: Commit**

```bash
git add src/App.tsx
git commit -m "fix: atomic busy/done state transitions in App.tsx"
```

---

## Task 4: ChatHistorySidebar.tsx

**Files:**
- Modify: `src/components/Chat/ChatHistorySidebar.tsx`

- [ ] **Step 1: Add imports at the top of the file**

After the existing imports, add:

```ts
import { WorkspaceSquircle, StatusSlot } from '../shared/WorkspaceSquircle';
```

- [ ] **Step 2: Replace the status indicator IIFE (lines ~340–388)**

Find this block (the IIFE inside `.chat-history-card-header`):

```tsx
{(() => {
  const isRunning = streamingSessionIds.has(session.id);
  const isAwaiting = awaitingSessionIds.has(session.id);
  const isError = errorSessionIds.has(session.id);
  const isSuspended = suspendedSessionIds.has(session.id);
  if (isAwaiting) return (
    <span
      className="workspace-approval-icon"
      data-testid={`sidebar-status-${session.id}-awaiting`}
      title="Approval needed"
    >!</span>
  );
  if (isError) return (
    <span
      className="workspace-approval-icon"
      style={{ background: 'var(--red)' }}
      data-testid={`sidebar-status-${session.id}-error`}
      title="Error"
    >!</span>
  );
  if (isRunning) return (
    <span
      className="titlebar-busy-spinner"
      data-testid={`sidebar-status-${session.id}-busy`}
      title="Working..."
    />
  );
  if (isUnread) return (
    <span
      className="workspace-done-dot"
      data-testid={`sidebar-status-${session.id}-done`}
      title="Response complete"
    />
  );
  if (isSuspended) return (
    <span
      className="chat-history-suspended-dot"
      data-testid={`sidebar-status-${session.id}-suspended`}
      title="Suspended after 30 min idle — send a message to resume"
    />
  );
  // Reserve the slot so titles stay aligned.
  return <span className="chat-history-status-spacer" aria-hidden="true" />;
})()}
```

Replace with:

```tsx
{(() => {
  const isRunning = streamingSessionIds.has(session.id);
  const isAwaiting = awaitingSessionIds.has(session.id);
  const isError = errorSessionIds.has(session.id);
  const isSuspended = suspendedSessionIds.has(session.id);
  const state = isAwaiting || isError ? 'approval'
    : isRunning ? 'busy'
    : isUnread ? 'done'
    : isSuspended ? 'inactive'
    : null;
  const title = isAwaiting ? 'Approval needed'
    : isError ? 'Error'
    : isRunning ? 'Working...'
    : isUnread ? 'Response complete'
    : isSuspended ? 'Suspended after 30 min idle — send a message to resume'
    : undefined;
  const testId = isAwaiting ? `sidebar-status-${session.id}-awaiting`
    : isError ? `sidebar-status-${session.id}-error`
    : isRunning ? `sidebar-status-${session.id}-busy`
    : isUnread ? `sidebar-status-${session.id}-done`
    : isSuspended ? `sidebar-status-${session.id}-suspended`
    : undefined;
  return (
    <StatusSlot>
      {state && <WorkspaceSquircle state={state} title={title} data-testid={testId} />}
    </StatusSlot>
  );
})()}
```

- [ ] **Step 3: Remove the now-unused CSS classes**

Find and delete the following CSS blocks inside the `<style>` tag in the same file (keep surrounding selectors intact):

- `.chat-history-suspended-dot { ... }` block
- `.chat-history-status-spacer { ... }` block
- `.workspace-approval-icon { ... }` block and its `@keyframes approval-blink`
- `.titlebar-busy-spinner { ... }` block and its `@keyframes dot-spinner-pulse`
- `.workspace-done-dot { ... }` block and its `@keyframes done-pulse`

- [ ] **Step 4: Remove unused `DOT_MASK_URL` import if no longer used**

Check if `DOT_MASK_URL` is still referenced anywhere in the file after the removal:

```bash
grep -n "DOT_MASK_URL" src/components/Chat/ChatHistorySidebar.tsx
```

If the count is zero, remove its import line.

- [ ] **Step 5: Type-check**

```bash
npx tsc --noEmit 2>&1 | grep ChatHistorySidebar
```

Expected: no output.

- [ ] **Step 6: Commit**

```bash
git add src/components/Chat/ChatHistorySidebar.tsx
git commit -m "feat: migrate ChatHistorySidebar to WorkspaceSquircle"
```

---

## Task 5: TitleBar.tsx

**Files:**
- Modify: `src/components/TitleBar.tsx`

This file has indicators in two places: (a) the selector button header, and (b) the picker dropdown rows.

- [ ] **Step 1: Add import**

```ts
import { WorkspaceSquircle, StatusSlot } from './shared/WorkspaceSquircle';
```

- [ ] **Step 2: Replace header indicators (the `projectIndicator` block, around line 247)**

Find:

```tsx
const projectIndicator = projApproval > 0
  ? <span className="titlebar-approval-dot" />
  : projCompleted > 0
    ? <span className="workspace-done-dot" />
    : projBusy > 0
      ? <span className="titlebar-busy-indicator">
          <span className="titlebar-busy-spinner" />
          {projBusy > 1 && <span className="titlebar-busy-count">{projBusy}</span>}
        </span>
      : null;
```

Replace with:

```tsx
const projectIndicator = projApproval > 0
  ? <WorkspaceSquircle state="approval" title="Approval needed" />
  : projCompleted > 0
    ? <WorkspaceSquircle state="done" title="Response complete" />
    : projBusy > 0
      ? <span className="titlebar-busy-indicator">
          <WorkspaceSquircle state="busy" />
          {projBusy > 1 && <span className="titlebar-busy-count">{projBusy}</span>}
        </span>
      : null;
```

- [ ] **Step 3: Replace active workspace picker rows (around line 327–335)**

Find (inside `active.map(w => ...)`):

```tsx
{approvalWorkspaces?.has(w.projectPath)
  ? <span className="workspace-approval-icon" title="Approval needed">!</span>
  : busyWorkspaces?.has(w.projectPath)
    ? <span className="workspace-spinner" title="Working..." />
    : <span className="workspace-status-dot workspace-dot-active" />}
<span className="dropdown-item-name">{basename(w.projectPath)}</span>
{approvalWorkspaces?.has(w.projectPath)
  ? <span className="workspace-approval-label">Approval needed</span>
  : !busyWorkspaces?.has(w.projectPath) && completedWorkspaces?.has(w.projectPath) && <span className="workspace-completed-icon" title="Response complete">!</span>}
```

Replace with:

```tsx
<StatusSlot>
  <WorkspaceSquircle
    state={
      approvalWorkspaces?.has(w.projectPath) ? 'approval'
      : busyWorkspaces?.has(w.projectPath) ? 'busy'
      : completedWorkspaces?.has(w.projectPath) ? 'done'
      : 'alive'
    }
    title={
      approvalWorkspaces?.has(w.projectPath) ? 'Approval needed'
      : busyWorkspaces?.has(w.projectPath) ? 'Working...'
      : completedWorkspaces?.has(w.projectPath) ? 'Response complete'
      : undefined
    }
  />
</StatusSlot>
<span className="dropdown-item-name">{basename(w.projectPath)}</span>
{approvalWorkspaces?.has(w.projectPath) && <span className="workspace-approval-label">Approval needed</span>}
```

- [ ] **Step 4: Replace suspended picker rows (around line 377)**

Find (inside `suspended.map(w => ...)`):

```tsx
<span className="workspace-status-dot workspace-dot-suspended" />
```

Replace with:

```tsx
<StatusSlot><WorkspaceSquircle state="inactive" /></StatusSlot>
```

- [ ] **Step 5: Remove unused CSS classes**

Inside the `<style>` tag, delete:
- `.workspace-done-dot { ... }` and `@keyframes done-pulse`
- `.titlebar-busy-spinner { ... }` and `@keyframes dot-spinner-pulse`
- `.workspace-completed-icon { ... }`
- `.workspace-status-dot { ... }`, `.workspace-dot-active`, `.workspace-dot-suspended`
- `.workspace-approval-icon { ... }` and `@keyframes approval-blink` (if present)
- `.titlebar-approval-dot { ... }` (if present)

Keep `.titlebar-busy-indicator`, `.titlebar-busy-count`, and `.workspace-approval-label`.

- [ ] **Step 6: Remove `DOT_MASK_URL` import if no longer needed**

```bash
grep -n "DOT_MASK_URL" src/components/TitleBar.tsx
```

If count is zero, remove the import.

- [ ] **Step 7: Type-check**

```bash
npx tsc --noEmit 2>&1 | grep TitleBar
```

Expected: no output.

- [ ] **Step 8: Commit**

```bash
git add src/components/TitleBar.tsx
git commit -m "feat: migrate TitleBar to WorkspaceSquircle"
```

---

## Task 6: WorkspaceHeader.tsx (remote renderer)

**Files:**
- Modify: `src/renderer-remote/chat/WorkspaceHeader.tsx`

- [ ] **Step 1: Add import**

```ts
import { WorkspaceSquircle, StatusSlot } from '../../components/shared/WorkspaceSquircle';
import { workspaceDisplayState } from '../../lib/workspaceStatus';
```

- [ ] **Step 2: Replace `displayPriority` and `StatusDot` with `workspaceDisplayState`**

The file currently has (around line 7–58):

```ts
type DisplayPriority = 'idle' | 'busy' | 'completed' | 'approval';

function displayPriority(status: WorkspaceStatus | undefined): DisplayPriority {
  if (!status) return 'idle';
  if (status.approval) return 'approval';
  if (status.busy || status.streaming || status.awaitingQuestion) return 'busy';
  if (status.completed) return 'completed';
  return 'idle';
}
// ... StatusDotProps + StatusDot component (lines 32–58)
```

Delete those entirely. Replace every call to `<StatusDot ... />` and `displayPriority(...)` with `workspaceDisplayState` + `WorkspaceSquircle`.

Find all uses of `<StatusDot` in the file:

```bash
grep -n "StatusDot\|displayPriority" src/renderer-remote/chat/WorkspaceHeader.tsx
```

For each occurrence of:
```tsx
<StatusDot
  status={statusStore.get(w.projectPath)}
  activeIdle={...}
  suspendedIdle={...}
/>
```

Replace with:
```tsx
<StatusSlot>
  <WorkspaceSquircle
    state={workspaceDisplayState(
      statusStore.get(w.projectPath),
      { isOpen: w.state === 'active' || w.state === 'open' },
    )}
  />
</StatusSlot>
```

For summary-level indicators (the tab/header that aggregates multiple workspace states), replace `displayPriority` with:

```tsx
const p = workspaceDisplayState(statusStore.get(w.projectPath), { isOpen: w.state === 'active' || w.state === 'open' });
```

And any check like `priorities.includes('busy')` becomes `priorities.includes('busy' as IndicatorState)` (import `IndicatorState` from `workspaceStatus`).

- [ ] **Step 3: Remove the `ws-dot-*` CSS classes**

Find and delete all `.ws-dot { ... }`, `.ws-dot-busy`, `.ws-dot-completed`, `.ws-dot-active`, `.ws-dot-suspended`, `.ws-dot-approval`, and their `@keyframes`.

- [ ] **Step 4: Remove `DOT_MASK_URL` import if no longer used**

```bash
grep -n "DOT_MASK_URL" src/renderer-remote/chat/WorkspaceHeader.tsx
```

Remove if count is zero.

- [ ] **Step 5: Type-check**

```bash
npx tsc --noEmit 2>&1 | grep WorkspaceHeader
```

Expected: no output.

- [ ] **Step 6: Commit**

```bash
git add src/renderer-remote/chat/WorkspaceHeader.tsx
git commit -m "feat: migrate WorkspaceHeader to WorkspaceSquircle"
```

---

## Task 7: CommandPalette.tsx + NavBar.tsx

**Files:**
- Modify: `src/components/CommandPalette.tsx`
- Modify: `src/components/NavBar.tsx`

### CommandPalette

The palette currently shows a green/gray squircle based on whether a workspace is `active`.

- [ ] **Step 1: Add import to CommandPalette.tsx**

```ts
import { WorkspaceSquircle, StatusSlot } from './shared/WorkspaceSquircle';
```

- [ ] **Step 2: Replace the `cp-status-dot` span (around line 381)**

Find:
```tsx
<div className="cp-status-dot" style={{ background: isActive ? 'var(--green)' : 'var(--text-muted)' }} />
```

Replace with:
```tsx
<StatusSlot>
  <WorkspaceSquircle state={isActive ? 'alive' : 'inactive'} />
</StatusSlot>
```

- [ ] **Step 3: Remove `.cp-status-dot` CSS block and its `DOT_MASK_URL` import if unused**

Delete the `.cp-status-dot { ... }` block from the `<style>` tag. Then:

```bash
grep -n "DOT_MASK_URL" src/components/CommandPalette.tsx
```

Remove import if zero remaining references.

### NavBar

NavBar receives `overallStatus?: 'approval' | 'completed' | 'busy' | null` and renders a bottom dot.

- [ ] **Step 4: Add import to NavBar.tsx**

```ts
import { WorkspaceSquircle } from './shared/WorkspaceSquircle';
import type { IndicatorState } from '../lib/workspaceStatus';
```

- [ ] **Step 5: Update the `OverallStatus` type and indicator (around line 4 and 86)**

The current type:
```ts
type OverallStatus = 'approval' | 'completed' | 'busy' | null;
```

Replace with:
```ts
type OverallStatus = 'approval' | 'done' | 'busy' | null;
```

Update the prop type comment and any internal mapping. Then find the indicator render (around line 86):

```tsx
{overallStatus && (
  <div className="nav-status-indicator">
    <span className={`nav-status-dot nav-status-${overallStatus}`} />
  </div>
)}
```

Replace with:

```tsx
{overallStatus && (
  <div className="nav-status-indicator">
    <WorkspaceSquircle state={overallStatus as IndicatorState} />
  </div>
)}
```

- [ ] **Step 6: Update the call site in App.tsx**

Find where `overallStatus` is passed to `NavBar` (grep for `overallStatus={`). The value is computed from `approvalSessions`, `completedWorkspaces`, `busyWorkspaces`. Change `'completed'` to `'done'` in that expression:

```bash
grep -n "overallStatus=" src/App.tsx
```

Find the ternary and change `'completed'` → `'done'`.

- [ ] **Step 7: Remove `nav-status-dot nav-status-*` CSS and `DOT_MASK_URL` import**

Delete the `.nav-status-dot`, `.nav-status-approval`, `.nav-status-completed`, `.nav-status-busy` CSS blocks and their `@keyframes`. Check:

```bash
grep -n "DOT_MASK_URL" src/components/NavBar.tsx
```

Remove import if zero remaining references.

- [ ] **Step 8: Type-check the whole project**

```bash
npx tsc --noEmit 2>&1 | head -30
```

Expected: no errors.

- [ ] **Step 9: Commit**

```bash
git add src/components/CommandPalette.tsx src/components/NavBar.tsx src/App.tsx
git commit -m "feat: migrate CommandPalette + NavBar to WorkspaceSquircle"
```

---

## Task 8: Smoke test

- [ ] **Step 1: Run unit tests**

```bash
npx vitest run tests/unit --reporter=verbose --maxWorkers=2
```

Expected: all pass including the new `workspaceStatus` tests.

- [ ] **Step 2: Build the app**

```bash
npm run build 2>&1 | tail -20
```

Expected: exits 0, no TypeScript errors.

- [ ] **Step 3: Start the app and verify all 5 states visually**

```bash
npm run dev
```

Open the app and confirm:
1. **Gray** — a workspace listed as Recent shows a gray squircle
2. **Green** — an open idle workspace shows a pulsing green squircle
3. **Yellow** — send a message and watch it turn amber while Claude works
4. **White blink** — after the turn completes (in a non-focused workspace), it shows white blinking
5. **Orange triangle** — trigger an approval request and confirm the 16px triangle appears, aligned with the squircle rows

- [ ] **Step 4: Final commit if any fixups were needed**

```bash
git add -p
git commit -m "fix: smoke test fixups for WorkspaceSquircle"
```
