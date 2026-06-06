# Holistic Design Refresh Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Overhaul the design token layer and update all major components to produce a cleaner, more premium dark UI with consistent spacing, typography, surfaces, and borders.

**Architecture:** Foundation-first — update `src/styles/globals.css` with a complete token system (surface elevation, border tiers, type scale, spacing scale, radius scale) and semantic aliases for backwards compat. Then update each component's embedded `<style>` tag to use the new tokens explicitly. Components already use CSS vars throughout, so alias forwarding means many changes cascade automatically; component passes refine the remaining hardcoded values.

**Tech Stack:** React, Electron, inline `<style>` tags with CSS custom properties, Vitest (for regression checks), dev server via `npm run dev`

---

## Task 0: Create the branch

**Files:**
- (none — git only)

- [ ] **Step 1: Create and switch to the design refresh branch**

```bash
git checkout -b design-refresh
```

Expected output: `Switched to a new branch 'design-refresh'`

- [ ] **Step 2: Verify clean working tree**

```bash
git status
```

Expected: `nothing to commit, working tree clean`

---

## Task 1: Token Layer — update `globals.css`

**Files:**
- Modify: `src/styles/globals.css` (`:root` block at lines 1–42)

- [ ] **Step 1: Replace the `:root` token block**

Open `src/styles/globals.css` and replace the entire `:root { ... }` block (lines 1–42) with:

```css
:root {
  /* ── Surface elevation (5-step ladder) ── */
  --surface-0: #090c0e;   /* window bg, nav bar */
  --surface-1: #0f1318;   /* sidebars, panels, main area */
  --surface-2: #161b22;   /* cards, inputs, code blocks */
  --surface-3: #1d2430;   /* modals, dropdowns, tool card headers */
  --surface-4: #252d3a;   /* hover, selected */

  /* Semantic aliases — keep old names working during component migration */
  --bg-primary:   var(--surface-1);
  --bg-secondary: var(--surface-0);
  --bg-mid:       var(--surface-0);
  --bg-input:     var(--surface-2);
  --bg-hover:     var(--surface-4);
  --bg-elevated:  var(--surface-3);

  /* ── Borders (tiered) ── */
  --border-hairline: #161f28;              /* internal structure, separators */
  --border-subtle:   #1e2a38;             /* panel/card edges (default) */
  --border-strong:   #2e3d4e;             /* focus rings, active states */
  --border-accent:   rgba(212,160,23,0.35); /* selected/highlighted */

  /* Alias — old --border maps to subtle tier */
  --border: var(--border-subtle);

  /* ── Accent (refined gold) ── */
  --accent:       #d4a017;
  --accent-hover: #f0b820;
  --accent-dim:   rgba(212,160,23,0.12);  /* icon bg, selection tints */
  --accent-rgb:   212, 160, 23;           /* for rgba() usage */

  /* ── Text ── */
  --text:           #bec6d0;
  --text-secondary: #8a97a8;
  --text-muted:     #4d5d6d;

  /* ── Status colors ── */
  --blue:      #4a9fd4;
  --green:     #2ea87e;
  --orange:    #d4770c;
  --pink:      #d46ec0;
  --purple:    #9c6ef0;
  --red:       #d45c3c;
  --yellow:    #d4a017;
  --turquoise: #38c7bd;

  /* ── Type scale ── */
  --text-xs:   11px;   /* timestamps, labels, metadata */
  --text-sm:   12px;   /* secondary UI, sidebar items */
  --text-base: 13px;   /* body (default) */
  --text-md:   14px;   /* chat message body */
  --text-lg:   15px;   /* section headings, panel titles */
  --text-xl:   17px;   /* page-level headings */

  /* ── Spacing scale (4px base) ── */
  --sp-1:  4px;
  --sp-2:  8px;
  --sp-3:  12px;
  --sp-4:  16px;
  --sp-5:  20px;
  --sp-6:  24px;
  --sp-8:  32px;
  --sp-10: 40px;
  --sp-12: 48px;

  /* ── Radius scale ── */
  --radius-xs: 2px;    /* tags, badges */
  --radius-sm: 4px;    /* buttons, small elements */
  --radius-md: 6px;    /* cards, inputs */
  --radius-lg: 10px;   /* panels */
  --radius-xl: 14px;   /* modals */

  /* ── Papery dash divider ── */
  --divider-dash: repeating-linear-gradient(
    90deg,
    var(--border-hairline) 0 7px,
    transparent 7px 13px
  );

  /* ── Layout ── */
  --nav-width:          48px;
  --sidebar-width:      300px;
  --titlebar-height:    38px;
  --terminal-min-height: 150px;

  /* ── Motion ── */
  --ease-out-soft: cubic-bezier(0.2, 0.8, 0.2, 1);
  --dur-fast:  120ms;
  --dur-base:  180ms;

  font-family: 'Geist', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
  font-size: var(--text-base);
  color: var(--text);
  background: var(--surface-1);
}
```

- [ ] **Step 2: Update the scrollbar rule (line ~183)**

Find:
```css
::-webkit-scrollbar { width: 8px; }
::-webkit-scrollbar-track { background: transparent; }
::-webkit-scrollbar-thumb { background: var(--border); border-radius: 4px; transition: background 0.2s; }
::-webkit-scrollbar-thumb:hover { background: var(--accent); }
```

Replace with:
```css
::-webkit-scrollbar { width: 6px; }
::-webkit-scrollbar-track { background: transparent; }
::-webkit-scrollbar-thumb { background: var(--border-subtle); border-radius: 3px; transition: background 0.2s; }
::-webkit-scrollbar-thumb:hover { background: var(--accent); }
```

- [ ] **Step 3: Run existing tests to confirm no regressions**

```bash
npm run test -- --maxWorkers=2 2>&1 | tail -20
```

Expected: all tests pass (CSS token changes don't affect logic tests).

- [ ] **Step 4: Start dev server and visually verify**

```bash
npm run dev
```

Open the app. The overall look should already shift — darker nav/window frame, slightly adjusted surfaces. Nothing should be broken. If the app fails to open, check the terminal for errors.

- [ ] **Step 5: Commit**

```bash
git add src/styles/globals.css
git commit -m "feat(design): add full token system to globals.css

Surface elevation ladder, tiered borders, type scale, spacing scale,
radius scale, accent-dim. Semantic aliases keep old var names working."
```

---

## Task 2: NavBar

**Files:**
- Modify: `src/components/NavBar.tsx` (embedded `<style>` tag, ~250 lines total)

The NavBar uses: `--bg-secondary`, `--border`, `--text-muted`, `--accent`, `--bg-hover`, `--bg-input`, `--bg-primary`, `--bg-elevated`.

- [ ] **Step 1: Update the `.navbar` container**

Find in the embedded `<style>`:
```css
.navbar {
```

Ensure `background` uses `--surface-0` explicitly (not alias) so it reads as the darkest layer:

Find any line like `background: var(--bg-secondary)` or `background: var(--bg-primary)` inside `.navbar { ... }` and change to:
```css
  background: var(--surface-0);
  border-right: 1px solid var(--border-hairline);
```

- [ ] **Step 2: Update nav button active/hover states**

Find `.nav-btn` active state (look for `background` on `.nav-btn.active` or `.nav-btn[data-active]`):

Replace the active background with:
```css
  background: var(--accent-dim);
  color: var(--accent);
```

Find hover state on `.nav-btn`:
```css
  background: var(--surface-2);
```

- [ ] **Step 3: Verify in dev server**

With `npm run dev` still running, check:
- Nav bar is visibly darker than the sidebar — depth separation is clear
- Active icon has the gold dim background
- Hover states work

- [ ] **Step 4: Commit**

```bash
git add src/components/NavBar.tsx
git commit -m "feat(design): update NavBar to surface-0, accent-dim active states"
```

---

## Task 3: Tool Call Cards

**Files:**
- Modify: `src/components/Chat/ToolCallCard.tsx` (embedded `<style>` tag, ~1932 lines total)

The ToolCallCard is the most visible component after the token change. Key targets: card container, header background, border, status colors.

- [ ] **Step 1: Update card container border and radius**

In the embedded `<style>`, find `.tool-call-card`:

Replace or update:
```css
.tool-call-card {
  background: var(--surface-2);
  border: 1px solid var(--border-subtle);
  border-radius: var(--radius-md);
  overflow: hidden;
}
```

- [ ] **Step 2: Update card header background**

Find `.tool-call-header` (the clickable header row):

```css
.tool-call-header {
  background: var(--surface-3);
  border-bottom: 1px solid var(--border-hairline);
}
```

- [ ] **Step 3: Update tool name / path text sizes**

Find where the tool name and path are styled (look for font-size declarations near `.tool-call-header`). Set:
- Tool name (e.g. "Read", "Edit", "Bash"): `font-size: var(--text-xs); font-weight: 600;`
- Path argument: `font-size: var(--text-xs); color: var(--text-secondary);`

- [ ] **Step 4: Update all `--border` references to `--border-hairline` for internal separators**

Within the ToolCallCard style block, do a targeted find-replace:

Any `border` or `border-top`/`border-bottom` that separates content *inside* the card (not the outer card border) should use `var(--border-hairline)`.

Lines that already use `var(--border)` for internal separators: update to `var(--border-hairline)`.

The outer card border: use `var(--border-subtle)`.

- [ ] **Step 5: Verify in dev server**

Run a tool call in the chat. Check:
- Card has the new surface-3 header (noticeably distinct from body)
- Card border is subtle, not heavy
- Expansion/collapse animation still works

- [ ] **Step 6: Commit**

```bash
git add src/components/Chat/ToolCallCard.tsx
git commit -m "feat(design): update ToolCallCard surfaces, border tiers, type sizes"
```

---

## Task 4: Chat Messages

**Files:**
- Modify: `src/components/Chat/ChatMessage.tsx` (embedded `<style>` tag, ~1173 lines total)

- [ ] **Step 1: Update message body font size**

Find `.chat-msg` or the message body text rule with `font-size`. Update:
```css
font-size: var(--text-md);   /* 14px — comfortable reading */
line-height: 1.55;
```

- [ ] **Step 2: Update code inline styling**

Find `code` inline styling within chat messages (usually `background: var(--bg-secondary)` or similar):
```css
background: var(--surface-3);
border: 1px solid var(--border-hairline);
border-radius: var(--radius-xs);
font-size: var(--text-sm);
padding: 1px 4px;
```

- [ ] **Step 3: Update pre/code block styling**

Find `.code-block-wrapper` or `pre` within the message style block:
```css
background: var(--surface-2);
border: 1px solid var(--border-subtle);
border-radius: var(--radius-md);
```

- [ ] **Step 4: Update `--border` references to appropriate tiers**

Scan the embedded style block for `var(--border)` and reclassify:
- Separators between messages or sections → `var(--border-hairline)`
- Card/block borders → `var(--border-subtle)`
- Keep accent-colored borders as-is

- [ ] **Step 5: Verify in dev server**

Send a message in chat and check:
- Message text is slightly larger (14px) and comfortable
- Inline code has the surface-3 background with hairline border
- Code blocks have the correct depth

- [ ] **Step 6: Commit**

```bash
git add src/components/Chat/ChatMessage.tsx
git commit -m "feat(design): update ChatMessage type sizes and border tiers"
```

---

## Task 5: Chat Input

**Files:**
- Modify: `src/components/Chat/ChatInput.tsx` (embedded `<style>` tag, ~1983 lines total)

- [ ] **Step 1: Update input box border and radius**

Find `.input-box` or `.input-wrapper` (the textarea container):
```css
background: var(--surface-2);
border: 1px solid var(--border-subtle);
border-radius: var(--radius-md);   /* 6px */
```

Find the focus state (`:focus-within` or `.focused`):
```css
border-color: var(--border-strong);
```

- [ ] **Step 2: Update send button**

Find the send/submit button styling:
```css
background: var(--accent);
color: #000;
border-radius: var(--radius-sm);   /* 4px */
font-weight: 600;
```

- [ ] **Step 3: Update autocomplete dropdown**

Find `.autocomplete-dropdown`:
```css
background: var(--surface-3);
border: 1px solid var(--border-subtle);
border-radius: var(--radius-md);
```

Selected item in dropdown:
```css
background: var(--surface-4);
```

- [ ] **Step 4: Scan for `--border` → tier**

Same as previous tasks: internal separators → `--border-hairline`, outer containers → `--border-subtle`.

- [ ] **Step 5: Verify in dev server**

Click the input, type, and check:
- Input has surface-2 background with subtle border
- Focus ring upgrades to border-strong (more visible but not harsh)
- Autocomplete dropdown (try typing `/`) has surface-3 background
- Send button is gold with rounded corners

- [ ] **Step 6: Commit**

```bash
git add src/components/Chat/ChatInput.tsx
git commit -m "feat(design): update ChatInput borders, radius, send button, dropdown"
```

---

## Task 6: File Explorer Sidebar

**Files:**
- Modify: `src/components/FileExplorer/FileExplorerSidebar.tsx` (~658 lines)

- [ ] **Step 1: Update sidebar container**

Find the sidebar wrapper styling (look for `--sidebar-width` usage or the outer container):
```css
background: var(--surface-1);
border-right: 1px solid var(--border-subtle);
```

- [ ] **Step 2: Update tree row items (compact density)**

Find `.tree-row`:
```css
font-size: var(--text-sm);   /* 12px compact */
padding: 3px var(--sp-3);    /* 3px vertical, 12px horizontal */
```

Find hover state:
```css
background: var(--surface-4);
```

Find selected/active state:
```css
background: var(--accent-dim);
color: var(--accent);
```

- [ ] **Step 3: Update sidebar section headers**

Find the section header (project root row or group headers):
```css
font-size: var(--text-xs);
font-weight: 600;
color: var(--text-secondary);
text-transform: uppercase;
letter-spacing: 0.06em;
padding: var(--sp-2) var(--sp-3);
border-bottom: 1px solid var(--border-hairline);
```

- [ ] **Step 4: Verify in dev server**

Open the file explorer sidebar. Check:
- Items are compact (12px, tight padding)
- Hover state is surface-4 (visible but not harsh)
- Active/selected item has gold dim background
- Section header is small-caps, muted

- [ ] **Step 5: Commit**

```bash
git add src/components/FileExplorer/FileExplorerSidebar.tsx
git commit -m "feat(design): update FileExplorer compact density, surface tokens"
```

---

## Task 7: Git Sidebar

**Files:**
- Modify: `src/components/Git/GitSidebar.tsx` (or equivalent — find the main git sidebar component)

- [ ] **Step 1: Find the git sidebar file**

```bash
ls src/components/Git/
```

Identify the main sidebar component (likely `GitSidebar.tsx` or `GitPanel.tsx`).

- [ ] **Step 2: Apply same sidebar pattern as FileExplorer**

In the embedded style tag:
- Container: `background: var(--surface-1); border-right: 1px solid var(--border-subtle);`
- Section headers: `font-size: var(--text-xs); font-weight: 600; text-transform: uppercase; letter-spacing: 0.06em; color: var(--text-secondary);`
- File items: `font-size: var(--text-sm); padding: 3px var(--sp-3);`
- Hover: `background: var(--surface-4);`
- Status letter (M/A/D): `font-size: var(--text-xs); font-weight: 600;`

- [ ] **Step 3: Update action buttons (Commit, Stash, etc.)**

Primary button (Commit):
```css
background: var(--accent);
color: #000;
font-size: var(--text-sm);
font-weight: 600;
padding: 5px var(--sp-2);
border-radius: var(--radius-sm);
```

Secondary button (Stash, Discard):
```css
background: var(--surface-3);
color: var(--text-secondary);
border: 1px solid var(--border-subtle);
font-size: var(--text-sm);
padding: 5px var(--sp-2);
border-radius: var(--radius-sm);
```

- [ ] **Step 4: Verify in dev server**

Open the Git sidebar. Check:
- File list is compact and readable
- M/A/D status letters are visible
- Commit button is gold, Stash button is secondary style

- [ ] **Step 5: Commit**

```bash
git add src/components/Git/
git commit -m "feat(design): update Git sidebar to new token system"
```

---

## Task 8: Remaining Sidebars & Panels Sweep

**Files:**
- Modify: any sidebar/panel components not yet touched — Search, Settings, Swarm, MCP, Plugins panels

- [ ] **Step 1: Find remaining sidebar components**

```bash
find src/components -name "*.tsx" | xargs grep -l "bg-secondary\|bg-primary\|bg-hover" | grep -v "ChatMessage\|ChatInput\|ToolCallCard\|NavBar\|FileExplorer\|Git"
```

Review the list. Touch each one that has a visible sidebar or panel.

- [ ] **Step 2: For each file, apply the sidebar pattern**

For every sidebar/panel component found:

```css
/* Container */
background: var(--surface-1);
border-right: 1px solid var(--border-subtle); /* or border-left for right sidebars */

/* Section header */
font-size: var(--text-xs);
font-weight: 600;
text-transform: uppercase;
letter-spacing: 0.06em;
color: var(--text-secondary);
border-bottom: 1px solid var(--border-hairline);

/* Row items */
font-size: var(--text-sm);
padding: 4px var(--sp-3);

/* Hover */
background: var(--surface-4);

/* Active/selected */
background: var(--accent-dim);
color: var(--accent);
```

Replace any `--border` used as a separator → `--border-hairline`.

- [ ] **Step 3: Verify in dev server**

Cycle through each sidebar (click each nav icon). Check for consistency — all panels should feel like the same design system.

- [ ] **Step 4: Commit**

```bash
git add src/components/
git commit -m "feat(design): sweep remaining panels/sidebars to new token system"
```

---

## Task 9: Global Button & Input Sweep

**Files:**
- Modify: any component with standalone button or input styling not yet covered

- [ ] **Step 1: Find button styling across components**

```bash
grep -rn "border-radius.*[0-9]px" src/components --include="*.tsx" | grep -v "ToolCallCard\|ChatMessage\|ChatInput\|NavBar\|FileExplorer\|Git" | head -40
```

Review which components have hardcoded border-radius values on buttons/inputs.

- [ ] **Step 2: Update button patterns**

For each component found, update button styles to follow the token pattern:

Primary action button:
```css
background: var(--accent);
color: #000;
font-size: var(--text-sm);
font-weight: 600;
padding: 5px var(--sp-2);
border-radius: var(--radius-sm);
border: none;
```

Secondary button:
```css
background: var(--surface-3);
color: var(--text-secondary);
font-size: var(--text-sm);
padding: 5px var(--sp-2);
border-radius: var(--radius-sm);
border: 1px solid var(--border-subtle);
```

Ghost button:
```css
background: transparent;
color: var(--text-secondary);
font-size: var(--text-sm);
padding: 5px var(--sp-2);
border-radius: var(--radius-sm);
border: none;
```
Ghost hover: `background: var(--surface-4);`

- [ ] **Step 3: Verify modals**

Open the Settings modal and GitHub modal (if available). Check:
- Modal background: `--surface-3` (elevated)
- Modal border: `1px solid var(--border-subtle)`
- Modal border-radius: `--radius-xl` (14px)
- Buttons inside modal follow the button pattern above

- [ ] **Step 4: Commit**

```bash
git add src/components/
git commit -m "feat(design): sweep buttons/inputs to token system across all components"
```

---

## Task 10: Final Visual Pass & PR

**Files:**
- (none — verification and branch push only)

- [ ] **Step 1: Run tests one more time**

```bash
npm run test -- --maxWorkers=2 2>&1 | tail -20
```

Expected: all tests pass.

- [ ] **Step 2: Full visual walkthrough**

With `npm run dev` running, check every major screen:

| Screen | What to verify |
|---|---|
| Chat | Surface depth, tool card headers, comfortable message text (14px) |
| File Explorer sidebar | Compact items, gold active state, muted header |
| Git sidebar | File status colors, action buttons, compact density |
| Search panel | Consistent with other sidebars |
| Settings modal | Elevated surface, radius-xl, button consistency |
| Nav bar | Darkest surface, gold active icon |

- [ ] **Step 3: Push branch**

```bash
git push -u origin design-refresh
```

- [ ] **Step 4: Optionally open a draft PR for review**

```bash
gh pr create --draft --title "feat(design): holistic design refresh" --body "$(cat <<'EOF'
Foundation-first design refresh:

- New token system: 5-step surface elevation, tiered borders, type scale, spacing scale, radius scale
- Refined gold accent (#d4a017)
- Contextual density: compact sidebars, comfortable chat
- All major components updated: NavBar, ToolCallCard, ChatMessage, ChatInput, FileExplorer, Git, remaining panels

Exploratory branch — working toward a cleaner, more premium dark UI.
EOF
)"
```

---

## Reference: Key Token Mappings

Quick reference for updating any component not covered above:

| Old var | New var | Notes |
|---|---|---|
| `--bg-secondary` | `--surface-0` | Alias exists; use explicit for nav |
| `--bg-primary` | `--surface-1` | Alias exists; default panel bg |
| `--bg-input` | `--surface-2` | Alias exists; cards, inputs |
| `--bg-elevated` | `--surface-3` | Alias exists; modals, dropdowns |
| `--bg-hover` | `--surface-4` | Alias exists; hover/selected |
| `--border` | `--border-subtle` | Alias exists; outer containers |
| `--border` (internal) | `--border-hairline` | Manual — separators inside panels |
| (new) | `--border-strong` | Focus rings, active borders |
| (new) | `--border-accent` | Selected with gold tint |
| (new) | `--accent-dim` | Active icon bg, selection tints |
