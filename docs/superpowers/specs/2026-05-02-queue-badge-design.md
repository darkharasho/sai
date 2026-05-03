# Queued Messages — Toolbar Badge + Popover

**Status**: Draft
**Date**: 2026-05-02
**Scope**: `src/components/Chat/MessageQueue.tsx` (rewrite from row-stack to badge + popover), `src/components/Chat/ChatInput.tsx` (host the badge in the toolbar; new `onQueuePromote` prop), `src/components/Chat/ChatPanel.tsx` (drop standalone MessageQueue row, wire `onQueuePromote`)

## Goal

Replace the standalone vertical stack of queued-message cards above
the chat input with a small accent-gold badge in the chat input's left
toolbar. Hover surfaces nothing (the count is already visible inline);
click opens a popover listing all queued messages with `↑` promote
and `×` remove actions per item.

This frees vertical space, mirrors the just-shipped TodoProgress ring
pattern, and adds the missing "actually run this one first"
interaction we don't have today.

## Behaviour

- **Visibility**: badge appears whenever `queue.length > 0`. When the
  queue is empty, the badge unmounts entirely (no placeholder).
- **Idle display**: small chip with a list icon and the label
  `<n> queued`.
- **Click**: popover opens, anchored above the badge. Click outside
  (document mousedown) closes. Re-clicking the badge also closes.
- **Per-item actions** (hover-revealed, opacity 0 → 1 on item hover):
  - `↑` "Move to next" — moves the item to position 0. Hidden on the
    item already at position 0.
  - `×` "Remove" — drops the item from the queue.
- **Sorting** is insertion-order; promote-to-next is the only manual
  reorder.

### State management

The queue itself is owned by `App.tsx`'s session-level state today and
flows through `ChatPanel` → `ChatInput` props. A new operation
`onQueuePromote(sessionId, id)` is added alongside the existing
`onQueueAdd / onQueueRemove / onQueueShift` callbacks. The reducer
that owns the queue array implements `promote` as
"move the item with `id` to index 0; preserve relative order of the
rest".

## Visual

### Badge

- Inline-flex `<button>` (or `<span>` with role/cursor) — sits in
  `toolbar-left` after the existing `<TodoProgress>` widget.
- Padding `3px 8px 3px 6px`, `border-radius: 5px`, `cursor: pointer`.
- Background `color-mix(in srgb, var(--accent) 6%, transparent)`,
  hover `12%`, popover-open `16%` (matches the visual relationship the
  todo ring uses for its open state).
- Color `var(--accent)`, font-weight 600, font-size 10px.
- Icon: lucide `ListOrdered` (or `Layers` if `ListOrdered` doesn't
  read well at 13px), size 13.
- Label: `<n> queued` — tabular nums for the integer.

### Popover

- Position: bottom-up from the badge (`bottom: calc(100% + 8px)`),
  `left: 0`.
- Width: 360px (slightly wider than todo popover because messages
  benefit from horizontal room).
- Background `var(--bg-secondary)`, border `1px solid var(--border)`,
  border-radius 8px, box-shadow `0 6px 24px rgba(0,0,0,0.4)`,
  z-index 10, color `var(--text)`, `cursor: default`.
- Header row: 6px×12px padding, bottom border. `Queued messages`
  title (semibold, `var(--text)`), `<n>` count right-aligned in
  `var(--text-muted)`.
- List: `max-height: 280px`, `overflow-y: auto`, items at
  `font-size: 12px`, padding `5px 12px 5px 12px`.
- Item layout (left to right):
  - Index (`var(--text-muted)`, font-weight 600, font-size 10px,
    width 14px, tabular nums)
  - Optional attachment icon group (matches today's
    `message-queue-attachments` semantics: terminal / files / images
    glyphs in `var(--accent)` at 60% opacity)
  - Truncated text (`flex: 1`, ellipsis, `var(--text)`)
  - Action buttons (right-aligned, `opacity: 0` → `opacity: 1` on
    `:hover` of the item):
    - `↑` (lucide `ArrowUp`, size 11) — hidden when index === 0.
      Hover: `color: var(--accent)`, faint accent background.
    - `×` (lucide `X`, size 11). Hover: `color: var(--red)`, faint
      red background.

### Animations

- Badge entry/exit (when queue transitions empty ↔ non-empty): framer
  `AnimatePresence` with `flick` spring, scale + opacity.
- Popover entry/exit: framer `AnimatePresence` with `pop` spring,
  scale + small `y` slide. `useReducedMotionTransition(SPRING.pop)`
  so it goes instant for reduced-motion users.
- Item enter/exit when promoted/removed: framer `layout` on each
  list item + AnimatePresence so the reorder slides cleanly. Same
  pattern Task 15 used for the queue chips, just inside the popover
  list now.

## Files

- Modify: `src/components/Chat/MessageQueue.tsx` — rewrite from row
  stack to badge + popover. Accept new `onPromote: (id: string) =>
  void` prop alongside the existing `queue` and `onRemove`.
- Modify: `src/components/Chat/ChatInput.tsx` — accept
  `messageQueue?: QueuedMessage[]`, `onQueueRemove?: (id: string) =>
  void`, and `onQueuePromote?: (id: string) => void`. Render
  `<MessageQueue queue={messageQueue} onRemove={onQueueRemove}
  onPromote={onQueuePromote} />` in `toolbar-left` immediately after
  `<TodoProgress>`. (`messageQueue` and `onQueueRemove` are already
  passed to ChatPanel from App; we just need to thread them through
  to ChatInput here.)
- Modify: `src/components/Chat/ChatPanel.tsx` — drop the standalone
  `<MessageQueue …/>` line in `chat-bottom-strip`; pass
  `messageQueue`, `onQueueRemove`, and `onQueuePromote` to
  `<ChatInput>`. Add a new `onQueuePromote` prop to ChatPanel itself.
- Modify: `src/App.tsx` — add `onQueuePromote(sessionId, id)` handler
  next to `onQueueAdd / onQueueRemove / onQueueShift`. Implement as
  "move the item with `id` to index 0; preserve relative order of
  the rest". Pass through to `<ChatPanel>`.

## Testing

Unit tests (`tests/unit/components/Chat/MessageQueue.test.tsx`,
new file — replaces the existing
`MessageQueue.integration.test.tsx`):

- Renders nothing when queue is empty
- Renders the badge with `<n> queued` when queue has items
- Click opens the popover with all queue items
- Click outside closes the popover
- Promote button is hidden on item at index 0
- Promote button calls `onPromote(id)` for items at index ≥ 1
- Remove button calls `onRemove(id)`
- Items render attachment glyphs when `msg.attachments` is set

Updates to existing tests:

- `ChatPanel.test.tsx`: assert no standalone MessageQueue child of
  the `chat-bottom-strip` (mirrors the negative assertion added for
  TodoProgress in the previous spec).
- `App.test.tsx` (or wherever the queue reducer lives): test the
  promote operation moves the chosen id to index 0.

Manual QA:

- Queue 3 messages while a turn is streaming. Confirm:
  - Badge appears in the toolbar with `3 queued`.
  - Click → popover with the three items in order.
  - Hover item 2 → ↑ and × appear; click ↑ → item 2 jumps to position 1
    with a smooth slide.
  - Click × on any item → it slides out, the remaining items reflow.
  - Empty the queue → badge disappears.
- The standalone vertical stack above the input is gone.

## Out of scope

- Editing queued message text from the popover.
- Drag-to-reorder or bulk reorder.
- Showing the queue inside the composer placeholder.
- Persisting queue across reloads (already exists / unrelated).
- Renaming the file (`MessageQueue.tsx` is fine even though the
  visual is now a badge — the functional name still applies).
