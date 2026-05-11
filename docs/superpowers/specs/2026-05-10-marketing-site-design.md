# SAI Marketing Site — Design

**Date:** 2026-05-10
**Status:** Approved

## Goal

Build a single-page marketing site for SAI, hosted on GitHub Pages at `https://darkharasho.github.io/sai/`. Visual identity is a hybrid: a terminal-aesthetic hero section paired with a modern, scannable dev-tool landing-page layout below.

## Architecture

- **Location:** `site/` directory at the repo root, isolated from the Electron app source.
- **Framework:** Astro (latest), TypeScript, zero client JS by default. A small inline script powers the hero mission-clock animation.
- **Styling:** Astro scoped styles + a single global stylesheet. CSS custom properties for palette (amber `#c8943e`, terminal dark background, mono + sans stacks). No Tailwind — keeps the bundle minimal and matches the bespoke feel.
- **Assets:** Reuse `public/img/sai.png` (logo) and the README hero screenshot. A small build-time copy step (in `site/package.json` script or Astro integration) copies the needed source assets into `site/public/` so the source of truth stays at the repo root.
- **Base path:** `astro.config.mjs` sets `site: 'https://darkharasho.github.io'` and `base: '/sai/'`.

## Deployment

GitHub Action at `.github/workflows/deploy-site.yml`:

- **Triggers:** push to `main` when `site/**` paths change, plus manual `workflow_dispatch`.
- **Steps:** checkout → setup Node (LTS) → `npm ci` in `site/` → `npm run build` → upload `site/dist/` as Pages artifact → deploy via `actions/deploy-pages@v4`.
- **Permissions:** `contents: read`, `pages: write`, `id-token: write`.

**One-time manual step:** GitHub Pages source must be set to "GitHub Actions" in the repo's Pages settings. The spec notes this; the deploy workflow assumes it.

## Page Structure

Single page, anchored sections.

1. **Hero** — full-viewport dark section.
   - Left: SAI logo + tagline ("Stop context-switching. Start shipping.") + primary CTA (Download) and secondary CTA (GitHub).
   - Right (desktop) / below (mobile): a faux terminal panel running the mission-clock animation — `[MM:SS.d] LOCKING TELEMETRY` cycling through phrases, hard-blinking block cursor, drifting SAI mark.
   - Pure CSS + ~30 lines of vanilla JS for the clock + phrase cycling.
2. **Screenshot showcase** — README hero screenshot inside a subtle window-chrome frame, soft amber glow.
3. **Bring your own AI** — three-up grid: Claude, Codex, Gemini. Provider name + one-line role. Notes that providers are swapped from `Settings → AI Provider`.
4. **Feature grid** — 8 cards drawn from README:
   - Project-context chat
   - Composer queue
   - Approvals & telemetry
   - Monaco editor + diff review
   - Integrated terminal
   - Git integration
   - Search/replace
   - Plugins + MCP
   Each card: icon, title, ~2 sentence blurb.
5. **Download** — three platform tiles (Linux AppImage, Windows Installer, macOS DMG) linking to `https://github.com/darkharasho/sai/releases/latest`. Underneath, a "Build from source" code block.
6. **Footer** — GitHub repo link, License link, version shields.io badge, tagline "Built for developers who'd rather ship than configure."

## Components (Astro)

- `Layout.astro` — `<head>`, meta tags, OG/Twitter cards, favicon, font loading.
- `Hero.astro` + `MissionClock.astro` (the terminal panel).
- `Screenshot.astro`
- `Providers.astro`
- `FeatureGrid.astro` + `FeatureCard.astro`
- `Download.astro`
- `Footer.astro`
- `src/data/features.ts` — feature list as data, not markup. Single source of truth.

## Responsive & Accessibility

- Mobile-first; hero stacks under ~900px viewport width.
- Honor `prefers-reduced-motion`: mission-clock freezes on a single frame, cursor stops blinking, no SAI-mark drift.
- Semantic landmarks: `<main>`, `<section aria-labelledby="...">`, single `<h1>` in hero.
- Color contrast ≥ WCAG AA on all amber-on-dark combinations.
- All interactive elements reachable by keyboard with visible focus states.

## SEO / Social

- `<title>`, meta description, canonical URL.
- Open Graph + Twitter card metadata; OG image is the hero screenshot.
- Sitemap generated via `@astrojs/sitemap`.
- `robots.txt` allowing all crawlers.

## Out of Scope (v1)

- Blog
- Changelog page
- FAQ
- Comparison table vs other editors
- Testimonials
- Analytics / telemetry

## Open Questions

None at design time. All decisions resolved during brainstorming:

- Hosting: `gh-pages` via GitHub Action, no custom domain.
- Stack: Astro.
- Aesthetic: hybrid (terminal hero, modern body).
- Sections: as listed above.
