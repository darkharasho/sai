# Overlay Tool Detail — Design

**Date:** 2026-06-11
**Status:** Approved

## Goal

Overlay tool cards today show only the bare tool name plus a running/done dot — no hint
of what the action is doing. Add a one-line, inline detail derived from the tool input
("Bash · npm test", "Edit · …/Chat/ChatPanel.tsx"), reusing the chat's tool-summary
vocabulary instead of inventing a new one.

Decisions from brainstorming: detail renders inline on the same row (the overlay window
is a fixed 380×230 — one line per tool); the redundant "running"/"done" status word is
dropped (the dot color — pulsing gold vs static green — already carries state).

## 1. `toolCallDetail` helper (new `src/lib/toolCallDetail.ts`)

Pure function: `toolCallDetail(tc: Pick<ToolCall, 'name' | 'type' | 'input'>): string | null`.

- Parses `tc.input` as JSON; tolerant of partial/invalid input (streaming) → returns null.
- Per tool:
  - `Bash` → first line of `command`
  - `Edit` / `Write` / `Read` / `NotebookEdit` → `file_path`, shortened from the LEFT
    (`…/Chat/ChatPanel.tsx`) so the basename survives
  - `Grep` / `Glob` → `pattern`
  - `WebFetch` → URL host; `WebSearch` → `query`
  - `Task` / `Agent` → `description`
  - `Skill` → `skill` name
  - `mcp__*` names → first string-valued input property
  - anything else → null
- Output capped (~80 chars) at a word boundary via the existing
  `truncateSnippet` (`src/lib/overlayFeed.ts`).
- Extracted as a standalone pure module (NOT a refactor of `ToolCallCard.tsx`'s
  `formatInput`, which stays as the chat's richer formatter — this helper is the shared
  plain-text vocabulary; ToolCallCard adoption can follow later if wanted).

## 2. Tail item + overlay rendering

- `OverlayTailItem` tool variant (`src/lib/overlayFeed.ts:15-19`) gains
  `detail?: string`.
- The overlay tail builder in `src/App.tsx` (`tailFor`, ~line 4724) attaches
  `detail: toolCallDetail(tc) ?? undefined`.
- `src/components/Overlay/OverlayView.tsx` (tool branch, ~line 156): render the detail
  in a muted span after the name; remove the status word span.
  - Name: `flex: 0 0 auto` (no longer flexes).
  - Detail (`overlay-tool-detail`): `flex: 1`, ellipsis truncation, muted color,
    same 11px monospace.
  - Dot unchanged.

## 3. Error handling

- Missing/unparseable input → no detail; the card looks exactly like today minus the
  status word.
- Long details are double-capped: helper caps at ~80 chars; CSS ellipsis handles the rest.

## 4. Testing

- Unit tests for `toolCallDetail`: each tool mapping, left-shortened paths, multi-line
  Bash commands, malformed/empty input, MCP fallback, cap length.
- Existing overlay/overlayFeed tests untouched.
- Manual: overlay window requires an app restart to pick up renderer changes.
