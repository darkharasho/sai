# Swarm + Meta Marketing Update Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Advertise Swarm mode and Meta workspaces in README.md and the Astro marketing site, with screenshots and a new flagship feature row.

**Architecture:** Edit the existing README to prepend two new feature sections; extend the marketing site by adding a `flagship` prop to `FeatureCard`, splitting `FeatureGrid` into a flagship row + the existing 8-card grid, and appending two new `<figure>` screenshot blocks. Commit two PNG screenshots into both `public/img/` and `site/public/img/`.

**Tech Stack:** Astro 4, lucide icons, Markdown.

---

## File map

- `public/img/swarm.png` — new (copy from `/tmp/sai-images/image-1778881643174.png`)
- `public/img/meta.png` — new (copy from `/tmp/sai-images/image-1778881722925.png`)
- `site/public/img/swarm.png` — new (same)
- `site/public/img/meta.png` — new (same)
- `README.md` — edit (prepend two feature sections inside `## Features`)
- `site/src/data/features.ts` — edit (add `flagship?: boolean` field; add D-01 + D-02 entries at top)
- `site/src/components/FeatureCard.astro` — edit (accept + render `flagship` prop)
- `site/src/components/FeatureGrid.astro` — edit (flagship row + updated header / legend)
- `site/src/components/Screenshot.astro` — edit (append CHANNEL 03 + 04 figures)

---

### Task 1: Copy screenshots into both image dirs

**Files:**
- Create: `public/img/swarm.png`
- Create: `public/img/meta.png`
- Create: `site/public/img/swarm.png`
- Create: `site/public/img/meta.png`

- [ ] **Step 1: Copy the swarm screenshot**

```bash
cp /tmp/sai-images/image-1778881643174.png public/img/swarm.png
cp /tmp/sai-images/image-1778881643174.png site/public/img/swarm.png
```

- [ ] **Step 2: Copy the meta screenshot**

```bash
cp /tmp/sai-images/image-1778881722925.png public/img/meta.png
cp /tmp/sai-images/image-1778881722925.png site/public/img/meta.png
```

- [ ] **Step 3: Verify all four files exist**

Run: `ls -la public/img/swarm.png public/img/meta.png site/public/img/swarm.png site/public/img/meta.png`
Expected: 4 files listed, each non-zero size.

- [ ] **Step 4: Commit**

```bash
git add public/img/swarm.png public/img/meta.png site/public/img/swarm.png site/public/img/meta.png
git commit -m "docs(marketing): add swarm + meta screenshots"
```

---

### Task 2: Add Swarm + Meta sections to README.md

**Files:**
- Modify: `README.md` (insert after line 33 `## Features`, before line 35 `### Bring your preferred AI CLI`)

- [ ] **Step 1: Insert the two new sections**

Insert the following block immediately after the `## Features` heading (line 33) and before the `### Bring your preferred AI CLI` heading. Preserve a blank line above and below.

```markdown
### Swarm mode — parallel agents in one chat
Spin up multiple Claude tasks from a single orchestrator chat and watch them stream side-by-side. Each writing task runs in its own git worktree on a `swarm/<slug>` branch; reads share the workspace root. Live tool counts, diff stats, and a completion timeline land in the sidebar as tasks finish — review each diff and **Land** individually, or **Land all green** to fast-forward the whole batch into your base branch. Configurable concurrency, approval policy, and a `/spawn` · `/burst` · `/land` slash-command escape hatch when you'd rather drive directly.

<img src="public/img/swarm.png" alt="SAI Swarm: orchestrator chat showing a 5-task batch complete with a completion timeline and a 'Land all green' button" width="1400" />

### Meta workspaces — one chat, many repos
Group N projects into a single named workspace that behaves like a regular project: one chat, one terminal, one editor, one Git panel — spanning every included repo. The AI sees each project as a top-level folder under a clean curated root, so cross-cutting changes ("add the same CI workflow to all six services") happen in one conversation. Per-project chips appear on tool calls, swarm tasks, and the sidebar; the Git panel renders per-repo stage / commit / push / pull controls so you can ship changes to each repo independently from the same surface.

<img src="public/img/meta.png" alt="SAI Meta workspace 'AI Dev Tools' with two repos (sai, tai) in the Git sidebar, each with their own commit/push/pull controls" width="1400" />
```

- [ ] **Step 2: Verify the README still renders cleanly**

Run: `head -60 README.md`
Expected: `### Swarm mode — parallel agents in one chat` appears as the first `###` under `## Features`, followed by the swarm image, then `### Meta workspaces`, then the meta image, then `### Bring your preferred AI CLI`.

- [ ] **Step 3: Commit**

```bash
git add README.md
git commit -m "docs(readme): document Swarm mode and Meta workspaces"
```

---

### Task 3: Add `flagship` field to the Feature type and add D-series entries

**Files:**
- Modify: `site/src/data/features.ts`

- [ ] **Step 1: Update the `Feature` interface and prepend two new entries**

Replace the entire file contents with:

```ts
export interface Feature {
  coord: string;
  title: string;
  blurb: string;
  meta: string;
  icon: string; // lucide icon name (without prefix)
  flagship?: boolean;
}

export const features: Feature[] = [
  {
    coord: 'D-01',
    title: 'Swarm mode',
    blurb: 'Spawn parallel Claude tasks from one orchestrator chat. Each writing task gets its own git worktree; review diffs and land individually, or "land all green" in one go. Slash-command escape hatch included.',
    meta: 'mod · swarm · parallel',
    icon: 'zap',
    flagship: true,
  },
  {
    coord: 'D-02',
    title: 'Meta workspaces',
    blurb: 'Group many projects into one workspace. One chat, one terminal, one editor, one Git panel — spanning every included repo. Per-project chips on tool calls; per-repo stage / commit / push controls.',
    meta: 'mod · meta · multi-repo',
    icon: 'layers',
    flagship: true,
  },
  {
    coord: 'A-01',
    title: 'Project-context chat',
    blurb: 'Talk to your agent inside the editor with your repository already attached. Streaming, image attachments, persistent sessions, full history.',
    meta: 'mod · chat · streaming',
    icon: 'message-square-text',
  },
  {
    coord: 'A-02',
    title: 'Composer queue',
    blurb: 'Queue follow-up prompts behind a streaming turn, promote any item to “next,” or bypass with Enter. Todo-ring and queue badge live in the toolbar.',
    meta: 'mod · composer · queue',
    icon: 'list-checks',
  },
  {
    coord: 'A-03',
    title: 'Approvals & telemetry',
    blurb: 'Provider-specific approval modes, inline tool-call approvals, context/token meters, response timers, and a cumulative turn timer.',
    meta: 'mod · approvals · telemetry',
    icon: 'shield-check',
  },
  {
    coord: 'B-01',
    title: 'Monaco editor & diffs',
    blurb: 'Tabs, syntax highlighting, unsaved-change protection, side-by-side and unified diffs. Open file links from chat, expand snippets to fullscreen.',
    meta: 'mod · editor · diff',
    icon: 'git-compare-arrows',
  },
  {
    coord: 'B-02',
    title: 'Integrated PTY terminal',
    blurb: 'A real PTY terminal — XTerm.js, interactive shell, clickable links, true-color rendering. Runs in your project root, always ready.',
    meta: 'mod · terminal · pty',
    icon: 'terminal',
  },
  {
    coord: 'B-03',
    title: 'First-class Git',
    blurb: 'Stage, commit, branch, push, pull, discard, and review diffs from the sidebar. Background status refresh. Provider-generated commit messages on demand.',
    meta: 'mod · git · sidebar',
    icon: 'git-branch',
  },
  {
    coord: 'C-01',
    title: 'Project-wide search/replace',
    blurb: 'Regex, case, whole-word toggles. Results grouped by file. Inline replace across unsaved buffers in the editor.',
    meta: 'mod · search · replace',
    icon: 'search',
  },
  {
    coord: 'C-02',
    title: 'Plugins & MCP servers',
    blurb: 'Install Claude Code plugins and MCP servers from inside SAI. Dedicated sidebars for installed servers and registry browsing.',
    meta: 'mod · plugins · mcp',
    icon: 'blocks',
  },
];
```

- [ ] **Step 2: Verify the file parses**

Run: `cd site && npx tsc --noEmit -p tsconfig.json && cd ..`
Expected: no type errors.

- [ ] **Step 3: Commit** (deferred — commit after FeatureCard + FeatureGrid changes land so the site stays consistent. Move to Task 4.)

---

### Task 4: Add `flagship` prop support to `FeatureCard.astro`

**Files:**
- Modify: `site/src/components/FeatureCard.astro`

- [ ] **Step 1: Add `flagship` to Props + render-time modifier class**

In the `---` frontmatter block at the top, replace the `interface Props` and `const` lines with:

```astro
---
import { Icon } from 'astro-icon/components';

interface Props {
  coord: string;
  title: string;
  blurb: string;
  meta: string;
  icon: string;
  index: number;
  flagship?: boolean;
}
const { coord, title, blurb, meta, icon, index, flagship = false } = Astro.props;
const n = String(index + 1).padStart(2, '0');
---
```

- [ ] **Step 2: Apply a `flagship` class to the root `<article>`**

Change the existing `<article class="card" style={`--n: ${index}`}>` line to:

```astro
<article class={`card${flagship ? ' card--flagship' : ''}`} style={`--n: ${index}`}>
```

- [ ] **Step 3: Add flagship styling**

Inside the `<style>` block, append the following rules at the end (immediately before the closing `</style>` tag):

```css
  .card--flagship { background: linear-gradient(180deg, rgba(255,180,84,0.06), transparent 40%), var(--ink-2); }
  .card--flagship::before { transform: scaleX(1); height: 3px; }
  .card--flagship .coord { background: var(--phosphor); color: var(--ink); border-color: var(--phosphor); }
  .card--flagship .ic { color: var(--phosphor); }
  .card--flagship .t { font-size: 19px; }
```

- [ ] **Step 4: Verify the file still type-checks**

Run: `cd site && npx tsc --noEmit -p tsconfig.json && cd ..`
Expected: no errors.

---

### Task 5: Render a flagship row above the 8-card grid

**Files:**
- Modify: `site/src/components/FeatureGrid.astro`

- [ ] **Step 1: Split features into flagships + rest, render two grids**

Replace the entire frontmatter `---` block at the top with:

```astro
---
import FeatureCard from './FeatureCard.astro';
import { features } from '../data/features';

const flagships = features.filter(f => f.flagship);
const rest = features.filter(f => !f.flagship);
---
```

- [ ] **Step 2: Update header copy + render the flagship row + the rest**

Replace the entire `<section>` body (lines 5–32 in the original) with:

```astro
<section class="sec sec--console feat" aria-labelledby="feat-title">
  <div class="container">
    <div class="head">
      <p class="eyebrow">Schedule 04 · MODULE INVENTORY</p>
      <h2 id="feat-title" class="head-title">
        <span class="mono">Two flagships.</span>
        <span class="display">Eight supporting modules.</span>
      </h2>
      <p class="head-lede">
        Every part of the SAI cockpit is built for the agent loop — prompt,
        review, run, ship. Nothing bolted on. Nothing in the way.
      </p>
    </div>

    {flagships.length > 0 && (
      <div class="grid grid--flagship">
        {flagships.map((f, i) => (
          <FeatureCard coord={f.coord} title={f.title} blurb={f.blurb} meta={f.meta} icon={f.icon} index={i} flagship={true} />
        ))}
      </div>
    )}

    <div class="grid">
      {rest.map((f, i) => (
        <FeatureCard coord={f.coord} title={f.title} blurb={f.blurb} meta={f.meta} icon={f.icon} index={i + flagships.length} />
      ))}
    </div>

    <p class="legend">
      <span>LEGEND ·</span>
      <span><span class="sw d"></span> D-series · flagship</span>
      <span><span class="sw a"></span> A-series · agent loop</span>
      <span><span class="sw b"></span> B-series · workspace</span>
      <span><span class="sw c"></span> C-series · extensibility</span>
    </p>
  </div>
</section>
```

- [ ] **Step 3: Add flagship-grid + D-series legend CSS**

In the existing `<style>` block, insert the following rules immediately before the `.grid {` rule:

```css
  .grid--flagship {
    display: grid;
    grid-template-columns: repeat(2, 1fr);
    gap: 0;
    border: 1px solid var(--rule-2);
    margin-bottom: 0;
  }
  .grid--flagship > :global(.card) { border: none; border-right: 1px solid var(--rule-2); }
  .grid--flagship > :global(.card:last-child) { border-right: none; }
  .grid--flagship + .grid { border-top: none; }

  @media (max-width: 640px) {
    .grid--flagship { grid-template-columns: 1fr; }
    .grid--flagship > :global(.card) { border-right: none !important; border-bottom: 1px solid var(--rule-2) !important; }
    .grid--flagship > :global(.card:last-child) { border-bottom: none !important; }
  }
```

Then in the existing `.legend .sw.c` rule block area, append:

```css
  .legend .sw.d { background: var(--phosphor); border-color: var(--phosphor); }
```

- [ ] **Step 4: Run dev server, verify layout**

Run: `cd site && npm run dev`
Open the printed URL and verify:
- Two flagship cards (Swarm, Meta) render in a 2-column row at the top with filled amber `D-01` / `D-02` coord badges.
- Eight existing cards (A-01..C-02) render below in their existing 4×2 grid.
- Legend shows D / A / B / C entries.

Stop the dev server when satisfied.

- [ ] **Step 5: Commit Task 3 + 4 + 5 together**

```bash
git add site/src/data/features.ts site/src/components/FeatureCard.astro site/src/components/FeatureGrid.astro
git commit -m "feat(site): add D-series flagship row for Swarm and Meta"
```

---

### Task 6: Append CHANNEL 03 + 04 screenshot figures

**Files:**
- Modify: `site/src/components/Screenshot.astro`

- [ ] **Step 1: Add two new figures inside the `<div class="container">`**

Locate the closing `</figure>` of the existing `CHANNEL · 02` block (around line 66). Immediately after it, before the closing `</div>` of `.container`, insert:

```astro
    <figure class="screen brackets">
      <span class="br-tr"></span><span class="br-bl"></span>
      <header class="screen-bar">
        <span class="lbl">CHANNEL · 03</span>
        <span class="lbl">RES · 1400×900</span>
        <span class="lbl ok">● LIVE</span>
        <span class="lbl mar" data-time-c>--:--:--</span>
      </header>
      <div class="img-wrap">
        <img src={`${base}img/swarm.png`} alt="SAI Swarm mode: orchestrator chat with a 5-task batch complete and a 'Land all green' button" width="1400" height="900" loading="lazy" />
        <span class="aberration" aria-hidden="true"></span>
        <span class="scanlines" aria-hidden="true"></span>
        <span class="reticle reticle-tl" aria-hidden="true">+</span>
        <span class="reticle reticle-tr" aria-hidden="true">+</span>
        <span class="reticle reticle-bl" aria-hidden="true">+</span>
        <span class="reticle reticle-br" aria-hidden="true">+</span>
      </div>
      <footer class="screen-foot">
        <span>FRAME · 00:04:12:03</span>
        <span>EXPOSURE · AUTO</span>
        <span>GAIN · +0db</span>
        <span class="ml">CAM · 03/SWARM</span>
      </footer>
    </figure>

    <figure class="screen brackets">
      <span class="br-tr"></span><span class="br-bl"></span>
      <header class="screen-bar">
        <span class="lbl">CHANNEL · 04</span>
        <span class="lbl">RES · 1400×900</span>
        <span class="lbl ok">● LIVE</span>
        <span class="lbl mar" data-time-d>--:--:--</span>
      </header>
      <div class="img-wrap">
        <img src={`${base}img/meta.png`} alt="SAI Meta workspace 'AI Dev Tools' with two repos in the Git sidebar, each with their own commit/push/pull controls" width="1400" height="900" loading="lazy" />
        <span class="aberration" aria-hidden="true"></span>
        <span class="scanlines" aria-hidden="true"></span>
        <span class="reticle reticle-tl" aria-hidden="true">+</span>
        <span class="reticle reticle-tr" aria-hidden="true">+</span>
        <span class="reticle reticle-bl" aria-hidden="true">+</span>
        <span class="reticle reticle-br" aria-hidden="true">+</span>
      </div>
      <footer class="screen-foot">
        <span>FRAME · 00:05:36:17</span>
        <span>EXPOSURE · AUTO</span>
        <span>GAIN · +0db</span>
        <span class="ml">CAM · 04/META</span>
      </footer>
    </figure>
```

- [ ] **Step 2: Extend the clock script to populate the new timestamps**

Replace the existing inline script block (lines 69–80) with:

```astro
  <script is:inline>
    const targets = document.querySelectorAll('[data-time], [data-time-b], [data-time-c], [data-time-d]');
    if (targets.length) {
      const upd = () => {
        const d = new Date();
        const t = [d.getHours(), d.getMinutes(), d.getSeconds()]
          .map(n => String(n).padStart(2, '0')).join(':');
        targets.forEach(el => { el.textContent = t; });
      };
      upd(); setInterval(upd, 1000);
    }
  </script>
```

- [ ] **Step 3: Run dev server, verify all four screenshots render**

Run: `cd site && npm run dev`
Verify CHANNEL 01, 02, 03 (Swarm), 04 (Meta) all render in order, each with a ticking timestamp in the header.

Stop the dev server when satisfied.

- [ ] **Step 4: Commit**

```bash
git add site/src/components/Screenshot.astro
git commit -m "feat(site): add Swarm and Meta screenshots to landing page"
```

---

### Task 7: Final build verification

- [ ] **Step 1: Build the site to verify no errors**

Run: `cd site && npm run build`
Expected: build completes successfully, no errors. `dist/` is regenerated.

- [ ] **Step 2: Spot-check `site/dist/index.html`**

Run: `grep -c "swarm.png\|meta.png" site/dist/index.html`
Expected: at least `2` (one match per new screenshot).

- [ ] **Step 3: No commit needed — `site/dist` is gitignored or already excluded; if it is tracked, run `git status` to confirm no unintended changes.**

Run: `git status`
Expected: clean tree (or only `site/dist/` changes if tracked).
