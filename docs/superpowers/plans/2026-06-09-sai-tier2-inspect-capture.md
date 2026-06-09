# SAI Tier 2 — `inspect_element` + `capture_app` Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add two read-only SAI tools the chat agent can call — `inspect_element` (computed box/style of a live DOM element) and `capture_app` (screenshot the live app window or a selector's region) — so the agent grounds in the real running app instead of guessing.

**Architecture:** Both are **renderer-target** tools, handled in the renderer's existing `onSwarmToolRequest` path (NOT the render-store/card path — they return data/image, not a render card). A new pure-ish module `src/render/saiQueryTools.ts` holds `inspectElement` (reads `document`/`getComputedStyle`) and `handleSaiQueryToolRequest` (routes the two tools, calls the injected `captureRegion`). `App.tsx` calls the handler and responds. **Framework Delta A (the `target:'main'` route) is intentionally NOT built** — `capturePage` is already renderer-reachable via the `sai.captureRegion` IPC, so neither tool needs it. Delta A stays deferred to the future native-picker tools.

**Tech Stack:** TypeScript, React, Vitest (jsdom for DOM tests). Run vitest with `--maxWorkers=2`.

**How results flow (verified):** `electron/swarm-mcp-server.ts:140-147` serializes a tool result to a `text` block of `JSON.stringify(result)`, and additionally emits an `image` block when `result.__mcpImage = { base64, mimeType }`. So `inspect_element` returns a plain JSON object; `capture_app` returns `{ ok, __mcpImage }`. `window.sai.captureRegion({x,y,width,height})` (preload `electron/preload.ts:162`) returns a bare base64 PNG of the main-window region, clamped to content bounds.

---

## File Structure

| File | Responsibility | New/Modified |
|------|----------------|--------------|
| `src/render/saiQueryTools.ts` | `inspectElement()` + `handleSaiQueryToolRequest()`. No render-store, no React. | **New** |
| `tests/unit/render/saiQueryTools.test.ts` | Unit tests (jsdom) for both. | **New** |
| `src/lib/saiTools.ts` | Two schema entries (`inspect_element`, `capture_app`). | Modify |
| `tests/unit/lib/saiTools.test.ts` | Assert the two tools are registered. | Modify |
| `src/App.tsx` | In `onSwarmToolRequest`, route these two via the handler. | Modify |

**Naming contract:** bare tool names `inspect_element`, `capture_app` (schema + handler). The MCP-exposed names are prefixed (`sai_inspect_element`); the main process forwards the **bare** name to the renderer (`req.tool` is already stripped — confirmed by the existing `req.tool === 'render_html'` checks in `App.tsx`).

---

## Task 1: `inspectElement` — computed box/style of a selector

**Files:**
- Create: `src/render/saiQueryTools.ts`
- Test: `tests/unit/render/saiQueryTools.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// tests/unit/render/saiQueryTools.test.ts
import { describe, it, expect } from 'vitest';
import { inspectElement } from '../../../src/render/saiQueryTools';

describe('inspectElement', () => {
  it('returns found:false for a selector that matches nothing', () => {
    const r = inspectElement({ selector: '.does-not-exist' });
    expect(r.found).toBe(false);
    expect(r.rect).toBeUndefined();
  });

  it('returns the rect and a default set of computed styles for a match', () => {
    const el = document.createElement('div');
    el.id = 'target';
    el.style.display = 'flex';
    el.style.color = 'rgb(1, 2, 3)';
    document.body.appendChild(el);

    const r = inspectElement({ selector: '#target' });
    expect(r.found).toBe(true);
    expect(r.rect).toMatchObject({ x: expect.any(Number), y: expect.any(Number), width: expect.any(Number), height: expect.any(Number) });
    // default set includes display + color
    expect(r.computed?.display).toBe('flex');
    expect(r.computed?.color).toBe('rgb(1, 2, 3)');
    // default set includes flex-shrink (a known SAI hairline gotcha)
    expect(r.computed).toHaveProperty('flex-shrink');

    document.body.removeChild(el);
  });

  it('returns only the requested props when props[] is given', () => {
    const el = document.createElement('span');
    el.id = 'only';
    el.style.opacity = '0.5';
    document.body.appendChild(el);

    const r = inspectElement({ selector: '#only', props: ['opacity'] });
    expect(Object.keys(r.computed ?? {})).toEqual(['opacity']);
    expect(r.computed?.opacity).toBe('0.5');

    document.body.removeChild(el);
  });

  it('returns an error for an invalid selector instead of throwing', () => {
    const r = inspectElement({ selector: '###' });
    expect(r.found).toBe(false);
    expect(r.error).toMatch(/selector/i);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/unit/render/saiQueryTools.test.ts --maxWorkers=2`
Expected: FAIL — `inspectElement is not a function`.

- [ ] **Step 3: Write minimal implementation**

```ts
// src/render/saiQueryTools.ts

export interface InspectInput {
  selector: string;
  props?: string[];
}

export interface InspectResult {
  found: boolean;
  rect?: { x: number; y: number; width: number; height: number };
  computed?: Record<string, string>;
  error?: string;
}

// A useful default set. Includes flex-shrink because zero-shrink hairlines in
// flex layouts are a recurring SAI rendering gotcha.
const DEFAULT_PROPS = [
  'display', 'position', 'width', 'height', 'margin', 'padding', 'border',
  'color', 'background-color', 'font-size', 'font-weight', 'opacity',
  'z-index', 'overflow', 'flex-shrink', 'flex-grow',
];

export function inspectElement(input: InspectInput, doc: Document = document): InspectResult {
  const selector = typeof input?.selector === 'string' ? input.selector : '';
  if (!selector) return { found: false, error: 'inspect_element requires a "selector" string' };

  let el: Element | null;
  try {
    el = doc.querySelector(selector);
  } catch {
    return { found: false, error: `invalid selector: ${selector}` };
  }
  if (!el) return { found: false };

  const r = el.getBoundingClientRect();
  const rect = { x: r.x, y: r.y, width: r.width, height: r.height };

  const view = doc.defaultView ?? window;
  const cs = view.getComputedStyle(el);
  const wanted = Array.isArray(input.props) && input.props.length > 0 ? input.props : DEFAULT_PROPS;
  const computed: Record<string, string> = {};
  for (const p of wanted) computed[p] = cs.getPropertyValue(p);

  return { found: true, rect, computed };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/unit/render/saiQueryTools.test.ts --maxWorkers=2`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add src/render/saiQueryTools.ts tests/unit/render/saiQueryTools.test.ts
git commit -m "feat(render): add inspectElement (computed box/style of a selector)"
```

---

## Task 2: `handleSaiQueryToolRequest` — route + `capture_app`

**Files:**
- Modify: `src/render/saiQueryTools.ts`
- Test: `tests/unit/render/saiQueryTools.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// append to tests/unit/render/saiQueryTools.test.ts
import { handleSaiQueryToolRequest } from '../../../src/render/saiQueryTools';

describe('handleSaiQueryToolRequest', () => {
  it('returns null for a tool it does not own (so App can fall through)', async () => {
    const r = await handleSaiQueryToolRequest({ tool: 'render_html', input: {} }, {});
    expect(r).toBeNull();
  });

  it('handles inspect_element by returning the inspect result', async () => {
    const el = document.createElement('div');
    el.id = 'q';
    document.body.appendChild(el);
    const r = await handleSaiQueryToolRequest({ tool: 'inspect_element', input: { selector: '#q' } }, {});
    expect(r).not.toBeNull();
    expect((r as any).found).toBe(true);
    document.body.removeChild(el);
  });

  it('handles capture_app by returning an __mcpImage from the injected captureRegion', async () => {
    const captureRegion = async () => 'AAAA'; // fake base64
    const r = await handleSaiQueryToolRequest({ tool: 'capture_app', input: {} }, { captureRegion });
    expect(r).toMatchObject({ ok: true, __mcpImage: { base64: 'AAAA', mimeType: 'image/png' } });
  });

  it('capture_app returns an error result when capture yields nothing', async () => {
    const captureRegion = async () => null;
    const r = await handleSaiQueryToolRequest({ tool: 'capture_app', input: {} }, { captureRegion });
    expect(r).toMatchObject({ ok: false });
    expect((r as any).error).toMatch(/capture/i);
  });

  it('capture_app with a selector captures that element rect', async () => {
    const el = document.createElement('div');
    el.id = 'shot';
    document.body.appendChild(el);
    let passedRect: any = null;
    const captureRegion = async (rect: any) => { passedRect = rect; return 'BBBB'; };
    const r = await handleSaiQueryToolRequest({ tool: 'capture_app', input: { selector: '#shot' } }, { captureRegion });
    expect((r as any).__mcpImage.base64).toBe('BBBB');
    expect(passedRect).toMatchObject({ x: expect.any(Number), y: expect.any(Number), width: expect.any(Number), height: expect.any(Number) });
    document.body.removeChild(el);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/unit/render/saiQueryTools.test.ts --maxWorkers=2`
Expected: FAIL — `handleSaiQueryToolRequest is not a function`.

- [ ] **Step 3: Write minimal implementation**

Append to `src/render/saiQueryTools.ts`:

```ts
export interface SaiQueryDeps {
  /** Capture a region of the app window; returns bare base64 PNG or null. */
  captureRegion?: (rect: { x: number; y: number; width: number; height: number }) => Promise<string | null>;
}

export interface SaiQueryRequest { tool: string; input: any; }

const FULL_WINDOW_RECT = { x: 0, y: 0, width: 100000, height: 100000 }; // clamped to content bounds in main

/**
 * Handles the read-only SAI query tools. Returns the result object, or null if
 * `tool` is not one this module owns (so the caller can fall through to other
 * handlers). `capture_app` results carry `__mcpImage` for the MCP image block.
 */
export async function handleSaiQueryToolRequest(
  req: SaiQueryRequest,
  deps: SaiQueryDeps,
): Promise<unknown | null> {
  if (req.tool === 'inspect_element') {
    return inspectElement(req.input ?? {});
  }
  if (req.tool === 'capture_app') {
    const capture = deps.captureRegion;
    if (!capture) return { ok: false, error: 'capture is unavailable' };

    let rect = FULL_WINDOW_RECT;
    const selector = typeof req.input?.selector === 'string' ? req.input.selector : '';
    if (selector) {
      let el: Element | null = null;
      try { el = document.querySelector(selector); } catch { el = null; }
      if (!el) return { ok: false, error: `capture_app: no element matches ${selector}` };
      const r = el.getBoundingClientRect();
      rect = { x: r.x, y: r.y, width: r.width, height: r.height };
    }

    const base64 = await capture(rect);
    if (!base64) return { ok: false, error: 'capture returned no image' };
    return { ok: true, __mcpImage: { base64, mimeType: 'image/png' as const } };
  }
  return null;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/unit/render/saiQueryTools.test.ts --maxWorkers=2`
Expected: PASS (9 tests total).

- [ ] **Step 5: Commit**

```bash
git add src/render/saiQueryTools.ts tests/unit/render/saiQueryTools.test.ts
git commit -m "feat(render): route inspect_element/capture_app via handleSaiQueryToolRequest"
```

---

## Task 3: Register the tool schemas

**Files:**
- Modify: `src/lib/saiTools.ts`
- Test: `tests/unit/lib/saiTools.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// append to tests/unit/lib/saiTools.test.ts
describe('Tier 2 inspect/capture tools', () => {
  it('registers inspect_element and capture_app as chat tools', () => {
    expect(SAI_TOOL_NAMES.has('inspect_element')).toBe(true);
    expect(SAI_TOOL_NAMES.has('capture_app')).toBe(true);
    const inspect = SAI_TOOL_SCHEMA.find((t) => t.name === 'inspect_element')!;
    expect(inspect.toolset).toBe('chat');
    expect(inspect.input_schema.required).toContain('selector');
    const cap = SAI_TOOL_SCHEMA.find((t) => t.name === 'capture_app')!;
    expect(cap.toolset).toBe('chat');
    expect(cap.input_schema.required ?? []).toEqual([]); // all optional
  });
});
```

If `SAI_TOOL_SCHEMA` / `SAI_TOOL_NAMES` are not already imported in that test file, they are (used by earlier blocks) — reuse them.

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/unit/lib/saiTools.test.ts --maxWorkers=2`
Expected: FAIL.

- [ ] **Step 3: Write minimal implementation**

Add to the `SAI_TOOL_SCHEMA` array in `src/lib/saiTools.ts`, after the `render_diff` entry (before the closing `]`):

```ts
  {
    name: 'inspect_element',
    description:
      "Return the computed box and CSS of a live element in the running SAI app, by CSS selector. " +
      "USE THIS to ground UI reasoning in what is ACTUALLY rendered — actual size, position, and " +
      "computed styles — instead of guessing from source or blaming stale builds/HMR. Read-only.",
    toolset: 'chat',
    input_schema: {
      type: 'object',
      properties: {
        selector: { type: 'string', description: 'CSS selector to inspect in the live app.' },
        props: {
          type: 'array',
          items: { type: 'string' },
          description: 'Computed style property names to return; omit for a useful default set.',
        },
      },
      required: ['selector'],
    },
  },
  {
    name: 'capture_app',
    description:
      'Screenshot the live SAI app window (or a single element by selector) and return the image. ' +
      'USE THIS to SEE the real current state of the running app — not a mock — when diagnosing or ' +
      'confirming UI. Read-only.',
    toolset: 'chat',
    input_schema: {
      type: 'object',
      properties: {
        selector: { type: 'string', description: 'Optional CSS selector; omit to capture the whole window.' },
      },
    },
  },
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/unit/lib/saiTools.test.ts --maxWorkers=2`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/saiTools.ts tests/unit/lib/saiTools.test.ts
git commit -m "feat(render): register inspect_element and capture_app tool schemas"
```

---

## Task 4: Wire into the renderer's tool-request handler

**Files:**
- Modify: `src/App.tsx` (the `onSwarmToolRequest` callback, ~line 1411-1441)

This is a thin integration — the testable logic lives in `handleSaiQueryToolRequest` (Task 2). Read the existing handler first; it currently has an `if (req.tool.startsWith('render_')) { ... return; }` block, then falls through to `handleSwarmToolRequest`.

- [ ] **Step 1: Add the query-tool branch**

In `src/App.tsx`, add the import near the other render imports (~line 54-55):

```ts
import { handleSaiQueryToolRequest } from './render/saiQueryTools';
```

Inside the `onSwarmToolRequest` callback, BEFORE the existing `if (typeof req.tool === 'string' && req.tool.startsWith('render_'))` block, insert:

```ts
      if (req.tool === 'inspect_element' || req.tool === 'capture_app') {
        const saiAny = sai as { captureRegion?: (r: { x: number; y: number; width: number; height: number }) => Promise<string | null> };
        void handleSaiQueryToolRequest(
          { tool: req.tool, input: req.input },
          { captureRegion: saiAny.captureRegion },
        ).then(
          (result) => sai.respondSwarmTool(req.id, result),
          (err) => sai.respondSwarmToolError(req.id, err instanceof Error ? err.message : String(err)),
        );
        return;
      }
```

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit`
Expected: exit 0, no new errors referencing `App.tsx` or `saiQueryTools`.

- [ ] **Step 3: Commit**

```bash
git add src/App.tsx
git commit -m "feat(render): wire inspect_element/capture_app into the renderer tool channel"
```

---

## Task 5: Regression + typecheck

**Files:** none (verification only)

- [ ] **Step 1: Run render + tools unit suites**

Run: `npx vitest run tests/unit/render tests/unit/lib/saiTools.test.ts --maxWorkers=2`
Expected: PASS, no failures.

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit`
Expected: exit 0.

---

## Self-Review Notes

- **Spec coverage:** Implements the Tier 2 `inspect_element` and `capture_app` tools from `2026-06-09-sai-mcp-tools-v2-design.md`. `read_app_state`, the native interaction tools, and `freezeAtMs` remain for follow-up. **Framework Delta A is deliberately skipped** (documented in Architecture) — neither tool needs the main route.
- **Why renderer-target, not the render-store path:** these return data/image, not a render card, so they bypass `dispatchSaiRenderTool`/`renderStore` and the chat `RenderToolCallCard` entirely. The capture image reuses the existing `__mcpImage` → `ToolResultImage` plumbing; `inspect_element` returns a JSON text block. No card or `renderToolCall`-guard changes needed.
- **Type consistency:** `inspectElement`/`InspectResult`, `handleSaiQueryToolRequest`/`SaiQueryDeps` defined in Tasks 1-2 and used unchanged in Task 4. Bare tool names match across schema, handler, and App wiring.
- **Restart caveat:** new tools are not attached to a running session until the app restarts (see memory `project_sai_tools_need_restart`); verification here is via unit tests, not live dogfooding.

## Follow-up (not in this plan)

1. `read_app_state` — allow-listed, read-only store accessor (renderer-target; reads zustand-style stores).
2. Native interaction tools (`pick_file`/`pick_color`/`pick_region`/`notify`/`clipboard`) — these DO need **Framework Delta A** (main-only dialogs), so Delta A lands with them.
3. `freezeAtMs` / filmstrip capture.
