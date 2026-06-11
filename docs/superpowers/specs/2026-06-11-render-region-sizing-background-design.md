# Render Region Natural-Width Sizing + Themed Background — Design

**Date:** 2026-06-11
**Status:** Approved

## Goal

Two defects in the in-app render system (`render_html` / `render_chart` / `render_diff` /
`render_form` mocks):

1. **White canvas.** Inline mocks render in a sandboxed `<iframe srcDoc>` whose body has
   no background; the iframe backdrop paints opaque white, covering the themed wrapper
   behind it. The `background` tool param only colors that hidden wrapper, so it appears
   to do nothing.
2. **Fixed-width clipping / double scrollbars.** The render region is hard-pinned to the
   `width` param (`RenderToolCard.tsx` `RenderRegion`, inline `width: entry.width`).
   Content wider than that scrolls inside the iframe — on top of any scrollbars the
   content itself has. Nothing measures the mock's natural width.

Decisions made during brainstorming:
- **Grow-only sizing**: `width` becomes the initial/minimum viewport; the region grows to
  the content's natural width, clamped to the message column. No shrink-to-fit (block
  content never reports a scrollWidth below the viewport without max-content tricks that
  break fluid layouts).
- **Background = explicit param, else inherit theme**: when `background` is omitted, the
  iframe body is painted with the resolved themed surface so the mock sits seamlessly on
  the app canvas.
- **Scope**: sizing + background only. Real-component mounting (registry expansion,
  headless mounts) is a separate future project.

## 1. Size reporter (`src/components/Chat/RenderToolCard.tsx`)

The injected `HEIGHT_REPORTER` script becomes a size reporter: it posts
`{ __saiRender: 1, height, width }` where
`width = Math.ceil(max(documentElement.scrollWidth, body ? body.scrollWidth : 0))`.

Parent (`RenderedHtml` / `RenderRegion`):
- Height behavior unchanged (state, 40–2000 clamp).
- New grow-only width: `displayWidth = max(entry.width, reportedWidth)`, held as state
  that only increases. Applied to the region div as `width: displayWidth` with
  `maxWidth: '100%'` so the message column remains the hard cap. The iframe stays
  `width: 100%`.
- The grow-only clamp lives in a small pure helper (exported for tests):
  `nextRenderWidth(current: number, reported: number, min: number): number`.

Convergence: widening the viewport can only lower (or equal) the next reported
scrollWidth, so the measure→widen loop settles in one or two reports. A mock whose
scripts never run never reports and stays at `entry.width` — identical to today.

## 2. Iframe background (same file, same `srcDoc`)

The composed doc's `<body>` gains an explicit background:
- `entry.background` when provided;
- otherwise the concrete color resolved from the wrapper at mount via
  `getComputedStyle` (resolves `var(--sai-surface, #1a1a1a)` to an actual color).

Explicit paint is required — the iframe backdrop is opaque white regardless of CSS
transparency, so "transparent → inherit" is implemented by painting the inherited color
into the body. The injected value is sanitized (reject `"` / `;` / `<` etc. beyond a
conservative CSS-color character set) before interpolation into the style attribute.
The wrapper div keeps its current default, making region and canvas the same seamless
surface. Theme changes while a mock is mounted do not repaint it (remount does).

`render_form` uses the same `RenderedHtml` path and gets both fixes for free.

## 3. Headless capture path (`electron/main.ts` `render:captureHtml`)

Mirrors both changes so screenshots match the in-chat result:
- Accepts `background?: string` (same sanitization) and injects it into the capture
  doc's body style; default remains the resolved themed surface passed by the caller
  (the renderer resolves it — main has no access to renderer CSS vars), falling back
  to `#1a1a1a`.
- After load, measures `scrollWidth` and widens the hidden window grow-only (existing
  80–2000 width clamp) before the height measure + `capturePage` it already does.

Plumbing: `electron/preload.ts` `renderCaptureHtml` type gains `background`;
`src/App.tsx` capture deps pass `req.input.background` through (both the
`render_mermaid` branch and the generic `render_*` branch).

## 4. Unchanged surfaces

- `mermaid` / `component` / `theme` render kinds are not iframes; they already sit
  transparently on the themed wrapper and size naturally. Only `html` and `form`
  (iframe) kinds change.
- `FileRenderedHtml` (file-backed renders, `path`/`baseDir` mode) keeps its explicit
  `height` semantics; background/width reporting are not injected into real sites.
- The `width` property descriptions for `render_html`, `render_chart`, `render_diff`,
  `render_form`, `render_mermaid`, `render_theme` in `src/lib/saiTools.ts` change to
  describe "initial/minimum viewport width (content may grow the canvas)".

## 5. Error handling

- No size report (broken/script-less mock): region stays at `entry.width`; height stays
  at the current 300px default — today's behavior.
- Absurd reported widths are clamped by `maxWidth: 100%` (chat) and the 2000px window
  cap (capture).
- Invalid `background` values fail sanitization and fall back to the themed default.

## 6. Testing

- Unit: `nextRenderWidth` (grow-only, min floor, no shrink); reporter script string
  posts both dimensions; background sanitizer accept/reject cases; `srcDoc` composition
  includes the resolved background; capture-arg plumbing via the existing
  `renderHostParams` / `handleRenderToolRequest` test patterns.
- Manual: re-render the GitHub-watcher-card mock (~460px natural width) — expect it on
  the dark canvas at full width with zero scrollbars. Renderer changes are visible under
  HMR; `electron/main.ts` capture changes require an app restart.
