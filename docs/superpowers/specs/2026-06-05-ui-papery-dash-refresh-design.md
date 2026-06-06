# Design: "Papery Dash" UI Refresh

**Date:** 2026-06-05
**Status:** Approved (direction + scope)
**Branch target:** TBD (feature branch off `main`)
**Supersedes:** `2026-06-05-ui-depth-glow-refresh-design.md` (Depth & Glow direction is set aside)

## Summary

Refine SAI's existing flat, semi-minimal, accent-driven look without changing its
character. The refresh introduces a single reusable primitive — a faint,
accent-tinted **dashed hairline** — that gives the UI a subtle "papery" texture. It
is applied in exactly two places: between chat turns, and inside cards (splitting a
card's header from its body).

This is a **visual-only, narrowly-scoped** refresh. No layout restructuring, no
behavior changes, no new depth/gradient/glow vocabulary. It deliberately replaces the
earlier "Depth & Glow" direction, which pulled toward elevation and blooms — the
opposite of the flat refinement we want here.

## Goals

- Add a distinctive "papery" texture using one dashed-hairline primitive.
- Keep the look flat and calm; the dash is a whisper, not a theme overhaul.
- Stay fully themed: the dash tracks `var(--accent)`, so Default/Midnight/Steel each
  get their own tint (amber / purple / blue) with no hardcoded colors.
- Ship from a single shared token so the whole look retunes from one place.

## Non-Goals

- No card elevation, gradients, glow, or shadow vocabulary (explicitly rejected).
- No "ticket-stub" dashed card outlines, no dashed accent/selection treatments
  (these were explored and set aside in favor of dividers only).
- No layout changes, no component API changes, no new state/IPC/props.
- No dashes on other dividers: sidebar section breaks, the input rule, toolbar
  separators, etc. stay solid hairlines.

## Decisions (locked with user)

1. **Direction = dashed dividers only** (explored option "A"). Not cut-out cards,
   not dashed accents.
2. **Texture = faint accent dash.** A `repeating-linear-gradient` hairline (~7px
   stroke / ~6px gap) at ~45% accent opacity — not a CSS `dashed` border (gradient
   gives precise, identical-everywhere control of stroke/gap/opacity).
3. **Color = `var(--accent)`**, not hardcoded amber. Auto-themes to purple in
   Midnight, blue in Steel.
4. **Scope = two spots only:** between chat turns (❶) and inside cards, header↔body
   (❷). Sidebar section breaks, the above-input rule, and other separators were
   explicitly left solid.

## Architecture

### Foundation: one themed token (the engine)

Introduce a single CSS custom property holding the dash as a background image,
defined once so a single tweak retunes every usage:

```css
--divider-dash: repeating-linear-gradient(
  90deg,
  color-mix(in srgb, var(--accent) 45%, transparent) 0 7px,
  transparent 7px 13px
);
```

- **Definition locations** (mirrors the existing theme-var pattern):
  - `src/styles/globals.css` — `:root` gains `--divider-dash` as the Default fallback.
  - `src/themes.ts` — because the token references `var(--accent)`, each theme inherits
    it automatically; no per-theme duplication is required beyond the `:root` entry.
    (If a theme ever needs a different opacity/spacing, it can override the token in its
    `vars`, but the default derivation is expected to suffice for all three.)
- Exact opacity (45%) and stroke/gap (7px/6px) are starting values, tuned visually
  during implementation.

### Application 1 — between chat turns

A 1px-tall divider element with `background: var(--divider-dash)`, rendered in the gap
between message groups in the chat list (`src/components/Chat/ChatMessage.tsx` or its
container). It occupies existing inter-turn spacing so there is no layout shift, and is
purely decorative (`aria-hidden`).

### Application 2 — inside cards (header ↔ body)

Cards that already render a header→body separator (tool-call, plan-review, and similar
cards) swap that solid hairline for `var(--divider-dash)`. This is a CSS change to the
existing separator, not a new element.

## Data Flow

None. Presentation-only. The token flows from `themes.ts` / `globals.css` →
`document.documentElement` (existing theme mechanism) → consumed by CSS. No new state,
IPC, or props. `var(--accent)` is already applied per theme, so the dash re-tints on
theme switch automatically.

## Testing

- **Theme coherence:** confirm the dash renders amber in Default, purple in Midnight,
  blue in Steel — no hardcoded color bleed.
- **No layout shift:** verify the inter-turn divider sits in existing spacing and does
  not push messages around when toggled on/off.
- **Scope check:** confirm dashes appear ONLY between chat turns and inside cards;
  sidebar/input/other separators remain solid.
- **Reduced motion:** N/A — the dash is static (no animation introduced). Note this
  explicitly so no motion-gating is added.
- **Existing tests:** run the suite with `--maxWorkers=2`; the refresh must not break
  unit/integration tests.
- **Visual check (manual):** before/after screenshot of the chat (two turns) and one
  tool-call card, across at least Default + one other theme.

## Rollout

Single small sweep, foundation-first: the `--divider-dash` token lands first (invisible
until consumed), then the two applications. Because both applications key off the one
token, they can be done in either order once the token exists.

## Open Questions

- Final opacity and stroke/gap values (tuned visually during implementation; starting
  point 45% / 7px / 6px).
- Whether any card type's header↔body separator should be excluded (decide per card
  during implementation; default is to apply to all that have such a separator).
