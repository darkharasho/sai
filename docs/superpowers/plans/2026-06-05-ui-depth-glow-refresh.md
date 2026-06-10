# Depth & Glow UI Refresh — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Apply a token-driven "depth & glow" visual refresh across SAI's surfaces — layered gradients, accent glow on stateful elements, and card elevation — without changing layout or behavior.

**Architecture:** A small set of depth design tokens is added to each theme's `vars` in `src/themes.ts` (and mirrored as Default-theme fallbacks in `src/styles/globals.css`). `applyTheme()` already pushes every `vars` entry onto `document.documentElement`, so the tokens become live automatically. Each surface is then restyled by editing its component's inline `<style>{`…`}` block to consume the new tokens. Two constraints are locked by guard tests before any restyling: the `ThinkingAnimation` and the `ChatInput` structure stay intact.

**Tech Stack:** React + TypeScript, Vite/Electron, inline `<style>` blocks consuming CSS custom properties, Vitest (projects: `unit` [jsdom], `integration` [node], `swarm` [node]).

**Spec:** `docs/superpowers/specs/2026-06-05-ui-depth-glow-refresh-design.md`

**Test runner note:** This machine limits Vitest workers. Always run with `--maxWorkers=2` (e.g. `npx vitest run --project unit --maxWorkers=2`).

---

## File Structure

**Foundation (the engine):**
- `src/themes.ts` — add 8 depth tokens to each of the 3 themes' `vars` objects. (Modify)
- `src/styles/globals.css` — add the same 8 tokens to `:root` as Default-theme fallbacks. (Modify)

**Guard tests (lock constraints before restyling):**
- `tests/unit/themes-depth-tokens.test.ts` — every theme defines every depth token. (Create)
- `tests/unit/thinking-animation-preserved.test.tsx` — `ThinkingAnimation` still renders `SaiLogo`, not a generic icon. (Create)
- `tests/unit/chat-input-structure.test.tsx` — `ChatInput` still renders its core structural nodes. (Create)

**Surface restyles (each edits an inline `<style>` block to consume tokens — no JSX/structure change unless noted):**
- `src/components/NavBar.tsx` — nav rail + active icon.
- Sidebar files: `src/components/FileExplorer/`, `src/components/Swarm/SwarmSidebar.tsx`, `src/components/MCP/McpSidebar.tsx`, `src/components/Plugins/PluginsSidebar.tsx`, `src/components/SearchPanel/SearchPanel.css`, `src/components/Chat/ChatHistorySidebar.tsx` — selected-row treatment + panel elevation.
- `src/components/Chat/ChatMessage.tsx` — user-bubble elevation + optional `ThinkingAnimation` frame.
- Card files: `src/components/Chat/ToolCallCard.tsx`, `PlanReviewCard.tsx`, `TodoProgress.tsx`, `LinkPreviewChip.tsx`, `GitHubWatcherCard.tsx`, `src/components/Swarm/SwarmTaskRow.tsx` — elevation + gradient edges.
- `src/components/Swarm/ActivityRibbon.tsx` — living-status sweep.
- Modal files: `src/components/SettingsModal.tsx` + other `*-modal-overlay` owners — elevated surface.
- `src/components/Chat/ChatInput.tsx` — refinement only.

---

## Token reference (use these exact values)

Add these 8 keys to each theme. Values differ per theme (themed, not hardcoded).

**Default theme `vars` (also the `:root` fallback values in `globals.css`):**
```
'--elev-1': 'linear-gradient(180deg, #12171d 0%, #0f141a 100%)',
'--elev-2': 'linear-gradient(180deg, #161c22 0%, #11161c 100%)',
'--elev-3': 'linear-gradient(180deg, #1c2027 0%, #151a20 100%)',
'--elev-highlight': 'inset 0 1px 0 rgba(255,255,255,0.045)',
'--glow-accent': '0 0 16px rgba(199,145,12,0.30)',
'--glow-focus': '0 0 0 3px rgba(245,184,50,0.15)',
'--shadow-card': '0 4px 16px rgba(0,0,0,0.40)',
'--gradient-accent': 'linear-gradient(135deg, #f5b832 0%, #c7910c 100%)',
```

**Midnight theme `vars`:**
```
'--elev-1': 'linear-gradient(180deg, #1a1722 0%, #15121c 100%)',
'--elev-2': 'linear-gradient(180deg, #1e1b26 0%, #18151f 100%)',
'--elev-3': 'linear-gradient(180deg, #232030 0%, #1b1826 100%)',
'--elev-highlight': 'inset 0 1px 0 rgba(255,255,255,0.05)',
'--glow-accent': '0 0 16px rgba(160,126,232,0.32)',
'--glow-focus': '0 0 0 3px rgba(185,154,240,0.16)',
'--shadow-card': '0 4px 16px rgba(0,0,0,0.45)',
'--gradient-accent': 'linear-gradient(135deg, #b99af0 0%, #a07ee8 100%)',
```

**Steel theme `vars` (lighter base — lighter highlight, softer shadow):**
```
'--elev-1': 'linear-gradient(180deg, #4c4f58 0%, #44474f 100%)',
'--elev-2': 'linear-gradient(180deg, #52555e 0%, #4a4d56 100%)',
'--elev-3': 'linear-gradient(180deg, #585b64 0%, #4f525b 100%)',
'--elev-highlight': 'inset 0 1px 0 rgba(255,255,255,0.07)',
'--glow-accent': '0 0 16px rgba(77,166,212,0.35)',
'--glow-focus': '0 0 0 3px rgba(107,188,224,0.20)',
'--shadow-card': '0 4px 16px rgba(0,0,0,0.30)',
'--gradient-accent': 'linear-gradient(135deg, #6bbce0 0%, #4da6d4 100%)',
```

The exported `DEPTH_TOKEN_KEYS` constant (Task 1) is the single source of truth for these key names.

---

## Task 1: Depth token foundation

**Files:**
- Modify: `src/themes.ts` (each theme's `vars`; add exported key list)
- Modify: `src/styles/globals.css:1-22` (`:root` block)
- Test: `tests/unit/themes-depth-tokens.test.ts` (create)

- [ ] **Step 1: Write the failing test**

Create `tests/unit/themes-depth-tokens.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { THEMES, DEPTH_TOKEN_KEYS } from '../../src/themes';

describe('depth tokens', () => {
  it('defines all depth tokens in every theme', () => {
    for (const theme of THEMES) {
      for (const key of DEPTH_TOKEN_KEYS) {
        expect(theme.vars[key], `${theme.id} missing ${key}`).toBeTruthy();
      }
    }
  });

  it('exposes at least the three known themes', () => {
    expect(THEMES.map(t => t.id)).toEqual(
      expect.arrayContaining(['default', 'midnight', 'steel']),
    );
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run --project unit tests/unit/themes-depth-tokens.test.ts --maxWorkers=2`
Expected: FAIL — `DEPTH_TOKEN_KEYS` is not exported from `src/themes.ts`.

- [ ] **Step 3: Add the token key list and tokens**

In `src/themes.ts`, after the `ThemeId` type (near the top), add:
```ts
export const DEPTH_TOKEN_KEYS = [
  '--elev-1', '--elev-2', '--elev-3', '--elev-highlight',
  '--glow-accent', '--glow-focus', '--shadow-card', '--gradient-accent',
] as const;
```

Then add the 8 token entries to each theme's `vars` object using the exact values from the **Token reference** section above (Default values into the `default` theme, Midnight into `midnight`, Steel into `steel`).

- [ ] **Step 4: Mirror Default tokens into globals.css**

In `src/styles/globals.css`, inside the `:root { … }` block (after `--turquoise`), add the **Default theme** token values in CSS syntax:
```css
  --elev-1: linear-gradient(180deg, #12171d 0%, #0f141a 100%);
  --elev-2: linear-gradient(180deg, #161c22 0%, #11161c 100%);
  --elev-3: linear-gradient(180deg, #1c2027 0%, #151a20 100%);
  --elev-highlight: inset 0 1px 0 rgba(255,255,255,0.045);
  --glow-accent: 0 0 16px rgba(199,145,12,0.30);
  --glow-focus: 0 0 0 3px rgba(245,184,50,0.15);
  --shadow-card: 0 4px 16px rgba(0,0,0,0.40);
  --gradient-accent: linear-gradient(135deg, #f5b832 0%, #c7910c 100%);
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run --project unit tests/unit/themes-depth-tokens.test.ts --maxWorkers=2`
Expected: PASS (both tests).

- [ ] **Step 6: Commit**
```bash
git add src/themes.ts src/styles/globals.css tests/unit/themes-depth-tokens.test.ts
git commit -m "feat(ui): add depth & glow design tokens to themes"
```

---

## Task 2: Lock the preservation constraints with guard tests

**Files:**
- Test: `tests/unit/thinking-animation-preserved.test.tsx` (create)
- Test: `tests/unit/chat-input-structure.test.tsx` (create)

> These tests pin the two locked constraints so later restyle tasks can't silently break them. They assert behavior/structure, not appearance.

- [ ] **Step 1: Write the ThinkingAnimation guard test**

Create `tests/unit/thinking-animation-preserved.test.tsx`:
```tsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render } from '@testing-library/react';
import ThinkingAnimation from '../../src/components/ThinkingAnimation';

beforeEach(() => {
  // SaiLogo path is keyed off the animation pref; force it on.
  (window as any).sai = { settingsGet: vi.fn().mockResolvedValue(true) };
});

describe('ThinkingAnimation preserved', () => {
  it('renders the SaiLogo (not a generic lucide icon) and the clock', () => {
    const { container } = render(<ThinkingAnimation />);
    // SaiLogo renders an <svg>; the clock span carries the elapsed time.
    expect(container.querySelector('svg')).not.toBeNull();
    expect(container.querySelector('.thinking-clock')).not.toBeNull();
    expect(container.querySelector('.thinking-text')).not.toBeNull();
  });
});
```

- [ ] **Step 2: Run it to verify it passes against current code**

Run: `npx vitest run --project unit tests/unit/thinking-animation-preserved.test.tsx --maxWorkers=2`
Expected: PASS — this guards existing behavior. If it fails, stop and check the render setup (jsdom, `@testing-library/react` is already a dependency used by other unit tests).

- [ ] **Step 3: Write the ChatInput structure guard test**

Create `tests/unit/chat-input-structure.test.tsx`. Render `ChatInput` with the minimum props it needs (inspect the current `ChatInputProps` interface in `src/components/Chat/ChatInput.tsx` and pass no-op handlers / empty values), then assert the structural nodes exist:
```tsx
import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import ChatInput from '../../src/components/Chat/ChatInput';

describe('ChatInput structure preserved', () => {
  it('renders the textarea, input-box, and toolbar', () => {
    // NOTE: fill props from the real ChatInputProps interface — use empty
    // arrays/strings and vi.fn() no-ops for required callbacks.
    const { container } = render(<ChatInput {...(MINIMAL_PROPS as any)} />);
    expect(container.querySelector('.chat-textarea')).not.toBeNull();
    expect(container.querySelector('.input-box')).not.toBeNull();
    expect(container.querySelector('.input-toolbar')).not.toBeNull();
  });
});
```
Define `MINIMAL_PROPS` at the top of the file by reading the `ChatInputProps` interface and supplying each required field (empty string/array/object, `vi.fn()` for functions). Do not stub internals — render the real component.

- [ ] **Step 4: Run it to verify it passes against current code**

Run: `npx vitest run --project unit tests/unit/chat-input-structure.test.tsx --maxWorkers=2`
Expected: PASS. If a required prop is missing, the error names it — add it to `MINIMAL_PROPS` and rerun.

- [ ] **Step 5: Commit**
```bash
git add tests/unit/thinking-animation-preserved.test.tsx tests/unit/chat-input-structure.test.tsx
git commit -m "test(ui): guard ThinkingAnimation and ChatInput against refresh regressions"
```

---

## Task 3: Nav rail — active icon glow + rail gradient

**Files:**
- Modify: `src/components/NavBar.tsx` (the inline `<style>{`…`}` block around line 91)

> Visual task: verified by eye + the guard suite staying green. No new unit assertions (CSS appearance isn't unit-testable here).

- [ ] **Step 1: Locate the nav styles**

In `src/components/NavBar.tsx`, open the `<style>{`…`}` block. Find the rail container rule (e.g. `.navbar`) and the active-item rule (the selector applied to the selected nav button, e.g. `.navbar .nav-item.active` / `.nav-btn.active` — confirm the exact name in the block).

- [ ] **Step 2: Apply tokens to the rail container**

Add to the rail container rule:
```css
  background-image: var(--elev-1);
  box-shadow: var(--elev-highlight);
```

- [ ] **Step 3: Apply gradient + glow to the active icon**

Add to the active nav-item rule:
```css
  background: var(--gradient-accent);
  box-shadow: var(--glow-accent), var(--elev-highlight);
  color: #0d0b07;
```
If the active rule sets a flat `background` already, replace that line with the `var(--gradient-accent)` line.

- [ ] **Step 4: Verify visually**

Run the app (`npm run dev` per the existing workflow, or the `run` skill). Confirm: rail has subtle vertical depth; the active icon glows amber. Toggle through all three themes (Settings → theme) and confirm the glow tracks each theme's accent (amber / purple / blue).

- [ ] **Step 5: Run the guard suite**

Run: `npx vitest run --project unit --maxWorkers=2`
Expected: PASS (no regressions).

- [ ] **Step 6: Commit**
```bash
git add src/components/NavBar.tsx
git commit -m "style(ui): depth & glow on nav rail and active icon"
```

---

## Task 4: Sidebars — selected row + panel elevation

**Files:**
- Modify (inline `<style>` blocks unless noted): `src/components/Swarm/SwarmSidebar.tsx`, `src/components/MCP/McpSidebar.tsx`, `src/components/Plugins/PluginsSidebar.tsx`, `src/components/Chat/ChatHistorySidebar.tsx`, `src/components/FileExplorer/` (the explorer component's style block)
- Modify: `src/components/SearchPanel/SearchPanel.css` (external stylesheet — same edits, plain CSS)

- [ ] **Step 1: Define the shared selected-row recipe**

For each sidebar's selected/active row rule (confirm the exact selector per file — typically `.row.selected`, `.item.active`, `.sidebar-row.active`), apply:
```css
  background: linear-gradient(90deg, color-mix(in srgb, var(--accent) 15%, transparent), transparent);
  box-shadow: inset 2px 0 0 var(--accent), var(--glow-accent);
  color: var(--text);
```
And for each sidebar's panel/container rule, add:
```css
  background-image: var(--elev-1);
```

- [ ] **Step 2: Apply to each sidebar file**

Repeat Step 1's recipe in every file listed under **Files** above. In `SearchPanel.css`, add the same declarations to the corresponding selectors (plain CSS, no `<style>` wrapper). Leave hover states as-is; only the selected/active state and panel background change.

- [ ] **Step 3: Verify visually**

Run the app. Open Files, Swarm, MCP, Plugins, Search, and Chat-history sidebars. Confirm selected rows carry the inset accent edge + faint glow and panels have subtle depth. Check all three themes.

- [ ] **Step 4: Run the guard suite**

Run: `npx vitest run --project unit --maxWorkers=2`
Expected: PASS.

- [ ] **Step 5: Commit**
```bash
git add src/components/Swarm/SwarmSidebar.tsx src/components/MCP/McpSidebar.tsx src/components/Plugins/PluginsSidebar.tsx src/components/Chat/ChatHistorySidebar.tsx src/components/SearchPanel/SearchPanel.css src/components/FileExplorer
git commit -m "style(ui): elevate sidebar panels and glow selected rows"
```

---

## Task 5: Chat messages — user-bubble elevation + ThinkingAnimation frame

**Files:**
- Modify: `src/components/Chat/ChatMessage.tsx` (inline `<style>` blocks at ~635 and ~937)

- [ ] **Step 1: Locate the user-message bubble rule**

In `ChatMessage.tsx`, find the rule for the user (sent) message bubble (confirm the exact selector, e.g. `.chat-msg-user` / `.msg.user`). The assistant message rule stays unchanged (quiet, type-led).

- [ ] **Step 2: Apply elevation to the user bubble**

Add to the user-bubble rule:
```css
  background: var(--elev-2);
  box-shadow: var(--shadow-card), var(--elev-highlight);
  border: 1px solid var(--border);
```
If the rule already sets `background`/`border`, replace those lines rather than duplicating.

- [ ] **Step 3: Add an optional glow frame around the ThinkingAnimation**

Locate where `<ThinkingAnimation />` is rendered in the chat stream (search the Chat components for the import usage; it is rendered while a response is generating). Wrap it (or style its existing wrapper) with a class `thinking-frame` and add this rule to the `ChatMessage.tsx` style block:
```css
  .thinking-frame {
    background: var(--elev-1);
    border: 1px solid var(--border);
    border-left: 2px solid var(--accent);
    border-radius: 12px;
    padding: 10px 13px;
    box-shadow: var(--glow-accent), var(--elev-highlight);
  }
```
Do not modify `ThinkingAnimation.tsx` itself — only its surrounding frame.

- [ ] **Step 4: Verify visually**

Run the app, send a message, and watch a response generate. Confirm: user bubbles lift off the canvas; the thinking animation sits in a glowing amber-edged frame with its SaiLogo + ticker + clock unchanged. Check all three themes.

- [ ] **Step 5: Run the guard suite (ThinkingAnimation guard must stay green)**

Run: `npx vitest run --project unit --maxWorkers=2`
Expected: PASS — especially `thinking-animation-preserved`.

- [ ] **Step 6: Commit**
```bash
git add src/components/Chat/ChatMessage.tsx
git commit -m "style(ui): elevate user bubbles and frame the thinking animation"
```

---

## Task 6: Cards — elevation + gradient edges

**Files:**
- Modify (inline `<style>` blocks): `src/components/Chat/ToolCallCard.tsx`, `src/components/Chat/PlanReviewCard.tsx`, `src/components/Chat/TodoProgress.tsx`, `src/components/Chat/LinkPreviewChip.tsx`, `src/components/Chat/GitHubWatcherCard.tsx`, `src/components/Swarm/SwarmTaskRow.tsx`

- [ ] **Step 1: Define the card recipe**

For each card's outer container rule (confirm the exact selector per file), apply:
```css
  background: var(--elev-2);
  box-shadow: var(--shadow-card), var(--elev-highlight);
  border: 1px solid var(--border);
```
Replace any existing flat `background`/`box-shadow`/`border` lines on that rule rather than duplicating.

- [ ] **Step 2: Apply to each card file**

Repeat Step 1 in every file listed under **Files**. Keep inner content, status colors, and layout untouched — only the card surface changes.

- [ ] **Step 3: Verify visually**

Run the app. Trigger a tool call, a plan review, a todo list, paste a link, and view a swarm task row. Confirm each card lifts with depth + soft shadow. Check all three themes.

- [ ] **Step 4: Run the guard suite**

Run: `npx vitest run --project unit --maxWorkers=2`
Expected: PASS.

- [ ] **Step 5: Commit**
```bash
git add src/components/Chat/ToolCallCard.tsx src/components/Chat/PlanReviewCard.tsx src/components/Chat/TodoProgress.tsx src/components/Chat/LinkPreviewChip.tsx src/components/Chat/GitHubWatcherCard.tsx src/components/Swarm/SwarmTaskRow.tsx
git commit -m "style(ui): elevate tool-call, plan, todo, link, and swarm cards"
```

---

## Task 7: Swarm activity ribbon — living status sweep

**Files:**
- Modify: `src/components/Swarm/ActivityRibbon.tsx` (inline `<style>` block)

- [ ] **Step 1: Read the ribbon's current markup and styles**

Open `ActivityRibbon.tsx`. Identify the element representing an active agent/lane and the class applied when an agent is done vs running.

- [ ] **Step 2: Add the sweep animation (reduced-motion gated)**

Add to the style block, matching the existing reduced-motion gating pattern used elsewhere (`@media (prefers-reduced-motion: no-preference)`):
```css
  @media (prefers-reduced-motion: no-preference) {
    @keyframes ribbon-sweep {
      to { transform: translateX(100%); }
    }
    .ribbon-lane.running::after {
      content: '';
      position: absolute;
      inset: 0;
      background: linear-gradient(90deg, transparent, var(--glow-accent-fill, rgba(255,255,255,0.12)), transparent);
      transform: translateX(-100%);
      animation: ribbon-sweep 1.8s linear infinite;
    }
  }
  .ribbon-lane { position: relative; overflow: hidden; }
  .ribbon-lane.done { box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--green) 40%, transparent); }
```
Apply the `ribbon-lane` class (and `running`/`done` modifiers) to the lane element if it doesn't already carry equivalent classes; reuse existing class names if present and adjust the selectors above to match.

- [ ] **Step 3: Verify visually + reduced motion**

Run the app and start a swarm. Confirm active lanes show a light sweep that settles to a green resting state when done. Then set the OS "reduce motion" preference (or emulate it in devtools) and confirm the sweep disappears (static state), with no layout shift.

- [ ] **Step 4: Run the guard suite**

Run: `npx vitest run --project unit --maxWorkers=2`
Expected: PASS.

- [ ] **Step 5: Commit**
```bash
git add src/components/Swarm/ActivityRibbon.tsx
git commit -m "style(ui): living-status sweep on swarm activity ribbon"
```

---

## Task 8: Modals & overlays — elevated surface

**Files:**
- Modify: `src/components/SettingsModal.tsx` and the other `*-modal-overlay` / overlay owners referenced in `globals.css` (GitHub modal, keybindings modal, search-confirm, code-panel backdrop, image modal). Locate each via its overlay class name (e.g. `.gh-modal-overlay`, `.keybindings-modal-overlay`, `.search-confirm-overlay`, `.cp-backdrop`, `.img-modal-overlay`).

- [ ] **Step 1: Apply elevation to the modal panel (not the backdrop)**

For each modal's content panel rule (the inner card, not the dimmed backdrop), apply:
```css
  background: var(--elev-3);
  box-shadow: var(--shadow-card), var(--elev-highlight);
  border: 1px solid var(--border);
```
Leave the existing backdrop blur (defined in `globals.css`) untouched.

- [ ] **Step 2: Apply to each modal owner**

Repeat Step 1 for each modal panel listed under **Files**.

- [ ] **Step 3: Verify visually**

Run the app. Open Settings, the GitHub modal, keybindings, search-confirm, the code panel, and an image modal. Confirm each panel reads as an elevated surface over the blurred backdrop. Check all three themes.

- [ ] **Step 4: Run the guard suite**

Run: `npx vitest run --project unit --maxWorkers=2`
Expected: PASS.

- [ ] **Step 5: Commit**
```bash
git add src/components/SettingsModal.tsx
# add any other modal files touched
git commit -m "style(ui): elevate modal and overlay surfaces"
```

---

## Task 9: Chat input — refinement only (no structural change)

**Files:**
- Modify: `src/components/Chat/ChatInput.tsx` (inline `<style>` block; rules `.input-box`, `.chat-textarea`, and the send button)

> The `chat-input-structure` guard test must stay green throughout. Do not change JSX structure — only visual properties.

- [ ] **Step 1: Soften the focus state**

Find the `.input-box` rule (and any `:focus-within` variant). Replace the hard focus border with a soft glow:
```css
  /* on .input-box:focus-within (create the selector if absent) */
  box-shadow: var(--glow-focus), var(--elev-highlight);
  border-color: var(--border);
```
Keep the resting (unfocused) border as it is today. Optionally tighten `border-radius` by ≤2px for a slightly crisper feel — do not change padding that affects the textarea hit area.

- [ ] **Step 2: Refine the send button**

Find the send-button rule. Apply:
```css
  background: var(--gradient-accent);
  box-shadow: var(--glow-accent);
  color: #0d0b07;
```
Leave the button's size/position/behavior unchanged.

- [ ] **Step 3: Verify visually + behavior**

Run the app. Confirm: focusing the input shows a soft glow ring (not a hard border); the send button has an amber gradient + glow; typing, autocomplete, context chips, usage bars, and slash menu all behave exactly as before. Check all three themes.

- [ ] **Step 4: Run the guard suite (structure guard must stay green)**

Run: `npx vitest run --project unit --maxWorkers=2`
Expected: PASS — especially `chat-input-structure`.

- [ ] **Step 5: Commit**
```bash
git add src/components/Chat/ChatInput.tsx
git commit -m "style(ui): refine chat input focus glow and send button"
```

---

## Task 10: Coherence pass — themes, reduced motion, full suite

**Files:** none (verification + any fixes surfaced)

- [ ] **Step 1: Theme coherence sweep**

Run the app and switch between Default, Midnight, and Steel. For each refreshed surface (nav rail, sidebars, chat bubbles, cards, swarm ribbon, modals, input), confirm no hardcoded amber leaks into Midnight/Steel and contrast stays readable (especially Steel's lighter base). Fix any surface that hardcoded a color instead of using a token; re-commit that file with `fix(ui): use token instead of hardcoded color in <surface>`.

- [ ] **Step 2: Reduced-motion sweep**

Emulate `prefers-reduced-motion: reduce` (devtools rendering tab or OS setting). Confirm every animated glow/sweep degrades to a static state with no layout shift. Fix any un-gated animation by wrapping it in `@media (prefers-reduced-motion: no-preference)`; re-commit.

- [ ] **Step 3: Run the full test suite**

Run:
```bash
npx vitest run --project unit --maxWorkers=2
npx vitest run --project integration --maxWorkers=2
npx vitest run --project swarm --maxWorkers=2
```
Expected: all PASS. Investigate and fix any failure before proceeding.

- [ ] **Step 4: Final commit (if Steps 1–2 produced fixes)**
```bash
git add -A
git commit -m "fix(ui): theme coherence and reduced-motion pass for depth & glow refresh"
```

---

## Self-Review Notes

- **Spec coverage:** Foundation tokens (Task 1) ✓; nav rail (T3) ✓; sidebars (T4) ✓; chat messages (T5) ✓; cards (T6) ✓; swarm ribbon (T7) ✓; modals (T8) ✓; chat input refinement (T9) ✓; ThinkingAnimation untouched + framed (T2 guard, T5) ✓; chat input structural preservation (T2 guard, T9) ✓; reduced-motion (T7, T10) ✓; all three themes coherent (T1 values, T10 sweep) ✓.
- **Token key names** are centralized in `DEPTH_TOKEN_KEYS` (Task 1) and reused by the foundation test — no drift between definition and consumption.
- **Honest testing boundary:** CSS appearance is verified visually (these are presentation-only changes); unit tests cover the token foundation and the two locked preservation constraints, which are the regression-prone parts.
