# Todo Progress Ring (Toolbar Indicator + Popover)

**Status**: Draft
**Date**: 2026-05-02
**Scope**: `src/components/Chat/TodoProgress.tsx` (rewrite from row-strip to ring widget), `src/components/Chat/ChatInput.tsx` (host the new ring in the toolbar), `src/components/Chat/ChatPanel.tsx` (drop the standalone TodoProgress row, wire props through to ChatInput)

## Goal

Replace the standalone TodoProgress row above the chat input with a small
circular progress ring in the chat input's left toolbar (next to the
existing context ring). Hover shows the current task; click opens a
popover with the full todo list.

The ring frees vertical space and matches the existing ContextRing
pattern, while keeping all the information the strip provided
discoverable on click.

## Behaviour

- **Visibility**: ring appears when there's an active todo list
  (the same `findLatestTodos(messages)` derivation the current
  TodoProgress uses), `isStreaming` is true, the user hasn't dismissed
  it, and not all tasks are complete. When any of those is false, the
  ring is unmounted.
- **Resting display**: small ring + numeric badge `<done>/<total>`.
- **Hover**: tooltip anchored above the ring with `<done>/<total> ·
  <activeTaskLabel>` (`activeTaskLabel` matches today's
  `inProgress.activeForm || inProgress.content`, fallback `Planning…`).
- **Click**: popover opens, anchored above the ring. Click anywhere
  outside (document-level mousedown) closes it. Re-clicking the ring
  also closes it.
- **Dismiss**: a `×` in the popover header dismisses the indicator for
  the current turn (mirrors today's dismiss-state-resets-on-next-turn
  behaviour). After dismiss the ring unmounts immediately.

## Visual

### Ring

- 22×22 SVG, 8px radius circle, 2.5 stroke (matches ContextRing).
- Track in `var(--border)`, fill in `var(--green)` since the existing
  context ring uses orange/red and the green clearly distinguishes "task
  progress" from "context usage".
- `stroke-dashoffset` driven by `done/total` ratio, animated through
  `motion.circle`'s `animate` prop using `SPRING.gentle` from the motion
  vocabulary so the fill grows smoothly as tasks complete.
- Sits in a hover-able wrapper alongside the count text. Wrapper is
  inline-flex with `cursor: pointer`, 4px padding, 5px radius, faint
  green hover background.

### Count text

- Tabular-nums, `font-size: 10px`, `var(--green)`, font-weight 600.

### Tooltip (on hover, no popover open)

- Position: bottom-up from the ring (`bottom: calc(100% + 6px)`).
- `bg: var(--bg-secondary)`, `border: 1px solid var(--border)`, `padding: 4px 8px`,
  `border-radius: 5px`, `font-size: 11px`, `white-space: nowrap`.
- Auto-shows after 200ms hover, hides on leave or when popover opens.

### Popover

- Position: bottom-up from the ring (`bottom: calc(100% + 8px)`).
- 320px wide, `bg: var(--bg-secondary)`, `border: 1px solid var(--border)`,
  `border-radius: 8px`, `box-shadow: 0 6px 24px rgba(0,0,0,0.4)`,
  `z-index: 10`.
- Header: 6px×12px padding, bottom border. `Tasks` title (semibold,
  `var(--text)`), `<done>/<total>` count right-aligned in
  `var(--text-muted)`, dismiss `×` button after the count.
- List: `max-height: 240px`, `overflow-y: auto`, items at `font-size: 12px`.
  Each item:
  - 12px circular status indicator on the left (1.5px border):
    - `done` → green border, faint green fill, white check glyph
    - `active` → green border, faint green fill, pulsing halo
      animation (`@media (prefers-reduced-motion: no-preference)` only)
    - `pending` → muted border, no fill
  - Text in `var(--text)`. Done items get `var(--text-muted)` plus a
    line-through with reduced opacity. Active item gets weight 500.
- Entry/exit: framer-motion `AnimatePresence` with `pop` spring, scale
  + opacity + small `y` slide so it appears anchored to the ring.

### Reduced motion

- Active-item halo pulse wrapped in
  `@media (prefers-reduced-motion: no-preference)`.
- Ring stroke transition uses
  `useReducedMotionTransition(SPRING.gentle)` so it goes instant for
  reduced-motion users.
- Popover entry uses
  `useReducedMotionTransition(SPRING.pop)`.

## Component shape

`TodoProgress.tsx` becomes the small ring + popover widget. It still
takes `messages` and `isStreaming` props, derives `todos` and
`dismissed` state internally exactly like today, and renders nothing
when nothing should show.

The standalone row markup and styles in `TodoProgress.tsx` are removed.
The component returns a small inline-flex element designed to sit
inside `toolbar-left`.

`ChatInput.tsx` accepts new props `messages: ChatMessageType[]` and
`isStreaming: boolean`, renders `<TodoProgress messages={messages}
isStreaming={isStreaming} />` in `toolbar-left` immediately after the
existing `<ContextRing />` slot. Both rings sit alongside each other.

`ChatPanel.tsx` drops the `<TodoProgress …/>` line that currently
renders inside `chat-bottom-strip`, and adds `messages={messages}` and
`isStreaming={isStreaming}` to the existing `<ChatInput …/>` props.

## Files

- Modify: `src/components/Chat/TodoProgress.tsx` — replace strip JSX
  with ring + popover; trim CSS; keep `findLatestTodos` derivation and
  the dismissed/turn-reset logic
- Modify: `src/components/Chat/ChatInput.tsx` — accept and render the
  new TodoProgress in `toolbar-left`; pass through `messages` and
  `isStreaming`
- Modify: `src/components/Chat/ChatPanel.tsx` — drop the standalone
  TodoProgress row; pass `messages` + `isStreaming` to ChatInput

## Testing

Unit tests in `tests/unit/components/Chat/TodoProgress.test.tsx`:

- Renders nothing when there are no todos
- Renders the ring with correct count when todos exist and
  `isStreaming` is true
- Hover (mouseenter) shows the tooltip with the active task label
- Click opens the popover; click outside closes it; click on the ring
  again toggles closed
- Dismiss × in the popover hides the ring entirely (and stays hidden
  even after subsequent renders within the same turn)
- Done/active/pending items render with the correct status classes

Updated `tests/unit/components/Chat/ChatPanel.test.tsx`: assert the
standalone `.todo-progress` strip is no longer rendered (smoke test
that the row is gone).

Manual QA:

- Trigger a real or simulated todo-list response from Claude. Confirm
  the ring appears in the toolbar, fills as tasks complete, animates
  smoothly. Hover for tooltip; click for popover; dismiss; verify
  re-engages on next turn.
- Confirm the chat input vertical space is reclaimed (no empty row
  above when there's no TodoProgress).

## Out of scope

- Changing the data source — `findLatestTodos` stays.
- Changing what counts as a todo turn (still `isStreaming &&
  hasTodos && !dismissed && completed < total`).
- Adding click-to-jump-to-task or any per-item interactions in the
  popover.
- Moving / restyling the ContextRing.
- Renaming the file (`TodoProgress.tsx` is fine for now even though
  the visual is now a ring; the functional name still applies).
