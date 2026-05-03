# Follow Button (Bottom-Right Scroll/Follow Indicator)

**Status**: Draft
**Date**: 2026-05-02
**Scope**: `src/components/Chat/ChatPanel.tsx`

## Goal

Replace the centered "new messages" pill above the composer with a single
bottom-right anchored button that:

1. Indicates whether live follow (auto-scroll-to-bottom) is currently on or off.
2. Shows a small unread indicator when new assistant messages have arrived
   while follow is off.
3. On click, scrolls to bottom and re-engages follow.

One always-needed control with one location, instead of two overlapping
ways to handle "user is scrolled up."

## Behavior

- **Visible** whenever the user is not at the bottom of the chat list
  (`isAtBottomRef.current === false`).
- **Hidden** when at-bottom — follow is on, no UI is needed.
- **Click**: invokes the existing scroll-to-bottom path (`tweenScrollToBottom`),
  sets `isAtBottomRef.current = true`, and clears the unread indicator.
- **Unread indicator**: a small accent-colored dot in the top-right corner of
  the button, set true when an assistant message arrives while the button is
  visible. Cleared on click or when the user scrolls back to the bottom.

## Visual

- Circular button, ~32px diameter, anchored bottom-right of the chat-messages
  area with a 12px inset from each edge.
- Background: `var(--bg-secondary)`. Border: `1px solid var(--border)`. Icon:
  `ChevronDown` (16px) in `var(--accent)`.
- Hover: lighter background, slightly stronger border tint.
- Unread dot: 6px circle, `var(--accent)`, top-right of the button.
- Entry/exit: `flick` spring from the motion vocabulary, animating
  `scale 0.85 → 1`, `opacity 0 → 1`, `y 6 → 0`. Exit reverses.
- Optional brief pulse (CSS keyframe gated on
  `prefers-reduced-motion: no-preference`) when the unread dot first appears.

## State changes in ChatPanel

- `isAtBottomRef` remains the source of truth for scroll handlers (refs
  don't trigger re-renders, which is correct for hot scroll paths).
- Add a `followOn` state mirror that re-renders the button when the value
  changes. Sync `followOn` from `isAtBottomRef` at the boundaries where the
  ref changes today: `onWheel`, `handleScroll` reaching the bottom, the
  `scrollToBottom` click handler, the workspace-active effect, and the
  send/queue paths that re-pin to bottom.
- Replace `showNewMessages` with `unreadCount` (number of new assistant
  messages received while `followOn` is false). Render the dot when
  `unreadCount > 0`. Reset to 0 on click and on scroll-to-bottom.

## Removed

- `new-messages-btn` and `new-messages-anchor` markup
- `.new-messages-btn` and `.new-messages-pulse` CSS, including the
  `new-messages-pulse` keyframe
- The `prevLenRef` + `useEffect` that pulsed the old button on
  message-count increases (replaced by the `unreadCount` state)

## Files

- Modify: `src/components/Chat/ChatPanel.tsx`
- Modify: `tests/unit/components/Chat/ChatPanel.test.tsx`

## Testing

Unit tests in `ChatPanel.test.tsx`:

- Button is not rendered when `followOn` is true (mount with `isActive: true`,
  no scroll events fired — assert no `[data-testid="follow-btn"]`).
- Button renders when `followOn` is false (simulate a scroll-up wheel event,
  assert the button is now in the DOM).
- Unread dot renders when an assistant message arrives while
  `followOn` is false (fire a wheel-up, dispatch an `assistant` message via
  the mock claudeOnMessage handler, assert
  `[data-testid="follow-btn-unread"]` is present).
- Click clears unread state and engages follow (click the button via
  fireEvent, assert dot is gone and follow state mirror is true).

Manual QA:

- Scroll up in a long conversation — button appears bottom-right with a
  springy entry.
- Wait for an assistant message — small accent dot appears on the button.
- Click the button — page scrolls smoothly to bottom, button disappears,
  follow re-engages so subsequent messages auto-scroll into view.
- Toggle OS reduced-motion — entry/exit and pulse become instant; click
  still works and scroll still happens.

## Out of scope

- Changing scroll mechanics (already rAF-tweened).
- Pinned-prompt bar.
- Any other chat surface.
