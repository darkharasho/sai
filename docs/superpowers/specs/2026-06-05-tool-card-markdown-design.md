# Render markdown in tool cards

## Problem

When a tool card shows a markdown body — most commonly a Write of a plan,
spec, or TODO `.md` file — the body is displayed as Shiki-highlighted markdown
*source*. Readers see raw `#`, `-`, and `|` syntax instead of the formatted
document. Plans and specs are meant to be read as rendered markdown.

## Goal

In `ToolCallCard`, when the card's input body is markdown, render it as
formatted markdown (via `ReactMarkdown` + `remarkGfm`) instead of highlighted
source, with a toggle back to source. Detection is content-based, not tied
solely to a `.md` file path, so any tool that emits a markdown body benefits —
not just file operations.

## Scope

In scope:

- The non-Bash, non-Todo, non-AskUserQuestion, non-diff input-body branch of
  `ToolCallCard` (`ToolCallCard.tsx`, the `code` rendering at the
  `HighlightedCode` call).
- A pure markdown-detection helper.
- A source/rendered toggle local to the card.
- Extracting the shared "card markdown" styles out of `PlanReviewCard` so this
  feature reuses them instead of adding a third copy of markdown CSS.

Out of scope (explicitly unchanged):

- **Edit diffs** — diffs of `.md` files stay as `+`/`-` line views; they are
  clearer than two rendered blobs.
- **Bash, Todo, AskUserQuestion** bodies — untouched.
- **Tool output** (`toolCall.output`) — stays as plain highlighted text; only
  the *input* body (`code`) is affected.
- The full-fidelity `MarkdownPreview` (CodePanel) — separate component, not
  touched.

## Decisions

- **Detection: path OR content.** Render as markdown when the body's `label`
  ends in `.md`/`.markdown`, OR the `code` shows clear markdown structure.
- **Toggle: yes**, defaulting to **rendered**, with a control to flip to raw
  highlighted source.

## Design

### Unit 1 — `isMarkdownBody(label: string, code: string): boolean`

Pure helper (co-located in `ToolCallCard.tsx` near `detectLang`/`formatInput`,
or a small sibling module if it grows). Returns true when **either**:

- **Path signal:** `label` (the file path / header) ends in `.md` or
  `.markdown` (case-insensitive).
- **Content signal:** `code` matches markdown structure. Use conservative
  heuristics requiring at least one *unambiguous* marker so plain prose / plain
  code does not misfire:
  - an ATX heading line: `/^#{1,6}\s+\S/m`
  - a fenced code block: ` ``` ` on its own line
  - a table row: a line containing `|` plus a separator row of `---`/`:--`
  - a markdown list with multiple items: two or more lines matching
    `/^\s*([-*+]|\d+\.)\s+\S/m`

  Require the content signal to come from a body of non-trivial size (e.g.
  more than ~1 line) to avoid promoting a single `- foo` value line.

What it does: classify a body as markdown. How you use it:
`isMarkdownBody(label, code)`. Depends on: nothing (pure string logic).

### Unit 2 — shared card-markdown styles

The markdown CSS currently lives inline in `PlanReviewCard` as the
`.plan-review-content …` rules inside its `STYLES` string. Extract the
markdown-element rules (headings, p, ul/ol/li, code, pre, table, hr, strong,
blockquote) into a shared, reusable style string keyed off a single class —
e.g. `.card-md` — exported from a small shared module
(`src/components/Chat/markdownCardStyles.ts`, exporting
`CARD_MD_CLASS` and `CARD_MD_STYLES`).

- `PlanReviewCard` keeps its layout/padding/scroll rules
  (`.plan-review-content` max-height, padding) and adds the shared `card-md`
  class to its content div, dropping the duplicated element rules.
- `ToolCallCard`'s markdown body uses the same `card-md` class + the shared
  style block.

This gives one source of truth for how markdown looks inside a card. What it
does: provide consistent compact-card markdown styling. How you use it: spread
`CARD_MD_STYLES` into a `<style>` tag and put `CARD_MD_CLASS` on the container.
Depends on: theme CSS vars only.

### Unit 3 — `ToolCardMarkdown` (inline component in `ToolCallCard.tsx`)

Small component: `<ToolCardMarkdown code={string} />`. Wraps
`ReactMarkdown` with `remarkPlugins={[remarkGfm]}`, container has the
`card-md` class. No rehype-raw / rehype-highlight needed for the compact card
view (matches `PlanReviewCard`, which uses only `remarkGfm`); code fences
render as plain `<pre>` styled by the shared CSS. Keeps the dependency surface
identical to the already-shipped `PlanReviewCard`.

### Unit 4 — toggle + wiring in `ToolCallCard`

In the body render branch currently guarded by
`!isBash && !isTodo && !isAskUserQuestion && code` (`ToolCallCard.tsx`):

1. Compute `const renderMarkdown = !diff && isMarkdownBody(label, code);`
   (diffs never go to markdown).
2. Add local state `const [mdView, setMdView] = useState<'rendered' | 'source'>('rendered');`
3. When `renderMarkdown` is true, render a small toggle control (two-segment
   "Rendered / Source" control, styled like the existing small card buttons)
   above the body.
   - `mdView === 'rendered'` → `<ToolCardMarkdown code={code} />` (full body, no
     line truncation; the card is already height-bounded the way plan-review is,
     so add the same `max-height`/scroll affordance via the shared/parent
     style).
   - `mdView === 'source'` → existing behaviour:
     `<HighlightedCode code={showAllCode ? code : truncated} lang={lang} />`
     plus the existing Show all / Show less button.
4. When `renderMarkdown` is false, behaviour is exactly as today (no toggle,
   `HighlightedCode`).

Output rendering below the body is unchanged.

## Data flow

`formatInput(toolCall)` → `{ label, code, diff, … }` (unchanged) →
`isMarkdownBody(label, code)` decides the body branch →
rendered (`ToolCardMarkdown`) or source (`HighlightedCode`), user-toggleable.

## Error handling

- `isMarkdownBody` is pure string matching; on any unexpected input it returns
  false (falls back to today's highlighted source) — safe default.
- `ReactMarkdown` already tolerates arbitrary strings; malformed markdown
  renders as best-effort text, same as `PlanReviewCard` today.

## Testing

Existing: `tests/unit/components/Chat/ToolCallCard.test.tsx`.

New unit tests:

- `isMarkdownBody`:
  - true for `label` ending `.md` / `.MD` / `.markdown` even with plain `code`.
  - true for multi-line `code` with an ATX heading; with a fenced block; with a
    GFM table; with a multi-item list.
  - false for plain prose, plain JSON/code bodies, a single `- value` line, and
    empty bodies.
- `ToolCallCard` rendering:
  - A Write of a `.md` file renders a `card-md` markdown container by default
    (rendered view), not a `highlighted-code`/`plain-code` source block.
  - Toggling to Source shows the highlighted source and the Show-all button.
  - A Write of a `.ts` file (non-markdown) renders source as before, with no
    toggle.
  - An Edit of a `.md` file still renders the diff view, not markdown.

Run with `vitest --maxWorkers=2` (machine constraint).

## Rollout / risk

Low risk, additive. Worst case of a detection false-positive is a non-markdown
body shown as markdown — recoverable in one click via the Source toggle, and
the conservative heuristics make this unlikely.
