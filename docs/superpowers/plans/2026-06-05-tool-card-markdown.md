# Render Markdown in Tool Cards Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** When a tool card's input body is markdown (a `.md`/`.markdown` file path, or content with markdown structure), render it as formatted markdown with a toggle back to highlighted source.

**Architecture:** Add a pure `isMarkdownBody()` detector and a `ToolCardMarkdown` renderer to `ToolCallCard`. The existing source-body branch gains a rendered/source toggle (default rendered). Shared compact-card markdown CSS is extracted out of `PlanReviewCard` into a reusable `card-md` style module so this is not a third copy. Edit diffs, Bash/Todo/AskQuestion bodies, and tool output are untouched.

**Tech Stack:** React + TypeScript, `react-markdown` + `remark-gfm` (already deps), Vitest + @testing-library/react, motion/react.

---

## File Structure

- **Create** `src/components/Chat/markdownCardStyles.ts` — exports `CARD_MD_CLASS` (string) and `CARD_MD_STYLES` (CSS string) for compact-card markdown element styling. Single source of truth shared by `PlanReviewCard` and `ToolCallCard`.
- **Modify** `src/components/Chat/PlanReviewCard.tsx` — replace its inline markdown element CSS with the shared `card-md` class + `CARD_MD_STYLES`; keep its own layout/scroll rules.
- **Modify** `src/components/Chat/ToolCallCard.tsx` — add `isMarkdownBody()` helper, `ToolCardMarkdown` component, the rendered/source toggle, and wire them into the existing `code` body branch.
- **Modify** `tests/unit/components/Chat/ToolCallCard.test.tsx` — add tests for detection + rendering + toggle.

---

## Task 1: Shared card-markdown styles module

Extract the markdown element CSS currently inlined in `PlanReviewCard` into a reusable module so `ToolCallCard` can share it. The element rules (headings, p, lists, code, pre, table, hr, strong, blockquote) get keyed off a single `card-md` class.

**Files:**
- Create: `src/components/Chat/markdownCardStyles.ts`
- Modify: `src/components/Chat/PlanReviewCard.tsx`

- [ ] **Step 1: Create the shared styles module**

Create `src/components/Chat/markdownCardStyles.ts`. These rules are the element styles lifted verbatim from `PlanReviewCard`'s `STYLES` (the `.plan-review-content h1/h2/h3/p/ul/ol/li/code/pre/table/th/td/hr/strong/blockquote` rules), re-keyed from `.plan-review-content` to `.card-md`:

```ts
/** Shared markdown element styling for compact "card" contexts
 *  (tool cards, plan review). Layout/padding/scroll stays on the host. */
export const CARD_MD_CLASS = 'card-md';

export const CARD_MD_STYLES = `
  .card-md h1,
  .card-md h2,
  .card-md h3 {
    margin: 14px 0 6px;
    font-weight: 700;
    color: var(--text);
  }
  .card-md h1 { font-size: 15px; }
  .card-md h2 { font-size: 13.5px; }
  .card-md h3 { font-size: 12.5px; }
  .card-md h1:first-child,
  .card-md h2:first-child,
  .card-md h3:first-child { margin-top: 0; }
  .card-md p { margin: 6px 0; }
  .card-md ul,
  .card-md ol {
    margin: 4px 0;
    padding-left: 20px;
  }
  .card-md li { margin: 2px 0; }
  .card-md code {
    font-family: 'Geist Mono', 'JetBrains Mono', ui-monospace, monospace;
    font-size: 11.5px;
    background: var(--bg-secondary);
    padding: 1px 4px;
    border-radius: 3px;
  }
  .card-md pre {
    background: var(--bg-secondary);
    border: 1px solid var(--border);
    border-radius: 6px;
    padding: 8px 10px;
    overflow-x: auto;
    margin: 8px 0;
  }
  .card-md pre code {
    background: transparent;
    padding: 0;
  }
  .card-md table {
    width: 100%;
    border-collapse: collapse;
    margin: 8px 0;
    font-size: 11.5px;
  }
  .card-md th,
  .card-md td {
    border: 1px solid var(--border);
    padding: 4px 8px;
    text-align: left;
  }
  .card-md th {
    background: var(--bg-secondary);
    font-weight: 600;
  }
  .card-md hr {
    border: none;
    border-top: 1px solid var(--border);
    margin: 12px 0;
  }
  .card-md strong { color: var(--text); }
  .card-md blockquote {
    margin: 6px 0;
    padding: 4px 12px;
    border-left: 3px solid var(--border);
    color: var(--text-muted);
  }
`;
```

- [ ] **Step 2: Point PlanReviewCard at the shared styles**

In `src/components/Chat/PlanReviewCard.tsx`:

1. Add the import after the existing imports (near line 6):

```tsx
import { CARD_MD_CLASS, CARD_MD_STYLES } from './markdownCardStyles';
```

2. Add `CARD_MD_CLASS` to the content div's className (around line 111). Change:

```tsx
                  className={`plan-review-content${!overflows || expanded ? ' plan-review-content-expanded' : ''}`}
```

to:

```tsx
                  className={`${CARD_MD_CLASS} plan-review-content${!overflows || expanded ? ' plan-review-content-expanded' : ''}`}
```

3. In the `STYLES` string, **delete** the now-duplicated element rules — the blocks for `.plan-review-content h1/h2/h3` (including `:first-child`), `.plan-review-content p`, `.plan-review-content ul/ol`, `.plan-review-content li`, `.plan-review-content code`, `.plan-review-content pre`, `.plan-review-content pre code`, `.plan-review-content table`, `.plan-review-content th/td`, `.plan-review-content th`, `.plan-review-content hr`, `.plan-review-content strong`, and `.plan-review-content blockquote` (the rules from line ~185 to ~251). **Keep** `.plan-review-chip*`, `.plan-review-body`, `.plan-review-content` (the padding/max-height/overflow/font block at ~174-181), `.plan-review-content-expanded`, `.plan-review-actions`, and `.plan-review-btn*`.

4. Append the shared styles to the rendered `<style>` so they are present. Change the final `<style>{STYLES}</style>` (line 142) to:

```tsx
      <style>{STYLES + CARD_MD_STYLES}</style>
```

- [ ] **Step 3: Run existing PlanReviewCard tests + typecheck**

Run: `npx vitest run tests/unit/components/Chat --maxWorkers=2`
Expected: PASS (no behavioral change; plan review still renders markdown). If a `PlanReviewCard` test asserts on element CSS it will still pass because the rules are now applied via `card-md`.

Run: `npx tsc --noEmit`
Expected: no new errors.

- [ ] **Step 4: Commit**

```bash
git add src/components/Chat/markdownCardStyles.ts src/components/Chat/PlanReviewCard.tsx
git commit -m "refactor(ui): extract shared card-md markdown styles from PlanReviewCard"
```

---

## Task 2: `isMarkdownBody` detector

Pure helper that decides whether a tool-card body should render as markdown. Path signal OR conservative content signal.

**Files:**
- Modify: `src/components/Chat/ToolCallCard.tsx` (add helper near `detectLang`, ~line 48)
- Test: `tests/unit/components/Chat/ToolCallCard.test.tsx`

- [ ] **Step 1: Write the failing tests**

Add to `tests/unit/components/Chat/ToolCallCard.test.tsx`. First export the helper for testing by importing it (the implementation step exports it):

```tsx
import ToolCallCard, { isMarkdownBody } from '../../../../src/components/Chat/ToolCallCard';

describe('isMarkdownBody', () => {
  it('is true for a .md / .markdown label even with plain code', () => {
    expect(isMarkdownBody('docs/plan.md', 'just plain text')).toBe(true);
    expect(isMarkdownBody('NOTES.MARKDOWN', '')).toBe(true);
    expect(isMarkdownBody('/abs/path/TODO.md', 'x')).toBe(true);
  });

  it('is true for content with an ATX heading', () => {
    expect(isMarkdownBody('', '# Title\n\nSome body text here.')).toBe(true);
  });

  it('is true for content with a fenced code block', () => {
    expect(isMarkdownBody('', 'intro line\n```\ncode\n```\n')).toBe(true);
  });

  it('is true for content with a GFM table', () => {
    expect(isMarkdownBody('', 'col a | col b\n--- | ---\n1 | 2')).toBe(true);
  });

  it('is true for a multi-item markdown list', () => {
    expect(isMarkdownBody('', '- one\n- two\n- three')).toBe(true);
  });

  it('is false for plain prose', () => {
    expect(isMarkdownBody('', 'This is just a sentence about things.')).toBe(false);
  });

  it('is false for a single dash value line', () => {
    expect(isMarkdownBody('', '- only one item')).toBe(false);
  });

  it('is false for plain code / JSON bodies', () => {
    expect(isMarkdownBody('config.ts', 'const x = 1;\nexport default x;')).toBe(false);
    expect(isMarkdownBody('', '{\n  "a": 1\n}')).toBe(false);
  });

  it('is false for empty body with no md label', () => {
    expect(isMarkdownBody('', '')).toBe(false);
    expect(isMarkdownBody('app.tsx', '')).toBe(false);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run tests/unit/components/Chat/ToolCallCard.test.tsx --maxWorkers=2`
Expected: FAIL — `isMarkdownBody is not a function` / import error.

- [ ] **Step 3: Implement the helper**

In `src/components/Chat/ToolCallCard.tsx`, add an exported helper just after `detectLang` (after line 65):

```tsx
/** Decide whether a tool-card body should render as formatted markdown.
 *  True when the label is a .md/.markdown path, or the body shows clear
 *  markdown structure. Conservative: plain prose / plain code stays as source. */
export function isMarkdownBody(label: string, code: string): boolean {
  if (/\.(md|markdown)$/i.test(label.trim())) return true;
  const body = code || '';
  // Require non-trivial content so a single value line doesn't promote.
  if (body.split('\n').filter(l => l.trim()).length < 2) return false;
  // ATX heading
  if (/^#{1,6}\s+\S/m.test(body)) return true;
  // Fenced code block (a ``` on its own line)
  if (/^```/m.test(body)) return true;
  // GFM table: a row with a pipe followed by a separator row of ---/:--
  if (/^.*\|.*$/m.test(body) && /^\s*\|?\s*:?-{3,}.*$/m.test(body)) return true;
  // Two or more list items
  const listItems = (body.match(/^\s*([-*+]|\d+\.)\s+\S/gm) || []).length;
  if (listItems >= 2) return true;
  return false;
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run tests/unit/components/Chat/ToolCallCard.test.tsx --maxWorkers=2`
Expected: PASS (all `isMarkdownBody` cases).

- [ ] **Step 5: Commit**

```bash
git add src/components/Chat/ToolCallCard.tsx tests/unit/components/Chat/ToolCallCard.test.tsx
git commit -m "feat(ui): add isMarkdownBody detector for tool cards"
```

---

## Task 3: `ToolCardMarkdown` renderer + toggle wiring

Render the body as markdown by default when detected, with a Rendered/Source toggle. Source view is exactly today's `HighlightedCode` behaviour.

**Files:**
- Modify: `src/components/Chat/ToolCallCard.tsx`
- Test: `tests/unit/components/Chat/ToolCallCard.test.tsx`

- [ ] **Step 1: Write the failing tests**

Add to `tests/unit/components/Chat/ToolCallCard.test.tsx`. Note `defaultExpanded` is true by default so the body renders. Markdown content renders into a `.card-md` container; source renders a `.highlighted-code` or `.plain-code` element (shiki is mocked to return `<pre><code>code</code></pre>`, so rendered source yields `.highlighted-code`).

```tsx
import { fireEvent } from '@testing-library/react';

describe('ToolCallCard markdown body', () => {
  const mdWrite = {
    id: 'w1',
    type: 'file_edit' as const,
    name: 'Write',
    input: JSON.stringify({ file_path: 'docs/plan.md', content: '# Plan\n\n- a\n- b\n' }),
  };

  it('renders a .md Write as markdown by default', () => {
    const { container } = render(<ToolCallCard toolCall={mdWrite} />);
    expect(container.querySelector('.card-md')).toBeTruthy();
    // The heading text is rendered as markdown, not raw "# Plan"
    expect(container.querySelector('.card-md h1')?.textContent).toBe('Plan');
  });

  it('shows a rendered/source toggle for markdown bodies', () => {
    const { getByTestId } = render(<ToolCallCard toolCall={mdWrite} />);
    expect(getByTestId('md-view-toggle')).toBeTruthy();
  });

  it('flips to highlighted source when toggled', () => {
    const { container, getByTestId } = render(<ToolCallCard toolCall={mdWrite} />);
    expect(container.querySelector('.card-md')).toBeTruthy();
    fireEvent.click(getByTestId('md-view-source'));
    expect(container.querySelector('.card-md')).toBeNull();
    expect(container.querySelector('.highlighted-code, .plain-code')).toBeTruthy();
  });

  it('does not render markdown or toggle for a non-md Write', () => {
    const tsWrite = {
      id: 'w2',
      type: 'file_edit' as const,
      name: 'Write',
      input: JSON.stringify({ file_path: 'src/app.ts', content: 'const x = 1;\nexport default x;' }),
    };
    const { container, queryByTestId } = render(<ToolCallCard toolCall={tsWrite} />);
    expect(container.querySelector('.card-md')).toBeNull();
    expect(queryByTestId('md-view-toggle')).toBeNull();
  });

  it('keeps Edit of a .md file as a diff, not markdown', () => {
    const mdEdit = {
      id: 'e1',
      type: 'file_edit' as const,
      name: 'Edit',
      input: JSON.stringify({ file_path: 'docs/plan.md', old_string: '# Old', new_string: '# New' }),
    };
    const { container } = render(<ToolCallCard toolCall={mdEdit} />);
    expect(container.querySelector('.diff-highlighted')).toBeTruthy();
    expect(container.querySelector('.card-md')).toBeNull();
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run tests/unit/components/Chat/ToolCallCard.test.tsx --maxWorkers=2`
Expected: FAIL — no `.card-md` element / `md-view-toggle` testid not found.

- [ ] **Step 3: Add imports and the `ToolCardMarkdown` component**

In `src/components/Chat/ToolCallCard.tsx`:

1. Add imports near the top (after the `PlanReviewCard` import at line 15):

```tsx
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { CARD_MD_CLASS, CARD_MD_STYLES } from './markdownCardStyles';
```

2. Add the renderer component just before the `MAX_PREVIEW_LINES` const (line 364):

```tsx
const MD_REMARK_PLUGINS = [remarkGfm];

function ToolCardMarkdown({ code }: { code: string }) {
  return (
    <div className={`tool-call-md ${CARD_MD_CLASS}`}>
      <ReactMarkdown remarkPlugins={MD_REMARK_PLUGINS}>{code}</ReactMarkdown>
    </div>
  );
}
```

- [ ] **Step 4: Compute detection + add view state**

In the `ToolCallCard` component body, after the existing `const { truncated, isTruncated } = truncateCode(...)` line (line 731), add:

```tsx
  const renderMarkdown = !diff && isMarkdownBody(label, code);
  const [mdView, setMdView] = useState<'rendered' | 'source'>('rendered');
```

- [ ] **Step 5: Wire the toggle + branch into the body**

In the body branch `{!isBash && !isTodo && !isAskUserQuestion && code && (` (line 852), replace the inner content so the diff/markdown/source selection is explicit. Change this block:

```tsx
              <div className="tool-call-body">
                {diff ? (
                  <DiffHighlightedCode oldString={diff.oldString} newString={diff.newString} lang={diff.fileLang} />
                ) : (
                  <HighlightedCode code={showAllCode ? code : truncated} lang={lang} />
                )}
                {isTruncated && (
                  <button
                    className="tool-call-show-more"
                    onClick={() => setShowAllCode(prev => !prev)}
                  >
                    {showAllCode ? 'Show less' : `Show all (${code.split('\n').length} lines)`}
                  </button>
                )}
```

to:

```tsx
              <div className="tool-call-body">
                {diff ? (
                  <DiffHighlightedCode oldString={diff.oldString} newString={diff.newString} lang={diff.fileLang} />
                ) : renderMarkdown ? (
                  <>
                    <div className="tool-call-md-toggle" data-testid="md-view-toggle" onClick={e => e.stopPropagation()}>
                      <button
                        type="button"
                        data-testid="md-view-rendered"
                        className={`tool-call-md-seg${mdView === 'rendered' ? ' tool-call-md-seg-on' : ''}`}
                        onClick={() => setMdView('rendered')}
                      >
                        Rendered
                      </button>
                      <button
                        type="button"
                        data-testid="md-view-source"
                        className={`tool-call-md-seg${mdView === 'source' ? ' tool-call-md-seg-on' : ''}`}
                        onClick={() => setMdView('source')}
                      >
                        Source
                      </button>
                    </div>
                    {mdView === 'rendered'
                      ? <ToolCardMarkdown code={code} />
                      : <HighlightedCode code={showAllCode ? code : truncated} lang={lang} />}
                    {mdView === 'source' && isTruncated && (
                      <button
                        className="tool-call-show-more"
                        onClick={() => setShowAllCode(prev => !prev)}
                      >
                        {showAllCode ? 'Show less' : `Show all (${code.split('\n').length} lines)`}
                      </button>
                    )}
                  </>
                ) : (
                  <HighlightedCode code={showAllCode ? code : truncated} lang={lang} />
                )}
                {!renderMarkdown && isTruncated && (
                  <button
                    className="tool-call-show-more"
                    onClick={() => setShowAllCode(prev => !prev)}
                  >
                    {showAllCode ? 'Show less' : `Show all (${code.split('\n').length} lines)`}
                  </button>
                )}
```

Note: the original unconditional `{isTruncated && (...)}` show-more button is now split — it lives inside the markdown branch (source mode only) and in the `!renderMarkdown` guard for the plain branch. Do not leave the original unconditional copy.

- [ ] **Step 6: Add the toggle + markdown container CSS**

In the `<style>` template at the bottom of `ToolCallCard` (inside the big template literal, e.g. right after the `.tool-call-body .plain-code { ... }` rule near line 1015), add:

```css
          .tool-call-md {
            padding: 10px 12px;
            font-size: 12.5px;
            line-height: 1.55;
            color: var(--text);
            max-height: 420px;
            overflow-y: auto;
          }
          .tool-call-md-toggle {
            display: inline-flex;
            gap: 2px;
            margin: 8px 12px 0;
            padding: 2px;
            border: 1px solid var(--border);
            border-radius: 6px;
            background: var(--bg-secondary);
          }
          .tool-call-md-seg {
            font-family: inherit;
            font-size: 10px;
            text-transform: uppercase;
            letter-spacing: 0.4px;
            padding: 3px 9px;
            border: none;
            border-radius: 4px;
            background: transparent;
            color: var(--text-muted);
            cursor: pointer;
          }
          .tool-call-md-seg-on {
            background: color-mix(in srgb, var(--accent) 16%, transparent);
            color: var(--accent);
          }
```

Then append `CARD_MD_STYLES` to the rendered styles. Find the closing of the inline style block (the `</style>` at line 1421) — change the opening `<style>{\`` ... \`}</style>` so the shared styles are concatenated. Concretely, change the closing:

```tsx
        `}</style>
```

to:

```tsx
        ` + CARD_MD_STYLES}</style>
```

(The `<style>{`` already opens an expression; appending `+ CARD_MD_STYLES` keeps it one string.)

- [ ] **Step 7: Run to verify it passes**

Run: `npx vitest run tests/unit/components/Chat/ToolCallCard.test.tsx --maxWorkers=2`
Expected: PASS (all markdown-body tests + the existing tests).

- [ ] **Step 8: Typecheck**

Run: `npx tsc --noEmit`
Expected: no new errors.

- [ ] **Step 9: Commit**

```bash
git add src/components/Chat/ToolCallCard.tsx tests/unit/components/Chat/ToolCallCard.test.tsx
git commit -m "feat(ui): render markdown tool-card bodies with source toggle"
```

---

## Task 4: Full verification

**Files:** none (verification only)

- [ ] **Step 1: Run the full Chat test suite**

Run: `npx vitest run tests/unit/components/Chat --maxWorkers=2`
Expected: PASS — ToolCallCard and PlanReviewCard suites green.

- [ ] **Step 2: Typecheck the whole project**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Manual smoke (optional, if running the app)**

Launch the app, have the agent Write a `.md` file (e.g. a plan), and confirm the tool card shows formatted markdown by default with a Rendered/Source toggle; confirm a `.ts` Write still shows highlighted source with no toggle; confirm an Edit of a `.md` still shows the diff.

- [ ] **Step 4: Final commit (if any docs/cleanup remain)**

```bash
git add -A
git commit -m "test(ui): verify tool-card markdown rendering" --allow-empty
```

---

## Self-Review Notes

- **Spec coverage:** Detection path-OR-content → Task 2. Toggle default-rendered → Task 3. Shared style extraction (no third copy) → Task 1. Edit diffs / Bash / Todo / AskQuestion / output untouched → Task 3 keeps the `diff` short-circuit and only touches the `code` branch; output rendering below is unchanged. ✅
- **No placeholders:** every code step shows full code. ✅
- **Type consistency:** `isMarkdownBody(label, code)`, `CARD_MD_CLASS`, `CARD_MD_STYLES`, `ToolCardMarkdown({ code })`, `mdView: 'rendered' | 'source'` used consistently across tasks. ✅
- **Note for implementer:** vitest is constrained to `--maxWorkers=2` per machine policy.
