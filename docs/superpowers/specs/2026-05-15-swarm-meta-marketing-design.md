# Swarm + Meta Workspaces: README & Marketing Update — Design Spec

**Date:** 2026-05-15
**Status:** Approved design, pending implementation plan

## Problem

Two flagship features have shipped since the last marketing pass — **Swarm mode** (v1.2.0) and **Meta workspaces** (v1.3.x) — but neither is reflected in `README.md` or the `site/` marketing landing page. New visitors don't see parallel-agent or multi-repo capability anywhere on the public surface.

## Goal

Update both the README and the Astro marketing site to advertise Swarm and Meta workspaces as flagship additions, with screenshots, without reorganizing the existing content.

## Scope

In:

- New "Swarm mode" and "Meta workspaces" feature sections in `README.md`, placed at the top of `## Features`.
- Two new screenshots committed to the repo (`public/img/swarm.png`, `public/img/meta.png`) and to the site (`site/public/img/swarm.png`, `site/public/img/meta.png`).
- Two new feature cards (`D-01 Swarm mode`, `D-02 Meta workspaces`) in `site/src/data/features.ts`, rendered as a flagship row above the existing 8-card grid.
- Header / legend copy updates in `FeatureGrid.astro` to reflect the new D-series.
- New "CHANNEL · 03 / SWARM" and "CHANNEL · 04 / META" `<figure>` blocks appended to `Screenshot.astro`.

Out:

- Hero copy changes.
- Re-shooting existing screenshots.
- Restructuring the feature grid layout beyond adding the flagship row.

## Approach

### README

Insert two new sections at the top of `## Features`:

1. **Swarm mode** — one-paragraph blurb covering: orchestrator chat, parallel Claude tasks, per-task git worktrees, live streaming, individual or batch "land all green," slash-command escape hatch. Followed by the swarm screenshot.
2. **Meta workspaces** — one-paragraph blurb covering: group N projects under one synthetic root, shared chat / terminal / editor / git, per-project chips on tool calls, per-repo git controls in the sidebar. Followed by the meta screenshot.

Both screenshots use repo-relative paths (`public/img/swarm.png`, `public/img/meta.png`) — consistent with how the existing logo is referenced.

### Marketing site

**Feature grid (`FeatureGrid.astro` + `features.ts` + `FeatureCard.astro`):**

- Add `flagship?: boolean` to the `Feature` interface and `FeatureCard` props. When set, the card renders with a filled amber coord badge and a permanently-visible top accent stripe (rather than hover-only).
- Add two new entries to `features.ts` at the **top** of the array: `D-01 Swarm mode` (icon: `zap`) and `D-02 Meta workspaces` (icon: `layers`), both `flagship: true`.
- In `FeatureGrid.astro`, split rendering: the two flagship features render in a 2-column row at the top, the remaining 8 features keep their existing 4×2 grid below.
- Update header: `"Eight modules."` → `"Two flagships."`; `"One control surface."` → `"Eight supporting modules."`
- Update legend: append `D-series · flagship` (color: amber/`--phosphor` filled, matching the flagship coord badge).

**Screenshots (`Screenshot.astro`):**

- Append two more `<figure class="screen brackets">` blocks below the existing two, identical structure, with `CHANNEL · 03` / `CHANNEL · 04` labels and `SWARM` / `META` callout. New images at `site/public/img/swarm.png` and `site/public/img/meta.png`.

## Files

- `README.md` — edit
- `public/img/swarm.png` — new
- `public/img/meta.png` — new
- `site/src/data/features.ts` — edit (add `flagship` field, two new entries)
- `site/src/components/FeatureCard.astro` — edit (handle `flagship` prop)
- `site/src/components/FeatureGrid.astro` — edit (flagship row + header/legend)
- `site/src/components/Screenshot.astro` — edit (two new figures)
- `site/public/img/swarm.png` — new
- `site/public/img/meta.png` — new

## Testing

- Visually inspect `README.md` on GitHub (or rendered locally) — both sections appear with screenshots loading.
- Run `npm run dev` in `site/`, verify the flagship row renders above the 8-card grid, both new screenshots appear, legend includes D-series.

## Non-goals

- No content changes to the existing 8 feature cards.
- No restructuring of `Hero.astro`, `Providers.astro`, `Marquee.astro`, `Download.astro`.
