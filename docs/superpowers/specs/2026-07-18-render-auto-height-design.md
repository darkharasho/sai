# Render Auto-Height — Design

**Date:** 2026-07-18
**Status:** Approved design, pending implementation plan

## Problem

In-app renders (`sai_render_html` and friends) are often not tall enough and show an inner
scrollbar. Height auto-sizing exists (2026-06-11 fix added a scrollHeight/ResizeObserver
reporter) but has three holes:

1. **`vh`-based mocks can never grow.** The live iframe starts at a hardcoded ~300px; a mock
   using `height: 100vh` reports `scrollHeight == current viewport`, so the reporter believes
   the content fits and the layout stays squashed with inner scrollbars. Model-authored
   full-screen mocks hit this constantly.
2. **The live path ignores the `height` param.** The schema honors `height` only for
   file-backed renders; inline HTML cannot be given a viewport by the model at all
   (`RenderToolCard.tsx` initial height state is hardcoded).
3. **Silent 2000px clamp** on the live card (`RenderToolCard.tsx:163`) — taller content
   scrolls forever. The headless screenshot path allows 4000px, so the screenshot the model
   sees and the card the user sees disagree.

## Decision

The card auto-sizes to the content — no expand/collapse, no scale-to-fit (user decision
2026-07-18). Fix the measurement semantics in both render paths, sharing pure helpers in
`src/render/renderSizing.ts`.

## Design

### 1. `height` is a real, honored parameter everywhere

Semantics change from "viewport height for file-backed renders" to **"initial/minimum
viewport height in px (default 480); the card grows to fit taller content."**

- `RenderEntry` gains `height?: number`.
- Both render paths parse it: `src/render/saiToolDispatcher.ts` (live MCP dispatch) AND
  `entryFromToolCall` in `src/components/Chat/RenderToolCallCard.tsx` (chat-history card).
  Per the two-paths rule, any render-behavior change lands in both.
- `RenderedHtml`'s initial height state = `entry.height ?? 480` (replaces the hardcoded
  default).

This is the `vh` fix: for viewport-relative layouts, "content height" *is* the design
viewport, so the model states it and the card renders it.

### 2. Grow-only height with a divergence guard

New pure function in `src/render/renderSizing.ts`, mirroring `nextRenderWidth`:

```ts
interface HeightSizerState { height: number; lastIncrement: number; repeatCount: number; frozen: boolean }
createHeightSizer(min: number): HeightSizerState
nextRenderHeight(state: HeightSizerState, reported: number): HeightSizerState
```

Rules:
- Grow-only: never below `min` (the initial viewport), never shrinks on a smaller report.
- Reports are clamped to the 4000px cap.
- **Divergence guard:** `100vh` + fixed-height extras creates a feedback loop — each resize
  raises `scrollHeight` by the same delta. Three consecutive equal positive increments →
  `frozen: true`; further growth is ignored. Freezing never shrinks what was already granted.
- Non-finite / ≤0 reports are ignored (state unchanged).

`RenderToolCard.tsx`'s message handler replaces its inline `setHeight(clamp(...))` with the
sizer. The reporter script itself is unchanged.

### 3. Cap raised and aligned: 2000 → 4000 on the live card

Matches the headless capture cap so screenshot and card agree. 4000px is the documented
ceiling in the schema text.

### 4. Headless capture gets the same semantics

`render:captureHtml` (electron/main.ts) accepts `height?: number`:
- The measuring window is created at `clamp(height ?? 480, 80, 4000)` instead of the
  hardcoded 1200.
- Final height remains `max(initial viewport, measured scrollHeight)` clamped to 4000 —
  same grow-only semantics as the live card, minus the guard (one-shot measurement can't
  loop).
- `App.tsx` capture call sites pass `input.height` through; `preload.ts` type updated.

### 5. Schema/description text (`src/lib/saiTools.ts`)

For all render tools with a height param:
> "Initial/minimum viewport height in px (default 480); the card grows to fit taller
> content (max 4000). For full-screen or vh-based layouts, set this to the intended
> viewport height."

Width text unchanged.

## Error handling

- Reporter failure (CSP, script error): card stays at the initial viewport height — with
  the `height` param now honored, that is the model's stated intent rather than 300px.
- Feedback loops: divergence guard freezes growth; never shrinks.
- Oversized reports: clamped to 4000.

## Testing

- **Unit (`tests/unit/renderSizing.test.ts` or alongside existing):** table tests for
  `nextRenderHeight` — grow, no-shrink, min floor, cap, non-finite reports, and the
  divergence case (equal increments → frozen; unequal increments keep growing).
- **Unit (RenderToolCard):** initial height honors `entry.height`; default 480; height
  updates on reporter message; 4000 cap.
- **Unit (dispatcher + entryFromToolCall):** `height` parsed into the entry on both paths.
- **E2E:** extend the existing render specs (`sai-render.spec.ts` /
  `render-tool-call-card.spec.ts`) with a tall flowing mock (card grows past 2000) and a
  `100vh` mock with an explicit `height` (card equals the requested viewport, no inner
  scrollbar).
- Vitest capped at 2 workers per global config.

## Key files

| File | Change |
|---|---|
| `src/render/renderSizing.ts` | add `createHeightSizer` / `nextRenderHeight` |
| `src/render/renderStore.ts` (RenderEntry type home) | `height?: number` |
| `src/render/saiToolDispatcher.ts` | parse `height` |
| `src/components/Chat/RenderToolCallCard.tsx` | parse `height` in `entryFromToolCall` |
| `src/components/Chat/RenderToolCard.tsx` | initial height from entry, sizer in handler, cap 4000 |
| `electron/main.ts` (`render:captureHtml`) | initial viewport from `height`, default 480 |
| `electron/preload.ts` | `renderCaptureHtml` accepts `height` |
| `src/App.tsx` | pass `input.height` at capture call sites |
| `src/lib/saiTools.ts` | schema text |
