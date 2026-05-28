# AskUserQuestion as End-of-Turn Status Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** While the AI is paused waiting for an `AskUserQuestion` answer, the workspace status displays as green ("completed") and the thinking spinner hides, on both desktop and mobile. When the user answers, normal streaming visuals resume.

**Architecture:** Add an `awaitingQuestion: boolean` field to `WorkspaceStatus` with priority just below `approval` and above `streaming`. The desktop App tracks a `Set<string>` of workspaces in this state, toggled by `question_needed`/`question_answered`/`result`/`done` events via a small pure helper. The field is mirrored to mobile through the existing `remoteEmitWorkspaceStatus` payload. Two spinner consumers (one desktop, one mobile) gate on the new field; status dots driven by the priority enum update automatically.

**Tech Stack:** TypeScript, React, Vitest.

**Spec:** `docs/superpowers/specs/2026-05-26-question-as-end-of-turn-design.md`

---

## File Structure

- `src/renderer-remote/lib/workspaceStatusStore.ts` — extend `WorkspaceStatus`, `WorkspaceStatusPriority`, `priority()`, allFalse check.
- `tests/unit/remote/workspace-status-store.test.ts` — extend with priority + allFalse tests.
- `src/lib/awaitingQuestionTracker.ts` — **new** pure helper: `applyQuestionEvent(prev, msg)`.
- `tests/unit/lib/awaitingQuestionTracker.test.ts` — **new** unit tests.
- `src/App.tsx` — new state Set, ref, message handlers, status proxy, wire emission.
- `src/renderer-remote/App.tsx` — accept `awaitingQuestion` from the wire payload.
- `src/components/Chat/ChatPanel.tsx` — `awaitingQuestion?` prop, guard `showThinking`.
- `src/renderer-remote/chat/Transcript.tsx` — `awaitingQuestion?` prop, guard the `streaming` block.
- `src/renderer-remote/chat/Chat.tsx` — read from store, pass to `Transcript`.

---

## Task 1: Extend `workspaceStatusStore` with `awaitingQuestion`

**Files:**
- Modify: `src/renderer-remote/lib/workspaceStatusStore.ts`
- Test: `tests/unit/remote/workspace-status-store.test.ts`

- [ ] **Step 1: Write the failing tests**

Replace the existing `tests/unit/remote/workspace-status-store.test.ts` with (re-writes existing tests to use the new field; preserves all original assertions):

```typescript
import { describe, it, expect } from 'vitest';
import { createWorkspaceStatusStore } from '../../../src/renderer-remote/lib/workspaceStatusStore';

const empty = { busy: false, streaming: false, completed: false, approval: false, awaitingQuestion: false };

describe('workspaceStatusStore', () => {
  it('notifies subscribers when a workspace status changes', () => {
    const s = createWorkspaceStatusStore();
    const events: Array<{ projectPath: string; status: any }> = [];
    s.subscribe((projectPath, status) => events.push({ projectPath, status }));
    s.set('/a', { ...empty, busy: true });
    s.set('/a', { ...empty, busy: true, streaming: true });
    expect(events).toHaveLength(2);
    expect(s.get('/a')).toEqual({ ...empty, busy: true, streaming: true });
  });

  it('clears entries when all flags are false', () => {
    const s = createWorkspaceStatusStore();
    s.set('/a', { ...empty, busy: true });
    s.set('/a', { ...empty });
    expect(s.get('/a')).toBeUndefined();
  });

  it('clears entries when only awaitingQuestion was set and it goes false', () => {
    const s = createWorkspaceStatusStore();
    s.set('/a', { ...empty, awaitingQuestion: true });
    expect(s.get('/a')).toBeDefined();
    s.set('/a', { ...empty });
    expect(s.get('/a')).toBeUndefined();
  });

  it('priority() returns single-state label', () => {
    const s = createWorkspaceStatusStore();
    expect(s.priority(undefined)).toBe('idle');
    expect(s.priority({ ...empty })).toBe('idle');
    expect(s.priority({ ...empty, busy: true, completed: true })).toBe('busy');
    expect(s.priority({ ...empty, busy: true, streaming: true })).toBe('streaming');
    expect(s.priority({ ...empty, completed: true })).toBe('completed');
    expect(s.priority({ ...empty, busy: true, streaming: true, completed: true, approval: true })).toBe('approval');
  });

  it('priority() places awaitingQuestion above streaming and below approval', () => {
    const s = createWorkspaceStatusStore();
    expect(s.priority({ ...empty, awaitingQuestion: true })).toBe('awaitingQuestion');
    // wins over streaming + busy
    expect(s.priority({ ...empty, awaitingQuestion: true, streaming: true, busy: true })).toBe('awaitingQuestion');
    // approval still wins
    expect(s.priority({ ...empty, awaitingQuestion: true, approval: true })).toBe('approval');
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/unit/remote/workspace-status-store.test.ts`
Expected: FAIL — TypeScript complains about unknown `awaitingQuestion` field; priority returns wrong values.

- [ ] **Step 3: Update the store**

Replace `src/renderer-remote/lib/workspaceStatusStore.ts` with:

```typescript
export interface WorkspaceStatus {
  busy: boolean;
  streaming: boolean;
  completed: boolean;
  approval: boolean;
  /** True while the AI has invoked AskUserQuestion and is awaiting an answer. Visual override only — busy/streaming may still be true. */
  awaitingQuestion: boolean;
  /** Session id of the streaming turn, or null if unknown (first turn before session_id arrives). */
  streamingSessionId?: string | null;
}

export type WorkspaceStatusPriority = 'idle' | 'completed' | 'busy' | 'streaming' | 'awaitingQuestion' | 'approval';

export interface WorkspaceStatusStore {
  get(projectPath: string): WorkspaceStatus | undefined;
  set(projectPath: string, status: WorkspaceStatus): void;
  subscribe(fn: (projectPath: string, status: WorkspaceStatus | undefined) => void): () => void;
  priority(status: WorkspaceStatus | undefined): WorkspaceStatusPriority;
}

export function createWorkspaceStatusStore(): WorkspaceStatusStore {
  const map = new Map<string, WorkspaceStatus>();
  const subs = new Set<(projectPath: string, status: WorkspaceStatus | undefined) => void>();
  return {
    get: (p) => map.get(p),
    set: (p, s) => {
      const allFalse = !s.busy && !s.streaming && !s.completed && !s.approval && !s.awaitingQuestion;
      if (allFalse) map.delete(p);
      else map.set(p, s);
      const out = map.get(p);
      for (const fn of subs) { try { fn(p, out); } catch { /* isolate */ } }
    },
    subscribe: (fn) => { subs.add(fn); return () => { subs.delete(fn); }; },
    priority: (s) => {
      if (!s) return 'idle';
      if (s.approval) return 'approval';
      if (s.awaitingQuestion) return 'awaitingQuestion';
      if (s.streaming) return 'streaming';
      if (s.busy) return 'busy';
      if (s.completed) return 'completed';
      return 'idle';
    },
  };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/unit/remote/workspace-status-store.test.ts`
Expected: all 5 tests PASS.

- [ ] **Step 5: Run wider remote test suite for type/usage errors**

Run: `npx vitest run tests/unit/remote`
Expected: PASS. (Any test that constructs a `WorkspaceStatus` literal directly may need `awaitingQuestion: false` added. The store-level tests are covered above; check `tests/integration/remote` for similar literals as well.)

If any literal is missing the field, add `awaitingQuestion: false`. Do not change semantics. Commit those test updates with this task.

- [ ] **Step 6: Commit**

```bash
git add src/renderer-remote/lib/workspaceStatusStore.ts tests/unit/remote/workspace-status-store.test.ts
# Plus any other test files updated for the new required field.
git commit -m "feat(remote): awaitingQuestion field in WorkspaceStatus"
```

---

## Task 2: `awaitingQuestionTracker` pure helper

**Files:**
- Create: `src/lib/awaitingQuestionTracker.ts`
- Create: `tests/unit/lib/awaitingQuestionTracker.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `tests/unit/lib/awaitingQuestionTracker.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { applyQuestionEvent } from '@/lib/awaitingQuestionTracker';

describe('applyQuestionEvent', () => {
  it('adds projectPath on question_needed', () => {
    const out = applyQuestionEvent(new Set(), { type: 'question_needed', projectPath: '/a' });
    expect(out.has('/a')).toBe(true);
  });

  it('removes projectPath on question_answered', () => {
    const out = applyQuestionEvent(new Set(['/a']), { type: 'question_answered', projectPath: '/a' });
    expect(out.has('/a')).toBe(false);
  });

  it('removes projectPath on result', () => {
    const out = applyQuestionEvent(new Set(['/a']), { type: 'result', projectPath: '/a' });
    expect(out.has('/a')).toBe(false);
  });

  it('removes projectPath on done', () => {
    const out = applyQuestionEvent(new Set(['/a']), { type: 'done', projectPath: '/a' });
    expect(out.has('/a')).toBe(false);
  });

  it('returns the same instance for unrelated message types (no churn)', () => {
    const prev = new Set(['/a']);
    const out = applyQuestionEvent(prev, { type: 'assistant', projectPath: '/a' });
    expect(out).toBe(prev);
  });

  it('returns the same instance when question_answered fires for a workspace not in the set', () => {
    const prev = new Set<string>();
    const out = applyQuestionEvent(prev, { type: 'question_answered', projectPath: '/a' });
    expect(out).toBe(prev);
  });

  it('returns the same instance when question_needed fires for a workspace already in the set', () => {
    const prev = new Set(['/a']);
    const out = applyQuestionEvent(prev, { type: 'question_needed', projectPath: '/a' });
    expect(out).toBe(prev);
  });

  it('does not touch other workspaces in the set', () => {
    const prev = new Set(['/a', '/b']);
    const out = applyQuestionEvent(prev, { type: 'question_answered', projectPath: '/a' });
    expect(out.has('/a')).toBe(false);
    expect(out.has('/b')).toBe(true);
  });
});
```

NOTE: the `@/` import alias is used by other tests in this repo. If it doesn't resolve, mirror what nearby tests use (e.g. relative path `../../../src/lib/awaitingQuestionTracker`).

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/unit/lib/awaitingQuestionTracker.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the helper**

Create `src/lib/awaitingQuestionTracker.ts`:

```typescript
export interface QuestionStatusMsg {
  type: string;
  projectPath: string;
}

export function applyQuestionEvent(prev: Set<string>, msg: QuestionStatusMsg): Set<string> {
  switch (msg.type) {
    case 'question_needed': {
      if (prev.has(msg.projectPath)) return prev;
      const next = new Set(prev);
      next.add(msg.projectPath);
      return next;
    }
    case 'question_answered':
    case 'result':
    case 'done': {
      if (!prev.has(msg.projectPath)) return prev;
      const next = new Set(prev);
      next.delete(msg.projectPath);
      return next;
    }
    default:
      return prev;
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/unit/lib/awaitingQuestionTracker.test.ts`
Expected: all 8 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/awaitingQuestionTracker.ts tests/unit/lib/awaitingQuestionTracker.test.ts
git commit -m "feat: awaitingQuestionTracker pure helper"
```

---

## Task 3: Wire `awaitingQuestion` through `src/App.tsx`

**Files:**
- Modify: `src/App.tsx`

Read the file first; the line numbers below are approximate and may have shifted with earlier tasks landing on the branch. Use Grep to find the exact insertion points if needed.

- [ ] **Step 1: Add the state and helper import**

Near the top of `src/App.tsx` add the import alongside other `@/lib/...` or relative imports:

```typescript
import { applyQuestionEvent } from './lib/awaitingQuestionTracker';
```

Find the `busyWorkspaces` state declaration (around `src/App.tsx:197`) and add directly after it:

```typescript
  const [awaitingQuestionWorkspaces, setAwaitingQuestionWorkspaces] = useState<Set<string>>(new Set());
```

- [ ] **Step 2: Extend `workspaceStatusRef`**

Find:

```typescript
  const workspaceStatusRef = useRef<{ busy: Set<string>; streaming: Set<string>; completed: Set<string>; approval: Set<string> }>({
    busy: new Set(), streaming: new Set(), completed: new Set(), approval: new Set(),
  });
```

Replace with:

```typescript
  const workspaceStatusRef = useRef<{ busy: Set<string>; streaming: Set<string>; completed: Set<string>; approval: Set<string>; awaitingQuestion: Set<string> }>({
    busy: new Set(), streaming: new Set(), completed: new Set(), approval: new Set(), awaitingQuestion: new Set(),
  });
```

- [ ] **Step 3: Extend `lastEmittedWorkspaceStatusRef`**

Find:

```typescript
  const lastEmittedWorkspaceStatusRef = useRef<Map<string, { busy: boolean; streaming: boolean; completed: boolean; approval: boolean; streamingSessionId: string | null }>>(new Map());
```

Replace with:

```typescript
  const lastEmittedWorkspaceStatusRef = useRef<Map<string, { busy: boolean; streaming: boolean; completed: boolean; approval: boolean; awaitingQuestion: boolean; streamingSessionId: string | null }>>(new Map());
```

- [ ] **Step 4: Update `statusFor()` in the remote proxy**

Find the `statusFor` closure (around `src/App.tsx:320-327`):

```typescript
        const statusFor = (projectPath: string) => {
          const busy = workspaceStatusRef.current.busy.has(projectPath);
          const streaming = workspaceStatusRef.current.streaming.has(projectPath);
          const completed = workspaceStatusRef.current.completed.has(projectPath);
          const approval = workspaceStatusRef.current.approval.has(projectPath);
          if (!busy && !streaming && !completed && !approval) return undefined;
          return { busy, streaming, completed, approval };
        };
```

Replace with:

```typescript
        const statusFor = (projectPath: string) => {
          const busy = workspaceStatusRef.current.busy.has(projectPath);
          const streaming = workspaceStatusRef.current.streaming.has(projectPath);
          const completed = workspaceStatusRef.current.completed.has(projectPath);
          const approval = workspaceStatusRef.current.approval.has(projectPath);
          const awaitingQuestion = workspaceStatusRef.current.awaitingQuestion.has(projectPath);
          if (!busy && !streaming && !completed && !approval && !awaitingQuestion) return undefined;
          return { busy, streaming, completed, approval, awaitingQuestion };
        };
```

Also widen the type literal a few lines above that declares the shape (`status?: { busy?: boolean; streaming?: boolean; completed?: boolean; approval?: boolean }` around `src/App.tsx:312`):

```typescript
          status?: { busy?: boolean; streaming?: boolean; completed?: boolean; approval?: boolean; awaitingQuestion?: boolean };
```

- [ ] **Step 5: Extend the workspace status sync effect**

Find the effect starting `useEffect(() => { workspaceStatusRef.current = { ...` (around `src/App.tsx:389`). Replace the whole effect body with:

```typescript
  useEffect(() => {
    workspaceStatusRef.current = {
      busy: new Set(busyWorkspaces),
      streaming: new Set(chatStreamingWorkspaces),
      completed: new Set(completedWorkspaces),
      approval: new Set(approvalWorkspaces.keys()),
      awaitingQuestion: new Set(awaitingQuestionWorkspaces),
    };
    // Emit per-workspace deltas to the remote bus so mobile sees live status.
    const all = new Set<string>([
      ...busyWorkspaces, ...chatStreamingWorkspaces, ...completedWorkspaces, ...approvalWorkspaces.keys(),
      ...awaitingQuestionWorkspaces,
      ...lastEmittedWorkspaceStatusRef.current.keys(),
    ]);
    for (const projectPath of all) {
      const streaming = chatStreamingWorkspaces.has(projectPath);
      const next = {
        busy: busyWorkspaces.has(projectPath),
        streaming,
        completed: completedWorkspaces.has(projectPath),
        approval: approvalWorkspaces.has(projectPath),
        awaitingQuestion: awaitingQuestionWorkspaces.has(projectPath),
        streamingSessionId: streaming ? (chatStreamingSessionRef.current.get(projectPath) ?? null) : null,
      };
      const prev = lastEmittedWorkspaceStatusRef.current.get(projectPath);
      if (!prev
          || prev.busy !== next.busy
          || prev.streaming !== next.streaming
          || prev.completed !== next.completed
          || prev.approval !== next.approval
          || prev.awaitingQuestion !== next.awaitingQuestion
          || prev.streamingSessionId !== next.streamingSessionId) {
        lastEmittedWorkspaceStatusRef.current.set(projectPath, next);
        void (window.sai as any).remoteEmitWorkspaceStatus?.(projectPath, next);
      }
    }
  }, [busyWorkspaces, chatStreamingWorkspaces, completedWorkspaces, approvalWorkspaces, awaitingQuestionWorkspaces]);
```

- [ ] **Step 6: Apply the tracker to `question_needed`, `question_answered`, `result`, `done`**

Find the `question_needed` handler (around `src/App.tsx:2049`):

```typescript
      if (msg.type === 'question_needed') {
        if (msg.projectPath !== activeProjectPathRef.current) {
          setNotificationCounts(p => {
            const next = new Map(p);
            next.set(msg.projectPath, (next.get(msg.projectPath) || 0) + 1);
            return next;
          });
        }
      }
```

Replace with:

```typescript
      if (msg.type === 'question_needed') {
        setAwaitingQuestionWorkspaces(prev => applyQuestionEvent(prev, msg));
        if (msg.projectPath !== activeProjectPathRef.current) {
          setNotificationCounts(p => {
            const next = new Map(p);
            next.set(msg.projectPath, (next.get(msg.projectPath) || 0) + 1);
            return next;
          });
        }
      }
      if (msg.type === 'question_answered') {
        setAwaitingQuestionWorkspaces(prev => applyQuestionEvent(prev, msg));
      }
```

Find the existing `if (msg.type === 'result' || msg.type === 'done')` handler block (around `src/App.tsx:2107`) and add this single line at the very top of that `if` body, before any other logic:

```typescript
        setAwaitingQuestionWorkspaces(prev => applyQuestionEvent(prev, msg));
```

- [ ] **Step 7: Run typecheck and the unit suite**

Run: `npx tsc -p tsconfig.json --noEmit`
Expected: clean.

Run: `npx vitest run tests/unit`
Expected: all PASS.

- [ ] **Step 8: Commit**

```bash
git add src/App.tsx
git commit -m "feat: track awaitingQuestion per workspace + emit to mobile"
```

---

## Task 4: Spinner guards (desktop `ChatPanel` + mobile `Transcript` + `Chat`) and mobile renderer mirror

**Files:**
- Modify: `src/components/Chat/ChatPanel.tsx`
- Modify: `src/App.tsx` (one call site)
- Modify: `src/renderer-remote/chat/Transcript.tsx`
- Modify: `src/renderer-remote/chat/Chat.tsx`
- Modify: `src/renderer-remote/App.tsx` (pass-through of the new field — if any cast is needed)

- [ ] **Step 1: Add `awaitingQuestion?` prop to `ChatPanel`**

In `src/components/Chat/ChatPanel.tsx`, find the props type (search for `isStreaming?: boolean;` around line 322). Add directly after it:

```typescript
  awaitingQuestion?: boolean;
```

Find the destructure of props at the top of the `ChatPanel` component (it's a long destructure). Add `awaitingQuestion` to the list (sensible neighbor: after `isStreaming`):

```typescript
  awaitingQuestion,
```

Find `const showThinking = isStreaming;` (around line 1325). Replace with:

```typescript
  const showThinking = isStreaming && !awaitingQuestion;
```

- [ ] **Step 2: Pass `awaitingQuestion` from `App.tsx`**

In `src/App.tsx`, find the `<ChatPanel ... isStreaming={ws.activeSession.kind === 'task' ? ...` invocation (around `src/App.tsx:3458`). Add a new prop directly after the `isStreaming={...}` block:

```tsx
                  awaitingQuestion={awaitingQuestionWorkspaces.has(wsPath)}
```

There is a second `ChatPanel`-like usage further up (around line 3152) for swarm/orchestrator that uses `isStreaming={streamingScopes.has(...)}` — leave that one alone unless it is the same component instance (verify by reading the surrounding JSX; if it's `<ChatPanel ...` add the same prop; otherwise skip).

- [ ] **Step 3: Add `awaitingQuestion?` prop to `Transcript`**

In `src/renderer-remote/chat/Transcript.tsx`, find the props interface (it's defined alongside the export — search for `streaming` in the type). Add `awaitingQuestion?: boolean;` next to `streaming`.

Add it to the destructure at the top of the component. Find the spinner block (around line 232):

```tsx
      {streaming && (
        <div
          aria-live="polite"
          style={{
            alignSelf: 'flex-start',
            paddingLeft: 4,
          }}
        >
          <ThinkingAnimation size={18} />
        </div>
      )}
```

Replace with:

```tsx
      {streaming && !awaitingQuestion && (
        <div
          aria-live="polite"
          style={{
            alignSelf: 'flex-start',
            paddingLeft: 4,
          }}
        >
          <ThinkingAnimation size={18} />
        </div>
      )}
```

- [ ] **Step 4: Read `awaitingQuestion` from the store in `Chat.tsx` and pass to `Transcript`**

In `src/renderer-remote/chat/Chat.tsx`, find the existing `backendStreaming` computation (around line 47):

```typescript
  const backendStreaming = (() => {
    if (!active) return false;
    const s = statusStore.get(active.projectPath);
    if (!s?.streaming) return false;
    if (!s.streamingSessionId) return true;
    return s.streamingSessionId === active.sessionId;
  })();
  const streaming = backendStreaming || localStreaming;
```

Add directly below it:

```typescript
  const awaitingQuestion = (() => {
    if (!active) return false;
    const s = statusStore.get(active.projectPath);
    return !!s?.awaitingQuestion;
  })();
```

Find the `<Transcript ... streaming={streaming} ...` invocation (around line 369) and add the new prop:

```tsx
        <Transcript messages={messages} streaming={streaming} awaitingQuestion={awaitingQuestion} onAnswerQuestion={onAnswerQuestion} />
```

The store subscription effect at the top of `Chat.tsx` already re-renders when status changes — no extra subscription needed because awaitingQuestion is read inside the render path off the same store.

- [ ] **Step 5: Mobile App receives the field with no further change**

Verify by reading `src/renderer-remote/App.tsx` around line 49:

```typescript
workspaceStatusStore.set(m.projectPath, m.status as WorkspaceStatus);
```

This is a structural cast — the new field flows through automatically. If the cast becomes strict somehow (e.g. spreading with explicit default), add `awaitingQuestion: !!m.status.awaitingQuestion`. Otherwise no change.

- [ ] **Step 6: Run typecheck + unit suite**

Run: `npx tsc -p tsconfig.json --noEmit`
Expected: clean.

Run: `npx vitest run tests/unit`
Expected: all PASS.

- [ ] **Step 7: Commit**

```bash
git add src/components/Chat/ChatPanel.tsx src/App.tsx src/renderer-remote/chat/Transcript.tsx src/renderer-remote/chat/Chat.tsx
# src/renderer-remote/App.tsx only if you had to change it
git commit -m "feat: gate thinking spinner on awaitingQuestion (desktop + mobile)"
```

---

## Task 5: Verification sweep

- [ ] **Step 1: Full unit suite**

Run: `npx vitest run tests/unit`
Expected: all PASS.

- [ ] **Step 2: Integration suite for the remote bridge**

Run: `npx vitest run tests/integration/remote`
Expected: all PASS.

- [ ] **Step 3: Typecheck**

Run: `npx tsc -p tsconfig.json --noEmit`
Expected: clean.

- [ ] **Step 4: Manual smoke (document only, no commit)**

Trigger `AskUserQuestion` from the agent in a desktop session and confirm:
1. The chat thinking animation hides while the question card is visible.
2. The workspace sidebar dot turns green.
3. On the paired mobile, the same workspace dot turns green and the mobile thinking indicator hides.
4. After answering, both dots return to streaming and spinners resume.

---

## Self-Review Notes

- **Spec coverage:**
  - `awaitingQuestion` field added (Task 1).
  - Priority order updated (Task 1).
  - Pure tracker for the bookkeeping (Task 2).
  - App state + wire emission + proxy + `result`/`done` cleanup (Task 3).
  - Spinner guards at the two identified sites (Task 4).
  - Mobile pass-through verified (Task 4 step 5).
  - No new toast / no `notifyCompletion` change — Task 3 only touches existing handlers in additive ways.
- **Placeholder scan:** none.
- **Type consistency:** `WorkspaceStatus.awaitingQuestion` is required (boolean) in the store; the wire payload from `App.tsx` always sets it explicitly; older payloads (if any other emitter ever appears) would be caught by the cast in `src/renderer-remote/App.tsx`. Field name is `awaitingQuestion` throughout.
- **Scope:** no backend (`claude.ts`/`workspace.ts`) changes — they already emit the events we need.
