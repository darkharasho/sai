# SAI `confirm` / `choose` Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add `confirm` (yes/no) and `choose` (pick one) tools that auto-generate form HTML and ride the shipped `render_form` machinery.

**Architecture:** A pure `buildChoiceHtml` generates the message + buttons (each carrying its value in a JSON `data-sai-value` attr) + a `saiSubmit` wiring script. `entryFromToolCall` builds a `kind:'form'` entry from it (so the card renders it interactively); `App.tsx` widens the existing `render_form` blocking branch to also match `confirm`/`choose`. No new channel.

**Tech Stack:** TypeScript, React, Vitest (`--maxWorkers=2`), Playwright harness.

**Spec:** `docs/superpowers/specs/2026-06-09-sai-confirm-choose-design.md`

---

## File Structure

| File | Responsibility | New/Mod |
|------|----------------|---------|
| `src/render/buildChoiceHtml.ts` | Pure HTML generator for message + choice buttons. | New |
| `src/components/Chat/RenderToolCallCard.tsx` | `entryFromToolCall` confirm/choose branches. | Mod |
| `src/lib/saiTools.ts` | `confirm`/`choose` schemas. | Mod |
| `src/App.tsx` | Widen `render_form` branch + card guard. | Mod |
| `src/test-harness/stories/render-tool-call-card.tsx` | `kind:'confirm'` story. | Mod |
| `tests/e2e/render-tool-call-card.spec.ts` | confirm e2e. | Mod |

**Naming contract:** `buildChoiceHtml(input: { message: string; choices: { label: string; value: unknown }[] }): string`; `Choice = { label: string; value: unknown }`; bare tools `confirm`/`choose` (prefixed `sai_confirm`/`sai_choose`).

---

## Task 1: `buildChoiceHtml`

**Files:** Create `src/render/buildChoiceHtml.ts`; Test `tests/unit/render/buildChoiceHtml.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// tests/unit/render/buildChoiceHtml.test.ts
import { describe, it, expect } from 'vitest';
import { buildChoiceHtml } from '../../../src/render/buildChoiceHtml';

describe('buildChoiceHtml', () => {
  it('escapes the message', () => {
    const html = buildChoiceHtml({ message: '<b>Delete?</b>', choices: [{ label: 'OK', value: true }] });
    expect(html).toContain('&lt;b&gt;Delete?&lt;/b&gt;');
    expect(html).not.toContain('<b>Delete?');
  });

  it('renders one button per choice with the escaped label', () => {
    const html = buildChoiceHtml({ message: 'Pick', choices: [{ label: 'A', value: 'a' }, { label: 'B', value: 'b' }] });
    expect((html.match(/<button/g) || []).length).toBe(2);
    expect(html).toContain('>A</button>');
    expect(html).toContain('>B</button>');
  });

  it('JSON-encodes each value in data-sai-value (attribute-escaped)', () => {
    const html = buildChoiceHtml({ message: 'm', choices: [{ label: 'Yes', value: true }, { label: 'Opt', value: 'opt-a' }] });
    expect(html).toContain('data-sai-value="true"');
    expect(html).toContain('data-sai-value="&quot;opt-a&quot;"');
  });

  it('includes the saiSubmit wiring script', () => {
    const html = buildChoiceHtml({ message: 'm', choices: [{ label: 'X', value: 1 }] });
    expect(html).toContain('saiSubmit(JSON.parse(');
    expect(html).toContain('data-sai-value');
  });

  it('escapes double-quotes in labels', () => {
    const html = buildChoiceHtml({ message: 'm', choices: [{ label: 'say "hi"', value: 1 }] });
    expect(html).toContain('say &quot;hi&quot;');
  });

  it('throws on empty choices', () => {
    expect(() => buildChoiceHtml({ message: 'm', choices: [] })).toThrow(/at least one choice/i);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/unit/render/buildChoiceHtml.test.ts --maxWorkers=2`
Expected: FAIL — module missing.

- [ ] **Step 3: Write minimal implementation**

```ts
// src/render/buildChoiceHtml.ts
export interface Choice {
  label: string;
  value: unknown;
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/**
 * Generate SAI-authored form HTML for a message + a row of choice buttons. Each
 * button carries its value JSON-encoded in `data-sai-value`; an appended script
 * wires every button to window.saiSubmit(parsedValue). The message and labels
 * are HTML-escaped; values are JSON-encoded then attribute-escaped — no
 * injection from the caller's strings. Throws if `choices` is empty.
 */
export function buildChoiceHtml(input: { message: string; choices: Choice[] }): string {
  if (!input.choices || input.choices.length === 0) {
    throw new Error('buildChoiceHtml requires at least one choice');
  }
  const buttons = input.choices
    .map((c) => {
      const dataVal = escapeHtml(JSON.stringify(c.value));
      return (
        `<button type="button" data-sai-value="${dataVal}" ` +
        `style="padding:8px 16px;margin:4px 6px 0 0;border:1px solid #2e3d4e;border-radius:8px;` +
        `background:#1b1f27;color:#cdd3df;font:600 13px system-ui;cursor:pointer">` +
        `${escapeHtml(c.label)}</button>`
      );
    })
    .join('');
  const script =
    '<script>document.querySelectorAll(\'[data-sai-value]\').forEach(function(b){' +
    'b.addEventListener(\'click\',function(){saiSubmit(JSON.parse(b.getAttribute(\'data-sai-value\')));});' +
    '});<\/script>';
  return (
    `<div style="font:14px system-ui,sans-serif;color:#e6e6e6;padding:14px">` +
    `<div style="margin-bottom:10px">${escapeHtml(input.message)}</div>` +
    `<div>${buttons}</div></div>${script}`
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/unit/render/buildChoiceHtml.test.ts --maxWorkers=2`
Expected: PASS (6 tests).

- [ ] **Step 5: Commit**

```bash
git add src/render/buildChoiceHtml.ts tests/unit/render/buildChoiceHtml.test.ts
git commit -m "feat(render): buildChoiceHtml generator for confirm/choose"
```

---

## Task 2: `entryFromToolCall` confirm/choose branches

**Files:** Modify `src/components/Chat/RenderToolCallCard.tsx`; Test `tests/unit/render/renderToolCallCard.entry.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// append to tests/unit/render/renderToolCallCard.entry.test.ts
it('builds a confirm form with two buttons', () => {
  const built = entryFromToolCall(tc('sai_confirm', { message: 'Proceed?' }));
  expect(built?.entry.kind).toBe('form');
  expect((String(built?.entry.payload.html).match(/<button/g) || []).length).toBe(2);
  expect(String(built?.entry.payload.html)).toContain('data-sai-value="true"');
  expect(String(built?.entry.payload.html)).toContain('data-sai-value="false"');
});

it('builds a choose form with one button per option', () => {
  const built = entryFromToolCall(tc('sai_choose', { message: 'Pick', options: ['Red', 'Green', 'Blue'] }));
  expect(built?.entry.kind).toBe('form');
  expect((String(built?.entry.payload.html).match(/<button/g) || []).length).toBe(3);
  expect(String(built?.entry.payload.html)).toContain('>Red</button>');
});

it('returns null for choose with no options', () => {
  expect(entryFromToolCall(tc('sai_choose', { message: 'Pick', options: [] }))).toBeNull();
});

it('returns null for confirm with no message', () => {
  expect(entryFromToolCall(tc('sai_confirm', {}))).toBeNull();
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/unit/render/renderToolCallCard.entry.test.ts --maxWorkers=2`
Expected: FAIL.

- [ ] **Step 3: Write minimal implementation**

In `src/components/Chat/RenderToolCallCard.tsx`:

1. Add the import (with the other render imports):

```ts
import { buildChoiceHtml } from '../../render/buildChoiceHtml';
```

2. After the `sai_render_form` branch and BEFORE the `// default: html` block in `entryFromToolCall`, insert:

```ts
  if (name.endsWith('sai_confirm')) {
    const message = typeof input.message === 'string' ? input.message : '';
    if (!message) return null;
    const confirmLabel = typeof input.confirmLabel === 'string' ? input.confirmLabel : 'Confirm';
    const cancelLabel = typeof input.cancelLabel === 'string' ? input.cancelLabel : 'Cancel';
    const html = buildChoiceHtml({ message, choices: [{ label: confirmLabel, value: true }, { label: cancelLabel, value: false }] });
    return {
      entry: { renderId, kind: 'form', payload: { html }, title: title || 'Confirm', width, background, status: 'ready' },
      code: message,
    };
  }

  if (name.endsWith('sai_choose')) {
    const message = typeof input.message === 'string' ? input.message : '';
    const options = Array.isArray(input.options)
      ? (input.options as unknown[]).filter((o): o is string => typeof o === 'string')
      : [];
    if (!message || options.length === 0) return null;
    const html = buildChoiceHtml({ message, choices: options.map((o) => ({ label: o, value: o })) });
    return {
      entry: { renderId, kind: 'form', payload: { html }, title: title || 'Choose', width, background, status: 'ready' },
      code: message,
    };
  }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/unit/render/renderToolCallCard.entry.test.ts --maxWorkers=2`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/components/Chat/RenderToolCallCard.tsx tests/unit/render/renderToolCallCard.entry.test.ts
git commit -m "feat(render): confirm/choose card redisplay via buildChoiceHtml"
```

---

## Task 3: Register the schemas

**Files:** Modify `src/lib/saiTools.ts`; Test `tests/unit/lib/saiTools.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// append to tests/unit/lib/saiTools.test.ts
describe('confirm/choose tools', () => {
  it('registers confirm and choose as chat tools', () => {
    expect(SAI_TOOL_NAMES.has('confirm')).toBe(true);
    expect(SAI_TOOL_NAMES.has('choose')).toBe(true);
    expect(SAI_TOOL_SCHEMA.find((t) => t.name === 'confirm')!.input_schema.required).toContain('message');
    const choose = SAI_TOOL_SCHEMA.find((t) => t.name === 'choose')!;
    expect(choose.input_schema.required).toEqual(expect.arrayContaining(['message', 'options']));
    expect(choose.toolset).toBe('chat');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/unit/lib/saiTools.test.ts --maxWorkers=2`
Expected: FAIL.

- [ ] **Step 3: Write minimal implementation**

Add to `SAI_TOOL_SCHEMA` in `src/lib/saiTools.ts`, after the `render_form` entry:

```ts
  {
    name: 'confirm',
    description:
      'Ask the user a yes/no question and BLOCK until they answer; returns { value: true | false }. A ' +
      'lightweight preset over render_form — use for a quick "proceed?" instead of authoring form HTML.',
    toolset: 'chat',
    input_schema: {
      type: 'object',
      properties: {
        message: { type: 'string', description: 'The question to show.' },
        confirmLabel: { type: 'string', description: "Confirm button label (default 'Confirm')." },
        cancelLabel: { type: 'string', description: "Cancel button label (default 'Cancel')." },
        timeoutMs: { type: 'number', description: 'How long to wait (10000-600000, default 180000).' },
      },
      required: ['message'],
    },
  },
  {
    name: 'choose',
    description:
      'Ask the user to pick ONE of several options and BLOCK until they choose; returns { value: <chosen ' +
      'option string> }. A lightweight preset over render_form for a quick single choice.',
    toolset: 'chat',
    input_schema: {
      type: 'object',
      properties: {
        message: { type: 'string', description: 'The prompt to show above the options.' },
        options: { type: 'array', items: { type: 'string' }, description: 'The options to choose from (one button each).' },
        timeoutMs: { type: 'number', description: 'How long to wait (10000-600000, default 180000).' },
      },
      required: ['message', 'options'],
    },
  },
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/unit/lib/saiTools.test.ts --maxWorkers=2`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/saiTools.ts tests/unit/lib/saiTools.test.ts
git commit -m "feat(render): register confirm and choose schemas"
```

---

## Task 4: Widen the App blocking branch + card guard

**Files:** Modify `src/App.tsx`. Verify via typecheck.

- [ ] **Step 1: Widen the render_form branch + guard**

In `src/App.tsx`:

1. In `onSwarmToolRequest`, change the `render_form` branch condition from:

```ts
      if (req.tool === 'render_form') {
```
to:
```ts
      if (req.tool === 'render_form' || req.tool === 'confirm' || req.tool === 'choose') {
```
(The branch body — `registerPendingForm(formTimeoutMs(req.input))` + respond — is unchanged; `formTimeoutMs` defaults when `timeoutMs` is absent, which is fine for confirm/choose.)

2. In the `renderToolCall` guard chain, add two lines (alongside the existing `sai_render_*` checks):

```ts
                      n.endsWith('sai_confirm') ||
                      n.endsWith('sai_choose') ||
```

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit`
Expected: exit 0.

- [ ] **Step 3: Commit**

```bash
git add src/App.tsx
git commit -m "feat(render): block on confirm/choose; render their cards"
```

---

## Task 5: e2e + regression

**Files:** Modify `src/test-harness/stories/render-tool-call-card.tsx`, `tests/e2e/render-tool-call-card.spec.ts`

- [ ] **Step 1: Add the confirm story**

In `src/test-harness/stories/render-tool-call-card.tsx`:

1. Extend `Kind`: add `'confirm'` → `type Kind = 'html' | 'chart' | 'diff' | 'mermaid' | 'theme' | 'form' | 'confirm';`
2. In `makeTc`, before the html fallback, add:

```ts
  if (kind === 'confirm') {
    return {
      id: `tc-confirm-${width}`,
      type: 'mcp',
      name: 'mcp__swarm__sai_confirm',
      input: JSON.stringify({ message: 'Proceed?', confirmLabel: 'Yes', cancelLabel: 'No', width }),
    };
  }
```
3. Generalize `FormStory` to take the kind (it currently hardcodes `makeTc(w, 'form')`):

```tsx
function FormStory({ w, kind }: { w: number; kind: Kind }) {
  const [result, setResult] = useState<FormResult | null>(null);
  useEffect(() => {
    const { promise, cancel } = registerPendingForm(10_000);
    promise.then(setResult);
    return cancel;
  }, []);
  return (
    <div style={{ width: 760, maxWidth: '100%' }}>
      <RenderToolCallCard tc={makeTc(w, kind)} />
      <div data-testid="form-result">{result ? JSON.stringify(result) : 'waiting'}</div>
    </div>
  );
}
```
4. In the story `component`, branch to `FormStory` for form-like kinds:

```tsx
  component: ({ w, kind }: { w: number; kind: Kind }) =>
    kind === 'form' || kind === 'confirm' ? (
      <FormStory w={w} kind={kind} />
    ) : (
      <div style={{ width: 760, maxWidth: '100%' }}>
        <RenderToolCallCard tc={makeTc(w, kind)} />
      </div>
    ),
```
5. Broaden the `parseProps` allowed-kind guard to also accept `'confirm'`.

- [ ] **Step 2: Add the e2e test**

In `tests/e2e/render-tool-call-card.spec.ts`, append:

```ts
test('confirm card returns true when the confirm button is clicked', async ({ harness }) => {
  const el = await harness.render('render-tool-call-card', { kind: 'confirm', w: '420' });
  const card = el.locator('[data-testid="render-tool-call-card"]');
  await expect(card).toBeVisible();
  await card.frameLocator('iframe').getByRole('button', { name: 'Yes' }).click();
  await expect(el.locator('[data-testid="form-result"]')).toContainText('"value":true');
  await expect(el.locator('[data-testid="form-result"]')).toContainText('"ok":true');
});
```

- [ ] **Step 3: Run e2e**

Run: `npx playwright test render-tool-call-card.spec.ts --reporter=list`
Expected: all pass. Do NOT weaken the `"value":true` assertion.

- [ ] **Step 4: Unit regression + typecheck**

Run: `npx vitest run tests/unit/render tests/unit/lib/saiTools.test.ts --maxWorkers=2`
Expected: PASS.
Run: `npx tsc --noEmit`
Expected: exit 0.

- [ ] **Step 5: Commit**

```bash
git add src/test-harness/stories/render-tool-call-card.tsx tests/e2e/render-tool-call-card.spec.ts
git commit -m "test(render): e2e for confirm card"
```

---

## Self-Review Notes

- **Spec coverage:** `buildChoiceHtml` (T1), confirm/choose card branches (T2), schemas (T3), App blocking-branch widen + guard (T4), e2e (T5). All design components covered.
- **Reuse:** confirm/choose add no new channel — they produce `kind:'form'` and ride `render_form`'s `formBridge` blocking, submit bridge, double-submit guard, and timeout. Only `buildChoiceHtml` + the two card branches + schema + the one-line App condition are new.
- **Type consistency:** `Choice` and `buildChoiceHtml` defined in T1, used in T2; bare tool names `confirm`/`choose` consistent across schema, App, and the `sai_`-prefixed card branches/guard.
- **Security:** generated HTML is SAI-authored; message/labels HTML-escaped, values JSON-encoded — no injection. Same sandbox/CSP as `render_form`.
- **Restart caveat:** the new tools are not live until the app restarts (memory `project_sai_tools_need_restart`).
