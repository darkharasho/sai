# SAI Renderer Tier 1 — `render_chart` + `render_diff` Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add two new SAI renderer tools — `render_chart` (JSON → inline-SVG bar/line chart) and `render_diff` (two HTML snippets side-by-side) — that reuse the shipped `kind: 'html'` render + capture path with zero new dependencies.

**Architecture:** Both tools are *pure HTML/SVG string builders* in a new shared module (`src/render/builtinRenderers.ts`). The builders are called from **two** places that must stay in sync: `dispatchSaiRenderTool` (the MCP/agent capture path) and `entryFromToolCall` in `RenderToolCallCard.tsx` (the chat-thread redisplay path). Each tool produces a normal `kind: 'html'` `RenderEntry`, so the existing iframe render, screenshot capture, and "Open ↗" affordance all work unchanged.

**Tech Stack:** TypeScript, React, Vitest (unit). No charting library — SVG is hand-rolled. Run vitest with `--maxWorkers=2` (per global instructions).

**Scope note:** This is the cohesive, zero-dependency half of Tier 1 from `docs/superpowers/specs/2026-06-09-sai-mcp-tools-v2-design.md`. `render_theme` (needs a `renderStore` payload change) and `render_mermaid` (needs a new dependency + async dispatch) are deferred to their own follow-up plans.

---

## File Structure

| File | Responsibility | New/Modified |
|------|----------------|--------------|
| `src/render/builtinRenderers.ts` | Pure functions: `buildChartHtml(input)`, `buildDiffHtml(input)`. No I/O, no React. | **New** |
| `tests/unit/render/builtinRenderers.test.ts` | Unit tests for the pure builders. | **New** |
| `src/render/saiToolDispatcher.ts` | Add `render_chart` / `render_diff` cases that call the builders and upsert a `kind: 'html'` entry. | Modify |
| `tests/unit/render/saiToolDispatcher.test.ts` | Add dispatcher cases for the two tools. | Modify |
| `src/lib/saiTools.ts` | Add the two tool schema entries. | Modify |
| `tests/unit/lib/saiTools.test.ts` | Assert the new tools are present/well-formed. | Modify |
| `src/components/Chat/RenderToolCallCard.tsx` | `entryFromToolCall` builds chart/diff HTML for thread redisplay. | Modify |

**Naming contract (used across tasks):**
- Builder signatures: `buildChartHtml(input: ChartInput): string`, `buildDiffHtml(input: DiffInput): string`.
- Bare tool names (schema + dispatcher): `render_chart`, `render_diff`.
- MCP-exposed names are prefixed (`sai_render_chart`); the card matches with `name.endsWith('render_chart')`.

---

## Task 1: Pure builder — `buildChartHtml`

**Files:**
- Create: `src/render/builtinRenderers.ts`
- Test: `tests/unit/render/builtinRenderers.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// tests/unit/render/builtinRenderers.test.ts
import { describe, it, expect } from 'vitest';
import { buildChartHtml } from '../../../src/render/builtinRenderers';

describe('buildChartHtml', () => {
  it('renders a bar chart with one <rect> per value and the labels', () => {
    const html = buildChartHtml({
      chart: 'bar',
      labels: ['A', 'B', 'C'],
      values: [1, 2, 4],
    });
    expect(html).toContain('<svg');
    expect((html.match(/<rect/g) || []).length).toBe(3);
    expect(html).toContain('>A<');
    expect(html).toContain('>C<');
  });

  it('renders a line chart as a single <polyline> through every point', () => {
    const html = buildChartHtml({ chart: 'line', labels: ['x', 'y'], values: [3, 6] });
    expect(html).toContain('<polyline');
    // two points => two "x,y" coordinate pairs in the points attribute
    const pts = html.match(/points="([^"]+)"/);
    expect(pts).not.toBeNull();
    expect(pts![1].trim().split(/\s+/).length).toBe(2);
  });

  it('escapes HTML-special characters in labels', () => {
    const html = buildChartHtml({ chart: 'bar', labels: ['<b>'], values: [1] });
    expect(html).toContain('&lt;b&gt;');
    expect(html).not.toContain('<b>');
  });

  it('throws on a values/labels length mismatch', () => {
    expect(() => buildChartHtml({ chart: 'bar', labels: ['A'], values: [1, 2] })).toThrow(
      /labels and values/i,
    );
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/unit/render/builtinRenderers.test.ts --maxWorkers=2`
Expected: FAIL — "Failed to resolve import" / `buildChartHtml is not a function`.

- [ ] **Step 3: Write minimal implementation**

```ts
// src/render/builtinRenderers.ts

export interface ChartInput {
  chart: 'bar' | 'line';
  labels: string[];
  values: number[];
  color?: string;
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

const CHART_W = 320;
const CHART_H = 180;
const PAD = 24;

export function buildChartHtml(input: ChartInput): string {
  const { chart, labels, values } = input;
  if (labels.length !== values.length) {
    throw new Error('chart labels and values must have the same length');
  }
  const color = typeof input.color === 'string' ? escapeHtml(input.color) : '#6aa9ff';
  const max = Math.max(1, ...values);
  const plotW = CHART_W - PAD * 2;
  const plotH = CHART_H - PAD * 2;
  const n = values.length;

  const xFor = (i: number) => (n <= 1 ? PAD + plotW / 2 : PAD + (i * plotW) / (n - 1));
  const yFor = (v: number) => PAD + plotH - (v / max) * plotH;

  let body = '';
  if (chart === 'bar') {
    const slot = plotW / Math.max(1, n);
    const barW = slot * 0.6;
    body = values
      .map((v, i) => {
        const h = (v / max) * plotH;
        const x = PAD + slot * i + (slot - barW) / 2;
        const y = PAD + plotH - h;
        return `<rect x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${barW.toFixed(1)}" height="${h.toFixed(1)}" fill="${color}" rx="2"/>`;
      })
      .join('');
  } else {
    const points = values.map((v, i) => `${xFor(i).toFixed(1)},${yFor(v).toFixed(1)}`).join(' ');
    body = `<polyline points="${points}" fill="none" stroke="${color}" stroke-width="2"/>`;
  }

  const labelEls = labels
    .map((label, i) => {
      const slot = plotW / Math.max(1, n);
      const x = chart === 'bar' ? PAD + slot * i + slot / 2 : xFor(i);
      return `<text x="${x.toFixed(1)}" y="${CHART_H - 6}" font-size="9" text-anchor="middle" fill="#9aa3b2">${escapeHtml(label)}</text>`;
    })
    .join('');

  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${CHART_W} ${CHART_H}" width="100%" ` +
    `style="font-family:system-ui,sans-serif">` +
    `<line x1="${PAD}" y1="${CHART_H - PAD}" x2="${CHART_W - PAD}" y2="${CHART_H - PAD}" stroke="#3a3f4b"/>` +
    `${body}${labelEls}</svg>`
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/unit/render/builtinRenderers.test.ts --maxWorkers=2`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add src/render/builtinRenderers.ts tests/unit/render/builtinRenderers.test.ts
git commit -m "feat(render): add buildChartHtml pure SVG chart builder"
```

---

## Task 2: Pure builder — `buildDiffHtml`

**Files:**
- Modify: `src/render/builtinRenderers.ts`
- Test: `tests/unit/render/builtinRenderers.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// append to tests/unit/render/builtinRenderers.test.ts
import { buildDiffHtml } from '../../../src/render/builtinRenderers';

describe('buildDiffHtml', () => {
  it('embeds both snippets and labels them', () => {
    const html = buildDiffHtml({ before: '<p>old</p>', after: '<p>new</p>' });
    expect(html).toContain('<p>old</p>');
    expect(html).toContain('<p>new</p>');
    expect(html).toContain('Before');
    expect(html).toContain('After');
  });

  it('honours a stacked layout', () => {
    const side = buildDiffHtml({ before: 'a', after: 'b' });
    const stacked = buildDiffHtml({ before: 'a', after: 'b', layout: 'stacked' });
    expect(side).toContain('grid-template-columns');
    expect(stacked).not.toContain('grid-template-columns');
  });

  it('uses custom labels when provided', () => {
    const html = buildDiffHtml({ before: 'a', after: 'b', beforeLabel: 'v1', afterLabel: 'v2' });
    expect(html).toContain('v1');
    expect(html).toContain('v2');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/unit/render/builtinRenderers.test.ts --maxWorkers=2`
Expected: FAIL — `buildDiffHtml is not a function`.

- [ ] **Step 3: Write minimal implementation**

```ts
// append to src/render/builtinRenderers.ts

export interface DiffInput {
  before: string;
  after: string;
  layout?: 'side-by-side' | 'stacked';
  beforeLabel?: string;
  afterLabel?: string;
}

export function buildDiffHtml(input: DiffInput): string {
  const beforeLabel = escapeHtml(input.beforeLabel ?? 'Before');
  const afterLabel = escapeHtml(input.afterLabel ?? 'After');
  const stacked = input.layout === 'stacked';
  const gridStyle = stacked
    ? 'display:grid;gap:12px'
    : 'display:grid;grid-template-columns:1fr 1fr;gap:12px';
  const cell = (label: string, content: string) =>
    `<div style="border:1px solid #2a2f3a;border-radius:8px;overflow:hidden">` +
    `<div style="padding:4px 8px;font:600 11px system-ui,sans-serif;color:#9aa3b2;` +
    `background:#1b1f27;border-bottom:1px solid #2a2f3a">${label}</div>` +
    `<div style="padding:10px">${content}</div></div>`;
  return (
    `<div style="${gridStyle};font-family:system-ui,sans-serif">` +
    `${cell(beforeLabel, input.before)}${cell(afterLabel, input.after)}</div>`
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/unit/render/builtinRenderers.test.ts --maxWorkers=2`
Expected: PASS (7 tests total).

- [ ] **Step 5: Commit**

```bash
git add src/render/builtinRenderers.ts tests/unit/render/builtinRenderers.test.ts
git commit -m "feat(render): add buildDiffHtml pure side-by-side builder"
```

---

## Task 3: Wire both tools into the dispatcher

**Files:**
- Modify: `src/render/saiToolDispatcher.ts`
- Test: `tests/unit/render/saiToolDispatcher.test.ts:1-40`

- [ ] **Step 1: Write the failing test**

```ts
// append cases inside the existing describe('dispatchSaiRenderTool', ...) block
it('render_chart upserts an html entry built from chart input', () => {
  const res = dispatchSaiRenderTool(
    'render_chart',
    { chart: 'bar', labels: ['A', 'B'], values: [1, 2], title: 'Counts' },
    'rid-chart',
  );
  expect(res.ok).toBe(true);
  const e = renderStore.get('rid-chart');
  expect(e?.kind).toBe('html');
  expect(String(e?.payload.html)).toContain('<svg');
  expect(e?.title).toBe('Counts');
});

it('render_chart rejects a labels/values mismatch with an error result', () => {
  const res = dispatchSaiRenderTool('render_chart', { chart: 'bar', labels: ['A'], values: [1, 2] }, 'rid-bad');
  expect(res.ok).toBe(false);
  expect(res.error).toMatch(/labels and values/i);
  expect(renderStore.get('rid-bad')).toBeUndefined();
});

it('render_diff upserts an html entry containing both snippets', () => {
  const res = dispatchSaiRenderTool('render_diff', { before: '<i>x</i>', after: '<i>y</i>' }, 'rid-diff');
  expect(res.ok).toBe(true);
  const e = renderStore.get('rid-diff');
  expect(e?.kind).toBe('html');
  expect(String(e?.payload.html)).toContain('<i>x</i>');
  expect(String(e?.payload.html)).toContain('<i>y</i>');
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/unit/render/saiToolDispatcher.test.ts --maxWorkers=2`
Expected: FAIL — `render_chart` falls through to `unknown tool: render_chart`.

- [ ] **Step 3: Write minimal implementation**

Add the import at the top of `src/render/saiToolDispatcher.ts`:

```ts
import { buildChartHtml, buildDiffHtml, type ChartInput, type DiffInput } from './builtinRenderers';
```

Add these two cases inside the `switch (name)` block, before `default:`:

```ts
    case 'render_chart': {
      let html: string;
      try {
        html = buildChartHtml(inp as ChartInput);
      } catch (e) {
        return { ok: false, error: e instanceof Error ? e.message : 'invalid chart input' };
      }
      renderStore.upsert({ renderId, kind: 'html', payload: { html }, title, width, background, status: 'rendering' });
      return { ok: true };
    }
    case 'render_diff': {
      if (typeof inp.before !== 'string' || typeof inp.after !== 'string') {
        return { ok: false, error: 'render_diff requires "before" and "after" HTML strings' };
      }
      const html = buildDiffHtml(inp as DiffInput);
      renderStore.upsert({ renderId, kind: 'html', payload: { html }, title, width, background, status: 'rendering' });
      return { ok: true };
    }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/unit/render/saiToolDispatcher.test.ts --maxWorkers=2`
Expected: PASS (8 tests total — 5 existing + 3 new).

- [ ] **Step 5: Commit**

```bash
git add src/render/saiToolDispatcher.ts tests/unit/render/saiToolDispatcher.test.ts
git commit -m "feat(render): dispatch render_chart and render_diff to the html surface"
```

---

## Task 4: Register the tool schemas

**Files:**
- Modify: `src/lib/saiTools.ts:10-49`
- Test: `tests/unit/lib/saiTools.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// append to tests/unit/lib/saiTools.test.ts (inside the existing top-level describe)
import { SAI_TOOL_SCHEMA, SAI_TOOL_NAMES } from '../../../src/lib/saiTools';

describe('Tier 1 chart/diff tools', () => {
  it('registers render_chart and render_diff as chat tools', () => {
    expect(SAI_TOOL_NAMES.has('render_chart')).toBe(true);
    expect(SAI_TOOL_NAMES.has('render_diff')).toBe(true);
    const chart = SAI_TOOL_SCHEMA.find((t) => t.name === 'render_chart')!;
    expect(chart.toolset).toBe('chat');
    expect(chart.input_schema.required).toContain('chart');
    expect(chart.input_schema.required).toContain('values');
    const diff = SAI_TOOL_SCHEMA.find((t) => t.name === 'render_diff')!;
    expect(diff.input_schema.required).toEqual(expect.arrayContaining(['before', 'after']));
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/unit/lib/saiTools.test.ts --maxWorkers=2`
Expected: FAIL — `SAI_TOOL_NAMES.has('render_chart')` is `false`.

- [ ] **Step 3: Write minimal implementation**

Add these two objects to the `SAI_TOOL_SCHEMA` array in `src/lib/saiTools.ts`, after the `render_component` entry (before the closing `]`):

```ts
  {
    name: 'render_chart',
    description:
      'Render a bar or line chart from JSON data live inside the SAI app and return a screenshot. ' +
      'USE THIS to SHOW the user numbers — metrics, benchmarks, timings, counts — instead of describing ' +
      'them in prose. Renders as inline SVG (no network).',
    toolset: 'chat',
    input_schema: {
      type: 'object',
      properties: {
        chart: { type: 'string', description: "'bar' or 'line'." },
        labels: { type: 'array', items: { type: 'string' }, description: 'X-axis labels, one per value.' },
        values: { type: 'array', items: { type: 'number' }, description: 'Numeric values; same length as labels.' },
        color: { type: 'string', description: 'Bar/line color (CSS color).' },
        title: { type: 'string', description: 'Label shown on the card/panel.' },
        width: { type: 'number', description: 'Viewport width in px (default 360).' },
        background: { type: 'string', description: 'Canvas background behind the chart.' },
      },
      required: ['chart', 'labels', 'values'],
    },
  },
  {
    name: 'render_diff',
    description:
      'Render two HTML snippets side-by-side (or stacked) live inside the SAI app and return a screenshot. ' +
      'USE THIS to compare two UI variants — old vs new, option A vs B — so the user sees them together. ' +
      'Each snippet runs sandboxed (no network, no app access).',
    toolset: 'chat',
    input_schema: {
      type: 'object',
      properties: {
        before: { type: 'string', description: 'First variant HTML.' },
        after: { type: 'string', description: 'Second variant HTML.' },
        layout: { type: 'string', description: "'side-by-side' (default) or 'stacked'." },
        beforeLabel: { type: 'string', description: "Label over the first variant (default 'Before')." },
        afterLabel: { type: 'string', description: "Label over the second variant (default 'After')." },
        title: { type: 'string', description: 'Label shown on the card/panel.' },
        width: { type: 'number', description: 'Viewport width in px (default 360).' },
        background: { type: 'string', description: 'Canvas background behind the diff.' },
      },
      required: ['before', 'after'],
    },
  },
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/unit/lib/saiTools.test.ts --maxWorkers=2`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/saiTools.ts tests/unit/lib/saiTools.test.ts
git commit -m "feat(render): register render_chart and render_diff tool schemas"
```

---

## Task 5: Thread-history redisplay in the chat card

**Files:**
- Modify: `src/components/Chat/RenderToolCallCard.tsx:27-70`
- Test: `tests/unit/render/handleRenderToolRequest.test.ts` is NOT the right file — create `tests/unit/render/renderToolCallCard.entry.test.ts`

The card's `entryFromToolCall` rebuilds the render entry from the persisted tool input when redrawing the thread (it does NOT call the dispatcher). It must produce the same HTML the dispatcher did, via the shared builders. Refactor `entryFromToolCall` into a small exported pure helper so it is unit-testable without React.

- [ ] **Step 1: Write the failing test**

```ts
// tests/unit/render/renderToolCallCard.entry.test.ts
import { describe, it, expect } from 'vitest';
import { entryFromToolCall } from '../../../src/components/Chat/RenderToolCallCard';
import type { ToolCall } from '../../../src/types';

function tc(name: string, input: unknown): ToolCall {
  return { id: 't1', name, input: JSON.stringify(input) } as ToolCall;
}

describe('entryFromToolCall — chart/diff', () => {
  it('builds an html entry from a sai_render_chart call', () => {
    const built = entryFromToolCall(tc('sai_render_chart', { chart: 'bar', labels: ['A'], values: [3] }));
    expect(built?.entry.kind).toBe('html');
    expect(String(built?.entry.payload.html)).toContain('<svg');
  });

  it('builds an html entry from a sai_render_diff call', () => {
    const built = entryFromToolCall(tc('sai_render_diff', { before: '<i>x</i>', after: '<i>y</i>' }));
    expect(String(built?.entry.payload.html)).toContain('<i>x</i>');
    expect(String(built?.entry.payload.html)).toContain('<i>y</i>');
  });

  it('returns null for a chart call with mismatched lengths (cannot render)', () => {
    const built = entryFromToolCall(tc('sai_render_chart', { chart: 'bar', labels: ['A'], values: [1, 2] }));
    expect(built).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/unit/render/renderToolCallCard.entry.test.ts --maxWorkers=2`
Expected: FAIL — `entryFromToolCall` is not exported.

- [ ] **Step 3: Write minimal implementation**

In `src/components/Chat/RenderToolCallCard.tsx`:

1. Add the import near the top:

```ts
import { buildChartHtml, buildDiffHtml, type ChartInput, type DiffInput } from '../../render/builtinRenderers';
```

2. Change `function entryFromToolCall(...)` to `export function entryFromToolCall(...)`.

3. Inside `entryFromToolCall`, after the existing `render_component` block and BEFORE the `// default: html` block, insert:

```ts
  if (name.endsWith('render_chart')) {
    let html: string;
    try {
      html = buildChartHtml(input as unknown as ChartInput);
    } catch {
      return null;
    }
    return {
      entry: { renderId, kind: 'html', payload: { html }, title: title || 'Chart', width, background, status: 'ready' },
      code: html,
    };
  }

  if (name.endsWith('render_diff')) {
    if (typeof input.before !== 'string' || typeof input.after !== 'string') return null;
    const html = buildDiffHtml(input as unknown as DiffInput);
    return {
      entry: { renderId, kind: 'html', payload: { html }, title: title || 'Diff', width, background, status: 'ready' },
      code: html,
    };
  }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/unit/render/renderToolCallCard.entry.test.ts --maxWorkers=2`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add src/components/Chat/RenderToolCallCard.tsx tests/unit/render/renderToolCallCard.entry.test.ts
git commit -m "feat(render): redisplay render_chart/render_diff cards from tool history"
```

---

## Task 6: Full regression + typecheck

**Files:** none (verification only)

- [ ] **Step 1: Run the render + tools unit suites**

Run: `npx vitest run tests/unit/render tests/unit/lib/saiTools.test.ts --maxWorkers=2`
Expected: PASS, no failures.

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit`
Expected: no errors. (If `tsc` is not the project's typecheck command, use the one in `package.json` "scripts" — check `scripts.typecheck` / `scripts.build`.)

- [ ] **Step 3: Commit any fixups**

```bash
git add -A
git commit -m "test(render): green chart/diff suites + typecheck" --allow-empty
```

---

## Self-Review Notes

- **Spec coverage:** Implements the `render_chart` and `render_diff` entries from the Tier 1 section of the v2 spec. `render_theme` and `render_mermaid` are explicitly out of scope (stated in the header) and tracked for follow-up plans.
- **Shared-builder invariant:** the dispatcher (Task 3) and the card (Task 5) both call the *same* `buildChartHtml`/`buildDiffHtml`, so the live agent capture and the thread redisplay cannot drift.
- **Type consistency:** `ChartInput`/`DiffInput` and `buildChartHtml`/`buildDiffHtml` are defined in Task 1–2 and used unchanged in Tasks 3 and 5. Tool names `render_chart`/`render_diff` (bare) match the dispatcher and schema; the card matches the MCP-prefixed form via `endsWith`.
- **Security:** unchanged from `render_html` — output is `kind: 'html'` rendered in the existing sandboxed iframe under the existing CSP. Builders escape labels (chart) but pass `before`/`after` HTML through verbatim *by design* (same trust model as `render_html`, which already renders agent HTML sandboxed).

---

## Follow-up plans (not in this plan)

1. `render_theme` — needs a `renderStore` payload field for theme CSS vars wrapping a registered component mount; touches `RenderRegion`.
2. `render_mermaid` — needs a `mermaid` dependency and an async dispatch path (mermaid renders to SVG asynchronously); the current `dispatchSaiRenderTool` is synchronous.
3. Framework Delta A (`target: 'main'` route) — prerequisite for the Tier 2 tools (`inspect_element`, `capture_app`).
