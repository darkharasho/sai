# SAI Renderer — `render_mermaid` Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a `render_mermaid` SAI tool — the agent passes Mermaid source, it renders as an SVG diagram live in the chat card and returns a screenshot.

**Architecture:** A new render kind `'mermaid'` whose payload is `{ diagram }`. A `MermaidRender` React component async-renders the source to SVG (via a dynamically-imported, code-split `mermaid`), used by `RenderRegion` for both the live card and thread redisplay — so the sync `entryFromToolCall` path stays sync (the async happens inside the component). The **agent screenshot** rides the existing, working offscreen path: `App.tsx` renders the source → SVG and feeds it to `renderCaptureHtml` (no preview-panel/live-region capture needed). `mermaid` is loaded via dynamic `import()` so it stays out of the main bundle.

**Tech Stack:** TypeScript, React, `mermaid`, Vitest (`--maxWorkers=2`), Playwright e2e harness.

**Why mermaid renders twice (by design):** the card renders it live (interactive, themed) via `MermaidRender`; the agent capture renders it offscreen via `renderCaptureHtml(svg)`. Both call the same `renderMermaidToSvg` helper. This avoids needing the unintegrated live-region capture surface.

---

## File Structure

| File | Responsibility | New/Modified |
|------|----------------|--------------|
| `src/render/renderMermaid.ts` | `renderMermaidToSvg(diagram, api?)` — dynamic-import mermaid, render to SVG. Injectable for tests. | **New** |
| `tests/unit/render/renderMermaid.test.ts` | Unit tests with an injected fake mermaid api. | **New** |
| `src/render/renderStore.ts` | Add `'mermaid'` to `RenderKind`. | Modify |
| `src/render/saiToolDispatcher.ts` | `render_mermaid` case → `kind:'mermaid'`. | Modify |
| `tests/unit/render/saiToolDispatcher.test.ts` | Dispatcher cases. | Modify |
| `src/lib/saiTools.ts` | `render_mermaid` schema entry. | Modify |
| `tests/unit/lib/saiTools.test.ts` | Schema assertion. | Modify |
| `src/components/Chat/RenderToolCard.tsx` | `MermaidRender` component + `RenderRegion` mermaid branch. | Modify |
| `src/components/Chat/RenderToolCallCard.tsx` | `entryFromToolCall` mermaid branch + code lang. | Modify |
| `src/App.tsx` | Async capture branch for `render_mermaid` + `renderToolCall` guard. | Modify |
| `src/test-harness/stories/render-tool-call-card.tsx` | `kind:'mermaid'` story variant. | Modify |
| `tests/e2e/render-tool-call-card.spec.ts` | e2e asserting the diagram SVG renders. | Modify |

**Naming contract:** bare tool name `render_mermaid` (schema + dispatcher); MCP-prefixed `sai_render_mermaid` (App guard via `endsWith`). Helper `renderMermaidToSvg(diagram: string, api?: MermaidApi): Promise<string>`.

---

## Task 1: `renderMermaidToSvg` helper + mermaid dependency

**Files:**
- Create: `src/render/renderMermaid.ts`
- Test: `tests/unit/render/renderMermaid.test.ts`

- [ ] **Step 1: Add the dependency**

Run: `npm install mermaid`
Expected: `mermaid` added to `package.json` dependencies.

- [ ] **Step 2: Write the failing test**

```ts
// tests/unit/render/renderMermaid.test.ts
import { describe, it, expect } from 'vitest';
import { renderMermaidToSvg, type MermaidApi } from '../../../src/render/renderMermaid';

function fakeApi(svg = '<svg id="m"><g/></svg>'): MermaidApi {
  return {
    initialize: () => {},
    render: async (_id: string, _text: string) => ({ svg }),
  };
}

describe('renderMermaidToSvg', () => {
  it('returns the SVG produced by the injected mermaid api', async () => {
    const out = await renderMermaidToSvg('graph TD; A-->B', fakeApi('<svg>diagram</svg>'));
    expect(out).toBe('<svg>diagram</svg>');
  });

  it('passes the diagram text and a unique id to mermaid.render', async () => {
    const calls: Array<{ id: string; text: string }> = [];
    const api: MermaidApi = {
      initialize: () => {},
      render: async (id, text) => { calls.push({ id, text }); return { svg: '<svg/>' }; },
    };
    await renderMermaidToSvg('sequenceDiagram\nA->>B: hi', api);
    await renderMermaidToSvg('graph TD; X-->Y', api);
    expect(calls[0].text).toBe('sequenceDiagram\nA->>B: hi');
    expect(calls[1].text).toBe('graph TD; X-->Y');
    expect(calls[0].id).not.toBe(calls[1].id); // unique render ids
  });

  it('propagates a render error (caller decides how to surface it)', async () => {
    const api: MermaidApi = {
      initialize: () => {},
      render: async () => { throw new Error('Parse error on line 1'); },
    };
    await expect(renderMermaidToSvg('not a diagram', api)).rejects.toThrow(/parse error/i);
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npx vitest run tests/unit/render/renderMermaid.test.ts --maxWorkers=2`
Expected: FAIL — module/function missing.

- [ ] **Step 4: Write minimal implementation**

```ts
// src/render/renderMermaid.ts

export interface MermaidApi {
  initialize: (config: Record<string, unknown>) => void;
  render: (id: string, text: string) => Promise<{ svg: string }>;
}

let cached: MermaidApi | null = null;
let counter = 0;

// Dynamic import keeps mermaid (large) out of the main bundle; it loads only the
// first time the agent renders a diagram.
async function loadMermaid(): Promise<MermaidApi> {
  if (cached) return cached;
  const mod = (await import('mermaid')) as unknown as { default?: MermaidApi } & MermaidApi;
  const api = (mod.default ?? mod) as MermaidApi;
  api.initialize({ startOnLoad: false, theme: 'dark', securityLevel: 'strict' });
  cached = api;
  return api;
}

/**
 * Render Mermaid source to an SVG string. `api` is injectable for tests; in the
 * app it defaults to the dynamically-imported mermaid module. Each call uses a
 * unique DOM id (mermaid requires it). Throws on a parse/render error.
 */
export async function renderMermaidToSvg(diagram: string, api?: MermaidApi): Promise<string> {
  const m = api ?? (await loadMermaid());
  const id = `sai-mermaid-${(counter = (counter + 1) % 1e9)}`;
  const { svg } = await m.render(id, diagram);
  return svg;
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run tests/unit/render/renderMermaid.test.ts --maxWorkers=2`
Expected: PASS (3 tests).

- [ ] **Step 6: Commit**

```bash
git add package.json package-lock.json src/render/renderMermaid.ts tests/unit/render/renderMermaid.test.ts
git commit -m "feat(render): add mermaid dep + renderMermaidToSvg helper"
```

---

## Task 2: `'mermaid'` render kind + dispatcher case

**Files:**
- Modify: `src/render/renderStore.ts:1`
- Modify: `src/render/saiToolDispatcher.ts`
- Test: `tests/unit/render/saiToolDispatcher.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// append inside describe('dispatchSaiRenderTool', ...) in tests/unit/render/saiToolDispatcher.test.ts
it('render_mermaid upserts a mermaid entry with the diagram payload', () => {
  const res = dispatchSaiRenderTool('render_mermaid', { diagram: 'graph TD; A-->B', title: 'Flow' }, 'rid-mmd');
  expect(res.ok).toBe(true);
  const e = renderStore.get('rid-mmd');
  expect(e?.kind).toBe('mermaid');
  expect(e?.payload).toEqual({ diagram: 'graph TD; A-->B' });
  expect(e?.title).toBe('Flow');
});

it('render_mermaid rejects a missing/empty diagram', () => {
  const res = dispatchSaiRenderTool('render_mermaid', { diagram: '' }, 'rid-mmd2');
  expect(res.ok).toBe(false);
  expect(res.error).toMatch(/diagram/i);
  expect(renderStore.get('rid-mmd2')).toBeUndefined();
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/unit/render/saiToolDispatcher.test.ts --maxWorkers=2`
Expected: FAIL — falls through to `unknown tool: render_mermaid`.

- [ ] **Step 3: Write minimal implementation**

In `src/render/renderStore.ts`, change line 1:

```ts
export type RenderKind = 'html' | 'component' | 'mermaid';
```

In `src/render/saiToolDispatcher.ts`, add this case inside the `switch (name)` block, before `default:`:

```ts
    case 'render_mermaid': {
      if (typeof inp.diagram !== 'string' || inp.diagram.length === 0) {
        return { ok: false, error: 'render_mermaid requires a non-empty "diagram" string' };
      }
      renderStore.upsert({ renderId, kind: 'mermaid', payload: { diagram: inp.diagram }, title: title || 'Diagram', width, background, status: 'rendering' });
      return { ok: true };
    }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/unit/render/saiToolDispatcher.test.ts --maxWorkers=2`
Expected: PASS (existing + 2 new).

- [ ] **Step 5: Commit**

```bash
git add src/render/renderStore.ts src/render/saiToolDispatcher.ts tests/unit/render/saiToolDispatcher.test.ts
git commit -m "feat(render): add mermaid render kind + dispatch render_mermaid"
```

---

## Task 3: Register the schema

**Files:**
- Modify: `src/lib/saiTools.ts`
- Test: `tests/unit/lib/saiTools.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// append to tests/unit/lib/saiTools.test.ts
describe('render_mermaid tool', () => {
  it('registers render_mermaid as a chat tool requiring diagram', () => {
    expect(SAI_TOOL_NAMES.has('render_mermaid')).toBe(true);
    const m = SAI_TOOL_SCHEMA.find((t) => t.name === 'render_mermaid')!;
    expect(m.toolset).toBe('chat');
    expect(m.input_schema.required).toContain('diagram');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/unit/lib/saiTools.test.ts --maxWorkers=2`
Expected: FAIL.

- [ ] **Step 3: Write minimal implementation**

Add to `SAI_TOOL_SCHEMA` in `src/lib/saiTools.ts`, after the `render_diff` entry:

```ts
  {
    name: 'render_mermaid',
    description:
      'Render a Mermaid diagram (flowchart, sequence, class, state, ER, gantt) live inside the SAI app ' +
      'and return a screenshot. USE THIS to SHOW structure or flow — an architecture, a sequence of calls, ' +
      'a state machine — instead of describing it in prose. Pass Mermaid source.',
    toolset: 'chat',
    input_schema: {
      type: 'object',
      properties: {
        diagram: { type: 'string', description: 'Mermaid source, e.g. "graph TD; A-->B".' },
        title: { type: 'string', description: 'Label shown on the card/panel.' },
        width: { type: 'number', description: 'Viewport width in px (default 360).' },
        background: { type: 'string', description: 'Canvas background behind the diagram.' },
      },
      required: ['diagram'],
    },
  },
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/unit/lib/saiTools.test.ts --maxWorkers=2`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/saiTools.ts tests/unit/lib/saiTools.test.ts
git commit -m "feat(render): register render_mermaid tool schema"
```

---

## Task 4: `MermaidRender` component + render surfaces

**Files:**
- Modify: `src/components/Chat/RenderToolCard.tsx`
- Modify: `src/components/Chat/RenderToolCallCard.tsx`

No unit test (async dynamic-import React component is covered by the e2e in Task 6 and the helper test in Task 1). Verify via typecheck.

- [ ] **Step 1: Add `MermaidRender` + the `RenderRegion` branch**

In `src/components/Chat/RenderToolCard.tsx`:

1. Add imports at the top:

```ts
import { renderMermaidToSvg } from '../../render/renderMermaid';
```
(`useState`/`useEffect` are already imported.)

2. In `RenderRegion`, change the kind branch so mermaid is handled. Replace:

```tsx
      {entry.kind === 'html' ? (
        <RenderedHtml entry={entry} />
      ) : (
        <MountComponent
          payload={entry.payload as { component: string; props: Record<string, unknown> }}
        />
      )}
```
with:
```tsx
      {entry.kind === 'html' ? (
        <RenderedHtml entry={entry} />
      ) : entry.kind === 'mermaid' ? (
        <MermaidRender diagram={String((entry.payload as { diagram: string }).diagram)} />
      ) : (
        <MountComponent
          payload={entry.payload as { component: string; props: Record<string, unknown> }}
        />
      )}
```

3. Add the component (next to `MountComponent`):

```tsx
function MermaidRender({ diagram }: { diagram: string }) {
  const [svg, setSvg] = useState('');
  const [err, setErr] = useState('');
  useEffect(() => {
    let alive = true;
    setSvg('');
    setErr('');
    renderMermaidToSvg(diagram).then(
      (s) => { if (alive) setSvg(s); },
      (e) => { if (alive) setErr(e instanceof Error ? e.message : 'mermaid error'); },
    );
    return () => { alive = false; };
  }, [diagram]);

  if (err) return <div className="sai-render-card__err">{err}</div>;
  if (!svg) return <div style={{ padding: 12, opacity: 0.6, fontSize: 12 }}>Rendering diagram…</div>;
  // svg is produced by mermaid with securityLevel:'strict' (sanitized).
  return <div style={{ padding: 12 }} dangerouslySetInnerHTML={{ __html: svg }} />;
}
```

- [ ] **Step 2: Add the `entryFromToolCall` mermaid branch**

In `src/components/Chat/RenderToolCallCard.tsx`:

1. After the `render_diff` branch and before the `// default: html` block, insert:

```ts
  if (name.endsWith('sai_render_mermaid')) {
    const diagram = typeof input.diagram === 'string' ? input.diagram : '';
    if (!diagram) return null;
    return {
      entry: { renderId, kind: 'mermaid', payload: { diagram }, title: title || 'Diagram', width, background, status: 'ready' },
      code: diagram,
    };
  }
```

2. The code-pane language: find where `lang` is computed (`const lang = entry.kind === 'component' ? 'json' : 'html';`) and change it to:

```ts
  const lang = entry.kind === 'component' ? 'json' : entry.kind === 'mermaid' ? 'text' : 'html';
```

- [ ] **Step 3: Typecheck**

Run: `npx tsc --noEmit`
Expected: exit 0.

- [ ] **Step 4: Commit**

```bash
git add src/components/Chat/RenderToolCard.tsx src/components/Chat/RenderToolCallCard.tsx
git commit -m "feat(render): MermaidRender component + mermaid card redisplay"
```

---

## Task 5: App.tsx capture wiring + card guard

**Files:**
- Modify: `src/App.tsx`

- [ ] **Step 1: Add the async capture branch**

Add the import near the other render imports (~line 55):

```ts
import { renderMermaidToSvg } from './render/renderMermaid';
```

In the `onSwarmToolRequest` callback, BEFORE the existing `if (typeof req.tool === 'string' && req.tool.startsWith('render_'))` block, insert:

```ts
      if (req.tool === 'render_mermaid') {
        const saiAny = sai as { renderCaptureHtml?: (a: { html: string; width?: number }) => Promise<string | null> };
        const diagram = typeof req.input?.diagram === 'string' ? req.input.diagram : '';
        const deps = diagram && typeof saiAny.renderCaptureHtml === 'function'
          ? {
              captureRenderRegion: async () => {
                const svg = await renderMermaidToSvg(diagram);
                const b64 = await saiAny.renderCaptureHtml!({
                  html: svg,
                  width: typeof req.input?.width === 'number' ? req.input.width : undefined,
                });
                if (!b64) throw new Error('capture returned no image');
                return { base64: b64, mimeType: 'image/png' as const };
              },
            }
          : {};
        void handleRenderToolRequest(
          { tool: req.tool, input: req.input, renderId: req.id },
          deps,
        ).then(
          (result) => sai.respondSwarmTool(req.id, result),
          (err) => sai.respondSwarmToolError(req.id, err instanceof Error ? err.message : String(err)),
        );
        return;
      }
```

- [ ] **Step 2: Add `sai_render_mermaid` to the card guard**

Find the `renderToolCall` guard (the `if (n.endsWith('sai_render_html') || ...)` chain) and add:

```ts
                      n.endsWith('sai_render_mermaid') ||
```
to the condition (alongside the existing `sai_render_chart`/`sai_render_diff` entries).

- [ ] **Step 3: Typecheck**

Run: `npx tsc --noEmit`
Expected: exit 0.

- [ ] **Step 4: Commit**

```bash
git add src/App.tsx
git commit -m "feat(render): wire render_mermaid capture + card guard"
```

---

## Task 6: e2e — diagram renders in the card

**Files:**
- Modify: `src/test-harness/stories/render-tool-call-card.tsx`
- Modify: `tests/e2e/render-tool-call-card.spec.ts`

- [ ] **Step 1: Add the story variant**

In `src/test-harness/stories/render-tool-call-card.tsx`, extend the `Kind` type and `makeTc`:

1. Change `type Kind = 'html' | 'chart' | 'diff';` to `type Kind = 'html' | 'chart' | 'diff' | 'mermaid';`
2. In `makeTc`, before the final html fallback, add:

```ts
  if (kind === 'mermaid') {
    return {
      id: `tc-mermaid-${width}`,
      type: 'mcp',
      name: 'mcp__swarm__sai_render_mermaid',
      input: JSON.stringify({ title: 'Flow', width, diagram: 'graph TD; A[Start]-->B[Next]; B-->C[Done]' }),
    };
  }
```
3. In `parseProps`, broaden the kind guard to also accept `'mermaid'`:

```ts
    const allowed = kind === 'chart' || kind === 'diff' || kind === 'mermaid';
    return { w: Number(params.get('w')) || 320, kind: (allowed ? kind : 'html') as Kind };
```

- [ ] **Step 2: Add the e2e test**

In `tests/e2e/render-tool-call-card.spec.ts`, append:

```ts
test('render_mermaid card renders the diagram as inline SVG', async ({ harness }) => {
  const el = await harness.render('render-tool-call-card', { kind: 'mermaid', w: '420' });
  const card = el.locator('[data-testid="render-tool-call-card"]');
  await expect(card).toBeVisible();
  // mermaid renders an <svg> once the dynamic import resolves.
  await expect(card.locator('svg')).toBeVisible({ timeout: 8000 });
  await expect(card.locator('svg')).toContainText('Start');
});
```

- [ ] **Step 3: Run the e2e spec**

Run: `npx playwright test render-tool-call-card.spec.ts --reporter=list`
Expected: all tests pass (the mermaid one may take a few seconds for the dynamic import).

If the mermaid test is flaky on timing, increase the `toBeVisible` timeout — do NOT weaken the assertion that an `<svg>` appears.

- [ ] **Step 4: Commit**

```bash
git add src/test-harness/stories/render-tool-call-card.tsx tests/e2e/render-tool-call-card.spec.ts
git commit -m "test(render): e2e coverage for render_mermaid card"
```

---

## Task 7: Regression + typecheck

- [ ] **Step 1: Unit suites**

Run: `npx vitest run tests/unit/render tests/unit/lib/saiTools.test.ts --maxWorkers=2`
Expected: PASS.

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit`
Expected: exit 0.

---

## Self-Review Notes

- **Spec coverage:** Implements Tier 1 `render_mermaid` from `2026-06-09-sai-mcp-tools-v2-design.md`. `render_theme` remains deferred (needs the live-region capture surface integrated into the app — see plan discussion).
- **Async handled at the edges, not the core:** the dispatcher and `entryFromToolCall` stay synchronous (they store `kind:'mermaid'` + the source); the async mermaid render happens inside `MermaidRender` (card) and the App capture dep (agent). No async-dispatch refactor needed.
- **Capture rides the working path:** the agent screenshot uses `renderCaptureHtml(svg)` (offscreen, shipped) — NOT the unintegrated live-region/preview-panel capture.
- **Bundle:** `mermaid` is loaded via dynamic `import()`, so it is code-split out of the main bundle and loads on first diagram render.
- **Security:** mermaid is initialized with `securityLevel:'strict'`; the resulting SVG is injected via `dangerouslySetInnerHTML` (sanitized by mermaid). The diagram source is model-authored, same trust model as the other render tools.
- **Restart caveat:** the new tool is not live in a running session until the app restarts (see memory `project_sai_tools_need_restart`).

## Follow-up (not in this plan)

1. `render_theme` — needs the live-region capture surface (`captureRenderRegion` + a mounted preview panel) integrated into the app, which is a separate piece of product UI.
2. Native interaction tools (need Framework Delta A).
