# Render Auto-Height Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Render cards auto-size to their content's height: the `height` param becomes an honored initial/minimum viewport on both render paths, height grows grow-only with a divergence guard, and the live-card cap aligns with the screenshot path at 4000px.

**Architecture:** A pure height sizer joins the existing `nextRenderWidth` in `src/render/renderSizing.ts`. `RenderEntry` gains `height?`; both entry-construction paths (live MCP dispatch and chat-history card) parse it; the live iframe seeds its height from it and feeds reporter messages through the sizer. The headless capture window starts at the same initial viewport. Schema text teaches the model the contract.

**Tech Stack:** TypeScript, React 18, Electron main (BrowserWindow capture), vitest (+ @testing-library/react), Playwright e2e.

**Spec:** `docs/superpowers/specs/2026-07-18-render-auto-height-design.md`

## Global Constraints

- `height` semantics everywhere: "Initial/minimum viewport height in px (default **480**); the card grows to fit taller content (max **4000**)."
- Height is grow-only: never below the initial viewport, never shrinks on a smaller report; non-finite/≤0 reports ignored.
- Divergence guard: **three consecutive equal positive increments** → frozen (the third increment is NOT applied); freezing never shrinks granted height.
- Live-card height clamp becomes 40–4000 (was 40–2000). Capture path stays 40–4000.
- Two-paths rule: entry-level changes land in BOTH `src/render/saiToolDispatcher.ts` and `entryFromToolCall` in `src/components/Chat/RenderToolCallCard.tsx`.
- File-backed renders (`payload.mode === 'file'`) keep their existing `payload.height` behavior — untouched.
- Vitest: `npx vitest run --project unit <file>`; repo config caps workers at 2 — do not override upward.
- Work on a feature branch off main (executor creates it; do not implement on main).

## File Structure

| Path | Role |
|---|---|
| `src/render/renderSizing.ts` | **Modify.** Add `HeightSizerState`, `createHeightSizer`, `nextRenderHeight`, `MAX_RENDER_HEIGHT` |
| `tests/unit/render/renderSizing.test.ts` | **Modify.** Sizer table tests |
| `src/render/renderStore.ts` | **Modify.** `RenderEntry.height?: number` |
| `src/render/saiToolDispatcher.ts` | **Modify.** Parse top-level `height` into entries |
| `src/components/Chat/RenderToolCallCard.tsx` | **Modify.** Same parse in `entryFromToolCall` |
| `src/components/Chat/RenderToolCard.tsx` | **Modify.** Initial height from entry; sizer in message handler |
| `src/lib/saiTools.ts` | **Modify.** `render_html` height description |
| `electron/main.ts` (`render:captureHtml`) | **Modify.** Initial viewport from `height` |
| `electron/preload.ts` | **Modify.** `renderCaptureHtml` accepts `height` |
| `src/App.tsx` | **Modify.** Pass `input.height` at the two capture call sites |
| `tests/unit/render/saiToolDispatcher.test.ts`, `tests/unit/render/renderToolCallCard.entry.test.ts`, `tests/unit/render/renderRegionSizing.test.tsx` | **Modify.** Coverage for the plumbing |
| e2e: `tests/e2e/sai-render.spec.ts` and/or `tests/e2e/render-tool-call-card.spec.ts` | **Modify.** Tall mock + `100vh` mock |

---

### Task 1: Height sizer (pure logic)

**Files:**
- Modify: `src/render/renderSizing.ts`
- Test: `tests/unit/render/renderSizing.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces (used by Task 3):

```ts
export const MAX_RENDER_HEIGHT = 4000;
export interface HeightSizerState {
  height: number;        // current granted height
  min: number;           // initial/minimum viewport
  lastIncrement: number; // size of the last applied growth step (0 initially)
  repeatCount: number;   // consecutive equal positive increments seen
  frozen: boolean;       // divergence guard tripped — no further growth
}
export function createHeightSizer(min: number): HeightSizerState
export function nextRenderHeight(state: HeightSizerState, reported: number): HeightSizerState
```

- [ ] **Step 1: Write the failing tests** (append to the existing file, matching its style)

```ts
// Append to tests/unit/render/renderSizing.test.ts
import { createHeightSizer, nextRenderHeight, MAX_RENDER_HEIGHT } from '../../../src/render/renderSizing';

describe('nextRenderHeight', () => {
  it('starts at the minimum viewport', () => {
    expect(createHeightSizer(480).height).toBe(480);
  });
  it('grows to a larger report', () => {
    const s = nextRenderHeight(createHeightSizer(480), 900);
    expect(s.height).toBe(900);
    expect(s.frozen).toBe(false);
  });
  it('never shrinks on a smaller report', () => {
    const grown = nextRenderHeight(createHeightSizer(480), 900);
    expect(nextRenderHeight(grown, 500).height).toBe(900);
  });
  it('never goes below the minimum', () => {
    expect(nextRenderHeight(createHeightSizer(480), 100).height).toBe(480);
  });
  it('caps at MAX_RENDER_HEIGHT', () => {
    expect(nextRenderHeight(createHeightSizer(480), 99999).height).toBe(MAX_RENDER_HEIGHT);
  });
  it('ignores non-finite and non-positive reports', () => {
    const s0 = createHeightSizer(480);
    expect(nextRenderHeight(s0, NaN)).toEqual(s0);
    expect(nextRenderHeight(s0, 0)).toEqual(s0);
    expect(nextRenderHeight(s0, -10)).toEqual(s0);
  });
  it('rounds fractional reports up', () => {
    expect(nextRenderHeight(createHeightSizer(480), 500.2).height).toBe(501);
  });
  it('freezes after three consecutive equal positive increments (vh feedback loop)', () => {
    let s = createHeightSizer(480);
    s = nextRenderHeight(s, 530);   // +50 applied
    expect(s.height).toBe(530);
    s = nextRenderHeight(s, 580);   // +50 applied (2nd equal)
    expect(s.height).toBe(580);
    s = nextRenderHeight(s, 630);   // +50 would be 3rd equal → frozen, NOT applied
    expect(s.height).toBe(580);
    expect(s.frozen).toBe(true);
    s = nextRenderHeight(s, 4000);  // frozen: ignored
    expect(s.height).toBe(580);
  });
  it('does not freeze on unequal increments', () => {
    let s = createHeightSizer(480);
    s = nextRenderHeight(s, 530);   // +50
    s = nextRenderHeight(s, 630);   // +100
    s = nextRenderHeight(s, 3000);  // +2370
    expect(s.height).toBe(3000);
    expect(s.frozen).toBe(false);
  });
  it('no-growth reports do not advance the repeat counter', () => {
    let s = createHeightSizer(480);
    s = nextRenderHeight(s, 530);   // +50
    s = nextRenderHeight(s, 530);   // no growth
    s = nextRenderHeight(s, 530);   // no growth
    s = nextRenderHeight(s, 580);   // +50 (2nd equal)
    s = nextRenderHeight(s, 630);   // 3rd equal → frozen at 580
    expect(s.height).toBe(580);
    expect(s.frozen).toBe(true);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run --project unit tests/unit/render/renderSizing.test.ts`
Expected: FAIL — `createHeightSizer` is not exported

- [ ] **Step 3: Implement** (append to `src/render/renderSizing.ts`)

```ts
export const MAX_RENDER_HEIGHT = 4000;

export interface HeightSizerState {
  height: number;
  min: number;
  lastIncrement: number;
  repeatCount: number;
  frozen: boolean;
}

export function createHeightSizer(min: number): HeightSizerState {
  const floor = Math.min(Math.max(Math.ceil(min), 40), MAX_RENDER_HEIGHT);
  return { height: floor, min: floor, lastIncrement: 0, repeatCount: 0, frozen: false };
}

/** Grow-only height for render regions, with a divergence guard: `100vh` plus
 *  fixed-height extras makes each resize raise scrollHeight by the same delta
 *  forever — three consecutive equal positive increments freeze the sizer at
 *  the height already granted. Never shrinks. */
export function nextRenderHeight(state: HeightSizerState, reported: number): HeightSizerState {
  if (state.frozen || !Number.isFinite(reported) || reported <= 0) return state;
  const target = Math.min(Math.max(state.height, state.min, Math.ceil(reported)), MAX_RENDER_HEIGHT);
  const increment = target - state.height;
  if (increment <= 0) return state;
  const repeatCount = increment === state.lastIncrement ? state.repeatCount + 1 : 1;
  if (repeatCount >= 3) {
    return { ...state, frozen: true };
  }
  return { ...state, height: target, lastIncrement: increment, repeatCount };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run --project unit tests/unit/render/renderSizing.test.ts`
Expected: PASS (all, including the preexisting width/color tests)

- [ ] **Step 5: Commit**

```bash
git add src/render/renderSizing.ts tests/unit/render/renderSizing.test.ts
git commit -m "feat(render): grow-only height sizer with vh-loop divergence guard"
```

---

### Task 2: `height` on the entry — both paths + schema text

**Files:**
- Modify: `src/render/renderStore.ts` (RenderEntry)
- Modify: `src/render/saiToolDispatcher.ts`
- Modify: `src/components/Chat/RenderToolCallCard.tsx` (`entryFromToolCall`)
- Modify: `src/lib/saiTools.ts` (render_html height description, line ~29)
- Test: `tests/unit/render/saiToolDispatcher.test.ts`, `tests/unit/render/renderToolCallCard.entry.test.ts`

**Interfaces:**
- Consumes: nothing new.
- Produces (used by Task 3): `RenderEntry.height?: number` — the initial/minimum viewport for inline renders. File-mode `payload.height` is unchanged and remains what `FileRenderedHtml` consumes.

- [ ] **Step 1: Write the failing tests**

Append to `tests/unit/render/saiToolDispatcher.test.ts` (match its existing dispatch/store idiom — it dispatches and asserts on `renderStore.get(renderId)`):

```ts
it('stores a positive height on the entry for inline html', () => {
  dispatchSaiRenderTool('render_html', { html: '<p>hi</p>', height: 800 }, 'rid-h1');
  expect(renderStore.get('rid-h1')?.height).toBe(800);
});
it('leaves entry.height undefined when absent or invalid', () => {
  dispatchSaiRenderTool('render_html', { html: '<p>hi</p>' }, 'rid-h2');
  expect(renderStore.get('rid-h2')?.height).toBeUndefined();
  dispatchSaiRenderTool('render_html', { html: '<p>hi</p>', height: -5 }, 'rid-h3');
  expect(renderStore.get('rid-h3')?.height).toBeUndefined();
});
it('file-backed renders keep height in the payload as before', () => {
  dispatchSaiRenderTool('render_html', { path: 'index.html', cwd: '/x', height: 700 }, 'rid-h4');
  const e = renderStore.get('rid-h4');
  expect((e?.payload as any).height).toBe(700);
});
```

Append to `tests/unit/render/renderToolCallCard.entry.test.ts` (match its `entryFromToolCall(tc)` idiom):

```ts
it('parses height onto the entry for inline html tool calls', () => {
  const r = entryFromToolCall({ id: 't-h1', name: 'sai_render_html', input: JSON.stringify({ html: '<p>x</p>', height: 720 }) } as any);
  expect(r?.entry.height).toBe(720);
});
it('entry.height is undefined when the input has none', () => {
  const r = entryFromToolCall({ id: 't-h2', name: 'sai_render_html', input: JSON.stringify({ html: '<p>x</p>' }) } as any);
  expect(r?.entry.height).toBeUndefined();
});
```

(Adapt the ToolCall literal to the file's existing fixture helper if it has one.)

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run --project unit tests/unit/render/saiToolDispatcher.test.ts tests/unit/render/renderToolCallCard.entry.test.ts`
Expected: FAIL — `height` is undefined on entries

- [ ] **Step 3: Implement**

`src/render/renderStore.ts` — add to `RenderEntry` after `width: number;`:

```ts
  /** Initial/minimum viewport height for inline renders; the card grows to
   *  fit taller content (max 4000). File-mode renders use payload.height. */
  height?: number;
```

`src/render/saiToolDispatcher.ts` — hoist the parse next to `width` (line ~14) and thread it:

```ts
  const height = typeof inp.height === 'number' && inp.height > 0 ? inp.height : undefined;
```

Add `height,` to EVERY inline `renderStore.upsert({...})` call in the switch (html inline, chart, diff, mermaid, theme, form, component). The file-mode upsert keeps `height` inside `payload` as today (the top-level `height` may also be set there; that is fine — `FileRenderedHtml` reads the payload). Remove the now-shadowed local `const height` inside the `render_html` case.

`src/components/Chat/RenderToolCallCard.tsx` — in `entryFromToolCall`, next to the `width` parse (line ~36):

```ts
  const height = typeof input.height === 'number' && input.height > 0 ? input.height : undefined;
```

and add `height,` to each inline entry literal it returns (the file-mode branch keeps its existing `payload.height`, line ~145).

`src/lib/saiTools.ts` — replace the render_html height description (line ~29):

```ts
        height: { type: 'number', description: 'Initial/minimum viewport height in px (default 480); the card grows to fit taller content (max 4000). For full-screen or vh-based layouts, set this to the intended viewport height.' },
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run --project unit tests/unit/render/saiToolDispatcher.test.ts tests/unit/render/renderToolCallCard.entry.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/render/renderStore.ts src/render/saiToolDispatcher.ts src/components/Chat/RenderToolCallCard.tsx src/lib/saiTools.ts tests/unit/render/saiToolDispatcher.test.ts tests/unit/render/renderToolCallCard.entry.test.ts
git commit -m "feat(render): honor height as initial viewport on both entry paths"
```

---

### Task 3: Live card uses the sizer

**Files:**
- Modify: `src/components/Chat/RenderToolCard.tsx` (`RenderedHtml`, lines ~132-173)
- Test: `tests/unit/render/renderRegionSizing.test.tsx`

**Interfaces:**
- Consumes: Task 1 (`createHeightSizer`, `nextRenderHeight`), Task 2 (`entry.height`).
- Produces: iframe height behavior — initial `entry.height ?? 480`, grow-only to 4000, frozen on divergence.

- [ ] **Step 1: Write the failing tests**

Append to `tests/unit/render/renderRegionSizing.test.tsx` (this file already mounts `RenderRegion` with a fake entry and posts reporter-style messages — mirror its helpers; the essential assertions):

```tsx
it('seeds the iframe height from entry.height', () => {
  const { iframe } = mountRegion({ height: 800 });          // file's mount helper
  expect(iframe.style.height).toBe('800px');
});
it('defaults the iframe height to 480 when entry.height is absent', () => {
  const { iframe } = mountRegion({});
  expect(iframe.style.height).toBe('480px');
});
it('grows past the old 2000 cap up to 4000', async () => {
  const { iframe, postSize } = mountRegion({});
  await postSize({ height: 3200 });
  expect(iframe.style.height).toBe('3200px');
  await postSize({ height: 9000 });
  expect(iframe.style.height).toBe('4000px');
});
it('does not shrink when a smaller height is reported', async () => {
  const { iframe, postSize } = mountRegion({ height: 800 });
  await postSize({ height: 600 });
  expect(iframe.style.height).toBe('800px');
});
```

(If the file lacks a `mountRegion`/`postSize` helper, build them the way its existing cases do — render `<RenderRegion entry={{...base, ...overrides}} />`, grab `container.querySelector('iframe')`, and dispatch a `MessageEvent` whose `source` is the iframe's `contentWindow` with `data: { __saiRender: 1, height }`.)

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run --project unit tests/unit/render/renderRegionSizing.test.tsx`
Expected: FAIL — initial height is 300px and cap is 2000

- [ ] **Step 3: Implement in `RenderedHtml`**

Replace the height state (line ~134):

```ts
  const initialViewport = entry.height && entry.height > 0 ? entry.height : 480;
  const [sizer, setSizer] = useState(() => createHeightSizer(initialViewport));
```

Replace the height branch of the message handler (line ~162-163):

```ts
        const h = Number(data.height);
        if (Number.isFinite(h) && h > 0) setSizer((s) => nextRenderHeight(s, h));
```

Iframe style (line ~204): `height: sizer.height`. Import `createHeightSizer, nextRenderHeight` from `../../render/renderSizing`.

- [ ] **Step 4: Run the render unit tests**

Run: `npx vitest run --project unit tests/unit/render/`
Expected: PASS (all files — catches any test that assumed the 300px default or 2000 cap)

- [ ] **Step 5: Commit**

```bash
git add src/components/Chat/RenderToolCard.tsx tests/unit/render/renderRegionSizing.test.tsx
git commit -m "feat(render): live card auto-sizes height via sizer, cap 4000"
```

---

### Task 4: Capture path parity

**Files:**
- Modify: `electron/main.ts` (`render:captureHtml` handler, lines ~1020-1069)
- Modify: `electron/preload.ts` (`renderCaptureHtml` type, line ~290)
- Modify: `src/App.tsx` (two capture call sites, ~1547-1558 mermaid and ~1675-1682 generic)

**Interfaces:**
- Consumes: nothing from earlier tasks (main-process code cannot import `src/render`).
- Produces: `renderCaptureHtml({ html, width?, height?, background? })` — `height` = initial viewport, default 480, clamped 80–4000; final capture height = `max(initial viewport is the floor via window size, measured scrollHeight)` clamped 40–4000 exactly as the measurement already works (a `vh` mock measures equal to the window height, so the capture equals the requested viewport).

- [ ] **Step 1: Implement (no unit harness exists for this Electron-main handler; the e2e task and live smoke cover it — keep the change minimal)**

`electron/main.ts` — in the handler:

```ts
  const minWidth = Math.min(Math.max(Math.round(args?.width || 480), 80), 2000);
  const initialHeight = Math.min(Math.max(Math.round(args?.height || 480), 80), 4000);
```

Create the window with `height: initialHeight` (replacing the hardcoded `1200`), and use `initialHeight` in the width-growth resize call (`win.setContentSize(width, initialHeight)` replacing `win.setContentSize(width, 1200)`). Add `height?: number` to the handler's args type. The existing height measurement and `Math.min(Math.max(Math.round(h), 40), 4000)` clamp stay as-is.

`electron/preload.ts` (line ~290): add `height?: number` to the `renderCaptureHtml` args type.

`src/App.tsx` — both call sites gain:

```ts
  height: typeof req.input?.height === 'number' ? req.input.height : undefined,
```

- [ ] **Step 2: Type-check and run the render units**

Run: `npx tsc --noEmit`
Expected: zero errors (this repo's build gate — vitest does not catch type errors)
Run: `npx vitest run --project unit tests/unit/render/`
Expected: PASS

- [ ] **Step 3: Commit**

```bash
git add electron/main.ts electron/preload.ts src/App.tsx
git commit -m "feat(render): capture window starts at the requested viewport height"
```

---

### Task 5: E2E + full verification

**Files:**
- Modify: `tests/e2e/sai-render.spec.ts` and/or `tests/e2e/render-tool-call-card.spec.ts` (read both first; add each case to the file whose existing structure fits it)

**Interfaces:**
- Consumes: everything prior; the e2e harness (`tests/e2e/test.ts`, `saiMock`, existing render-spec helpers).

- [ ] **Step 1: Add two e2e cases**

Read the existing render specs and mirror how they inject a render (harness story / tool-call fixture). Add:

1. **Tall flowing mock grows past the old cap:** render inline html containing `<div style="height:3000px">tall</div>`; assert the render region's iframe height reaches `3000px` (poll — the reporter needs a tick) and that the region does not show `2000px`.
2. **`100vh` mock honors the requested viewport:** render `<div style="height:100vh">full</div>` with `height: 800`; assert the iframe height is `800px` (not 300/480) and stays stable (no runaway growth after a settle delay — assert the same value twice ~500ms apart).

Concrete assertion shape (adapt selectors to the spec's existing helpers):

```ts
const iframe = page.locator('[data-render-region] iframe');
await expect.poll(() => iframe.evaluate((el) => (el as HTMLIFrameElement).style.height)).toBe('3000px');
```

- [ ] **Step 2: Run the touched e2e specs**

Run: `npx playwright test tests/e2e/sai-render.spec.ts tests/e2e/render-tool-call-card.spec.ts --reporter=list`
Expected: PASS (existing + new)

- [ ] **Step 3: Full verification**

Run: `npx tsc --noEmit` → clean; `npx vitest run` → all pass; full e2e suite → all pass.

- [ ] **Step 4: Commit**

```bash
git add tests/e2e/sai-render.spec.ts tests/e2e/render-tool-call-card.spec.ts
git commit -m "test(e2e): render auto-height — tall mock grows, vh mock honors viewport"
```

---

## Self-Review Notes (performed at plan-writing time)

- **Spec coverage:** honored height both paths (T2), sizer + guard (T1), live card + 4000 cap (T3), capture parity (T4), schema text (T2), tests incl. e2e tall + vh (T1/T2/T3/T5). Error handling is inherent (guard freezes; invalid reports ignored; reporter failure leaves the model-stated viewport).
- **Type consistency:** `createHeightSizer(min) → HeightSizerState`, `nextRenderHeight(state, reported) → HeightSizerState` used identically in T1 and T3; `RenderEntry.height?` (T2) consumed in T3; capture arg `height?` (T4) independent by design (main process).
- **Judgment calls:** schema change documents `height` on `render_html` only (the motivating case); the dispatcher/entry parse accepts it for all inline tools harmlessly. `tsc --noEmit` added as an explicit gate (lesson from the brainstorm-overhaul branch: vitest and Playwright both bypass tsc).
