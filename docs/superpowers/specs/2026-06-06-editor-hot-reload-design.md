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

### Unit 1 — `detectFileEdits(toolCalls, projectRoot)` (pure, new module)

New file `src/components/CodePanel/detectFileEdits.ts`:

```ts
export function detectFileEdits(
  toolCalls: ToolCall[] | undefined,
  projectRoot: string,
): { id: string; path: string }[];
```

Returns, for each *completed, non-errored* file-editing tool call, its tool-call `id`
and the **absolute** edited path:

- Include tool names `Write`, `Edit`, `MultiEdit`, `NotebookEdit`.
- The call must have a truthy `output` (completed) and that output must not be a tool
  error (reuse the existing `parseToolError` helper from `ToolCallCard`, or a shared copy).
- Parse the call's `input` JSON; take `file_path` (or `notebook_path` for `NotebookEdit`).
- Resolve to absolute: if already absolute, use as-is; else join with `projectRoot`
  (reuse the resolution approach already used by `extractToolPath`/`toolProjectLinkName`
  in `ToolCallCard.tsx`).
- Skip calls with no parsable path. Returns `[]` for undefined/empty input.

Pure, unit-testable. Depends on: `ToolCall` type, `parseToolError`, path join util.

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

In the `claude:message` handler (where incoming assistant messages update state), after
the existing state update:

1. Resolve the active project root for the message's workspace.
2. `const edits = detectFileEdits(message.toolCalls, projectRoot)`.
3. Keep a `processedEditIds` ref (a `Set<string>`). For each `edit` whose `id` is not yet
   processed, mark it processed and — **if `edit.path` matches an open file** in that
   workspace — call `applyExternalChange(edit.path)`.

Dedup by tool-call `id` prevents re-firing as a streaming message re-renders with the
same completed tool call. Edits to files that aren't open are ignored.

## Data flow

```
AI Write/Edit tool completes
  → claude:message (toolCalls carry file_path + output)
  → detectFileEdits() → [{id, absPath}]
  → for each new id matching an open file: applyExternalChange(absPath)
       ├─ file clean → reload content/savedContent/diskMtime, clear isDirty (hot reload)
       └─ file dirty → add to externallyModified → existing banner (Reload / Keep edits)
```

## Error handling

- `detectFileEdits` parses JSON in try/catch; malformed input → that call is skipped.
- `applyExternalChange` reads the file via the existing `fsReadFile`/`fsMtime` IPC; on a
  read failure it leaves state unchanged (no throw to the message handler).
- Tool-error outputs are excluded, so a failed edit never triggers a reload.

## Testing

New `tests/unit/components/CodePanel/detectFileEdits.test.ts`:
- A completed `Write` with `{file_path}` and output → returns `{id, absolutePath}`.
- A completed `Edit` with a relative `file_path` → resolves against the project root.
- `NotebookEdit` with `notebook_path` → returned.
- A `Read` tool, or a `Write` with no `output` (incomplete), or a `Write` whose output is
  a tool error → excluded.
- Multiple edits in one `toolCalls` array → all returned with distinct ids.
- `undefined`/empty toolCalls → `[]`.

The `applyExternalChange` extraction is covered behaviorally by the existing poll (no
behavior change to it). The thin App wiring (dedup + open-file match) is verified by the
detector tests plus manual smoke (open a file, have the AI edit it, confirm instant
reload; open a file with unsaved edits, confirm the banner appears instantly).

## Rollout / risk

Low risk, additive. The reload/conflict behavior is unchanged and now centralized; only
the *timing* improves for AI edits. No new dependency, no new IPC, no filesystem watcher.
Worst case (detector misses a tool or a path) degrades to today's 5-second poll.
