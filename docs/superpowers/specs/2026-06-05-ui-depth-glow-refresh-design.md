# Design: "Depth & Glow" UI Refresh

**Date:** 2026-06-05
**Status:** Approved (direction + scope)
**Branch target:** TBD (feature branch off `main`)

## Summary

Freshen SAI's UI by leaning into its existing dark, amber-accented identity rather
than replacing it. The refresh adds a small, reusable vocabulary of "depth"
primitives — layered surface gradients, accent glow on stateful elements, and card
elevation — applied consistently across every surface. The baseline stays calm;
warmth and elevation appear only where state or attention lives.

This is a **visual-only** refresh: no layout changes, no behavior changes, no
structural component changes.

## Goals

- Make SAI look distinctly itself (premium, warm, alive) instead of a generic dark IDE.
- Keep all three themes (Default / Midnight / Steel) coherent — no hardcoded colors.
- Ship in one sweep across all surfaces, driven by shared tokens.

## Non-Goals

- No new features, no layout restructuring, no component API changes.
- No replacement of the existing `ThinkingAnimation`.
- No rebuild of the chat input.

## Hard Constraints (locked with user)

1. **`ThinkingAnimation` is untouched.** The animated `SaiLogo` (17 motion modes,
   shuffled in chains), the themed word-ticker, and the running clock ship exactly
   as they are today (`src/components/ThinkingAnimation.tsx`). The only permitted
   change is an *optional* glowing, accent-edged frame/card around it. It must never
   become a generic dot or spinner.
2. **Chat input stays structurally and behaviorally identical.**
   `src/components/Chat/ChatInput.tsx` (context ring, usage bars, autocomplete,
   context chips, toolbar) keeps its structure and behavior. Only light visual
   refinement is allowed: a softer focus glow instead of a hard always-on border,
   slightly tightened radius/spacing, and a nicer send button.
3. **Reduced motion respected.** All glow/elevation that animates must degrade to a
   static state under `prefers-reduced-motion: reduce` (the codebase already gates
   animations this way in `globals.css`).
4. **Themed, not hardcoded.** All depth primitives derive from theme variables so
   Default/Midnight/Steel each get a coherent version automatically.

## Architecture

### Foundation: depth design tokens (the engine)

Introduce a "depth vocabulary" as CSS custom properties, defined per theme so all
surfaces pull from a single source.

- **Definition locations:**
  - `src/themes.ts` — each theme's `vars` object gains the new tokens (themed values).
  - `src/styles/globals.css` — `:root` gains the Default-theme fallbacks (mirrors the
    existing pattern where `globals.css` duplicates the default theme's vars).
- **Tokens to add (names indicative; finalize during implementation):**
  - `--elev-1`, `--elev-2`, `--elev-3` — top-down panel gradient fills (increasing lift).
  - `--elev-highlight` — the 1px inner top highlight (`inset 0 1px 0 …`).
  - `--glow-accent` — soft amber bloom for active/selected state.
  - `--glow-focus` — focus ring glow (used by the input and focusable controls).
  - `--shadow-card` — elevation shadow for lifted cards/bubbles/modals.
  - `--gradient-accent` — solid accent gradient for the few "brand" elements
    (send button, active nav icon).

Every surface change below is an *application* of these tokens. This is what keeps the
refresh consistent and cheap to maintain: tune the tokens, the whole app shifts.

### Surface application (one sweep, all surfaces)

Each surface is restyled by applying the tokens above. No JSX/structure changes unless
noted.

1. **Nav rail** (`src/components/` nav/titlebar area): rail gets a subtle vertical
   gradient; active icon gets `--gradient-accent` fill + `--glow-accent` bloom.
2. **Sidebars** (Files, Swarm, MCP, Plugins, Search, Chat history, Settings): panels
   get `--elev-*`; the selected row gets an inset accent edge + faint `--glow-accent`.
3. **Chat messages** (`src/components/Chat/ChatMessage.tsx`): user bubbles lift with a
   gradient fill + `--shadow-card`; assistant messages stay quiet and type-led.
4. **Cards** (tool-call, plan-review, todo-progress, link-preview, GitHub-watcher,
   swarm task rows/cards): gradient edges + `--elev-*` + `--shadow-card`.
5. **Swarm activity ribbon** (`src/components/Swarm/ActivityRibbon.tsx`): "living
   status" treatment — light-sweep animation while an agent is active, settling to a
   green resting state when done. Honors reduced-motion.
6. **Modals / overlays** (settings, GitHub, keybindings, search-confirm, code-panel
   backdrop, image modal): elevated surface using `--elev-*` + `--shadow-card`, paired
   with the existing backdrop blur.
7. **Chat input** (`src/components/Chat/ChatInput.tsx`): refinement only — replace the
   hard focus border with a softer `--glow-focus` ring, tighten radius/spacing, and
   apply `--gradient-accent` to the send button. No structural change.

## Data Flow

None. This is presentation-only. Tokens flow from `themes.ts` → applied to
`document.documentElement` (existing theme-switching mechanism) → consumed by CSS.
No new state, no new IPC, no new props.

## Testing

- **Theme coherence:** verify all three themes (Default / Midnight / Steel) render each
  refreshed surface coherently — no hardcoded amber bleeding into Midnight/Steel.
- **Reduced motion:** with `prefers-reduced-motion: reduce`, confirm animated glow /
  swarm sweep degrade to static states.
- **Visual regression (manual):** screenshot each surface before/after (the
  `readme-screenshots` skill / existing screenshot tooling can assist).
- **Existing tests:** the refresh must not break existing unit/integration tests; run
  the suite (respecting the `--maxWorkers=2` limit) after changes.
- **Preservation checks:** confirm `ThinkingAnimation` and `ChatInput` render and behave
  identically (no DOM-structure changes to either beyond the permitted refinements).

## Rollout

Single sweep. Implementation order is foundation-first for safety: tokens land first
(invisible until consumed), then surfaces are restyled. Because everything keys off the
tokens, surfaces can be done in any convenient order after the foundation exists.

## Open Questions

- Exact token values per theme (tuned visually during implementation).
- Whether the `ThinkingAnimation` frame/card is always-on or context-dependent
  (decide during implementation; default to a subtle always-on frame in chat).
