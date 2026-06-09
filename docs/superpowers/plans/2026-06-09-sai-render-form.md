# `render_form` Bidirectional Input Channel — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add `render_form` — the agent renders an interactive form in the chat card; the tool call blocks until the user submits; the result is `{ ok:true, value }`.

**Architecture:** `formBridge.ts` holds a FIFO of pending forms (register/submit/timeout). The chat card's sandboxed iframe gets a `window.saiSubmit(value)` bridge that `postMessage`s to the parent; the card routes that to `formBridge.submitForm`. `App.tsx`'s `onSwarmToolRequest` awaits `registerPendingForm` for `render_form` instead of capturing. A pure `formTimeout` helper is shared by the renderer and the main-process tool timeout (extended past 60s for `render_form`).

**Tech Stack:** TypeScript, React, Electron, Vitest (`--maxWorkers=2`), Playwright harness.

**Spec:** `docs/superpowers/specs/2026-06-09-sai-render-form-design.md`

---

## File Structure

| File | Responsibility | New/Mod |
|------|----------------|---------|
| `src/render/formBridge.ts` | FIFO pending-form registry: `registerPendingForm`, `submitForm`. | New |
| `src/render/formTimeout.ts` | Pure `formTimeoutMs(input)` clamp (shared renderer + main). | New |
| `src/render/renderStore.ts` | Add `'form'` kind. | Mod |
| `src/lib/saiTools.ts` | `render_form` schema. | Mod |
| `src/components/Chat/RenderToolCallCard.tsx` | `entryFromToolCall` form branch + lang. | Mod |
| `src/components/Chat/RenderToolCard.tsx` | `SUBMIT_BRIDGE`, `RenderedHtml` `enableSubmit`, `RenderRegion` form branch. | Mod |
| `src/App.tsx` | `render_form` blocking branch + card guard. | Mod |
| `electron/main.ts` | Tool-aware reject timeout via `formTimeoutMs`. | Mod |
| `src/test-harness/stories/render-tool-call-card.tsx` | `kind:'form'` story (registers a pending form, shows result). | Mod |
| `tests/e2e/render-tool-call-card.spec.ts` | form e2e. | Mod |

**Naming contract:** `registerPendingForm(timeoutMs): { promise: Promise<FormResult>; cancel: () => void }`; `submitForm(value: unknown): void`; `FormResult = { ok: boolean; value?: unknown; dismissed?: boolean; error?: string }`; `formTimeoutMs(input: unknown): number`; bare tool `render_form` / prefixed `sai_render_form`; iframe global `window.saiSubmit`.

---

## Task 1: `formBridge` — FIFO pending-form registry

**Files:** Create `src/render/formBridge.ts`; Test `tests/unit/render/formBridge.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// tests/unit/render/formBridge.test.ts
import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { registerPendingForm, submitForm, _resetForTests } from '../../../src/render/formBridge';

beforeEach(() => { _resetForTests(); vi.useFakeTimers(); });
afterEach(() => { vi.useRealTimers(); });

describe('formBridge', () => {
  it('resolves with the submitted value', async () => {
    const { promise } = registerPendingForm(1000);
    submitForm({ choice: 'B' });
    await expect(promise).resolves.toEqual({ ok: true, value: { choice: 'B' } });
  });

  it('resolves dismissed on timeout', async () => {
    const { promise } = registerPendingForm(1000);
    vi.advanceTimersByTime(1000);
    await expect(promise).resolves.toEqual({ ok: false, dismissed: true, error: 'form timed out' });
  });

  it('is FIFO: first submit resolves the first-registered form', async () => {
    const a = registerPendingForm(5000);
    const b = registerPendingForm(5000);
    submitForm('first');
    submitForm('second');
    await expect(a.promise).resolves.toEqual({ ok: true, value: 'first' });
    await expect(b.promise).resolves.toEqual({ ok: true, value: 'second' });
  });

  it('submitForm with no pending form is a no-op', () => {
    expect(() => submitForm('orphan')).not.toThrow();
  });

  it('cancel resolves dismissed and removes the form from the queue', async () => {
    const { promise, cancel } = registerPendingForm(5000);
    cancel();
    await expect(promise).resolves.toEqual({ ok: false, dismissed: true, error: 'form cancelled' });
    // a later submit should NOT double-resolve / should be a no-op
    expect(() => submitForm('late')).not.toThrow();
  });

  it('a submitted form clears its timeout (no late dismissal)', async () => {
    const { promise } = registerPendingForm(1000);
    submitForm('done');
    vi.advanceTimersByTime(2000);
    await expect(promise).resolves.toEqual({ ok: true, value: 'done' });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/unit/render/formBridge.test.ts --maxWorkers=2`
Expected: FAIL — module missing.

- [ ] **Step 3: Write minimal implementation**

```ts
// src/render/formBridge.ts
export interface FormResult {
  ok: boolean;
  value?: unknown;
  dismissed?: boolean;
  error?: string;
}

interface Pending {
  resolve: (r: FormResult) => void;
  timer: ReturnType<typeof setTimeout>;
}

const queue: Pending[] = [];

/**
 * Register a pending form. Returns a promise that resolves when submitForm() is
 * called (FIFO), on timeout, or on cancel(). The agent blocks on one form at a
 * time, so the queue is normally length 0 or 1.
 */
export function registerPendingForm(timeoutMs: number): { promise: Promise<FormResult>; cancel: () => void } {
  let entry: Pending;
  const promise = new Promise<FormResult>((resolve) => {
    const timer = setTimeout(() => {
      remove(entry);
      resolve({ ok: false, dismissed: true, error: 'form timed out' });
    }, timeoutMs);
    entry = { resolve, timer };
    queue.push(entry);
  });
  const cancel = () => {
    if (remove(entry)) {
      clearTimeout(entry.timer);
      entry.resolve({ ok: false, dismissed: true, error: 'form cancelled' });
    }
  };
  return { promise, cancel };
}

/** Resolve the oldest pending form with the submitted value. No-op if none. */
export function submitForm(value: unknown): void {
  const entry = queue.shift();
  if (!entry) return;
  clearTimeout(entry.timer);
  entry.resolve({ ok: true, value });
}

function remove(entry: Pending): boolean {
  const i = queue.indexOf(entry);
  if (i === -1) return false;
  queue.splice(i, 1);
  return true;
}

export function _resetForTests(): void {
  for (const e of queue) clearTimeout(e.timer);
  queue.length = 0;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/unit/render/formBridge.test.ts --maxWorkers=2`
Expected: PASS (6 tests).

- [ ] **Step 5: Commit**

```bash
git add src/render/formBridge.ts tests/unit/render/formBridge.test.ts
git commit -m "feat(render): formBridge FIFO pending-form registry"
```

---

## Task 2: `formTimeoutMs` clamp helper

**Files:** Create `src/render/formTimeout.ts`; Test `tests/unit/render/formTimeout.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// tests/unit/render/formTimeout.test.ts
import { describe, it, expect } from 'vitest';
import { formTimeoutMs } from '../../../src/render/formTimeout';

describe('formTimeoutMs', () => {
  it('defaults to 180000 when no timeout given', () => {
    expect(formTimeoutMs({})).toBe(180000);
    expect(formTimeoutMs(undefined)).toBe(180000);
    expect(formTimeoutMs({ timeoutMs: 'nope' })).toBe(180000);
  });
  it('passes through a valid timeout', () => {
    expect(formTimeoutMs({ timeoutMs: 60000 })).toBe(60000);
  });
  it('clamps below 10000 and above 600000', () => {
    expect(formTimeoutMs({ timeoutMs: 5 })).toBe(10000);
    expect(formTimeoutMs({ timeoutMs: 9999999 })).toBe(600000);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/unit/render/formTimeout.test.ts --maxWorkers=2`
Expected: FAIL — module missing.

- [ ] **Step 3: Write minimal implementation**

```ts
// src/render/formTimeout.ts
const DEFAULT_MS = 180_000;
const MIN_MS = 10_000;
const MAX_MS = 600_000;

/** Clamp a render_form `timeoutMs` input to a sane range; default 3 min. */
export function formTimeoutMs(input: unknown): number {
  const raw = input && typeof input === 'object' ? (input as { timeoutMs?: unknown }).timeoutMs : undefined;
  const n = typeof raw === 'number' && Number.isFinite(raw) ? raw : DEFAULT_MS;
  return Math.min(MAX_MS, Math.max(MIN_MS, n));
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/unit/render/formTimeout.test.ts --maxWorkers=2`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add src/render/formTimeout.ts tests/unit/render/formTimeout.test.ts
git commit -m "feat(render): formTimeoutMs clamp helper"
```

---

## Task 3: `'form'` kind + schema + card redisplay

**Files:** Modify `src/render/renderStore.ts:1`, `src/lib/saiTools.ts`, `src/components/Chat/RenderToolCallCard.tsx`; Tests `tests/unit/lib/saiTools.test.ts`, `tests/unit/render/renderToolCallCard.entry.test.ts`

- [ ] **Step 1: Write the failing tests**

```ts
// append to tests/unit/lib/saiTools.test.ts
describe('render_form tool', () => {
  it('registers render_form as a chat tool requiring html', () => {
    expect(SAI_TOOL_NAMES.has('render_form')).toBe(true);
    const f = SAI_TOOL_SCHEMA.find((x) => x.name === 'render_form')!;
    expect(f.toolset).toBe('chat');
    expect(f.input_schema.required).toContain('html');
  });
});
```

```ts
// append to tests/unit/render/renderToolCallCard.entry.test.ts
it('builds a form entry from a sai_render_form call', () => {
  const built = entryFromToolCall(tc('sai_render_form', { html: '<button>go</button>' }));
  expect(built?.entry.kind).toBe('form');
  expect(String(built?.entry.payload.html)).toContain('<button>go</button>');
});

it('returns null for a form call with empty html', () => {
  const built = entryFromToolCall(tc('sai_render_form', { html: '' }));
  expect(built).toBeNull();
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/unit/lib/saiTools.test.ts tests/unit/render/renderToolCallCard.entry.test.ts --maxWorkers=2`
Expected: FAIL.

- [ ] **Step 3: Write minimal implementation**

In `src/render/renderStore.ts` line 1:

```ts
export type RenderKind = 'html' | 'component' | 'mermaid' | 'theme' | 'form';
```

In `src/lib/saiTools.ts`, add to `SAI_TOOL_SCHEMA` after the `render_theme` entry:

```ts
  {
    name: 'render_form',
    description:
      'Render an INTERACTIVE form/prompt in the SAI chat and BLOCK until the user submits, then return ' +
      'their input. USE THIS to ask the user a rich, visual question (pick one of these options, set a ' +
      'value, fill these fields) instead of plain text. Write self-contained HTML whose submit control ' +
      'calls window.saiSubmit(value) with a JSON-serializable value; that value comes back as ' +
      'result.value. The call blocks until the user submits or the form times out.',
    toolset: 'chat',
    input_schema: {
      type: 'object',
      properties: {
        html: { type: 'string', description: 'Form HTML; a control must call saiSubmit(value).' },
        timeoutMs: { type: 'number', description: 'How long to wait for a submit (10000-600000, default 180000).' },
        title: { type: 'string', description: 'Label shown on the card.' },
        width: { type: 'number', description: 'Viewport width in px (default 360).' },
      },
      required: ['html'],
    },
  },
```

In `src/components/Chat/RenderToolCallCard.tsx`, after the `sai_render_theme` branch and BEFORE the `// default: html` block in `entryFromToolCall`, insert:

```ts
  if (name.endsWith('sai_render_form')) {
    const html = typeof input.html === 'string' ? input.html : '';
    if (!html) return null;
    return {
      entry: { renderId, kind: 'form', payload: { html }, title: title || 'Form', width, background, status: 'ready' },
      code: html,
    };
  }
```

The `lang` computation already falls through to `'html'` for `kind:'form'` (form code is html) — leave it.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/unit/lib/saiTools.test.ts tests/unit/render/renderToolCallCard.entry.test.ts --maxWorkers=2`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/render/renderStore.ts src/lib/saiTools.ts src/components/Chat/RenderToolCallCard.tsx tests/unit/lib/saiTools.test.ts tests/unit/render/renderToolCallCard.entry.test.ts
git commit -m "feat(render): render_form schema + form kind + card redisplay"
```

---

## Task 4: Submit bridge in the iframe

**Files:** Modify `src/components/Chat/RenderToolCard.tsx`. Verify via typecheck.

- [ ] **Step 1: Add the bridge, `enableSubmit`, and the form branch**

In `src/components/Chat/RenderToolCard.tsx`:

1. Add the import at the top (with the other render imports):

```ts
import { submitForm } from '../../render/formBridge';
```

2. Add the `SUBMIT_BRIDGE` constant next to `HEIGHT_REPORTER`:

```ts
// Injected only for form renders: exposes window.saiSubmit(value), which posts
// the user's value to the parent. The only new capability given to the sandbox.
const SUBMIT_BRIDGE =
  '<script>window.saiSubmit=function(v){try{parent.postMessage({__saiFormSubmit:1,value:v},\'*\');}catch(e){}};<\/script>';
```

3. In `RenderRegion`, add a `form` branch. Change the `entry.kind === 'theme' ? (...)` tail so a `form` branch precedes the component fallback:

```tsx
      ) : entry.kind === 'theme' ? (
        <ThemedComponents
          components={(entry.payload as { components: string[] }).components}
          vars={(entry.payload as { vars: Record<string, string> }).vars}
          props={(entry.payload as { props?: Record<string, unknown> }).props}
        />
      ) : entry.kind === 'form' ? (
        <RenderedHtml entry={entry} enableSubmit />
      ) : (
```

4. Change `RenderedHtml` to accept `enableSubmit` and wire the submit message. Replace the whole `RenderedHtml` function with:

```tsx
function RenderedHtml({ entry, enableSubmit }: { entry: RenderEntry; enableSubmit?: boolean }) {
  const userHtml = String((entry.payload as { html: string }).html);
  const iframeRef = useRef<HTMLIFrameElement | null>(null);
  const [height, setHeight] = useState(300);
  const bridge = enableSubmit ? SUBMIT_BRIDGE : '';
  const doc =
    `<!doctype html><html><head><meta http-equiv="Content-Security-Policy" content="${SANDBOX_CSP}"></head>` +
    `<body style="margin:0">${userHtml}${bridge}${HEIGHT_REPORTER}</body></html>`;

  useEffect(() => {
    function onMessage(e: MessageEvent) {
      const win = iframeRef.current?.contentWindow;
      if (!win || e.source !== win) return;
      const data = e.data as { __saiRender?: number; height?: number; __saiFormSubmit?: number; value?: unknown } | null;
      if (!data) return;
      if (data.__saiRender) {
        const h = Number(data.height);
        if (Number.isFinite(h) && h > 0) setHeight(Math.min(2000, Math.max(40, Math.ceil(h))));
      } else if (enableSubmit && data.__saiFormSubmit) {
        submitForm(data.value);
      }
    }
    window.addEventListener('message', onMessage);
    return () => window.removeEventListener('message', onMessage);
  }, [enableSubmit]);

  return (
    <iframe
      ref={iframeRef}
      title={entry.title || 'render'}
      sandbox="allow-scripts"
      style={{ width: '100%', height, border: 0, display: 'block' }}
      srcDoc={doc}
    />
  );
}
```

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit`
Expected: exit 0.

- [ ] **Step 3: Commit**

```bash
git add src/components/Chat/RenderToolCard.tsx
git commit -m "feat(render): iframe saiSubmit bridge + form RenderRegion branch"
```

---

## Task 5: `App.tsx` blocking branch + card guard

**Files:** Modify `src/App.tsx`. Verify via typecheck.

- [ ] **Step 1: Add the render_form branch and card guard**

In `src/App.tsx`:

1. Add imports near the other render imports (~line 55):

```ts
import { registerPendingForm } from './render/formBridge';
import { formTimeoutMs } from './render/formTimeout';
```

2. In `onSwarmToolRequest`, BEFORE the existing `if (typeof req.tool === 'string' && req.tool.startsWith('render_'))` block, insert:

```ts
      if (req.tool === 'render_form') {
        const { promise } = registerPendingForm(formTimeoutMs(req.input));
        void promise.then(
          (result) => sai.respondSwarmTool(req.id, result),
          (err) => sai.respondSwarmToolError(req.id, err instanceof Error ? err.message : String(err)),
        );
        return;
      }
```

3. In the `renderToolCall` guard chain, add a line (alongside the existing `sai_render_*` checks):

```ts
                      n.endsWith('sai_render_form') ||
```

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit`
Expected: exit 0.

- [ ] **Step 3: Commit**

```bash
git add src/App.tsx
git commit -m "feat(render): block on render_form, resolve with the user's value"
```

---

## Task 6: Tool-aware main-process timeout

**Files:** Modify `electron/main.ts`. Verify via typecheck.

- [ ] **Step 1: Use `formTimeoutMs` for render_form**

In `electron/main.ts`:

1. Add the import near the other render imports (with `renderHostSearch`):

```ts
import { formTimeoutMs } from '../src/render/formTimeout';
```

2. In the `onToolCall` handler, replace the hard-coded 60s timeout block:

```ts
        setTimeout(() => {
          if (pendingMcpCalls.has(id)) {
            pendingMcpCalls.delete(id);
            reject(new Error(`tool call ${req.tool} timed out after 60s`));
          }
        }, 60_000);
```
with:
```ts
        // render_form blocks on human input — give it the form's own (clamped)
        // timeout as a backstop above the renderer's; everything else stays 60s.
        const timeoutMs = req.tool === 'render_form' ? formTimeoutMs(req.input) + 5_000 : 60_000;
        setTimeout(() => {
          if (pendingMcpCalls.has(id)) {
            pendingMcpCalls.delete(id);
            reject(new Error(`tool call ${req.tool} timed out after ${Math.round(timeoutMs / 1000)}s`));
          }
        }, timeoutMs);
```

(The `+5_000` ensures the renderer's form timeout fires first, returning a clean `{ ok:false, dismissed:true }` before main's backstop.)

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit`
Expected: exit 0.

- [ ] **Step 3: Commit**

```bash
git add electron/main.ts
git commit -m "feat(render): extend main tool timeout for render_form"
```

---

## Task 7: e2e — submit round-trips the value

**Files:** Modify `src/test-harness/stories/render-tool-call-card.tsx`, `tests/e2e/render-tool-call-card.spec.ts`

- [ ] **Step 1: Add the form story (registers a pending form, shows the result)**

In `src/test-harness/stories/render-tool-call-card.tsx`:

1. Add imports at the top:

```ts
import { useEffect, useState } from 'react';
import { registerPendingForm, type FormResult } from '../../render/formBridge';
```

2. Extend `Kind`: `type Kind = 'html' | 'chart' | 'diff' | 'mermaid' | 'theme' | 'form';`

3. In `makeTc`, before the html fallback, add:

```ts
  if (kind === 'form') {
    return {
      id: `tc-form-${width}`,
      type: 'mcp',
      name: 'mcp__swarm__sai_render_form',
      input: JSON.stringify({
        title: 'Pick one',
        width,
        html: '<button id="b" style="padding:10px 18px">Pick B</button>' +
          '<script>document.getElementById("b").addEventListener("click",function(){saiSubmit("picked-B");});<\/script>',
      }),
    };
  }
```

4. Add a wrapper component (above `export const renderToolCallCardStory`) that registers a pending form and shows its result:

```tsx
function FormStory({ w }: { w: number }) {
  const [result, setResult] = useState<FormResult | null>(null);
  useEffect(() => {
    const { promise } = registerPendingForm(10_000);
    promise.then(setResult);
  }, []);
  return (
    <div style={{ width: 760, maxWidth: '100%' }}>
      <RenderToolCallCard tc={makeTc(w, 'form')} />
      <div data-testid="form-result">{result ? JSON.stringify(result) : 'waiting'}</div>
    </div>
  );
}
```

5. In the story's `component`, branch to `FormStory` for the form kind:

```tsx
  component: ({ w, kind }: { w: number; kind: Kind }) =>
    kind === 'form' ? (
      <FormStory w={w} />
    ) : (
      <div style={{ width: 760, maxWidth: '100%' }}>
        <RenderToolCallCard tc={makeTc(w, kind)} />
      </div>
    ),
```

6. Broaden the `parseProps` allowed-kind guard to also accept `'form'`.

- [ ] **Step 2: Add the e2e test**

In `tests/e2e/render-tool-call-card.spec.ts`, append:

```ts
test('render_form submit round-trips the value back through formBridge', async ({ harness }) => {
  const el = await harness.render('render-tool-call-card', { kind: 'form', w: '420' });
  const card = el.locator('[data-testid="render-tool-call-card"]');
  await expect(card).toBeVisible();
  // The form button lives inside the sandboxed iframe.
  await card.frameLocator('iframe').getByRole('button', { name: 'Pick B' }).click();
  // formBridge resolves the pending form; the story renders the result.
  await expect(el.locator('[data-testid="form-result"]')).toContainText('picked-B');
  await expect(el.locator('[data-testid="form-result"]')).toContainText('"ok":true');
});
```

- [ ] **Step 3: Run e2e**

Run: `npx playwright test render-tool-call-card.spec.ts --reporter=list`
Expected: all pass. If the click inside the iframe needs the frame to settle, Playwright's `frameLocator` auto-waits; do NOT weaken the `picked-B` assertion.

- [ ] **Step 4: Unit regression + typecheck**

Run: `npx vitest run tests/unit/render tests/unit/lib/saiTools.test.ts --maxWorkers=2`
Expected: PASS.
Run: `npx tsc --noEmit`
Expected: exit 0.

- [ ] **Step 5: Commit**

```bash
git add src/test-harness/stories/render-tool-call-card.tsx tests/e2e/render-tool-call-card.spec.ts
git commit -m "test(render): e2e for render_form submit round-trip"
```

---

## Self-Review Notes

- **Spec coverage:** `formBridge` (T1), `formTimeoutMs` (T2), `'form'` kind + schema + card redisplay (T3), iframe submit bridge + `RenderRegion` branch (T4), App blocking branch + guard (T5), main tool-aware timeout (T6), e2e round-trip (T7). All design components covered. `render_form` deliberately does NOT touch the dispatcher/`handleRenderToolRequest` (per spec).
- **The blocking contract:** App's `onSwarmToolRequest` awaits `registerPendingForm` and never calls `handleRenderToolRequest` for `render_form`; the card (built by `entryFromToolCall`) is the interactive surface; `formBridge` is the sole correlation. No `renderStore`/`req.id` coupling.
- **Timeout layering:** renderer `formTimeoutMs(input)` < main `formTimeoutMs(input)+5000`, so the renderer resolves a clean `{ ok:false, dismissed:true }` before main's backstop rejects.
- **Type consistency:** `FormResult`, `registerPendingForm`, `submitForm`, `formTimeoutMs` defined in T1/T2 and used unchanged in T4/T5/T6/T7. `kind:'form'` consistent across store/card/region.
- **Security:** the only new sandbox capability is `window.saiSubmit` → one JSON `postMessage`; iframe stays `allow-scripts` only (no same-origin). Submitted value is returned as data, never rendered as HTML.
- **Restart caveat:** `render_form` is not live in a running session until the app restarts (memory `project_sai_tools_need_restart`).
