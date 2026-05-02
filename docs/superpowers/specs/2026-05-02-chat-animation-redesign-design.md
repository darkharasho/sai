# Chat Animation Redesign

**Status**: Draft
**Date**: 2026-05-02
**Scope**: `src/components/Chat/` — chat conversation surface only

## Goal

Make the chat panel feel buttery smooth — lively and physical with a cinematic
lean. Motion should make the conversation feel alive without distracting from
content. All animation flows from a single shared vocabulary so the surface
feels like one cohesive system.

Target vibe: things have weight (springs, slight overshoot), reveals get to be
expressive (staggers, layout transitions, per-tool-type signatures), but
nothing slows the user down.

## Out of scope

- Chat history sidebar
- Settings panels
- Provider-switch transitions outside the thinking indicator
- Editor / terminal panes

## Section 1 — Motion vocabulary

A single source of truth in `src/components/Chat/motion.ts`. Every consumer
imports from here; no magic numbers in components.

### Springs (framer-motion)

| Name     | Config                                            | Use                                          |
|----------|---------------------------------------------------|----------------------------------------------|
| `gentle` | `{ stiffness: 220, damping: 28, mass: 0.9 }`      | Ambient enters/exits (queue, pinned, todo, errors) |
| `pop`    | `{ stiffness: 380, damping: 26, mass: 0.7 }`      | Assistant message + tool card entry          |
| `flick`  | `{ stiffness: 520, damping: 32 }`                 | Toggles, hovers, status badge changes        |
| `dock`   | `{ stiffness: 300, damping: 30, mass: 1.0 }`      | Pinned-prompt dock/undock and FLIP           |

### Easings (for non-spring orchestration)

- `out` — `cubic-bezier(0.22, 1, 0.36, 1)` (expo-out)
- `inOut` — `cubic-bezier(0.65, 0, 0.35, 1)`

### Constants

```ts
export const STAGGER = { tight: 30, default: 55, loose: 90 }; // ms
export const DISTANCE = { nudge: 4, slide: 12, lift: 24 };    // px
```

### Reduced motion

`useReducedMotionTransition()` hook returns `{ duration: 0 }` when
`matchMedia('(prefers-reduced-motion: reduce)')` matches, otherwise the
configured spring. CSS keyframes used elsewhere are wrapped in
`@media (prefers-reduced-motion: no-preference)`. Stagger constants resolve
to 0. The FLIP registry short-circuits to no-op. Layout animations on
`LayoutGroup` use `layout="position"` only (no size animation).

## Section 2 — Tech & architecture

**Library**: framer-motion (already a dependency). Prefer declarative
`motion.div` with `initial`/`animate`/`exit`/`layout` over imperative WAAPI.
No new dependencies.

**Shared building blocks** (new files in `src/components/Chat/`):

- `motion.ts` — constants + `useReducedMotionTransition()` hook
- `MotionPresence.tsx` — `AnimatePresence` preconfigured with
  `mode="popLayout"` and our default exit, used wherever transient UI
  mounts/unmounts
- `Stagger.tsx` — applies `staggerChildren` + `delayChildren` from constants

**Where animation lives**:

- *Per-message entry* — inside `ChatMessage.tsx`, so each row owns its own
  enter; clean unmount on `/clear`
- *Tool-card stagger* — inside `ChatMessage` rendering `toolCalls`, wrapped in
  `Stagger`; per-type entrance lives inside `ToolCallCard.tsx` keyed off
  `tool.type`
- *Layout transitions* — `layout` prop on the input area's child stack,
  `LayoutGroup` around the bottom strip so context meter / model picker /
  todo / queue / approval reflow together
- *Pinned prompt dock/undock* — framer's `layoutId` so the prompt visibly
  travels between its in-list slot and the docked bar
- *Streaming text shimmer* — CSS gradient mask on trailing characters,
  driven by a CSS variable updated when new tokens arrive (no React
  re-renders for the effect)

**Tradeoff**: `LayoutGroup` and `layoutId` on the pinned prompt mean
shared layout state between the in-list message and the docked bar. If
either falls out of the tree at the wrong moment, the dock animation
skips. Mitigate by keeping the bar always mounted (zero-height when no
pinned target).

## Section 3 — Bottom-anchored chat list

When a conversation has fewer messages than the viewport can hold, messages
stack from the bottom up — last message sits just above the composer with
empty space above the first message. Once content exceeds the viewport, the
container scrolls naturally and the bottom stays pinned for new messages.

**Implementation** in `.chat-messages`:

- Keep `flex-direction: column` (avoid `column-reverse` — it breaks
  `scrollIntoView`, the IntersectionObserver-based pinned-prompt detection,
  the load-earlier sentinel, and accessibility ordering)
- Inner content wrapper uses `min-height: 100%; display: flex;
  flex-direction: column;` with `margin-top: auto` on the first rendered
  message (or a leading spacer with `flex: 1`). The leading flex space
  collapses once content overflows
- The `chat-load-sentinel` ("Loading earlier messages…") sits above the
  auto-margin so it stays at the top of scrollable content, not floating
  in dead space
- Empty state is unaffected — it already centers via its own `height: 100%`

**Motion implications**:

- The first user message of a fresh conversation rises from the composer
  into a slot just above it — short FLIP travel, satisfying spring landing
- Assistant's first reply lands right above the user message
- As the conversation grows past one screen, bottom-anchor naturally
  transitions to standard top-down scrolling — no special-case code

## Section 4 — Per-surface treatment

### Message entry

- *User message*: existing FLIP retained; retuned from current WAAPI timing
  to the `dock` spring. Travel from composer rect → slot above composer.
- *Assistant message*: `initial: { y: 12, opacity: 0 }` →
  `animate: { y: 0, opacity: 1 }` with `pop` spring. No scale change
  (avoids subpixel text shimmer during settle).
- *System / error messages*: `gentle` spring, `y: 8`. Errors also get a
  brief accent-colored 1px outline pulse (200ms).
- *Streaming text*: trailing-token shimmer — `linear-gradient` mask CSS
  variable on the last ~3 characters of the streaming bubble, updated via
  `setProperty` on each token append (no React re-render for the effect).

### Tool cards (inside assistant message)

- Wrapped in `Stagger` with `STAGGER.default` (55ms)
- Each card: `pop` spring, `y: 10`, `opacity 0→1`. `layout` prop on the
  card so output-expanding height changes animate
- Per-type entrance signature on the icon/header strip only:
  - `file_edit`: header strip wipes left-to-right (clip-path)
  - `terminal_command`: command text types in (~20ms per char, capped at
    400ms total)
  - `web_fetch`: header strip has a one-shot shimmer sweep on mount
  - `file_read` / `other`: plain `pop` entry, no signature
- Status badge (running/done/error): `flick` spring + color crossfade on
  state change

### Thinking indicator (per-provider, more expressive)

- *Enter*: rises from where the composer is (`y: 16`, `opacity 0→1`,
  `pop` spring)
- *Exit*: morph into the first assistant message of the response via
  `layoutId="active-response-anchor"` — the thinking indicator and the
  *first* assistant bubble of the current turn share that id (later
  bubbles in the same turn don't), so framer animates the transition
  rather than cutting
- *Claude*: blink-cursor concept retained; cursor adds a subtle vertical
  breathing (1.0 → 1.08 height, 1.6s loop) while idle-thinking; tightens
  to a steady cursor as text arrives
- *Codex*: shimmer retained; "Working" word gets a slow letter-by-letter
  `y: 0.5px` wave
- *Gemini*: braille spinner + rainbow color cycle retained; hint swaps
  use a `y: 4px, opacity` cross-slide (instead of plain fade)

### Pinned-prompt bar (dock/undock via `layoutId`)

- The user prompt in the list and the docked bar share
  `layoutId={`pinned-${msg.id}`}`
- When the list message scrolls out of view, framer transitions the prompt
  from the in-list slot to the docked bar position (`dock` spring)
- Click "Jump": undock — animates back down to the list slot, then
  `scrollIntoView` finishes the gesture
- Swap between user messages while scrolled: bar content cross-slides
  (`y: 6`, opacity, 180ms `out`) with direction matching scroll direction

### Auxiliary stack (above composer)

All wrapped in a `LayoutGroup` so reflow is animated when one appears
or disappears.

- *MessageQueue chips*: `Stagger` (tight, 30ms) with `gentle` spring.
  Enter from `x: -6, opacity: 0`. Exit reverses
- *TodoProgress*: existing bar's fill goes from linear width transition
  to `gentle` spring on width. Item-state change (pending → in_progress →
  completed) gets a `flick` color crossfade
- *Approval panel*: `pop` spring entry (it demands attention),
  `y: 12, opacity: 0`. Exit on approve/deny/always-allow uses `gentle` +
  slight `y: -4` so resolution feels distinct from a fresh appearance

### Scroll & sentinel

- Auto-scroll-to-bottom: replace `scrollIntoView({ behavior: 'smooth' })`
  with a small rAF tween (~280ms, `out` easing) that follows the streaming
  tail without feeling like it's chasing. Cancellable on user wheel/touch
- "Loading earlier messages" sentinel: when older messages prepend, they
  enter with `gentle` spring at `y: -6` — they slide into the top of the
  list, not pop in

### New-messages button

- Enter: `flick` spring, `y: 6, opacity: 0 → 1`, scale `0.92 → 1`
- Exit reverses
- If new messages arrive while it's visible: brief `flick` scale pulse
  (`1 → 1.04 → 1`, 220ms) on the button — no re-mount

### Empty state

- Keep current fade+scale entrance
- Add a subtle floating loop on the SAI logo (`translateY: 0 → -2px → 0`,
  4s, ease-in-out). Wrapped in `@media (prefers-reduced-motion: no-preference)`

## Section 5 — Testing approach

### Unit tests (Vitest, in `tests/unit/components/Chat/`)

- `motion.test.ts` — exports exist; `useReducedMotionTransition` returns
  `{ duration: 0 }` when reduced-motion matches; spring tokens otherwise.
  Mock `matchMedia`
- `flipRegistry.test.ts` — existing tests still pass with retuned spring
- `ChatPanel.test.tsx` — extend with: bottom-anchor renders trailing space
  when `messages.length === 1`; pinned-prompt `layoutId` stable across
  re-renders for the same message id; `LayoutGroup` wraps the bottom strip
- `ChatMessage.test.tsx` — assistant message has `initial`/`animate`
  motion props; reduced-motion strips them; tool cards wrapped in
  `Stagger`
- `ToolCallCard.test.tsx` — per-type signature renders the correct
  sub-component (`file_edit` wipe, `terminal_command` typed, `web_fetch`
  shimmer, `other` plain)

### Integration / regression

- Existing FLIP integration test stays — checks rect handoff, not timing
- `MessageQueue.integration.test.tsx` — extend to assert chips enter/exit
  through `AnimatePresence` (presence-aware queries, not exact timing)

### Not tested

- Spring physics output (framer's job)
- Visual correctness of staggers, easings, gradient shimmer (human review)

### Manual QA checklist

- [ ] Send first message in a fresh conversation — bottom anchor + FLIP feels right
- [ ] Send while scrolled to top of long history — auto-scroll catches up smoothly
- [ ] Tool-heavy assistant response — staggered tool cards, no jank
- [ ] Trigger an approval mid-response — composer reflow looks intentional
- [ ] Scroll up past 3+ user messages — pinned bar docks/swaps cleanly
- [ ] Click Jump on pinned bar — undock animates back into the list
- [ ] `/clear` mid-conversation — exit animations don't fight each other
- [ ] Toggle OS reduced-motion — everything goes instant
- [ ] Provider switch (Claude → Codex → Gemini) — thinking states behave per-provider
- [ ] Empty state — SAI logo floats subtly; cycling hints cross-fade

### Performance budget

- Target 60fps on a busy assistant turn (thinking + multiple tool cards
  entering)
- Likely stress points: `LayoutGroup` re-layouts and the streaming-tail
  shimmer. Both have escape hatches (drop `layout`, drop the shimmer)
- No new memory leaks from `motion` components

## Open questions

None at draft time.
