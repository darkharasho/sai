# Design: Chat Message List Refresh ("slightly more chat")

**Date:** 2026-06-05
**Status:** Approved (direction + scope)
**Branch target:** continues on `ui-papery-dash-refresh` (or a fresh branch off it / `main`)
**Related:** builds on `2026-06-05-ui-papery-dash-refresh-design.md` (papery dash). This refresh
**removes** the between-turns dashed divider added there; the in-card dash stays.

## Summary

Make the message list read as a conversation rather than a terminal log — deliberately
*slightly*, by re-homing only the user's message. The user's turn becomes a compact,
right-aligned bubble; the assistant's turn is unchanged (full-width, left-aligned, with
its SaiLogo avatar) so its rich content — code blocks, diffs, tool-call cards, todo
rings — keeps full width. Turn separation shifts from an explicit dashed rule to the
natural asymmetry of a right bubble plus a larger inter-turn gap.

This is a **visual-only** change to message layout. No behavior changes, no changes to
streaming, markdown rendering, attachments, or the user-message FLIP/pin animation.

## Goals

- Differentiate "user said" from "SAI said" at a glance via alignment (right vs left).
- Keep assistant turns full-width so embedded rich content is unaffected.
- Preserve the existing user-message FLIP/pin-to-bar animation exactly.
- Stay themed (bubble uses theme vars; auto-tints across Default/Midnight/Steel).

## Non-Goals

- No assistant-side bubble (rejected: it boxes in wide code/tool content).
- No avatars+names "Slack/Discord" treatment (rejected as direction C).
- No timestamps, read receipts, or consecutive-message grouping (YAGNI).
- No change to system/error message rendering (they keep their current card/treatment).
- No change to the in-card papery dash (ToolCallCard / PlanReviewCard separators stay).

## Decisions (locked with user)

1. **Direction A — asymmetric.** User right bubble; assistant unchanged full-width left.
2. **User bubble = "subtle + tail" (option 1).** Existing input fill (`--bg-input`) with a
   `--border` hairline, chat "tail" corner radius `14px 14px 4px 14px`, the green `>_`
   (Terminal) icon **kept** inside, `max-width: ~76%`, shrink-wrapped to its text.
3. **Drop the between-turns dashed divider** from the chat list. Turn rhythm comes from
   the right-bubble asymmetry + a larger inter-turn gap. The dash remains inside cards.

## Architecture

Small, contained — mostly CSS in one component plus removing one inserted element.

### `src/components/Chat/ChatMessage.tsx`

Restyle the `.chat-msg-user` rule (currently a full-width bordered row):
- `margin-left: auto; width: fit-content; max-width: 76%;` — pushes the bubble to the
  right and shrink-wraps it to its content.
- `border-radius: 14px 14px 4px 14px;` — the chat tail (sharp bottom-right).
- Keep `background: var(--bg-input)`, `border: 1px solid var(--border)`, padding.
- Add a top margin (~18px) to create the inter-turn gap previously supplied by the
  divider. (Exact value tuned during implementation.)

The user branch already renders the green `>_` icon (`Terminal`) inside
`.chat-msg-content`; it stays. `.chat-msg-assistant` and all assistant rendering are
untouched.

### `src/components/Chat/ChatPanel.tsx`

Remove the turn-divider insertion from the `visibleMessages.map(...)` block (the
`turnDivider` element and its `i > 0` guard added in the papery-dash work). The map
returns the message node directly again. The `Fragment` wrapper may stay or be removed;
keeping keys correct is the only requirement.

### `src/styles/globals.css`

Remove the now-unused `.chat-turn-divider` rule. Keep `--divider-dash` and
`.dashed-divider-top` (cards still consume them). `.dashed-rule` may stay as a generic
hairline utility or be removed if unused after this change.

## Hard Constraint: preserve the user-message FLIP/pin animation

User messages participate in a FLIP system (`pinnedLayoutId`, `flipRegistry`, the
`measuring` / `flipping` phases) that animates a prompt up into the pinned-prompt bar
during a turn. The right-bubble restyle must not break this. Specifically:
- The bubble must still register/measure its rect for the FLIP.
- The transition from the right-aligned in-list bubble to the (full-width) pinned bar
  must remain visually acceptable — verify during implementation; if the
  right-alignment makes the FLIP jarring, constrain the change so the animation reads
  cleanly (e.g. keep the pinned-bar treatment as-is and accept the position shift, or
  adjust the bubble's measured origin). No animation behavior is removed.

## Data Flow

None. Presentation-only. No new state, props, IPC. Bubble styling derives from existing
theme vars, so it re-tints on theme switch automatically.

## Testing

- **Unit (`tests/unit/components/Chat/ChatPanel.test.tsx`):** flip the existing
  turn-divider test — a two-turn thread now renders **zero** `.chat-turn-divider`
  (update the assertion `1 → 0`, or remove the test).
- **Unit (`tests/unit/components/Chat/ChatMessage.test.tsx`):** assert a user message
  renders with its `chat-msg-user` hook (and, if a new class/marker is added for the
  bubble, assert that).
- **Manual:** user-right / assistant-left rhythm reads as a conversation across
  Default / Midnight / Steel; **pin a user message mid-turn and confirm the FLIP
  animation is intact**; confirm error/system messages and in-card dashes are unchanged;
  confirm long user messages wrap within `max-width` and short ones shrink-wrap.
- **Full suite** with `--maxWorkers=2`; no regressions.

## Rollout

Single small change. Order: (1) remove the divider insertion + `.chat-turn-divider`
rule, (2) restyle `.chat-msg-user` into the right bubble + inter-turn gap, (3) verify the
FLIP/pin animation, (4) update tests.

## Open Questions

- Exact `max-width` (start 76%), tail radius, and inter-turn gap — tuned visually.
- Whether the FLIP origin needs adjustment for the right-aligned bubble (decided during
  implementation against the live animation).
