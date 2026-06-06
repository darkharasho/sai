# Richer Task Cards Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give `TaskCreate`/`TaskUpdate`/`TodoWrite` tool cards and the `TodoProgress` follower richer, structured info — resolving a `TaskUpdate`'s subject from conversation history.

**Architecture:** Extract the existing per-task replay logic from `TodoProgress` into a shared pure module `taskRegistry.ts` (`buildTaskRegistry` + `extractTaskCreateId` + a `TaskRegistryContext`). `ChatPanel` builds the registry from `messages` and provides it via context. `ToolCallCard` renders a new `TaskCardView` for task tools (reading the context to resolve `TaskUpdate` subjects), enhances `TodoListView`, and `TodoProgress`'s popover gains priority badges + title-forward active items.

**Tech Stack:** React + TypeScript, Vitest + @testing-library/react, lucide-react, motion/react.

---

## File Structure

- **Create** `src/components/Chat/taskRegistry.ts` — `TaskInfo`, `buildTaskRegistry(messages)`, `extractTaskCreateId(...)`, `TaskRegistryContext`. Pure logic + a context object. One responsibility: turn message history into a task-id→info map.
- **Modify** `src/components/Chat/TodoProgress.tsx` — consume `buildTaskRegistry`/`extractTaskCreateId` (delete the inlined copies); add popover priority badge + title-forward active item.
- **Modify** `src/components/Chat/ToolCallCard.tsx` — `TaskCardView` component, task icons, detection + wiring, `TodoListView` enhancement.
- **Modify** `src/components/Chat/ChatPanel.tsx` — build the registry and wrap the message list in `TaskRegistryContext.Provider`.
- **Create** `tests/unit/components/Chat/taskRegistry.test.ts`.
- **Modify** `tests/unit/components/Chat/ToolCallCard.test.tsx`, `tests/unit/components/Chat/TodoProgress.test.tsx`.

---

## Task 1: Shared task-registry module

**Files:**
- Create: `src/components/Chat/taskRegistry.ts`
- Test: `tests/unit/components/Chat/taskRegistry.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `tests/unit/components/Chat/taskRegistry.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { buildTaskRegistry, extractTaskCreateId } from '../../../../src/components/Chat/taskRegistry';
import type { ChatMessage, ToolCall } from '../../../../src/types';

function asst(toolCalls: ToolCall[]): ChatMessage {
  return { id: 'm' + Math.random(), role: 'assistant', content: '', timestamp: 0, toolCalls };
}
function tc(name: string, input: object, output?: string): ToolCall {
  return { type: 'task', name, input: JSON.stringify(input), output };
}

describe('extractTaskCreateId', () => {
  it('parses the id from a "Task #N created" output', () => {
    expect(extractTaskCreateId('Task #3 created successfully: foo', 'fallback')).toBe('3');
  });
  it('falls back when there is no output', () => {
    expect(extractTaskCreateId(undefined, '7')).toBe('7');
  });
});

describe('buildTaskRegistry', () => {
  it('keeps the create subject when a later update only changes status', () => {
    const messages = [
      asst([tc('TaskCreate', { subject: 'Build parser', description: 'the desc' }, 'Task #1 created successfully')]),
      asst([tc('TaskUpdate', { taskId: '1', status: 'completed' })]),
    ];
    const reg = buildTaskRegistry(messages);
    expect(reg.get('1')).toMatchObject({ id: '1', subject: 'Build parser', description: 'the desc', status: 'completed' });
  });

  it('lets an update override subject and activeForm', () => {
    const messages = [
      asst([tc('TaskCreate', { subject: 'Old' }, 'Task #2 created successfully')]),
      asst([tc('TaskUpdate', { taskId: '2', subject: 'New', activeForm: 'Doing new' })]),
    ];
    expect(reg2(messages).get('2')).toMatchObject({ subject: 'New', activeForm: 'Doing new' });
  });

  it('removes a task on deleted status', () => {
    const messages = [
      asst([tc('TaskCreate', { subject: 'X' }, 'Task #5 created successfully')]),
      asst([tc('TaskUpdate', { taskId: '5', status: 'deleted' })]),
    ];
    expect(buildTaskRegistry(messages).has('5')).toBe(false);
  });

  it('ignores an update for an unknown task id', () => {
    const reg = buildTaskRegistry([asst([tc('TaskUpdate', { taskId: '99', status: 'completed' })])]);
    expect(reg.has('99')).toBe(false);
  });

  it('skips malformed JSON without throwing', () => {
    const bad: ChatMessage = { id: 'b', role: 'assistant', content: '', timestamp: 0,
      toolCalls: [{ type: 'task', name: 'TaskCreate', input: '{not json' }] };
    expect(() => buildTaskRegistry([bad])).not.toThrow();
    expect(buildTaskRegistry([bad]).size).toBe(0);
  });

  it('uses a sequence fallback id when output lacks a task number', () => {
    const reg = buildTaskRegistry([asst([tc('TaskCreate', { subject: 'Seq' })])]);
    expect(reg.get('1')).toMatchObject({ subject: 'Seq' });
  });
});

function reg2(messages: ChatMessage[]) { return buildTaskRegistry(messages); }
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run tests/unit/components/Chat/taskRegistry.test.ts --maxWorkers=2`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the module**

Create `src/components/Chat/taskRegistry.ts`:

```ts
import { createContext } from 'react';
import type { ChatMessage } from '../../types';

export interface TaskInfo {
  id: string;
  subject: string;
  description?: string;
  activeForm?: string;
  status: 'pending' | 'in_progress' | 'completed';
  owner?: string;
}

/** Extract a TaskCreate id from its output ("Task #1 created successfully: ..."),
 *  falling back to the provided value (a sequence counter). Mirrors the legacy
 *  TodoProgress behavior. */
export function extractTaskCreateId(output: string | undefined, fallback: string): string {
  if (!output) return fallback;
  const m = /Task\s*#?\s*([0-9a-zA-Z_-]+)\b/i.exec(output);
  if (m) return m[1];
  try {
    const parsed = JSON.parse(output);
    if (parsed && (parsed.id || parsed.taskId)) return String(parsed.id || parsed.taskId);
  } catch { /* ignore */ }
  return fallback;
}

/** Replay TaskCreate/TaskUpdate calls across the whole conversation into a
 *  task-id → TaskInfo map. TaskCreate seeds an entry; TaskUpdate mutates it
 *  (status 'deleted' removes it). Malformed inputs are skipped. */
export function buildTaskRegistry(messages: ChatMessage[]): Map<string, TaskInfo> {
  const tasks = new Map<string, TaskInfo>();
  let createSeq = 0;
  for (const m of messages) {
    if (m.role !== 'assistant' || !m.toolCalls?.length) continue;
    for (const tcall of m.toolCalls) {
      if (tcall.name === 'TaskCreate') {
        try {
          const input = JSON.parse(tcall.input || '{}');
          createSeq += 1;
          const id = extractTaskCreateId(tcall.output, String(createSeq));
          if (tasks.has(id)) continue;
          tasks.set(id, {
            id,
            subject: input.subject || input.description || 'Task',
            description: input.description,
            activeForm: input.activeForm,
            status: 'pending',
            owner: input.owner,
          });
        } catch { /* ignore malformed input */ }
      } else if (tcall.name === 'TaskUpdate') {
        try {
          const input = JSON.parse(tcall.input || '{}');
          const id = input.taskId != null ? String(input.taskId) : '';
          if (!id) continue;
          if (input.status === 'deleted') { tasks.delete(id); continue; }
          const existing = tasks.get(id);
          if (!existing) continue;
          if (input.status === 'pending' || input.status === 'in_progress' || input.status === 'completed') {
            existing.status = input.status;
          }
          if (typeof input.subject === 'string') existing.subject = input.subject;
          if (typeof input.description === 'string') existing.description = input.description;
          if (typeof input.activeForm === 'string') existing.activeForm = input.activeForm;
          if (typeof input.owner === 'string') existing.owner = input.owner;
        } catch { /* ignore malformed input */ }
      }
    }
  }
  return tasks;
}

export const TaskRegistryContext = createContext<Map<string, TaskInfo>>(new Map());
```

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run tests/unit/components/Chat/taskRegistry.test.ts --maxWorkers=2`
Expected: PASS — all cases.

- [ ] **Step 5: Commit**

```bash
git add src/components/Chat/taskRegistry.ts tests/unit/components/Chat/taskRegistry.test.ts
git commit -m "feat(ui): add shared task-registry module and context"
```

---

## Task 2: Refactor TodoProgress to use the shared registry

**Files:**
- Modify: `src/components/Chat/TodoProgress.tsx`

No behavior change — this only removes the duplicated replay logic. The follower's
visual enrichment is Task 5.

- [ ] **Step 1: Import the shared helpers**

In `src/components/Chat/TodoProgress.tsx`, add after the existing imports (the `motion` import on line 4):

```tsx
import { buildTaskRegistry } from './taskRegistry';
```

- [ ] **Step 2: Replace the inlined TaskCreate/TaskUpdate replay**

In `findLatestTodos`, the function currently has a TodoWrite-legacy loop, then a
TaskCreate/TaskUpdate replay block that builds `tasks`/`order` (the block from
`// New: TaskCreate / TaskUpdate are atomic...` through the `if (order.length > 0) { return ... }`).
Replace ONLY that replay block (keep the TodoWrite-legacy loop above it untouched) with:

```tsx
  // New: TaskCreate / TaskUpdate are atomic per-task calls. Replay them via the
  // shared registry so updates in a later turn still find tasks created earlier.
  const registry = buildTaskRegistry(messages);
  if (registry.size > 0) {
    return Array.from(registry.values()).map((t) => ({
      id: t.id,
      content: t.subject,
      activeForm: t.activeForm,
      status: t.status,
    }));
  }
  return null;
```

Also DELETE the now-unused local `extractTaskCreateId` function at the top of the file
(lines ~20-30) — it now lives in `taskRegistry.ts`. (Verify nothing else references it;
`buildTaskRegistry` uses the shared one internally.)

- [ ] **Step 3: Run the existing TodoProgress tests**

Run: `npx vitest run tests/unit/components/Chat/TodoProgress.test.tsx --maxWorkers=2`
Expected: PASS — unchanged behavior. (The registry preserves insertion order via `Map`,
matching the previous `order[]` behavior.)

Run: `npx tsc --noEmit`
Expected: no new errors. (If `extractTaskCreateId` removal leaves an unused-import or
reference, fix it.)

- [ ] **Step 4: Commit**

```bash
git add src/components/Chat/TodoProgress.tsx
git commit -m "refactor(ui): TodoProgress uses shared buildTaskRegistry"
```

---

## Task 3: TaskCardView + ToolCallCard wiring + ChatPanel provider

**Files:**
- Modify: `src/components/Chat/ToolCallCard.tsx`
- Modify: `src/components/Chat/ChatPanel.tsx`
- Test: `tests/unit/components/Chat/ToolCallCard.test.tsx`

- [ ] **Step 1: Write the failing tests**

Add to `tests/unit/components/Chat/ToolCallCard.test.tsx`. Add the context import near the
top imports:

```tsx
import { TaskRegistryContext } from '../../../../src/components/Chat/taskRegistry';
```

Then add:

```tsx
describe('ToolCallCard task rendering', () => {
  it('renders a TaskCreate card with subject title and a created badge', () => {
    const create = {
      id: 'tc1', type: 'task' as const, name: 'TaskCreate',
      input: JSON.stringify({ subject: 'Build the parser', description: 'parse search output' }),
      output: 'Task #1 created successfully',
    };
    const { container, getByText } = render(<ToolCallCard toolCall={create} />);
    expect(container.querySelector('.task-card')).toBeTruthy();
    expect(getByText('Build the parser')).toBeTruthy();
    expect(container.querySelector('.task-badge-created')).toBeTruthy();
  });

  it('resolves a TaskUpdate subject from the registry context', () => {
    const update = {
      id: 'tu1', type: 'task' as const, name: 'TaskUpdate',
      input: JSON.stringify({ taskId: '1', status: 'completed' }),
    };
    const registry = new Map([['1', { id: '1', subject: 'Build the parser', status: 'completed' as const }]]);
    const { getByText, container } = render(
      <TaskRegistryContext.Provider value={registry}>
        <ToolCallCard toolCall={update} />
      </TaskRegistryContext.Provider>
    );
    expect(getByText('Build the parser')).toBeTruthy();
    expect(container.querySelector('.task-badge-completed')).toBeTruthy();
  });

  it('falls back to Task #id when the update is unresolved', () => {
    const update = {
      id: 'tu2', type: 'task' as const, name: 'TaskUpdate',
      input: JSON.stringify({ taskId: '7', status: 'in_progress' }),
    };
    const { getByText } = render(<ToolCallCard toolCall={update} />);
    expect(getByText('Task #7')).toBeTruthy();
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run tests/unit/components/Chat/ToolCallCard.test.tsx --maxWorkers=2`
Expected: FAIL — no `.task-card`.

- [ ] **Step 3: Add imports + icons**

In `src/components/Chat/ToolCallCard.tsx`:

1. Add `ListChecks` to the lucide import list (the big `lucide-react` import near the top) and add the `useContext` React import. The file currently imports `{ useState, useEffect, useRef }` from 'react' (line 1) — change to include `useContext`:

```tsx
import { useState, useEffect, useRef, useContext } from 'react';
```

2. In the `lucide-react` import block, add `ListChecks` alongside the other icons.

3. Add the taskRegistry import after the `./searchResults` import:

```tsx
import { TaskRegistryContext, type TaskInfo } from './taskRegistry';
```

4. In the `nameToIcon` map, add entries:

```tsx
  TaskCreate: ListTodo,
  TaskUpdate: ListChecks,
```

- [ ] **Step 4: Add the TaskCardView component**

Add near the other inline view components (e.g. right after `SearchResultView`, before
`const MAX_PREVIEW_LINES`):

```tsx
interface TaskFields {
  taskId?: string;
  subject?: string;
  description?: string;
  activeForm?: string;
  status?: string;
  owner?: string;
  addBlocks?: string[];
  addBlockedBy?: string[];
}

function parseTaskFields(input: string): TaskFields {
  try {
    const p = JSON.parse(input || '{}');
    return {
      taskId: p.taskId != null ? String(p.taskId) : undefined,
      subject: typeof p.subject === 'string' ? p.subject : undefined,
      description: typeof p.description === 'string' ? p.description : undefined,
      activeForm: typeof p.activeForm === 'string' ? p.activeForm : undefined,
      status: typeof p.status === 'string' ? p.status : undefined,
      owner: typeof p.owner === 'string' ? p.owner : undefined,
      addBlocks: Array.isArray(p.addBlocks) ? p.addBlocks.map(String) : undefined,
      addBlockedBy: Array.isArray(p.addBlockedBy) ? p.addBlockedBy.map(String) : undefined,
    };
  } catch { return {}; }
}

function TaskCardView({ kind, fields, resolved }: { kind: 'create' | 'update'; fields: TaskFields; resolved?: TaskInfo }) {
  const title = fields.subject || resolved?.subject || `Task #${fields.taskId ?? '?'}`;
  const description = fields.description || (kind === 'update' ? resolved?.description : undefined);
  const activeForm = fields.activeForm || (kind === 'update' ? resolved?.activeForm : undefined);
  const badge = kind === 'create'
    ? { cls: 'created', label: 'Created' }
    : fields.status
      ? { cls: fields.status, label: fields.status.replace('_', ' ') }
      : { cls: 'updated', label: 'Updated' };
  return (
    <div className="tool-call-body task-card">
      <div className="task-card-head">
        <span className="task-card-title">{title}</span>
        <span className={`task-badge task-badge-${badge.cls}`}>{badge.label}</span>
      </div>
      {description && <div className="task-card-desc">{description}</div>}
      <div className="task-card-meta">
        {activeForm && <span className="task-chip">{activeForm}</span>}
        {fields.owner && <span className="task-chip">owner: {fields.owner}</span>}
        {fields.addBlocks && fields.addBlocks.length > 0 && <span className="task-chip">blocks {fields.addBlocks.length}</span>}
        {fields.addBlockedBy && fields.addBlockedBy.length > 0 && <span className="task-chip">blocked by {fields.addBlockedBy.length}</span>}
      </div>
    </div>
  );
}
```

- [ ] **Step 5: Wire detection + body branch**

In the `ToolCallCard` component body, after the `isAskUserQuestion` const (around line 774), add:

```tsx
  const isTaskCreate = toolCall.name === 'TaskCreate';
  const isTaskUpdate = toolCall.name === 'TaskUpdate';
  const isTask = isTaskCreate || isTaskUpdate;
  const taskRegistry = useContext(TaskRegistryContext);
  const taskFields = isTask ? parseTaskFields(toolCall.input || '') : null;
  const taskResolved = isTaskUpdate && taskFields?.taskId ? taskRegistry.get(taskFields.taskId) : undefined;
```

Update `hasBody` (the line after the `status` const) to make task cards always have a body. It currently is (after the search feature):

```tsx
  const hasBody = isAskUserQuestion ? true : isBash ? !!toolCall.output : isTodo ? true : search ? (!!toolCall.output || !!query) : !!code;
```

Change to:

```tsx
  const hasBody = isAskUserQuestion ? true : isTask ? true : isBash ? !!toolCall.output : isTodo ? true : search ? (!!toolCall.output || !!query) : !!code;
```

In the body JSX, add a task branch alongside the others. After the `{isTodo && <TodoListView ... />}` block, insert:

```tsx
            {isTask && taskFields && (
              <TaskCardView kind={isTaskCreate ? 'create' : 'update'} fields={taskFields} resolved={taskResolved} />
            )}
```

Then guard the search branch and the generic branch so a task tool doesn't also fall
through. The search flag should exclude tasks — change the `search` computation to add
`&& !isTask`... but `isTask` is declared after `search`. Simplest: guard the two JSX
branches. Change the search branch opener `{search && (` to `{search && !isTask && (`
and the generic branch opener `{!isBash && !isTodo && !isAskUserQuestion && !search && code && (`
to `{!isBash && !isTodo && !isAskUserQuestion && !search && !isTask && code && (`.
(Tasks have no `pattern`, so `search` is already false for them via `isSearchTool` name
check; the `!isTask` guards are defensive and make intent explicit.)

- [ ] **Step 6: Add CSS**

Inside the inline `<style>` block, after the `.search-sep` rule (added previously), add:

```css
          .task-card { padding: 10px 12px; display: flex; flex-direction: column; gap: 6px; }
          .task-card-head { display: flex; align-items: baseline; gap: 8px; }
          .task-card-title { font-size: 12.5px; color: var(--text); font-weight: 600; flex: 1; word-break: break-word; }
          .task-badge {
            flex-shrink: 0; font-size: 9px; text-transform: uppercase; letter-spacing: 0.4px;
            font-weight: 600; padding: 2px 7px; border-radius: 4px;
            background: color-mix(in srgb, var(--text-muted) 18%, transparent); color: var(--text-secondary);
          }
          .task-badge-created { background: color-mix(in srgb, var(--accent) 18%, transparent); color: var(--accent); }
          .task-badge-in_progress { background: color-mix(in srgb, var(--orange, #e6b84f) 20%, transparent); color: var(--orange, #e6b84f); }
          .task-badge-completed { background: color-mix(in srgb, var(--green) 18%, transparent); color: var(--green); }
          .task-badge-deleted { background: color-mix(in srgb, var(--red, #f85149) 16%, transparent); color: var(--red, #f85149); }
          .task-card-desc { font-size: 11.5px; color: var(--text-muted); line-height: 1.5; word-break: break-word; }
          .task-card-meta { display: flex; flex-wrap: wrap; gap: 6px; }
          .task-chip {
            font-size: 10px; padding: 2px 7px; border-radius: 4px;
            background: var(--bg-secondary); border: 1px solid var(--border); color: var(--text-secondary);
            font-family: 'Geist Mono', 'JetBrains Mono', monospace;
          }
```

- [ ] **Step 7: Wire the provider in ChatPanel**

In `src/components/Chat/ChatPanel.tsx`:

1. Add the import (near other `./` imports):

```tsx
import { buildTaskRegistry, TaskRegistryContext } from './taskRegistry';
```

2. Inside the `ChatPanel` component, near where other memos live (after the `messages`
state is available), add:

```tsx
  const taskRegistry = useMemo(() => buildTaskRegistry(messages), [messages]);
```

(`useMemo` is already imported in ChatPanel; if not, add it to the `react` import.)

3. Wrap the `visibleMessages.map(...)` block (the `{visibleMessages.map(msg => ...)}`
region around line 1835) in the provider. Change:

```tsx
            {visibleMessages.map(msg => msg.role === 'user'
```

so the whole `{visibleMessages.map(...)}` expression is wrapped:

```tsx
            <TaskRegistryContext.Provider value={taskRegistry}>
            {visibleMessages.map(msg => msg.role === 'user'
              ? ( ... )
              : ...
              )}
            </TaskRegistryContext.Provider>
```

i.e. place `<TaskRegistryContext.Provider value={taskRegistry}>` immediately before the
`{visibleMessages.map(` and its closing `</TaskRegistryContext.Provider>` immediately
after the map's closing `)}`. Do not change the map body.

- [ ] **Step 8: Run tests + typecheck**

Run: `npx vitest run tests/unit/components/Chat/ToolCallCard.test.tsx --maxWorkers=2`
Expected: PASS — task rendering tests + all pre-existing.

Run: `npx tsc --noEmit`
Expected: clean.

- [ ] **Step 9: Commit**

```bash
git add src/components/Chat/ToolCallCard.tsx src/components/Chat/ChatPanel.tsx tests/unit/components/Chat/ToolCallCard.test.tsx
git commit -m "feat(ui): structured TaskCreate/TaskUpdate cards with history-resolved subject"
```

---

## Task 4: TodoListView enhancement

**Files:**
- Modify: `src/components/Chat/ToolCallCard.tsx`
- Test: `tests/unit/components/Chat/ToolCallCard.test.tsx`

- [ ] **Step 1: Write the failing tests**

Add to `tests/unit/components/Chat/ToolCallCard.test.tsx`:

```tsx
describe('TodoWrite card enhancements', () => {
  const todoCall = {
    id: 'td1', type: 'todo' as const, name: 'TodoWrite',
    input: JSON.stringify({ todos: [
      { id: '1', content: 'First', status: 'completed' },
      { id: '2', content: 'Second', activeForm: 'Doing second', status: 'in_progress', priority: 'high' },
      { id: '3', content: 'Third', status: 'pending' },
    ] }),
  };

  it('shows a done/total count header', () => {
    const { getByTestId } = render(<ToolCallCard toolCall={todoCall} />);
    expect(getByTestId('todo-count').textContent).toBe('1/3');
  });

  it('shows the activeForm for the in-progress item', () => {
    const { getByText } = render(<ToolCallCard toolCall={todoCall} />);
    expect(getByText('Doing second')).toBeTruthy();
  });

  it('renders a priority badge when a todo has priority', () => {
    const { container } = render(<ToolCallCard toolCall={todoCall} />);
    expect(container.querySelector('.todo-priority')?.textContent).toBe('high');
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run tests/unit/components/Chat/ToolCallCard.test.tsx --maxWorkers=2`
Expected: FAIL — `todo-count` testid missing.

- [ ] **Step 3: Enhance `TodoListView` and its `Todo` type**

In `src/components/Chat/ToolCallCard.tsx`, extend the `Todo` interface (around line 476)
to include `activeForm`:

```tsx
interface Todo {
  id: string;
  content: string;
  activeForm?: string;
  status: 'pending' | 'in_progress' | 'completed';
  priority?: string;
}
```

Replace the `TodoListView` function body (around line 483) with:

```tsx
function TodoListView({ input }: { input: string }) {
  let todos: Todo[] = [];
  try {
    const parsed = JSON.parse(input);
    todos = Array.isArray(parsed.todos) ? parsed.todos : [];
  } catch { /* ignore */ }

  if (!todos.length) return null;

  const done = todos.filter(t => t.status === 'completed').length;

  return (
    <div className="tool-call-body todo-list-body">
      <div className="todo-list-head">
        <span className="todo-list-title">Tasks</span>
        <span className="todo-list-count" data-testid="todo-count">{done}/{todos.length}</span>
      </div>
      {todos.map((todo, i) => (
        <div key={todo.id || i} className={`todo-item todo-${todo.status}`}>
          <span className="todo-icon">
            {todo.status === 'completed' ? '✓' : todo.status === 'in_progress' ? '✦' : '○'}
          </span>
          <span className="todo-content">
            {todo.status === 'in_progress' ? (todo.activeForm || todo.content) : todo.content}
          </span>
          {todo.priority && <span className="todo-priority">{todo.priority}</span>}
        </div>
      ))}
    </div>
  );
}
```

- [ ] **Step 4: Add CSS for the new bits**

Inside the inline `<style>` block, after the existing `.todo-pending .todo-content` rule
(near the other `todo-*` rules), add:

```css
          .todo-list-head {
            display: flex; align-items: baseline; gap: 8px;
            padding: 4px 12px 2px; border-bottom: 1px dashed var(--border); margin-bottom: 4px;
          }
          .todo-list-title {
            font-size: 9px; text-transform: uppercase; letter-spacing: 0.5px; color: var(--text-muted); font-weight: 600;
          }
          .todo-list-count {
            margin-left: auto; font-size: 10px; color: var(--text-muted);
            font-variant-numeric: tabular-nums;
            font-family: 'Geist Mono', 'JetBrains Mono', monospace;
          }
          .todo-priority {
            margin-left: auto; flex-shrink: 0;
            font-size: 8.5px; text-transform: uppercase; letter-spacing: 0.4px; font-weight: 600;
            padding: 1px 6px; border-radius: 3px;
            background: color-mix(in srgb, var(--orange, #e6b84f) 18%, transparent);
            color: var(--orange, #e6b84f);
          }
```

- [ ] **Step 5: Run tests + typecheck**

Run: `npx vitest run tests/unit/components/Chat/ToolCallCard.test.tsx --maxWorkers=2`
Expected: PASS.

Run: `npx tsc --noEmit`
Expected: clean.

- [ ] **Step 6: Commit**

```bash
git add src/components/Chat/ToolCallCard.tsx tests/unit/components/Chat/ToolCallCard.test.tsx
git commit -m "feat(ui): TodoWrite card shows count, activeForm, and priority"
```

---

## Task 5: TodoProgress follower popover enrichment

**Files:**
- Modify: `src/components/Chat/TodoProgress.tsx`
- Test: `tests/unit/components/Chat/TodoProgress.test.tsx`

- [ ] **Step 1: Write the failing tests**

Open `tests/unit/components/Chat/TodoProgress.test.tsx` to match its existing helpers for
building messages and opening the popover. Add tests following the file's existing style
(reuse its message-builder + render helpers). The two behaviors to assert, expressed
against the rendered popover (open it the way existing tests do — clicking the
`todo-ring` element):

```tsx
  it('renders a priority badge on a popover item that has priority', () => {
    // Build messages whose latest TodoWrite includes an item with priority: 'high'
    // and at least one in_progress item so the ring is visible (completed < total).
    // Render <TodoProgress messages={messages} isStreaming />, click [data-testid="todo-ring"],
    // then:
    expect(document.querySelector('.todo-ring-priority')?.textContent).toBe('high');
  });

  it('shows the title (content) for the in-progress item with activeForm as a secondary line', () => {
    // Latest TodoWrite has an in_progress item: { content: 'Run the suite', activeForm: 'Running the suite', ... }
    // After opening the popover:
    const active = document.querySelector('.todo-ring-item--active');
    expect(active?.querySelector('.todo-ring-text')?.textContent).toContain('Run the suite');
    expect(active?.querySelector('.todo-ring-subtext')?.textContent).toContain('Running the suite');
  });
```

(If the existing test file already has a helper like `makeTodoMessages(todos)` and a
`renderAndOpen()` flow, use those. Otherwise mirror the construction used by the existing
passing tests in that file — do not invent a new harness.)

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run tests/unit/components/Chat/TodoProgress.test.tsx --maxWorkers=2`
Expected: FAIL — `.todo-ring-priority` / `.todo-ring-subtext` missing.

- [ ] **Step 3: Add `priority` to the internal Todo type**

In `src/components/Chat/TodoProgress.tsx`, the local `Todo` interface (around line 7)
already has `priority?: string` and `activeForm?: string` — confirm both are present
(they are). No change needed if so.

- [ ] **Step 4: Update the popover list item rendering**

In the `todos.map((t) => { ... })` render (around line 210), replace the returned `<li>`'s
inner content so the active item leads with the title and shows `activeForm` as a
secondary line, and a priority badge renders when present. Replace the existing
`<span className="todo-ring-text">...</span>` block with:

```tsx
                    <span className="todo-ring-textwrap">
                      <span className="todo-ring-text">{t.content}</span>
                      {status === 'active' && t.activeForm && t.activeForm !== t.content && (
                        <span className="todo-ring-subtext">{t.activeForm}</span>
                      )}
                    </span>
                    {t.priority && <span className="todo-ring-priority">{t.priority}</span>}
```

(Previously the active item showed `t.activeForm || t.content`; now it shows the title
`t.content` as primary with `activeForm` beneath. Non-active items already showed
`t.content`.)

NOTE: For `Task`-sourced todos, `priority` is undefined (no badge) — that's expected; the
badge only appears for legacy `TodoWrite` items that carry a priority.

- [ ] **Step 5: Add CSS**

In the `<style>` block of `TodoProgress.tsx`, after the `.todo-ring-text` rule
(around line 348), add:

```css
        .todo-ring-textwrap { display: flex; flex-direction: column; gap: 1px; min-width: 0; flex: 1; }
        .todo-ring-subtext {
          font-size: 10.5px; color: var(--text-muted); font-style: italic; word-break: break-word;
        }
        .todo-ring-priority {
          flex-shrink: 0; align-self: flex-start; margin-top: 2px;
          font-size: 8.5px; text-transform: uppercase; letter-spacing: 0.4px; font-weight: 600;
          padding: 1px 6px; border-radius: 3px;
          background: color-mix(in srgb, var(--orange, #e6b84f) 18%, transparent);
          color: var(--orange, #e6b84f);
        }
```

Also ensure the `.todo-ring-item` is a flex row that lays out `todo-ring-status`,
`todo-ring-textwrap`, and `todo-ring-priority` — it already uses
`display: flex; align-items: flex-start; gap: 8px;`, which works.

- [ ] **Step 6: Run tests + typecheck**

Run: `npx vitest run tests/unit/components/Chat/TodoProgress.test.tsx --maxWorkers=2`
Expected: PASS.

Run: `npx tsc --noEmit`
Expected: clean.

- [ ] **Step 7: Commit**

```bash
git add src/components/Chat/TodoProgress.tsx tests/unit/components/Chat/TodoProgress.test.tsx
git commit -m "feat(ui): TodoProgress popover shows priority + title-forward active item"
```

---

## Task 6: Full verification

**Files:** none (verification only)

- [ ] **Step 1: Full Chat suite**

Run: `npx vitest run tests/unit/components/Chat --maxWorkers=2`
Expected: PASS — taskRegistry, ToolCallCard, TodoProgress, and all other Chat suites green.

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit`
Expected: clean.

- [ ] **Step 3: Manual smoke (optional, if running the app)**

Have the agent create and update tasks. Confirm: TaskCreate card shows the subject + a
"Created" badge; a TaskUpdate with only status shows the resolved subject + a colored
status badge; a bare TaskUpdate for an unknown task shows `Task #<id>`; the TodoWrite card
shows a count + activeForm + priority; the follower popover shows priority badges and the
in-progress item's title with activeForm beneath.

- [ ] **Step 4: Final commit (empty if nothing to add)**

```bash
git add -A
git commit -m "test(ui): verify richer task cards" --allow-empty
```

---

## Self-Review Notes

- **Spec coverage:** registry+context → Task 1; TodoProgress refactor (no behavior change) → Task 2; TaskCardView + wiring + ChatPanel provider + history resolution → Task 3; TodoWrite count/activeForm/priority → Task 4; follower priority+title → Task 5; verification → Task 6. ✅
- **No placeholders:** all code shown; Task 5's tests defer to the existing test file's harness rather than inventing one — the implementer is told to mirror existing helpers (the one acceptable "match existing pattern" instruction since that harness already exists in-repo). ✅
- **Type consistency:** `TaskInfo`, `buildTaskRegistry`, `extractTaskCreateId`, `TaskRegistryContext`, `TaskFields`, `parseTaskFields`, `TaskCardView({kind,fields,resolved})`, `isTask`/`isTaskCreate`/`isTaskUpdate`, `taskResolved` — consistent across tasks. ✅
- **Priority/ordering:** task branch added before the generic/search branches; `hasBody` updated; search and generic branches guarded with `!isTask`. Tasks have no `pattern` so `search` is already false. ✅
- **Machine constraint:** vitest `--maxWorkers=2`.
