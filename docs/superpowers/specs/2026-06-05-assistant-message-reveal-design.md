# Design: Assistant Message Reveal (replace typewriter + de-jitter entrance)

**Date:** 2026-06-05
**Status:** Approved (direction + scope)
**Branch:** `ui-papery-dash-refresh` (rolling UI-refresh branch)

## Revision (2026-06-05, post-implementation): wait-then-reveal for ALL replies

The original design below revealed only *complete arrivals* and kept the live token
append for streamed replies. The user revised this: **remove the live token append
entirely — every assistant reply presents through the fake-stream reveal.** Concretely:

- **No live append.** While an assistant reply is generating (`isAssistantStreaming`),
  it displays nothing; the existing thinking animation (which stays visible the whole
  turn — `showThinking = isStreaming`) represents the in-progress reply. No blank gap.
- **Reveal on completion.** When the reply finishes (`isAssistantStreaming` → false), it
  fake-streams in via `wordReveal` (calm fade entrance + crisp word-snap + caret).
- **Trigger flips from exclude → include.** `STREAMED_MESSAGES` (now: streamed-this-
  session) is used to *include*: a reply that streamed this session reveals on
  completion, with **no freshness time limit** (long generations still reveal). A
  complete-arrival reply (never streamed) reveals via the timestamp-freshness fallback.
  **History** — loaded on chat reopen, never streamed this session, old timestamp —
  still renders instantly.
- Reduced-motion, history-instant, the engine, and the calm fade are all unchanged.

The sections below are the original design; where they say "live streaming is unchanged
/ raw append", read the revision above instead.

## Summary

Replace the jarring assistant-message entrance and the unreliable "Typewriter
streaming" setting with a single, reliable reveal. New assistant replies that arrive
complete get a crisp **word-by-word reveal** — words snap in left-to-right (≈70ms each)
at a ≈52ms cadence with a traveling amber caret, over a **pre-laid-out** layout so there
is **zero reflow**. The bouncy entrance spring is replaced with a calm fade. Live token
streaming is unchanged (raw append, which the user likes). History renders instantly.

## Goals

- Kill the jarring entrance "pop" (the underdamped `SPRING.pop` overshoot) for assistant
  messages.
- Remove the flaky `typewriterEnabled` ("Typewriter streaming") setting and its drip
  implementation entirely.
- Give complete assistant replies a reliable, reflow-free "streaming" feel (crisp
  word-snap + caret), the look validated in brainstorming.

## Non-Goals

- No change to **live token streaming** (a reply streaming from the model keeps today's
  raw append — the no-reflow reveal can't drive a stream because it needs the full text
  to pre-compute layout).
- No reveal on **history loads / chat reopen** (renders instantly — no mass animation).
- No change to user or system message entrances (user bubble + FLIP shipped separately).
- No new settings UI (the reveal is the standard behavior, not a toggle).

## Decisions (locked with user)

1. **Feel:** crisp word snap (≈70ms per word) + ≈52ms cadence + traveling amber caret,
   pre-laid-out (no reflow). (Brainstorm option "crisp snap + caret".)
2. **Trigger:** only **new replies that arrive complete in one shot** in the current
   session. Live streams keep raw append; history renders instantly.
3. **Remove** the "Typewriter streaming" setting and its drip code.
4. **Entrance:** assistant container entrance changes from `SPRING.pop` to a calm fade
   (opacity only, no slide, no overshoot); the word reveal carries the motion.
5. **Approach:** word-level reveal over the rendered markdown, with **atomic blocks**
   (code blocks, tables, images) revealed as whole units; **documented fallback** to a
   block-level reveal if word wrapping fights complex markdown. Reduced-motion → instant.

## Architecture

### New unit: `src/components/Chat/wordReveal.ts`

A self-contained, imperative reveal engine. One responsibility: animate the first
appearance of a finished message's DOM.

- **Interface:** `revealWords(container: HTMLElement, opts?: { cadenceMs?; snapMs?; budgetMs?; maxWords? }): { cancel(): void }`.
- **Behavior:**
  - Walk the container's text nodes; wrap each whitespace-delimited word in a
    `<span class="rv-word">` at `opacity: 0` (CSS transition `opacity <snapMs> linear`).
    Do not descend into atomic blocks: `pre`, `code` (block), `table`, `img`,
    and any element marked atomic — these are revealed as a single unit at their position
    in the sequence.
  - Because all words are wrapped before any reveal, layout is final → **no reflow**.
  - Sequence: reveal items in document order, setting `opacity: 1` and moving a single
    caret element (amber `▋`) to sit after the most-recently revealed item; remove the
    caret when done.
  - **Duration budget:** effective cadence = `min(cadenceMs(=52), budgetMs(=~1200) / itemCount)` so long replies stay snappy. If `itemCount > maxWords` (hard cap, e.g. 600), skip animation and render instantly.
  - `cancel()` stops timers and forces the final visible state (all `opacity: 1`, caret
    removed) — used on unmount / if content changes.
- **Fallback mode (documented):** if word wrapping proves unsafe for some markdown, an
  option reveals only top-level block children in sequence (each faded in) with the
  caret — coarser but robust. The primary path is word-level.

### `src/components/Chat/ChatMessage.tsx`

- **Remove** the typewriter machinery: `typewriterPref`/`typewriterEnabled` state and the
  `sai-pref-typewriter` listener, `TYPEWRITER_PROGRESS`, `displayLen`, `tickTimerRef`,
  `lastSeenContentLenRef`, `snapToWordBoundary`, and the typewriter `useEffect`(s). The
  assistant body renders full markdown directly once not streaming.
- **Add** a ref on the rendered markdown and a `useLayoutEffect` that calls
  `revealWords(ref)` **exactly once** when ALL of: `message.role === 'assistant'`, not
  streaming (`!isAssistantStreaming`), `message.content` non-empty, reduced-motion off,
  the message **did not stream this session** (a module `STREAMED_MESSAGES` set records
  any id seen with `isAssistantStreaming === true`), and the message is **fresh**
  (`Date.now() - message.timestamp < ~8s`, which excludes history/reopened chats —
  `SEEN_MESSAGES` alone can't, since history is also "first seen"). Guard with a ref flag
  so it never re-runs. (A token-streamed reply is in `STREAMED_MESSAGES`, so its
  post-stream re-render never reveals — append already showed it.)
- **Entrance:** for assistant messages, replace the `SPRING.pop` entry transition with a
  calm fade (opacity 0→1, ≈180ms ease-out, no `y`). User/system entrances unchanged.

### `src/components/Chat/motion.ts`

- Add the calm assistant-entrance transition (e.g. `FADE_IN = { duration: 0.18, ease: EASING.out }`) or an equivalent non-overshoot value; keep existing springs for other callers.

### `src/components/SettingsModal.tsx`

- Delete the "Typewriter streaming" settings row, its `typewriterEnabled` state, the
  `settingsGet`/`settingsSet('typewriterEnabled', …)` calls, the remote-sync line, the
  `handleTypewriterEnabledChange` handler, and the `sai-pref-typewriter` broadcast.

## Data Flow

None new. The change **removes** the `typewriterEnabled` preference and the
`sai-pref-typewriter` event. The reveal is presentation-only, driven by a layout effect
on first paint of a complete assistant message. No IPC/state/props added.

## Reduced Motion

Under `prefers-reduced-motion: reduce`, the reveal is skipped entirely (content renders
instantly) and no caret animates. The existing reduced-motion gating pattern is reused.

## Testing

- **`tests/unit/components/Chat/wordReveal.test.ts`** (jsdom + fake timers): a container
  with a paragraph + a link + a code block → prose words get `.rv-word` spans while the
  code block stays atomic; after advancing all timers every item is visible and the caret
  is removed; with a large synthetic word count the effective cadence shrinks (budget),
  and beyond `maxWords` it renders instantly without wrapping.
- **`tests/unit/components/Chat/ChatMessage.test.tsx`**: remove typewriter-specific
  assertions; a new **complete** assistant message triggers the reveal (assert `.rv-word`
  spans appear in the body); a **streaming** message and a reduced-motion render show no
  reveal (instant); rendering is otherwise unchanged.
- **SettingsModal**: if a settings test exists, assert the "Typewriter streaming" row is
  gone; otherwise verify by build + manual.
- **Full suite** (`--maxWorkers=2`): no regressions.
- **Manual:** a short/fast reply crisp-reveals with the caret and no reflow; a long
  streamed reply appends as before with a calm (non-bouncy) entrance; reopening an old
  chat renders instantly; reduced-motion renders instantly; the setting is gone from
  Settings.

## Rollout

Order: (1) remove the typewriter setting + drip code (pure deletion, verify nothing
breaks), (2) add `wordReveal.ts` with tests, (3) wire it into `ChatMessage` + swap the
assistant entrance to the calm fade, (4) verify manually (incl. reduced-motion) and run
the full suite.

## Open Questions

- Exact cadence/snap/budget values (start 52ms / 70ms / ~1200ms) — tuned visually.
- Whether the caret keeps a brief blink at the end or vanishes immediately (default:
  vanish when the reveal completes).
- The `maxWords` instant-render cap value (start ~600) — tuned against real replies.
