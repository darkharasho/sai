# Hot-reload the open file when the AI edits it

## Problem

When the AI edits a file the user is viewing in the editor, the change is not
reflected until the existing 5-second mtime poll (`App.tsx:2030-2064`) happens to
notice it. The user expects the editor to update immediately when the AI writes the
file they're looking at.

## Goal

When an AI `Write`/`Edit`/`MultiEdit`/`NotebookEdit` tool finishes editing a file
that is open in an editor tab, refresh that tab's content **instantly** — reusing the
app's existing reload-and-conflict machinery — instead of waiting for the poll.

## Decisions

- **Trigger:** the incoming AI tool stream. The renderer already receives every tool
  call over `claude:message`; when a file-editing tool completes on an open file, react
  immediately. No native filesystem watcher and no new IPC.
- **Conflict:** if the open file has **unsaved edits** (dirty), do not clobber — show the
  existing "file changed on disk" banner (Reload / Keep My Edits), just instantly. Only
  auto-reload when the file is clean.
- **Scope of views:** applies to any open view of the file (editor / diff / markdown
  preview). Non-editable views are never dirty, so they always refresh; dirty conflicts
  only arise in the editable editor view.
- The 5-second poll stays as a fallback for non-AI external edits (git, terminal, etc.).

## Design

### Mechanism note: the raw `claude:message` stream

The renderer's `claude:message` handler receives **raw** Claude CLI messages, not the
app's assembled `ToolCall` objects:

- An **assistant** message carries `msg.message.content` — an array of blocks; a
  `tool_use` block is `{ type:'tool_use', id, name, input }` (with `input.file_path` etc).
- A **tool result** arrives as a **user** message whose `msg.message.content` has
  `tool_result` blocks `{ type:'tool_result', tool_use_id, content, is_error }`
  (`electron/services/claude.ts:344-360, 935-948`).

So an edit's *path* (from `tool_use`) and its *completion* (from `tool_result`) arrive in
separate messages and must be correlated by id.

### Unit 1 — two pure extractors (`src/components/CodePanel/detectFileEdits.ts`)

```ts
export function extractEditToolUses(
  content: unknown,        // an assistant message's content blocks
  projectRoot: string,
): { id: string; path: string }[];

export function successfulToolResultIds(
  content: unknown,        // a user message's content blocks
): string[];
```

- `extractEditToolUses`: for each `tool_use` block whose `name` is `Write`, `Edit`,
  `MultiEdit`, or `NotebookEdit`, read `input.file_path` (or `input.notebook_path`),
  resolve to an **absolute** path (`isAbsolute(p) ? p : join(projectRoot, p)`), and return
  `{ id, path }`. Skip blocks with no path. Non-array `content` → `[]`.
- `successfulToolResultIds`: return the `tool_use_id` of every `tool_result` block where
  `is_error` is not true. Non-array `content` → `[]`.

Both pure and unit-testable. Depend on: a path join/isAbsolute util only (no React).

### Unit 2 — `applyExternalChange(path)` (extracted reload-or-banner action)

The 5-second poll currently inlines the per-file decision (`App.tsx:2035-2062`): read
fresh content/mtime, and **if the file is dirty → add to `externallyModified` (banner);
else → reload content + `savedContent` + `diskMtime`, clear `isDirty`.** Extract that
decision into a single reusable callback on the App component:

```ts
const applyExternalChange = useCallback(async (filePath: string) => { ... }, [deps]);
```

It operates on whatever open file matches `filePath` (any view mode). Both the poll and
the new instant trigger call it, so the reload/conflict behavior lives in exactly one
place. The poll keeps its own mtime comparison and calls `applyExternalChange(path)` only
when it sees a newer mtime; the instant trigger calls it directly (the tool completion
already tells us the file changed, so no mtime comparison is needed there).

### Unit 3 — instant trigger wiring (`App.tsx`)

In the existing `claude:message` handler (`App.tsx:2118`), keep a
`pendingEditsRef = useRef(new Map<string, string>())` (tool_use_id → absolute path):

1. Resolve the project root for `msg.projectPath` (the workspace's path).
2. If `msg.type === 'assistant'`: for each `{id, path}` from
   `extractEditToolUses(msg.message?.content, projectRoot)`, `pendingEditsRef.current.set(id, path)`.
3. If `msg.type === 'user'`: for each `id` from `successfulToolResultIds(msg.message?.content)`,
   look up `pendingEditsRef.current.get(id)`; if present, `delete` it and — **if that path
   matches an open file** in `msg.projectPath`'s workspace — call `applyExternalChange(path)`.

Correlating by id and deleting on completion makes each edit fire exactly once. Edits to
files that aren't open are ignored (the entry is still deleted, so the map doesn't grow).

## Data flow

```
AI assistant message  → extractEditToolUses(content) → pendingEdits[id] = absPath
AI tool_result (user)  → successfulToolResultIds(content) → for each id:
    path = pendingEdits.delete(id)
    if path is an open file → applyExternalChange(absPath)
       ├─ file clean → reload content/savedContent/diskMtime, clear isDirty (hot reload)
       └─ file dirty → add to externallyModified → existing banner (Reload / Keep edits)
```

## Error handling

- The extractors tolerate non-array/missing `content` and unexpected block shapes
  (return `[]` / skip), so a malformed message never throws into the handler.
- `applyExternalChange` reads the file via the existing `fsReadFile`/`fsMtime` IPC; on a
  read failure it leaves state unchanged (no throw to the message handler).
- `is_error` tool_results are excluded, so a failed edit never triggers a reload.

## Testing

New `tests/unit/components/CodePanel/detectFileEdits.test.ts`:
- `extractEditToolUses`:
  - a `Write` tool_use with absolute `file_path` → `{id, path}` unchanged.
  - an `Edit` tool_use with a relative `file_path` → resolved against the project root.
  - a `NotebookEdit` with `notebook_path` → returned.
  - a `Read` tool_use, and a `tool_use` with no path → excluded.
  - multiple edit tool_uses in one content array → all returned with their ids.
  - non-array / missing content → `[]`.
- `successfulToolResultIds`:
  - returns ids of `tool_result` blocks with `is_error` falsy.
  - excludes `is_error: true` blocks.
  - non-array / missing content → `[]`.

The `applyExternalChange` extraction is covered behaviorally by the existing poll (no
behavior change to it). The thin App wiring (id correlation + open-file match) is verified
by the extractor tests plus manual smoke (open a file, have the AI edit it, confirm instant
reload; open a file with unsaved edits, confirm the banner appears instantly).

## Rollout / risk

Low risk, additive. The reload/conflict behavior is unchanged and now centralized; only
the *timing* improves for AI edits. No new dependency, no new IPC, no filesystem watcher.
Worst case (detector misses a tool or a path) degrades to today's 5-second poll.
