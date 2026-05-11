# SAI Marketing Site Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a single-page Astro marketing site for SAI deployed to GitHub Pages at `https://darkharasho.github.io/sai/`.

**Architecture:** Astro static site in `site/` directory, zero client JS by default except for a small inline mission-clock animation in the hero. A GitHub Action builds the site and deploys to GitHub Pages on push to `main` when `site/**` changes.

**Tech Stack:** Astro (latest), TypeScript, vanilla CSS with custom properties, `@astrojs/sitemap`. No Tailwind. Node LTS for builds.

**Spec:** `docs/superpowers/specs/2026-05-10-marketing-site-design.md`

---

## File Structure

**New files (all under `site/` unless noted):**
- `site/package.json` — Astro project manifest, scripts, deps
- `site/tsconfig.json` — TS config extending Astro's strict base
- `site/astro.config.mjs` — site/base path, sitemap integration
- `site/.gitignore` — `dist/`, `node_modules/`, `.astro/`
- `site/src/pages/index.astro` — single landing page, composes sections
- `site/src/layouts/Layout.astro` — `<head>`, meta, fonts, global styles slot
- `site/src/styles/global.css` — CSS reset, custom properties, base type
- `site/src/components/Hero.astro` — hero section with CTAs and MissionClock
- `site/src/components/MissionClock.astro` — faux terminal panel with cycling phrases
- `site/src/components/Screenshot.astro` — framed app screenshot
- `site/src/components/Providers.astro` — Claude / Codex / Gemini three-up
- `site/src/components/FeatureGrid.astro` — wraps FeatureCards from data
- `site/src/components/FeatureCard.astro` — single feature card
- `site/src/components/Download.astro` — platform tiles + build-from-source
- `site/src/components/Footer.astro` — links + tagline
- `site/src/data/features.ts` — feature list (title, blurb, icon name)
- `site/public/img/sai.png` — copy of repo logo
- `site/public/img/screenshot.png` — README hero screenshot
- `site/public/favicon.svg` — small SAI mark
- `site/public/robots.txt`
- `.github/workflows/deploy-site.yml` — Pages deploy

**No app source files are modified.**

---

## Task 1: Scaffold the Astro project

**Files:**
- Create: `site/package.json`
- Create: `site/tsconfig.json`
- Create: `site/astro.config.mjs`
- Create: `site/.gitignore`
- Create: `site/src/pages/index.astro` (placeholder)

- [ ] **Step 1: Create `site/package.json`**

```json
{
  "name": "sai-site",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "astro dev",
    "build": "astro build",
    "preview": "astro preview",
    "astro": "astro"
  },
  "dependencies": {
    "astro": "^4.16.0",
    "@astrojs/sitemap": "^3.2.0"
  }
}
```

- [ ] **Step 2: Create `site/tsconfig.json`**

```json
{
  "extends": "astro/tsconfigs/strict",
  "include": ["src/**/*.ts", "src/**/*.astro", "src/**/*.d.ts"]
}
```

- [ ] **Step 3: Create `site/astro.config.mjs`**

```js
import { defineConfig } from 'astro/config';
import sitemap from '@astrojs/sitemap';

export default defineConfig({
  site: 'https://darkharasho.github.io',
  base: '/sai/',
  trailingSlash: 'ignore',
  integrations: [sitemap()],
});
```

- [ ] **Step 4: Create `site/.gitignore`**

```
node_modules/
dist/
.astro/
.env
.env.local
```

- [ ] **Step 5: Create placeholder `site/src/pages/index.astro`**

```astro
---
---
<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <title>SAI</title>
  </head>
  <body>
    <h1>SAI</h1>
  </body>
</html>
```

- [ ] **Step 6: Install and verify dev server boots**

Run from repo root:
```bash
cd site && npm install && npm run build
```
Expected: `npm install` completes, `npm run build` produces `site/dist/index.html` with no errors.

- [ ] **Step 7: Commit**

```bash
git add site/.gitignore site/package.json site/package-lock.json site/tsconfig.json site/astro.config.mjs site/src/pages/index.astro
git commit -m "site: scaffold astro project"
```

---

## Task 2: Copy shared assets into `site/public/`

**Files:**
- Create: `site/public/img/sai.png` (copy of `public/img/sai.png`)
- Create: `site/public/img/screenshot.png` (download from README asset URL)
- Create: `site/public/favicon.svg`
- Create: `site/public/robots.txt`

- [ ] **Step 1: Copy the SAI logo**

```bash
mkdir -p site/public/img
cp public/img/sai.png site/public/img/sai.png
```

- [ ] **Step 2: Download the README hero screenshot**

The screenshot URL is referenced in `README.md` line 25:
`https://github.com/user-attachments/assets/d92d5d2e-a51e-4145-8237-560e18dbadb7`

```bash
curl -L -o site/public/img/screenshot.png "https://github.com/user-attachments/assets/d92d5d2e-a51e-4145-8237-560e18dbadb7"
```

Expected: file exists, non-zero size, opens as a valid PNG.

- [ ] **Step 3: Create `site/public/favicon.svg`**

Simple amber square with an "S" — placeholder, easy to swap later:

```svg
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32">
  <rect width="32" height="32" rx="6" fill="#c8943e"/>
  <text x="16" y="22" font-family="ui-monospace,Menlo,monospace" font-size="18" font-weight="700" text-anchor="middle" fill="#16110a">S</text>
</svg>
```

- [ ] **Step 4: Create `site/public/robots.txt`**

```
User-agent: *
Allow: /

Sitemap: https://darkharasho.github.io/sai/sitemap-index.xml
```

- [ ] **Step 5: Verify build still passes**

Run: `cd site && npm run build`
Expected: build succeeds, `dist/img/sai.png`, `dist/img/screenshot.png`, `dist/favicon.svg`, `dist/robots.txt` all exist.

- [ ] **Step 6: Commit**

```bash
git add site/public
git commit -m "site: add shared assets (logo, screenshot, favicon, robots)"
```

---

## Task 3: Global styles and Layout component

**Files:**
- Create: `site/src/styles/global.css`
- Create: `site/src/layouts/Layout.astro`

- [ ] **Step 1: Create `site/src/styles/global.css`**

```css
:root {
  --bg: #0e0b07;
  --bg-elev: #15110a;
  --bg-panel: #1c160d;
  --fg: #f4ecdc;
  --fg-dim: #b8ad94;
  --fg-mute: #7a715f;
  --accent: #c8943e;
  --accent-soft: #c8943e33;
  --border: #2a2218;
  --border-strong: #3a2f20;
  --mono: ui-monospace, "JetBrains Mono", "SF Mono", Menlo, Consolas, monospace;
  --sans: -apple-system, BlinkMacSystemFont, "Inter", "Segoe UI", Roboto, sans-serif;
  --radius: 10px;
  --container: 1180px;
}

* { box-sizing: border-box; }
html, body { margin: 0; padding: 0; }
html { color-scheme: dark; }
body {
  background: var(--bg);
  color: var(--fg);
  font-family: var(--sans);
  font-size: 16px;
  line-height: 1.55;
  -webkit-font-smoothing: antialiased;
}

a { color: var(--accent); text-decoration: none; }
a:hover { text-decoration: underline; }

img { max-width: 100%; display: block; }

h1, h2, h3 { font-weight: 700; letter-spacing: -0.02em; line-height: 1.15; margin: 0; }
h1 { font-size: clamp(2.2rem, 4.5vw, 3.6rem); }
h2 { font-size: clamp(1.6rem, 2.5vw, 2.2rem); }
h3 { font-size: 1.15rem; }

.container { max-width: var(--container); margin: 0 auto; padding: 0 24px; }

section { padding: 96px 0; border-top: 1px solid var(--border); }
section:first-of-type { border-top: 0; }

.btn {
  display: inline-flex; align-items: center; gap: 8px;
  padding: 12px 20px; border-radius: 8px;
  font-family: var(--mono); font-size: 0.95rem; font-weight: 600;
  border: 1px solid var(--border-strong);
  background: var(--bg-panel); color: var(--fg);
  transition: border-color 120ms, background 120ms, transform 120ms;
}
.btn:hover { border-color: var(--accent); text-decoration: none; }
.btn:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
.btn-primary { background: var(--accent); color: #16110a; border-color: var(--accent); }
.btn-primary:hover { background: #d9a24a; border-color: #d9a24a; }

.eyebrow {
  font-family: var(--mono); font-size: 0.78rem;
  color: var(--accent); letter-spacing: 0.18em; text-transform: uppercase;
  margin-bottom: 14px;
}

@media (prefers-reduced-motion: reduce) {
  *, *::before, *::after { animation-duration: 0.001ms !important; animation-iteration-count: 1 !important; transition-duration: 0.001ms !important; }
}
```

- [ ] **Step 2: Create `site/src/layouts/Layout.astro`**

```astro
---
import '../styles/global.css';

interface Props {
  title?: string;
  description?: string;
}

const {
  title = 'SAI — Simply AI · An AI-first code editor',
  description = 'SAI is a desktop code editor built around AI. Chat with Claude, Codex, or Gemini, edit code, run commands, and manage Git — without ever leaving the window.',
} = Astro.props;

const ogImage = new URL(`${import.meta.env.BASE_URL}img/screenshot.png`, Astro.site).toString();
const canonical = new URL(Astro.url.pathname, Astro.site).toString();
---
<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>{title}</title>
    <meta name="description" content={description} />
    <link rel="canonical" href={canonical} />
    <link rel="icon" type="image/svg+xml" href={`${import.meta.env.BASE_URL}favicon.svg`} />

    <meta property="og:type" content="website" />
    <meta property="og:title" content={title} />
    <meta property="og:description" content={description} />
    <meta property="og:image" content={ogImage} />
    <meta property="og:url" content={canonical} />

    <meta name="twitter:card" content="summary_large_image" />
    <meta name="twitter:title" content={title} />
    <meta name="twitter:description" content={description} />
    <meta name="twitter:image" content={ogImage} />
  </head>
  <body>
    <main>
      <slot />
    </main>
  </body>
</html>
```

- [ ] **Step 3: Wire up index page to use Layout**

Overwrite `site/src/pages/index.astro`:

```astro
---
import Layout from '../layouts/Layout.astro';
---
<Layout>
  <div class="container" style="padding: 96px 24px;">
    <h1>SAI</h1>
    <p>Coming soon.</p>
  </div>
</Layout>
```

- [ ] **Step 4: Verify build**

Run: `cd site && npm run build`
Expected: success. `dist/index.html` contains `<title>SAI — Simply AI...</title>` and meta tags.

- [ ] **Step 5: Commit**

```bash
git add site/src/styles site/src/layouts site/src/pages/index.astro
git commit -m "site: add global styles and Layout"
```

---

## Task 4: MissionClock component

**Files:**
- Create: `site/src/components/MissionClock.astro`

This is the animated terminal panel in the hero. It shows `[MM:SS.d]` ticking, cycles through ALL-CAPS phrases, has a hard-blinking block cursor, and a drifting SAI mark in the background. Honors `prefers-reduced-motion`.

- [ ] **Step 1: Create `site/src/components/MissionClock.astro`**

```astro
---
const phrases = [
  'LOCKING TELEMETRY',
  'BREACHING ICE',
  'INDEXING REPOSITORY',
  'NEGOTIATING HANDSHAKE',
  'SPOOLING CONTEXT',
  'AUTHORIZING APPROVALS',
  'STREAMING TOKENS',
  'COMPILING DIFFS',
];
---
<div class="clock" role="img" aria-label="SAI mission-clock animation">
  <div class="chrome">
    <span class="dot dot-r"></span>
    <span class="dot dot-y"></span>
    <span class="dot dot-g"></span>
    <span class="title">sai · session 1</span>
  </div>
  <div class="screen">
    <span class="drift" aria-hidden="true">SAI</span>
    <div class="line">
      <span class="ts" data-clock>[00:00.0]</span>
      <span class="phrase" data-phrase>{phrases[0]}</span>
      <span class="cursor" aria-hidden="true">█</span>
    </div>
    <div class="line dim"><span class="ts">[00:00.0]</span> &gt; awaiting input…</div>
  </div>
</div>

<script is:inline define:vars={{ phrases }}>
  const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const clockEl = document.querySelector('[data-clock]');
  const phraseEl = document.querySelector('[data-phrase]');

  if (clockEl && phraseEl) {
    if (reduced) {
      clockEl.textContent = '[00:12.4]';
      phraseEl.textContent = phrases[0];
    } else {
      const start = performance.now();
      const tick = (now) => {
        const elapsed = (now - start) / 1000;
        const m = Math.floor(elapsed / 60);
        const s = Math.floor(elapsed % 60);
        const d = Math.floor((elapsed * 10) % 10);
        const mm = String(m).padStart(2, '0');
        const ss = String(s).padStart(2, '0');
        clockEl.textContent = `[${mm}:${ss}.${d}]`;
        requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);

      let i = 0;
      setInterval(() => {
        i = (i + 1) % phrases.length;
        phraseEl.textContent = phrases[i];
      }, 1800);
    }
  }
</script>

<style>
  .clock {
    background: var(--bg-panel);
    border: 1px solid var(--border-strong);
    border-radius: var(--radius);
    overflow: hidden;
    box-shadow: 0 30px 80px -30px rgba(200, 148, 62, 0.25), 0 0 0 1px rgba(200, 148, 62, 0.06);
    font-family: var(--mono);
  }
  .chrome {
    display: flex; align-items: center; gap: 8px;
    padding: 10px 14px;
    background: #100c07;
    border-bottom: 1px solid var(--border);
  }
  .dot { width: 10px; height: 10px; border-radius: 50%; display: inline-block; }
  .dot-r { background: #c4554a; }
  .dot-y { background: #c89a4a; }
  .dot-g { background: #65a37a; }
  .title { margin-left: 10px; font-size: 0.78rem; color: var(--fg-mute); letter-spacing: 0.05em; }

  .screen {
    position: relative;
    padding: 28px 24px 32px;
    min-height: 220px;
  }
  .drift {
    position: absolute; inset: 0;
    display: grid; place-items: center;
    font-size: 8rem; font-weight: 800; letter-spacing: 0.08em;
    color: var(--accent);
    opacity: 0.06;
    pointer-events: none;
    animation: drift 14s ease-in-out infinite alternate;
  }
  .line { display: flex; align-items: baseline; gap: 12px; font-size: 0.98rem; line-height: 1.9; }
  .line.dim { color: var(--fg-mute); }
  .ts { color: var(--accent); font-variant-numeric: tabular-nums; }
  .phrase { color: var(--fg); font-weight: 600; letter-spacing: 0.08em; }
  .cursor {
    color: var(--accent);
    animation: blink 1s steps(2, start) infinite;
  }
  @keyframes blink { 50% { opacity: 0; } }
  @keyframes drift {
    0%   { transform: translate(-4%, -2%); }
    100% { transform: translate(4%, 2%); }
  }
  @media (prefers-reduced-motion: reduce) {
    .cursor, .drift { animation: none; }
  }
</style>
```

- [ ] **Step 2: Verify it renders in dev**

```bash
cd site && npm run build
```
Expected: build succeeds. Component compiles; no usage yet — it'll be wired up in Task 5.

- [ ] **Step 3: Commit**

```bash
git add site/src/components/MissionClock.astro
git commit -m "site: add MissionClock terminal animation"
```

---

## Task 5: Hero component

**Files:**
- Create: `site/src/components/Hero.astro`
- Modify: `site/src/pages/index.astro`

- [ ] **Step 1: Create `site/src/components/Hero.astro`**

```astro
---
import MissionClock from './MissionClock.astro';
const base = import.meta.env.BASE_URL;
---
<section class="hero">
  <div class="container hero-grid">
    <div class="copy">
      <div class="brand">
        <img src={`${base}img/sai.png`} alt="" width="44" height="44" />
        <span class="wordmark">SAI</span>
        <span class="sub">Simply AI</span>
      </div>
      <h1>Stop context-switching.<br/><span class="accent">Start shipping.</span></h1>
      <p class="lede">
        A desktop code editor built around AI. Chat with Claude, Codex, or Gemini,
        edit code, run commands, and manage Git — all without ever leaving the window.
      </p>
      <div class="cta">
        <a class="btn btn-primary" href="https://github.com/darkharasho/sai/releases/latest">↓ Download SAI</a>
        <a class="btn" href="https://github.com/darkharasho/sai">View on GitHub →</a>
      </div>
    </div>
    <div class="clock-wrap">
      <MissionClock />
    </div>
  </div>
</section>

<style>
  .hero {
    padding: 80px 0 96px;
    background:
      radial-gradient(900px 500px at 80% 0%, rgba(200, 148, 62, 0.10), transparent 60%),
      radial-gradient(700px 400px at 10% 80%, rgba(200, 148, 62, 0.06), transparent 70%);
    border-top: 0;
  }
  .hero-grid {
    display: grid;
    grid-template-columns: 1.05fr 0.95fr;
    gap: 56px;
    align-items: center;
  }
  .brand {
    display: flex; align-items: center; gap: 12px;
    margin-bottom: 24px;
  }
  .brand img { border-radius: 8px; }
  .wordmark { font-family: var(--mono); font-weight: 700; letter-spacing: 0.08em; font-size: 1.1rem; }
  .sub { font-family: var(--mono); font-size: 0.85rem; color: var(--fg-mute); }
  .accent { color: var(--accent); }
  .lede { color: var(--fg-dim); font-size: 1.15rem; max-width: 56ch; margin-top: 20px; }
  .cta { display: flex; gap: 12px; margin-top: 28px; flex-wrap: wrap; }

  @media (max-width: 900px) {
    .hero-grid { grid-template-columns: 1fr; gap: 40px; }
  }
</style>
```

- [ ] **Step 2: Wire Hero into the index page**

Replace `site/src/pages/index.astro`:

```astro
---
import Layout from '../layouts/Layout.astro';
import Hero from '../components/Hero.astro';
---
<Layout>
  <Hero />
</Layout>
```

- [ ] **Step 3: Verify the build and inspect output**

```bash
cd site && npm run build
```
Expected: success. `dist/index.html` contains the hero copy, the SAI logo `<img>` reference, and the MissionClock script.

- [ ] **Step 4: Optional manual check**

```bash
cd site && npm run preview
```
Visit `http://localhost:4321/sai/` — hero renders, mission-clock ticks, cursor blinks, CTAs route to releases and repo.

- [ ] **Step 5: Commit**

```bash
git add site/src/components/Hero.astro site/src/pages/index.astro
git commit -m "site: add Hero section"
```

---

## Task 6: Screenshot section

**Files:**
- Create: `site/src/components/Screenshot.astro`
- Modify: `site/src/pages/index.astro`

- [ ] **Step 1: Create `site/src/components/Screenshot.astro`**

```astro
---
const base = import.meta.env.BASE_URL;
---
<section class="shot" aria-labelledby="shot-title">
  <div class="container">
    <p class="eyebrow">A look inside</p>
    <h2 id="shot-title">The whole loop, one window.</h2>
    <p class="lede">Open a project, pick your provider, ask it to build a feature, and watch it happen in real time. Review diffs, stage changes, commit — done.</p>
    <div class="frame">
      <div class="chrome">
        <span class="dot dot-r"></span><span class="dot dot-y"></span><span class="dot dot-g"></span>
      </div>
      <img src={`${base}img/screenshot.png`} alt="SAI desktop application showing chat, editor, terminal, and Git panels" width="1400" height="900" loading="lazy" />
    </div>
  </div>
</section>

<style>
  .lede { color: var(--fg-dim); max-width: 60ch; margin: 14px 0 36px; font-size: 1.08rem; }
  .frame {
    border: 1px solid var(--border-strong);
    border-radius: var(--radius);
    overflow: hidden;
    background: var(--bg-panel);
    box-shadow: 0 40px 100px -40px rgba(200, 148, 62, 0.2);
  }
  .chrome {
    display: flex; gap: 8px;
    padding: 10px 14px;
    background: #100c07;
    border-bottom: 1px solid var(--border);
  }
  .dot { width: 10px; height: 10px; border-radius: 50%; }
  .dot-r { background: #c4554a; }
  .dot-y { background: #c89a4a; }
  .dot-g { background: #65a37a; }
  .frame img { display: block; width: 100%; height: auto; }
</style>
```

- [ ] **Step 2: Wire into the page**

Update `site/src/pages/index.astro`:

```astro
---
import Layout from '../layouts/Layout.astro';
import Hero from '../components/Hero.astro';
import Screenshot from '../components/Screenshot.astro';
---
<Layout>
  <Hero />
  <Screenshot />
</Layout>
```

- [ ] **Step 3: Build**

`cd site && npm run build` → success.

- [ ] **Step 4: Commit**

```bash
git add site/src/components/Screenshot.astro site/src/pages/index.astro
git commit -m "site: add Screenshot showcase"
```

---

## Task 7: Providers section

**Files:**
- Create: `site/src/components/Providers.astro`
- Modify: `site/src/pages/index.astro`

- [ ] **Step 1: Create `site/src/components/Providers.astro`**

```astro
---
const providers = [
  { name: 'Claude', role: 'Anthropic’s coding agent', accent: '#d4a14a' },
  { name: 'Codex', role: 'OpenAI’s CLI agent',         accent: '#7aa376' },
  { name: 'Gemini', role: 'Google’s coding agent',     accent: '#6f9bd1' },
];
---
<section class="providers" aria-labelledby="providers-title">
  <div class="container">
    <p class="eyebrow">Bring your own AI</p>
    <h2 id="providers-title">Use the agent you already trust.</h2>
    <p class="lede">Switch providers any time from <code>Settings → AI Provider</code>. SAI keeps each provider’s models, approval modes, and conversation preferences separate.</p>
    <div class="grid">
      {providers.map((p) => (
        <article class="card">
          <span class="badge" style={`--badge: ${p.accent}`}>{p.name[0]}</span>
          <h3>{p.name}</h3>
          <p>{p.role}</p>
        </article>
      ))}
    </div>
  </div>
</section>

<style>
  .lede { color: var(--fg-dim); max-width: 60ch; margin: 14px 0 40px; font-size: 1.08rem; }
  .lede code { font-family: var(--mono); color: var(--accent); background: var(--bg-panel); padding: 2px 6px; border-radius: 4px; }
  .grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 20px; }
  .card {
    padding: 28px;
    background: var(--bg-elev);
    border: 1px solid var(--border);
    border-radius: var(--radius);
  }
  .badge {
    display: inline-grid; place-items: center;
    width: 40px; height: 40px; border-radius: 10px;
    background: color-mix(in srgb, var(--badge) 20%, transparent);
    color: var(--badge);
    font-family: var(--mono); font-weight: 700; font-size: 1.1rem;
    margin-bottom: 16px;
  }
  .card h3 { margin-bottom: 6px; }
  .card p { color: var(--fg-dim); margin: 0; }
  @media (max-width: 760px) {
    .grid { grid-template-columns: 1fr; }
  }
</style>
```

- [ ] **Step 2: Wire into index page**

```astro
---
import Layout from '../layouts/Layout.astro';
import Hero from '../components/Hero.astro';
import Screenshot from '../components/Screenshot.astro';
import Providers from '../components/Providers.astro';
---
<Layout>
  <Hero />
  <Screenshot />
  <Providers />
</Layout>
```

- [ ] **Step 3: Build and commit**

```bash
cd site && npm run build
cd ..
git add site/src/components/Providers.astro site/src/pages/index.astro
git commit -m "site: add Providers section"
```

---

## Task 8: Feature data and FeatureCard

**Files:**
- Create: `site/src/data/features.ts`
- Create: `site/src/components/FeatureCard.astro`

- [ ] **Step 1: Create `site/src/data/features.ts`**

```ts
export interface Feature {
  title: string;
  blurb: string;
  glyph: string; // single short mono glyph or label, e.g. "{}", "git", "▶"
}

export const features: Feature[] = [
  {
    title: 'Chat with real project context',
    blurb: 'Talk to your assistant inside the editor with your repository already attached. Streaming, image attachments, persistent sessions, full history.',
    glyph: '◉',
  },
  {
    title: 'A composer that keeps up',
    blurb: 'Queue follow-up prompts behind a streaming turn, promote any item to “next,” or bypass the queue with Enter. Todo ring and queue badge live in the toolbar.',
    glyph: '»»',
  },
  {
    title: 'Approvals & telemetry',
    blurb: 'Provider-specific approval modes, inline tool-call approvals, context/token meters, response timers, and a cumulative turn timer for long runs.',
    glyph: '[ok]',
  },
  {
    title: 'Monaco editor & diff review',
    blurb: 'Tabs, syntax highlighting, unsaved-change protection, side-by-side and unified diffs. Open file links from chat, expand snippets to fullscreen.',
    glyph: '{ }',
  },
  {
    title: 'Integrated terminal',
    blurb: 'A real PTY-backed terminal — XTerm.js, interactive shell, clickable links, proper color rendering. Runs in your project directory.',
    glyph: '▶_',
  },
  {
    title: 'First-class Git',
    blurb: 'Stage, commit, branch, push, pull, discard, and review diffs from the sidebar. Background status refresh. AI-generated commit messages on demand.',
    glyph: 'git',
  },
  {
    title: 'Search & replace, project-wide',
    blurb: 'Regex, case, whole-word toggles. Results grouped by file. Inline replace across unsaved buffers in the editor.',
    glyph: '⌕',
  },
  {
    title: 'Plugins & MCP servers',
    blurb: 'Browse and install Claude Code plugins and MCP servers from inside SAI. Dedicated sidebars for installed servers and registry browsing.',
    glyph: '∷',
  },
];
```

- [ ] **Step 2: Create `site/src/components/FeatureCard.astro`**

```astro
---
interface Props {
  title: string;
  blurb: string;
  glyph: string;
}
const { title, blurb, glyph } = Astro.props;
---
<article class="card">
  <span class="glyph" aria-hidden="true">{glyph}</span>
  <h3>{title}</h3>
  <p>{blurb}</p>
</article>

<style>
  .card {
    padding: 28px;
    background: var(--bg-elev);
    border: 1px solid var(--border);
    border-radius: var(--radius);
    transition: border-color 150ms, transform 150ms;
  }
  .card:hover { border-color: var(--border-strong); }
  .glyph {
    display: inline-flex; align-items: center; justify-content: center;
    min-width: 40px; height: 40px; padding: 0 10px;
    font-family: var(--mono); font-weight: 600; font-size: 0.95rem;
    color: var(--accent);
    background: var(--accent-soft);
    border-radius: 8px;
    margin-bottom: 16px;
  }
  .card h3 { margin-bottom: 10px; }
  .card p { color: var(--fg-dim); margin: 0; font-size: 0.98rem; }
</style>
```

- [ ] **Step 3: Build and commit**

```bash
cd site && npm run build
cd ..
git add site/src/data/features.ts site/src/components/FeatureCard.astro
git commit -m "site: add feature data and FeatureCard"
```

---

## Task 9: FeatureGrid section

**Files:**
- Create: `site/src/components/FeatureGrid.astro`
- Modify: `site/src/pages/index.astro`

- [ ] **Step 1: Create `site/src/components/FeatureGrid.astro`**

```astro
---
import FeatureCard from './FeatureCard.astro';
import { features } from '../data/features';
---
<section class="features" aria-labelledby="features-title">
  <div class="container">
    <p class="eyebrow">Everything you need, in one window</p>
    <h2 id="features-title">Built for the way you actually ship.</h2>
    <div class="grid">
      {features.map((f) => (
        <FeatureCard title={f.title} blurb={f.blurb} glyph={f.glyph} />
      ))}
    </div>
  </div>
</section>

<style>
  .grid {
    margin-top: 40px;
    display: grid;
    grid-template-columns: repeat(4, 1fr);
    gap: 18px;
  }
  @media (max-width: 1100px) { .grid { grid-template-columns: repeat(2, 1fr); } }
  @media (max-width: 600px) { .grid { grid-template-columns: 1fr; } }
</style>
```

- [ ] **Step 2: Wire into index page**

```astro
---
import Layout from '../layouts/Layout.astro';
import Hero from '../components/Hero.astro';
import Screenshot from '../components/Screenshot.astro';
import Providers from '../components/Providers.astro';
import FeatureGrid from '../components/FeatureGrid.astro';
---
<Layout>
  <Hero />
  <Screenshot />
  <Providers />
  <FeatureGrid />
</Layout>
```

- [ ] **Step 3: Build and commit**

```bash
cd site && npm run build
cd ..
git add site/src/components/FeatureGrid.astro site/src/pages/index.astro
git commit -m "site: add FeatureGrid section"
```

---

## Task 10: Download section

**Files:**
- Create: `site/src/components/Download.astro`
- Modify: `site/src/pages/index.astro`

- [ ] **Step 1: Create `site/src/components/Download.astro`**

```astro
---
const releaseUrl = 'https://github.com/darkharasho/sai/releases/latest';
const platforms = [
  { os: 'Linux',   format: 'AppImage',  href: releaseUrl, glyph: 'tux' },
  { os: 'Windows', format: 'Installer', href: releaseUrl, glyph: 'win' },
  { os: 'macOS',   format: 'DMG',       href: releaseUrl, glyph: 'mac' },
];
---
<section class="download" aria-labelledby="download-title" id="download">
  <div class="container">
    <p class="eyebrow">Get SAI</p>
    <h2 id="download-title">Download for your platform.</h2>
    <div class="tiles">
      {platforms.map((p) => (
        <a class="tile" href={p.href}>
          <span class="glyph">{p.glyph}</span>
          <span class="os">{p.os}</span>
          <span class="fmt">{p.format}</span>
        </a>
      ))}
    </div>

    <div class="source">
      <h3>Or build from source</h3>
      <pre><code>{`git clone https://github.com/darkharasho/sai.git
cd sai
npm install
npm run electron:dev`}</code></pre>
    </div>
  </div>
</section>

<style>
  .tiles {
    margin-top: 32px;
    display: grid;
    grid-template-columns: repeat(3, 1fr);
    gap: 16px;
  }
  .tile {
    display: flex; flex-direction: column; align-items: flex-start; gap: 6px;
    padding: 28px;
    background: var(--bg-elev);
    border: 1px solid var(--border);
    border-radius: var(--radius);
    color: var(--fg);
    transition: border-color 150ms, transform 150ms;
  }
  .tile:hover { border-color: var(--accent); text-decoration: none; transform: translateY(-2px); }
  .tile .glyph {
    font-family: var(--mono); font-size: 0.8rem; color: var(--accent);
    background: var(--accent-soft); padding: 4px 10px; border-radius: 6px;
    letter-spacing: 0.1em; text-transform: uppercase;
  }
  .tile .os { font-size: 1.3rem; font-weight: 700; margin-top: 6px; }
  .tile .fmt { font-family: var(--mono); color: var(--fg-mute); font-size: 0.9rem; }

  .source { margin-top: 56px; }
  .source h3 { margin-bottom: 14px; color: var(--fg-dim); font-family: var(--mono); font-size: 0.9rem; letter-spacing: 0.1em; text-transform: uppercase; }
  .source pre {
    background: var(--bg-panel);
    border: 1px solid var(--border);
    border-radius: var(--radius);
    padding: 20px 24px;
    overflow-x: auto;
    font-family: var(--mono);
    font-size: 0.95rem;
    line-height: 1.7;
    color: var(--fg);
  }

  @media (max-width: 760px) {
    .tiles { grid-template-columns: 1fr; }
  }
</style>
```

- [ ] **Step 2: Wire into index page**

```astro
---
import Layout from '../layouts/Layout.astro';
import Hero from '../components/Hero.astro';
import Screenshot from '../components/Screenshot.astro';
import Providers from '../components/Providers.astro';
import FeatureGrid from '../components/FeatureGrid.astro';
import Download from '../components/Download.astro';
---
<Layout>
  <Hero />
  <Screenshot />
  <Providers />
  <FeatureGrid />
  <Download />
</Layout>
```

- [ ] **Step 3: Build and commit**

```bash
cd site && npm run build
cd ..
git add site/src/components/Download.astro site/src/pages/index.astro
git commit -m "site: add Download section"
```

---

## Task 11: Footer

**Files:**
- Create: `site/src/components/Footer.astro`
- Modify: `site/src/layouts/Layout.astro`

- [ ] **Step 1: Create `site/src/components/Footer.astro`**

```astro
---
---
<footer class="footer">
  <div class="container row">
    <div class="left">
      <span class="wordmark">SAI</span>
      <span class="tagline">Built for developers who'd rather ship than configure.</span>
    </div>
    <nav class="links" aria-label="Footer">
      <a href="https://github.com/darkharasho/sai">GitHub</a>
      <a href="https://github.com/darkharasho/sai/blob/main/LICENSE">License</a>
      <a href="https://github.com/darkharasho/sai/releases">Releases</a>
      <img alt="Latest release" src="https://img.shields.io/github/v/release/darkharasho/sai?style=flat-square&color=c8943e" />
    </nav>
  </div>
</footer>

<style>
  .footer {
    padding: 48px 0;
    border-top: 1px solid var(--border);
    background: var(--bg-elev);
  }
  .row {
    display: flex; align-items: center; justify-content: space-between;
    gap: 24px; flex-wrap: wrap;
  }
  .left { display: flex; align-items: baseline; gap: 14px; flex-wrap: wrap; }
  .wordmark { font-family: var(--mono); font-weight: 700; letter-spacing: 0.08em; }
  .tagline { color: var(--fg-mute); font-size: 0.95rem; }
  .links { display: flex; align-items: center; gap: 20px; flex-wrap: wrap; }
  .links a { color: var(--fg-dim); font-family: var(--mono); font-size: 0.9rem; }
  .links a:hover { color: var(--accent); }
</style>
```

- [ ] **Step 2: Render Footer in Layout**

Modify `site/src/layouts/Layout.astro`. Replace the `<body>` block with:

```astro
  <body>
    <main>
      <slot />
    </main>
    <Footer />
  </body>
```

And at the top of the frontmatter (above `interface Props`), add:

```astro
import Footer from '../components/Footer.astro';
```

- [ ] **Step 3: Build and commit**

```bash
cd site && npm run build
cd ..
git add site/src/components/Footer.astro site/src/layouts/Layout.astro
git commit -m "site: add Footer"
```

---

## Task 12: Manual smoke check

- [ ] **Step 1: Run preview server**

```bash
cd site && npm run preview
```

- [ ] **Step 2: Visit `http://localhost:4321/sai/` and verify:**

- Hero renders with logo, headline, two CTAs, mission-clock animation ticking, phrases cycling, cursor blinking.
- Screenshot renders inside the framed window chrome.
- Providers grid shows three cards (Claude, Codex, Gemini).
- Feature grid shows all eight feature cards.
- Download tiles all link to `https://github.com/darkharasho/sai/releases/latest`.
- Footer shows wordmark, tagline, GitHub/License/Releases links, version badge.
- Resize to ~600px width: hero stacks, all grids collapse to single column.
- `prefers-reduced-motion`: in DevTools rendering panel, enable reduced motion → mission-clock freezes, cursor stops blinking.

- [ ] **Step 3: View page source — verify**

- `<title>` and `<meta name="description">` present.
- OG and Twitter meta tags present.
- Canonical URL is `https://darkharasho.github.io/sai/`.
- Favicon link present.
- All asset URLs include `/sai/` base path.

No commit — this task is verification only.

---

## Task 13: GitHub Pages deploy workflow

**Files:**
- Create: `.github/workflows/deploy-site.yml`

- [ ] **Step 1: Create the workflow**

```yaml
name: Deploy site

on:
  push:
    branches: [main]
    paths:
      - 'site/**'
      - '.github/workflows/deploy-site.yml'
  workflow_dispatch:

permissions:
  contents: read
  pages: write
  id-token: write

concurrency:
  group: pages
  cancel-in-progress: false

jobs:
  build:
    runs-on: ubuntu-latest
    defaults:
      run:
        working-directory: site
    steps:
      - uses: actions/checkout@v4

      - uses: actions/setup-node@v4
        with:
          node-version: 20
          cache: npm
          cache-dependency-path: site/package-lock.json

      - run: npm ci
      - run: npm run build

      - uses: actions/configure-pages@v5

      - uses: actions/upload-pages-artifact@v3
        with:
          path: site/dist

  deploy:
    needs: build
    runs-on: ubuntu-latest
    environment:
      name: github-pages
      url: ${{ steps.deployment.outputs.page_url }}
    steps:
      - id: deployment
        uses: actions/deploy-pages@v4
```

- [ ] **Step 2: Commit**

```bash
git add .github/workflows/deploy-site.yml
git commit -m "ci: deploy marketing site to GitHub Pages"
```

- [ ] **Step 3: One-time manual setup (note to user — not automated)**

In GitHub repo settings → Pages, set "Source" to **GitHub Actions**. Then push `main` or run the workflow via `workflow_dispatch` to publish.

After the first successful run, the site will be live at `https://darkharasho.github.io/sai/`.

---

## Done

Site is built, sectioned, animated, responsive, accessible, and on a working deploy pipeline. Out of scope for any follow-up: blog, changelog page, FAQ, comparison table, analytics.
