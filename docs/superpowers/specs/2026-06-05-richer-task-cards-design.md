# Richer task cards (TaskCreate / TaskUpdate / TodoWrite)

## Problem

Task tool cards carry little information:

- **TaskUpdate** has no dedicated card. It falls through the generic `key: value`
  fallback in `formatInput`, so a card shows roughly `taskId: 1` / `status: completed`
  — not even *which* task changed, because the subject lives in the earlier
  `TaskCreate` call, not in the update.
- **TaskCreate** similarly renders as flat `key: value` text.
- **TodoWrite** (`TodoListView`) shows only a status glyph + `content` per item —
  no progress count, no `activeForm`, no priority.

## Goal

Give task cards a structured, readable view. For `TaskUpdate`, resolve the task's
subject from conversation history so the card shows which task changed and its new
status. Enrich `TaskCreate` and the `TodoWrite` list similarly.

## Decisions

- **Resolve subject from history** for `TaskUpdate` (replay `TaskCreate`/`TaskUpdate`
  calls across the whole conversation), reusing the replay logic that already exists
  in `TodoProgress`.
- **Show the target status only** on `TaskUpdate` (the status the update sets), not a
  before→after transition. Computing the prior status needs per-call replay state and
  is not worth the complexity.
- **TodoWrite extras:** header progress count (`done/total`), `activeForm` shown for the
  in-progress item, and a small priority badge when present.

## Scope

In scope: `TaskCreate`, `TaskUpdate`, and `TodoWrite` cards; a shared task-registry
module; a registry context provided in `ChatPanel`; and a light enrichment of the
`TodoProgress` follower popover (the ring + popover in the input toolbar,
`ChatInput.tsx:953`).

Out of scope (unchanged): all other tool cards (Bash/Read/Write/Edit/Grep-Glob/markdown);
the `TodoProgress` ring itself (count, progress arc, dismiss, open/close, visibility
gating); the remote (`src/renderer-remote`) and mobile surfaces.

## Design

### Unit 1 — `src/components/Chat/taskRegistry.ts` (pure)

```ts
export interface TaskInfo {
  id: string;
  subject: string;
  description?: string;
  activeForm?: string;
  status: 'pending' | 'in_progress' | 'completed';
  owner?: string;
}
export function buildTaskRegistry(messages: ChatMessage[]): Map<string, TaskInfo>;
export function extractTaskCreateId(output: string | undefined, fallback: string): string;
```

`buildTaskRegistry` replays the conversation in order: for each assistant message's
`TaskCreate` call it adds `{ id, subject = input.subject || input.description || 'Task',
description, activeForm, status: 'pending', owner }` (id via `extractTaskCreateId`,
matching today's behavior — parse `Task #N created…` from output, else a sequence
counter). For each `TaskUpdate` it applies `status` (incl. `deleted` → remove),
`subject`, `description`, `activeForm`, `owner` to the existing entry.

This is the same logic currently inlined in `TodoProgress.findLatestTodos`'s
TaskCreate/TaskUpdate branch. Extract it here; `TodoProgress` imports
`buildTaskRegistry`/`extractTaskCreateId` and keeps its existing TodoWrite-legacy path
and its `Todo[]` return shape (it can map registry values to its local `Todo` shape).
No behavior change to `TodoProgress`.

What it does: turn message history into a task-id → task-info map. Depends on: the
`ChatMessage`/`ToolCall` types only.

### Unit 2 — `TaskRegistryContext`

`src/components/Chat/taskRegistry.ts` also exports:

```ts
export const TaskRegistryContext = React.createContext<Map<string, TaskInfo>>(new Map());
```

`ChatPanel` builds the registry with `useMemo(() => buildTaskRegistry(messages), [messages])`
and wraps the messages list (the `visibleMessages.map(...)` region around
`ChatPanel.tsx:1835`) in `<TaskRegistryContext.Provider value={registry}>`. The default
empty map means `ToolCallCard` works without a provider (tests, other surfaces).

### Unit 3 — `TaskCardView` (presentational, in `ToolCallCard.tsx`)

```tsx
function TaskCardView({ kind, fields, resolved }: {
  kind: 'create' | 'update';
  fields: { taskId?: string; subject?: string; description?: string; activeForm?: string;
            status?: string; owner?: string; addBlocks?: string[]; addBlockedBy?: string[] };
  resolved?: TaskInfo;
}): JSX.Element
```

Renders:
- **Title:** `fields.subject` ?? `resolved?.subject` ?? `Task #${fields.taskId ?? '?'}`.
- **Status badge:** for `create`, label "created" (neutral/green); for `update`, the
  `fields.status` value color-coded — `pending` (muted), `in_progress` (orange/accent),
  `completed` (green), `deleted` (red). If `update` has no `status`, show an "updated"
  neutral badge.
- **Description** (if present): `fields.description` ?? (for update with no own desc)
  `resolved?.description`, in muted body text.
- **activeForm chip** (if present): `fields.activeForm` ?? `resolved?.activeForm`.
- **owner** (if present), and **blocks/blockedBy** counts when `addBlocks`/`addBlockedBy`
  are non-empty (e.g. "blocks 2", "blocked by 1").

Pure/presentational — `resolved` is passed in by `ToolCallCard`, so this component is
testable without context.

### Unit 4 — wiring in `ToolCallCard`

- Add to `nameToIcon`: `TaskCreate: ListTodo` (already imported) and
  `TaskUpdate: ListChecks` (add `ListChecks` to the lucide import — distinct from the
  plan-mode `ClipboardList`/`ClipboardCheck` icons already in use).
- Compute `const isTaskCreate = toolCall.name === 'TaskCreate';`
  `const isTaskUpdate = toolCall.name === 'TaskUpdate';` and `const isTask = isTaskCreate || isTaskUpdate;`.
- Parse the call's input once for task fields (taskId/subject/description/activeForm/
  status/owner/addBlocks/addBlockedBy). For `TaskUpdate`, read
  `useContext(TaskRegistryContext)` and `resolved = registry.get(String(taskId))`.
- `hasBody`: true for task cards (`isTask ? true : …`).
- In the body branch ordering, render `TaskCardView` for task cards (before the generic
  `code` branch), analogous to how `isTodo`/`isAskUserQuestion` are handled. Guard the
  generic branch with `!isTask` like the existing `!isBash && !isTodo && …` chain.
- The card header still shows the tool name ("Task Create"/"Task Update" via the existing
  `humanizeToolName`) and status badge as today.

### Unit 5 — `TodoListView` enhancement (in `ToolCallCard.tsx`)

- Add a header row: `done/total` count (e.g. `2/5`).
- For an `in_progress` item, render `todo.activeForm || todo.content` (today it always
  uses `content`).
- When `todo.priority` is present, render a small priority badge after the content.

### Unit 6 — `TodoProgress` follower popover enrichment

Per the chosen scope ("priority plus title"), the follower's popover list
(`TodoProgress.tsx`, the `todos.map(...)` at ~line 210) gains:
- A small **priority badge** after the item text when `todo.priority` is present.
  (Priority comes from legacy `TodoWrite` items; `Task`-sourced items have none and
  render no badge.)
- The **title** is always the task's `content` (subject). Today the in-progress item
  shows `activeForm || content`, which can hide the actual title behind the gerund
  ("Running tests" instead of "Run the test suite"). Change the active item to show the
  **title (`content`)** as the primary text, with `activeForm` rendered as a secondary
  muted line beneath it when present and different from `content`. Non-active items keep
  showing `content`.

No description is added. The ring, count, progress arc, dismiss, open/close, and
visibility gating are unchanged.

## Data flow

`messages` → `buildTaskRegistry` (in `ChatPanel`, memoized) → `TaskRegistryContext` →
`ToolCallCard` reads it for `TaskUpdate` → `TaskCardView` renders call fields + resolved
subject. `TaskCreate` needs no resolution (subject is in its own input). `TodoWrite`
renders from its own `{ todos: [...] }` input.

## Error handling

- `buildTaskRegistry` ignores malformed JSON inputs (try/catch per call), like today.
- Unresolved `TaskUpdate` (no matching create, e.g. truncated history) → title falls back
  to `Task #<id>`; never throws.
- Missing context provider → default empty map → same fallback.

## Testing

New `tests/unit/components/Chat/taskRegistry.test.ts`:
- A `TaskCreate` then `TaskUpdate` (status only) → registry entry keeps the subject from
  create and the status from update.
- `TaskUpdate` with `subject`/`activeForm` overrides them.
- `status: 'deleted'` removes the entry.
- `TaskUpdate` for an unknown id → no entry created (ignored).
- id extraction: `output: 'Task #3 created successfully: …'` → id `'3'`; no output → sequence fallback.
- Malformed JSON input → skipped, no throw.

New `ToolCallCard.test.tsx` cases:
- `TaskCreate` card shows the subject as title and a "created" badge; description renders.
- `TaskUpdate` card with only `{ taskId, status: 'completed' }` and a registry context
  providing that id's subject → renders the subject as title and a "completed" badge
  (use `TaskRegistryContext.Provider` in the test).
- `TaskUpdate` with no matching registry entry → title falls back to `Task #<id>`, no crash.
- `TodoWrite` card shows a `done/total` count and renders `activeForm` for an in-progress item.
- Regression: a Grep card still renders search results (task wiring didn't disturb it).

`TodoProgress.test.tsx`: existing tests must still pass after the registry refactor.
Add cases:
- A popover item whose todo has a `priority` renders a priority badge; one without
  renders none.
- The in-progress item shows its `content` (title) as primary text, with `activeForm`
  as a secondary line when it differs from `content`.

Run with `vitest --maxWorkers=2`.

## Rollout / risk

Low risk, additive. The `TodoProgress` refactor is the only change to existing behavior
and is covered by its existing test suite. Task cards are new rendering paths gated on
exact tool names; everything else is untouched.
