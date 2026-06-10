# Design: Thinking Animation → Reply Morph (SAI provider)

**Date:** 2026-06-05
**Status:** Approved (direction + scope)
**Branch:** `ui-papery-dash-refresh` (rolling UI-refresh branch)

## Summary

The SAI thinking animation currently renders as a single detached banner pinned
*below* the entire message list while a turn streams. With wait-then-reveal
suppressing live text, that banner is often the only thing moving on screen, so it
reads as a static, disconnected status bar.

This pass keeps the animation exactly as the user loves it (the `SaiLogo` chain, the
running clock, the typewriter status words) but changes its **relationship** to the
reply: the thinking row becomes the **head of the forming assistant segment**, and on
completion it **morphs in place** into the revealed text. While the turn keeps going,
a fresh thinking row drops in below for the next segment — think → reveal → think →
reveal, cascading down the chat as the answer builds.

Scope is **SAI provider only**. Gemini and Codex keep today's detached-banner
behavior unchanged (a separate pass).

## Goals

- Make the thinking animation feel connected to the message it produces, not a banner.
- Morph the thinking row in place into the revealed reply: logo settles, clock freezes
  into the duration stamp, status text hands off to the word-by-word reveal.
- Cascade across a multi-segment turn: each segment morphs; a new thinking row drops in
  below while the turn continues; none spawns once the turn ends.
- Tool calls keep their current live behavior, rendered beneath the thinking row.
- Preserve the existing animation visuals and the `wordReveal` reveal engine.

## Non-Goals

- **No change to Gemini/Codex** thinking animations (separate pass). Their detached
  banner path stays exactly as-is.
- **No change to `wordReveal`'s reveal feel** — it is reused as the text-reveal stage of
  the morph; only the orchestration around it is new.
- **No change to tool-call rendering** — tool cards still appear and run live; they
  simply render below the thinking row (the forming segment's head) instead of below a
  detached banner.
- **No new settings UI.** The morph is the standard SAI behavior, gated by the existing
  `saiAnimationEnabled` preference (off → today's behavior / fallback).

## Decisions (locked with user)

1. **Direction:** "morphs into the reply" — the thinking row transforms in place into the
   message; it is not dismissed and replaced.
2. **Signature detail:** the running clock `[mm:ss.t]` **freezes and restyles into the
   segment's `[durationMs]` stamp**. The logo settles from its animated chain to the
   static `chat-msg-sai` avatar. The status text **blurs out** as the reply fades in.
3. **Handoff timing:** **sequential** — status blurs out, then the reply fades in
   word-by-word (not overlapping).
4. **Cascade:** while the turn is still streaming, a **new thinking row spawns below**
   the just-revealed segment, with a fade+slide entrance. Turn ends → last segment
   morphs, **no** new row.
5. **Tool calls:** cards render **live beneath** the thinking row. The thinking row stays
   **pinned above** its tools for the whole segment (option 1), so the in-place morph is
   consistent for every segment — including tool-bearing ones.
6. **Scope:** SAI provider only; Gemini/Codex unchanged.

## Background: how a turn maps to the model

These facts (verified in `ChatPanel.tsx` / `ChatMessage.tsx`) make the design clean:

- A turn is a sequence of **assistant messages ("segments")**. Each segment may carry
  preamble **text** and **tool calls**; tool cards render below the text.
- Only the **last** assistant message is "streaming"
  (`isStreaming={isStreaming && msg.id === lastAssistantId && !streamSettled}`). Earlier
  segments already reveal their text the moment the next segment is pushed. The cascade
  therefore already exists in the data — today it is invisible because the only moving
  element is the one bottom banner.
- Each assistant text segment already gets its **own `durationMs`** stamp, so the
  clock→duration morph has a real per-segment value to land on.
- Today the banner renders detached, below the list:
  `showThinking = isStreaming && !awaitingQuestion`.

So the redesign is: **relocate the banner to the head of the forming segment, and add
the morph.**

## Architecture

### Where the thinking row renders

The detached `showThinking` banner is replaced (for the SAI provider) by two render
sites; never both, and never as a bottom banner:

1. **Attached (the common case).** When a streaming assistant segment exists (the last
   assistant message, `isAssistantStreaming`), its hidden-text slot — the place
   `chat-msg-content` would render text — instead renders the thinking row, at the top of
   the segment. Tool cards render live beneath it, unchanged.

2. **Pending.** When the turn is running but no assistant segment exists yet for the
   in-progress output (just after send, or between segments before the next message is
   created), a standalone thinking row sits at the tail. This is the only remaining
   "tail" render and it replaces the old banner.

When the first assistant segment is created, the **pending** row becomes the
**attached** head of that segment — a continuation, not a morph (there is no text yet to
reveal; the morph only happens when a segment *completes*). Ideally the same row element
carries over so the logo/clock do not restart; at minimum the visual state is continuous.

Non-SAI providers (`aiProvider` gemini/codex) keep the existing detached-banner path
verbatim.

### The morph (fires when a segment stops streaming)

A segment morphs when it is no longer `lastAssistantId` (next segment pushed) or the turn
ends. On the same row, in place:

- **Logo:** animated `SaiLogo` (chain mode) → static `chat-msg-sai` avatar, with a small
  settle (scale 1.12 → 1).
- **Clock → duration:** the running `[mm:ss.t]` freezes at its last value and restyles
  into the muted `[durationMs]` stamp (reusing the segment's existing `durationMs`).
- **Status → words:** the status line blurs+fades out (~250ms); then the segment text
  fades in word-by-word via the existing `wordReveal` engine (sequential handoff).

### New-segment entrance

The next thinking row (attached head of the new segment, or a pending row) enters with a
fade + 8px upward slide (~420ms, the entrance shown in the mockups). Reduced motion:
no slide.

### Reduced motion / history

No morph. The text appears via the existing reduced-motion / history-instant fallbacks
already in `wordReveal` and the reveal design. The thinking row, when shown, is static
(no chain animation) per the existing `saiAnimationEnabled === false` path.

## Components touched

- **`src/components/Chat/ChatPanel.tsx`**
  - Remove the detached SAI `showThinking` banner; render the **pending** thinking row at
    the tail for the SAI provider. Keep the Gemini/Codex banner path.
  - Continue wiring `isStreaming` per message (unchanged).

- **`src/components/Chat/ChatMessage.tsx`**
  - When an assistant segment is streaming (SAI provider), render the thinking row in the
    content slot instead of the empty hidden-text branch.
  - On stream-end, orchestrate the morph (settle logo + freeze clock) and invoke the
    existing `wordReveal` for the text.

- **`src/components/ThinkingAnimation.tsx`**
  - Expose a morph/settle end-state: stop the chain on the static avatar and freeze the
    clock at a provided final value, so the row can hand off rather than unmount.
  - Keep all current visuals and the `saiAnimationEnabled` fallback.

- **`src/components/Chat/wordReveal.ts`**
  - Reused as-is for the text reveal. The morph orchestrates timing around it; no change
    to its feel.

## Testing

- **Morph fires on segment completion:** a streaming SAI segment that completes settles
  its logo, freezes the clock to `[durationMs]`, and reveals its text via `wordReveal`.
- **Cascade:** in a multi-segment turn, each segment morphs and a new thinking row
  appears for the next; after the final segment no thinking row remains.
- **Tool segment:** the thinking row renders above live tool cards and morphs in place on
  completion (row stays above its tools).
- **Pending state:** a thinking row shows at the tail when the turn is running but no
  assistant segment exists yet.
- **Provider scope:** Gemini/Codex still render the detached banner; no morph.
- **Reduced motion:** no morph; text appears instantly; no slide entrance.
- **Pref off (`saiAnimationEnabled === false`):** today's static fallback, no morph.
