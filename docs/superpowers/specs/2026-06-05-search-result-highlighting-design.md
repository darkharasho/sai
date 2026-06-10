# Better syntax highlighting for search tool cards (grep/glob)

## Problem

Tool cards render Grep/Glob poorly:

- **Output** (matched lines, file lists) renders through `HighlightedCode lang="text"` — flat monospace. File paths, line numbers, and match content are visually identical, so results are hard to scan.
- **Input/query** is built by `formatInput` as `key: value` text (`pattern: …`, `path: …`), but `detectLang` inspects the raw JSON input (which starts with `{`) and picks `json`, so the key:value block is syntax-colored as broken JSON.

## Goal

Give search-tool cards a structured, readable result view: emphasized file paths, dimmed `:line:` gutters, and the matched term highlighted within grep lines. Render the query as clean key→value rows instead of mis-highlighted JSON. Apply to Grep/Glob by name and to other tools whose output has the same shape (content-detected).

## Scope

In scope:

- New pure parser `parseSearchResults(output)`.
- New `SearchResultView` (output) and `SearchQueryView` (input) components.
- New `isSearchTool(toolCall, parsedRows)` detector.
- Wiring into `ToolCallCard`'s non-Bash/Todo/AskUserQuestion branch.

Out of scope (unchanged):

- **Bash** — keeps its dedicated `BashInOut` IN/OUT view.
- **Read/Write/Edit diffs** and **markdown bodies** (`renderMarkdown` from the prior feature) — untouched and take priority over search rendering.
- **Tool output for non-search tools** — still `HighlightedCode lang="text"`.

## Decisions

- **Match highlighting: yes.** Highlight the matched substring within grep lines using the search `pattern`, compiled in a `try/catch`; invalid/unsupported patterns fall back to plain content.
- **Detection: tool name + content shape.** Grep/Glob always render as search results. Other tools opt in only when a strong majority of output lines parse as `file` or `match` rows.
- **Query display: key→value rows** (label + mono value), not chips.

## Design

### Unit 1 — `parseSearchResults(output: string): { rows: SearchRow[]; kind: 'files' | 'matches' | 'mixed' | 'empty' }`

New file `src/components/Chat/searchResults.ts`. Pure. Splits `output` into lines and classifies each:

```ts
export type SearchRow =
  | { type: 'match'; path: string; line: number; text: string }
  | { type: 'file'; path: string }
  | { type: 'separator' }        // grep context separator "--"
  | { type: 'raw'; text: string };
```

Rules (applied per non-empty line, in order):

- `"--"` (trimmed) → `separator`.
- Matches `/^(.+?):(\d+):(.*)$/` → `match` with `path`, `line` (parsed int), `text` (the remainder, not trimmed). The non-greedy path segment stops at the first `:<digits>:`.
- Looks like a bare path → `file`. "Looks like a path": no leading whitespace, contains no internal spaces *or* ends in a known-ish file pattern; concretely, the whole trimmed line matches `/^[^\s:][^\s]*$/` and contains a `/`, `\`, or a `.` extension (e.g. `src/a.ts`, `README.md`, `dir/sub`). This keeps prose lines out.
- Otherwise → `raw`.

`kind`: `empty` if no rows; `files` if every classified content row is `file`; `matches` if every content row is `match`; else `mixed`.

What it does: turn raw search output into typed rows. How you use it: `const { rows, kind } = parseSearchResults(output)`. Depends on: nothing.

### Unit 2 — `isSearchTool(name: string, output: string): boolean`

In `searchResults.ts`. Returns true when:

- `name` is `Grep` or `Glob` (exact), OR
- the output is non-trivial (≥ 2 non-blank lines) and ≥ 75% of content rows from `parseSearchResults` are `file` or `match` (i.e. `(fileRows + matchRows) / contentRows >= 0.75`, with `contentRows >= 2`).

What it does: gate the search-result rendering. How you use it: `isSearchTool(toolCall.name, toolCall.output || '')`. Depends on: `parseSearchResults`.

### Unit 3 — `<SearchResultView rows pattern />`

Inline in `ToolCallCard.tsx` (or `searchResults.ts` if it stays pure-presentational; it needs React, so `ToolCallCard.tsx`). Renders parsed rows:

- `file` → row with a file icon-dot and the `path` in accent-tinted mono.
- `match` → `path` (emphasis), a dimmed `:line:` gutter, then `text`. The matched substring(s) within `text` are wrapped in `<mark className="search-hit">`.
- `separator` → a thin dashed divider.
- `raw` → plain mono line.

Match highlighting: compile `pattern` once via `new RegExp(pattern, 'g')` inside `try/catch`. On throw (invalid regex) or empty pattern, render `text` plain. Split each `text` on regex matches and wrap hits. Cap highlight work per line (e.g. bail to plain if >50 matches in a line) to avoid pathological patterns.

Truncation: reuse the existing `MAX_OUT = 8`-style "show all (N lines)" affordance already used by `BashInOut`. Default-collapse to the first N rows with a show-more toggle.

What it does: present typed rows with highlighting. How you use it: `<SearchResultView rows={rows} pattern={pattern} />`. Depends on: parsed rows + the search `pattern` (from input).

### Unit 4 — `<SearchQueryView parts />`

Inline in `ToolCallCard.tsx`. Receives the parsed input fields and renders key→value rows:

- A row per present field among `pattern`, `path`, `glob`, `type`: a small uppercase label (`PATTERN`, `PATH`, `GLOB`, `TYPE`) + the value in mono. `pattern` value may use a subtle "regex" styling but no Shiki.
- Replaces the `formatInput` `code` block + `HighlightedCode` path for search tools.

What it does: show the query cleanly. How you use it: `<SearchQueryView pattern={…} path={…} glob={…} type={…} />`. Depends on: nothing.

### Unit 5 — Wiring in `ToolCallCard`

- Compute `const search = !diff && !renderMarkdown && isSearchTool(toolCall.name, toolCall.output || '')`. (Markdown and diff take priority.)
- Extract the query fields: reuse the already-parsed `JSON.parse(toolCall.input)` (the same parse `formatInput` does) to get `pattern/path/glob/type`. To avoid double-parsing, add an optional `query` field to `FormatResult` populated in `formatInput`'s `parsed.pattern` branch, and read it here.
- In the body branch:
  - When `search`: render `<SearchQueryView … />` for the input (when any of path/glob/type present; pattern already shows in the header label) and, in the output area, `<SearchResultView rows pattern />` instead of `HighlightedCode lang="text"`.
  - Else: existing behaviour (markdown / diff / highlighted source) unchanged.
- `hasBody` must be true for search tools when there is output even if `code` is empty (Glob with only a pattern has empty `code` today). Update `hasBody` so a search tool with output expands.

## Data flow

`toolCall.input` → `formatInput` → `{ label, code, query }`; `toolCall.output` → `parseSearchResults` → `{ rows, kind }`. `isSearchTool` gates: search tools → `SearchQueryView` + `SearchResultView`; others unchanged.

## Error handling

- `parseSearchResults` is pure string logic; unrecognized lines degrade to `raw`. Never throws.
- Match-highlight regex compiled in `try/catch`; invalid patterns → plain text.
- If `output` is absent, `SearchResultView` is not rendered (no output body), matching today.

## Testing

New unit tests `tests/unit/components/Chat/searchResults.test.ts`:

- `parseSearchResults`:
  - grep content (`src/a.ts:12:const x = 1`) → one `match` row with path/line/text.
  - glob list (`src/a.ts\nsrc/b.tsx`) → two `file` rows, `kind: 'files'`.
  - mixed content + a `--` separator → `separator` row present, `kind: 'mixed'` or `matches` as appropriate.
  - prose lines (`Found 3 matches`) → `raw`, not `file`/`match`.
  - empty output → `kind: 'empty'`, no rows.
  - a path with a Windows-y `C:\x` is parsed without crashing (documents behaviour; need not be perfect).
- `isSearchTool`:
  - `('Grep', anything)` and `('Glob', anything)` → true.
  - non-search name with mostly file/match output → true.
  - non-search name with prose output → false.
  - `('Read', '')` / trivial output → false.

New `ToolCallCard.test.tsx` cases:

- A Grep card with `path:line:text` output renders `.search-result` rows (not `.highlighted-code`), with a `.search-hit` mark around the matched term.
- A Glob card renders `.search-result` file rows; the query view shows path/glob rows when present.
- An invalid regex pattern still renders match content (plain, no crash, no `.search-hit`).
- A non-search tool (e.g. `Read` output) is unchanged (no `.search-result`).
- A `.md` Write still renders markdown (markdown priority over search) — regression guard.

Run with `vitest --maxWorkers=2`.

## Rollout / risk

Additive and gated by `isSearchTool`. Worst case is a content-shape false positive rendering a non-search output as a file list — low impact (still legible) and bounded by the 75% threshold + Grep/Glob-name certainty. No change to Bash/Read/Write/Edit/markdown paths.
