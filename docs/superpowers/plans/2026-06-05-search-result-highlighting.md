# Search-Result Highlighting in Tool Cards Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Render Grep/Glob (and other search-shaped) tool cards with a structured result view — emphasized file paths, dimmed `:line:` gutters, highlighted matched terms — and a clean key→value query view instead of JSON-mis-highlighted input.

**Architecture:** A pure parser (`parseSearchResults`) + detector (`isSearchTool`) in a new `searchResults.ts`. Two presentational components (`SearchQueryView`, `SearchResultView`) in `ToolCallCard.tsx`. Wiring adds a dedicated "search" body branch (search tools can have empty `code` but real output, which the existing `code`-gated branch can't show), fixes `hasBody`, and guards the generic branch. Markdown and diff rendering keep priority.

**Tech Stack:** React + TypeScript, Vitest + @testing-library/react.

---

## File Structure

- **Create** `src/components/Chat/searchResults.ts` — pure logic: `SearchRow` type, `parseSearchResults(output)`, `isSearchTool(name, output)`, and a `highlightMatches(text, pattern)` helper returning React-friendly segments. One responsibility: classify/parse search output. No React.
- **Modify** `src/components/Chat/ToolCallCard.tsx` — add `query` to `FormatResult`/`formatInput`; add `SearchQueryView` + `SearchResultView` components; add the search body branch, `hasBody` fix, generic-branch guard, and CSS.
- **Create** `tests/unit/components/Chat/searchResults.test.ts` — unit tests for the pure module.
- **Modify** `tests/unit/components/Chat/ToolCallCard.test.tsx` — rendering tests for the search branch.

---

## Task 1: Pure search parser + detector

**Files:**
- Create: `src/components/Chat/searchResults.ts`
- Test: `tests/unit/components/Chat/searchResults.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `tests/unit/components/Chat/searchResults.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { parseSearchResults, isSearchTool, highlightMatches } from '../../../../src/components/Chat/searchResults';

describe('parseSearchResults', () => {
  it('parses a grep content line into a match row', () => {
    const { rows, kind } = parseSearchResults('src/a.ts:12:const x = 1');
    expect(rows).toEqual([{ type: 'match', path: 'src/a.ts', line: 12, text: 'const x = 1' }]);
    expect(kind).toBe('matches');
  });

  it('parses a glob file list into file rows', () => {
    const { rows, kind } = parseSearchResults('src/a.ts\nsrc/b.tsx');
    expect(rows).toEqual([
      { type: 'file', path: 'src/a.ts' },
      { type: 'file', path: 'src/b.tsx' },
    ]);
    expect(kind).toBe('files');
  });

  it('captures grep context separators and classifies mixed output', () => {
    const { rows, kind } = parseSearchResults('src/a.ts:1:foo\n--\nsrc/b.ts:2:bar');
    expect(rows[1]).toEqual({ type: 'separator' });
    expect(kind).toBe('matches');
  });

  it('treats prose lines as raw, not file/match', () => {
    const { rows, kind } = parseSearchResults('Found 3 matches across 2 files');
    expect(rows).toEqual([{ type: 'raw', text: 'Found 3 matches across 2 files' }]);
    expect(kind).toBe('mixed');
  });

  it('returns empty kind for blank output', () => {
    expect(parseSearchResults('').kind).toBe('empty');
    expect(parseSearchResults('   \n  ').rows).toEqual([]);
  });

  it('does not crash on a windows-style path', () => {
    expect(() => parseSearchResults('C:\\Users\\x\\a.ts')).not.toThrow();
  });
});

describe('isSearchTool', () => {
  it('is true for Grep and Glob by name regardless of output', () => {
    expect(isSearchTool('Grep', '')).toBe(true);
    expect(isSearchTool('Glob', 'anything at all here')).toBe(true);
  });

  it('is true for an unknown tool whose output is mostly file/match rows', () => {
    expect(isSearchTool('CustomSearch', 'src/a.ts:1:x\nsrc/b.ts:2:y\nsrc/c.ts')).toBe(true);
  });

  it('is false for an unknown tool with prose output', () => {
    expect(isSearchTool('Read', 'This is a paragraph of text.\nAnother sentence here.')).toBe(false);
  });

  it('is false for trivial output', () => {
    expect(isSearchTool('Read', '')).toBe(false);
    expect(isSearchTool('Read', 'one line')).toBe(false);
  });
});

describe('highlightMatches', () => {
  it('splits text into hit and plain segments for a literal pattern', () => {
    expect(highlightMatches('const x = 1', 'const')).toEqual([
      { hit: true, text: 'const' },
      { hit: false, text: ' x = 1' },
    ]);
  });

  it('returns a single plain segment when there is no match', () => {
    expect(highlightMatches('abc', 'zzz')).toEqual([{ hit: false, text: 'abc' }]);
  });

  it('returns a single plain segment for an invalid regex pattern', () => {
    expect(highlightMatches('a(b', '(')).toEqual([{ hit: false, text: 'a(b' }]);
  });

  it('returns a single plain segment for an empty pattern', () => {
    expect(highlightMatches('abc', '')).toEqual([{ hit: false, text: 'abc' }]);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run tests/unit/components/Chat/searchResults.test.ts --maxWorkers=2`
Expected: FAIL — module not found / functions undefined.

- [ ] **Step 3: Implement the module**

Create `src/components/Chat/searchResults.ts`:

```ts
/** Pure parsing/classification for search-tool output (Grep/Glob and lookalikes). */

export type SearchRow =
  | { type: 'match'; path: string; line: number; text: string }
  | { type: 'file'; path: string }
  | { type: 'separator' }
  | { type: 'raw'; text: string };

export type SearchKind = 'files' | 'matches' | 'mixed' | 'empty';

const MATCH_RE = /^(.+?):(\d+):(.*)$/;
// A bare path: no whitespace, and contains a slash or a dotted extension.
const FILE_RE = /^[^\s:][^\s]*$/;

function looksLikePath(s: string): boolean {
  if (!FILE_RE.test(s)) return false;
  return s.includes('/') || s.includes('\\') || /\.[a-zA-Z0-9]{1,8}$/.test(s);
}

function classify(line: string): SearchRow | null {
  const trimmed = line.trim();
  if (!trimmed) return null;
  if (trimmed === '--') return { type: 'separator' };
  const m = trimmed.match(MATCH_RE);
  if (m && looksLikePath(m[1])) {
    return { type: 'match', path: m[1], line: parseInt(m[2], 10), text: m[3] };
  }
  if (looksLikePath(trimmed)) return { type: 'file', path: trimmed };
  return { type: 'raw', text: trimmed };
}

export function parseSearchResults(output: string): { rows: SearchRow[]; kind: SearchKind } {
  const rows: SearchRow[] = [];
  for (const line of (output || '').split('\n')) {
    const row = classify(line);
    if (row) rows.push(row);
  }
  if (rows.length === 0) return { rows, kind: 'empty' };
  const content = rows.filter(r => r.type === 'file' || r.type === 'match');
  const files = rows.filter(r => r.type === 'file').length;
  const matches = rows.filter(r => r.type === 'match').length;
  let kind: SearchKind;
  if (content.length === 0) kind = 'mixed';
  else if (matches === 0) kind = 'files';
  else if (files === 0) kind = 'matches';
  else kind = 'mixed';
  return { rows, kind };
}

export function isSearchTool(name: string, output: string): boolean {
  if (name === 'Grep' || name === 'Glob') return true;
  const { rows } = parseSearchResults(output);
  const contentRows = rows.filter(r => r.type === 'file' || r.type === 'match').length;
  const nonBlank = (output || '').split('\n').filter(l => l.trim()).length;
  if (nonBlank < 2 || contentRows < 2) return false;
  return contentRows / rows.filter(r => r.type !== 'separator').length >= 0.75;
}

export type HighlightSegment = { hit: boolean; text: string };

/** Split `text` into hit/plain segments by `pattern` (treated as a regex).
 *  Invalid/empty patterns, or pathological match counts, yield one plain segment. */
export function highlightMatches(text: string, pattern: string): HighlightSegment[] {
  if (!pattern) return [{ hit: false, text }];
  let re: RegExp;
  try {
    re = new RegExp(pattern, 'g');
  } catch {
    return [{ hit: false, text }];
  }
  const segments: HighlightSegment[] = [];
  let lastIndex = 0;
  let count = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    if (++count > 50) return [{ hit: false, text }];
    // Guard against zero-width matches looping forever.
    if (m.index === re.lastIndex) { re.lastIndex++; continue; }
    if (m.index > lastIndex) segments.push({ hit: false, text: text.slice(lastIndex, m.index) });
    segments.push({ hit: true, text: m[0] });
    lastIndex = m.index + m[0].length;
  }
  if (segments.length === 0) return [{ hit: false, text }];
  if (lastIndex < text.length) segments.push({ hit: false, text: text.slice(lastIndex) });
  return segments;
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run tests/unit/components/Chat/searchResults.test.ts --maxWorkers=2`
Expected: PASS — all cases.

Note on the "prose" test: `'Found 3 matches across 2 files'` has spaces so it fails `FILE_RE` → `raw`; with zero content rows, `kind` is `mixed`. The test asserts exactly that.

- [ ] **Step 5: Commit**

```bash
git add src/components/Chat/searchResults.ts tests/unit/components/Chat/searchResults.test.ts
git commit -m "feat(ui): add pure search-result parser and detector"
```

---

## Task 2: Query + result view components

**Files:**
- Modify: `src/components/Chat/ToolCallCard.tsx`

This task adds the two presentational components and the `query` field on `FormatResult`. No wiring into the render tree yet (Task 3), so there is no behavioral test here — it is verified by typecheck and by Task 3's tests. (These are small, pure-presentational components; building them in isolation first keeps Task 3 focused on wiring.)

- [ ] **Step 1: Add `query` to FormatResult and populate it**

In `src/components/Chat/ToolCallCard.tsx`, extend the `FormatResult` interface (currently around line 238):

```tsx
interface FormatResult {
  label: string;
  code: string;
  langOverride?: string;
  diff?: { oldString: string; newString: string; fileLang: string };
  query?: { pattern?: string; path?: string; glob?: string; type?: string };
}
```

In `formatInput`, the `parsed.pattern` branch (around line 276) currently is:

```tsx
    // Grep / Glob — show pattern + optional path/glob filter
    if (parsed.pattern) {
      const parts: string[] = [`pattern: ${parsed.pattern}`];
      if (parsed.path) parts.push(`path: ${parsed.path}`);
      if (parsed.glob) parts.push(`glob: ${parsed.glob}`);
      if (parsed.type) parts.push(`type: ${parsed.type}`);
      const isGlob = toolCall.name?.toLowerCase().includes('glob');
      return { label: isGlob ? `glob: ${parsed.pattern}` : `grep: ${parsed.pattern}`, code: parts.length > 1 ? parts.join('\n') : '' };
    }
```

Replace its `return` with one that also carries the structured query:

```tsx
    // Grep / Glob — show pattern + optional path/glob filter
    if (parsed.pattern) {
      const parts: string[] = [`pattern: ${parsed.pattern}`];
      if (parsed.path) parts.push(`path: ${parsed.path}`);
      if (parsed.glob) parts.push(`glob: ${parsed.glob}`);
      if (parsed.type) parts.push(`type: ${parsed.type}`);
      const isGlob = toolCall.name?.toLowerCase().includes('glob');
      return {
        label: isGlob ? `glob: ${parsed.pattern}` : `grep: ${parsed.pattern}`,
        code: parts.length > 1 ? parts.join('\n') : '',
        query: { pattern: parsed.pattern, path: parsed.path, glob: parsed.glob, type: parsed.type },
      };
    }
```

- [ ] **Step 2: Add the import for the pure module**

Near the other `./` imports (after the `markdownCardStyles` import added previously, around line 18), add:

```tsx
import { parseSearchResults, isSearchTool, highlightMatches, type SearchRow } from './searchResults';
```

- [ ] **Step 3: Add the SearchQueryView component**

Add just before `const MAX_PREVIEW_LINES = 20;` (near line 364, alongside `ToolCardMarkdown`):

```tsx
function SearchQueryView({ query }: { query: NonNullable<FormatResult['query']> }) {
  const fields: [string, string | undefined][] = [
    ['pattern', query.pattern],
    ['path', query.path],
    ['glob', query.glob],
    ['type', query.type],
  ];
  const present = fields.filter(([, v]) => v != null && v !== '');
  if (present.length === 0) return null;
  return (
    <div className="search-query">
      {present.map(([k, v]) => (
        <div key={k} className="search-query-row">
          <span className="search-query-key">{k}</span>
          <span className="search-query-val">{v}</span>
        </div>
      ))}
    </div>
  );
}
```

- [ ] **Step 4: Add the SearchResultView component**

Add immediately after `SearchQueryView`:

```tsx
const SEARCH_MAX_ROWS = 12;

function SearchResultLine({ text, pattern }: { text: string; pattern?: string }) {
  const segments = highlightMatches(text, pattern || '');
  return (
    <span className="search-line-text">
      {segments.map((s, i) =>
        s.hit ? <mark key={i} className="search-hit">{s.text}</mark> : <span key={i}>{s.text}</span>
      )}
    </span>
  );
}

function SearchResultView({ rows, pattern }: { rows: SearchRow[]; pattern?: string }) {
  const [showAll, setShowAll] = useState(false);
  if (rows.length === 0) return null;
  const visible = showAll ? rows : rows.slice(0, SEARCH_MAX_ROWS);
  const hiddenCount = rows.length - visible.length;
  return (
    <div className="search-result">
      {visible.map((row, i) => {
        if (row.type === 'separator') return <div key={i} className="search-sep" aria-hidden />;
        if (row.type === 'file') {
          return (
            <div key={i} className="search-row search-row-file">
              <span className="search-dot" aria-hidden />
              <span className="search-path">{row.path}</span>
            </div>
          );
        }
        if (row.type === 'match') {
          return (
            <div key={i} className="search-row search-row-match">
              <span className="search-path">{row.path}</span>
              <span className="search-gutter">:{row.line}:</span>
              <SearchResultLine text={row.text} pattern={pattern} />
            </div>
          );
        }
        return <div key={i} className="search-row search-row-raw">{row.text}</div>;
      })}
      {(hiddenCount > 0 || showAll) && rows.length > SEARCH_MAX_ROWS && (
        <button className="tool-call-show-more" onClick={() => setShowAll(prev => !prev)}>
          {showAll ? 'Show less' : `Show all (${rows.length} results)`}
        </button>
      )}
    </div>
  );
}
```

(`useState` is already imported at the top of the file.)

- [ ] **Step 5: Typecheck**

Run: `npx tsc --noEmit`
Expected: no new errors. (The components are defined but not yet used — TypeScript allows unused module-level functions; if a `noUnusedLocals`-style error appears for an unused component, proceed to Task 3 which uses them, or temporarily ignore — but this project does not error on unused module functions, only unused locals. Verify the two components and `SearchResultLine`/`SEARCH_MAX_ROWS` typecheck cleanly.)

- [ ] **Step 6: Commit**

```bash
git add src/components/Chat/ToolCallCard.tsx
git commit -m "feat(ui): add SearchQueryView and SearchResultView components"
```

---

## Task 3: Wire search rendering into ToolCallCard

**Files:**
- Modify: `src/components/Chat/ToolCallCard.tsx`
- Test: `tests/unit/components/Chat/ToolCallCard.test.tsx`

- [ ] **Step 1: Write the failing tests**

Add to `tests/unit/components/Chat/ToolCallCard.test.tsx` (the file already imports `render`, `fireEvent`, and `ToolCallCard`):

```tsx
describe('ToolCallCard search rendering', () => {
  const grep = {
    id: 'g1',
    type: 'file_search' as const,
    name: 'Grep',
    input: JSON.stringify({ pattern: 'const', path: 'src', glob: '*.ts' }),
    output: 'src/a.ts:12:const x = 1\nsrc/b.ts:3:const y = 2',
  };

  it('renders grep output as search-result rows, not highlighted source', () => {
    const { container } = render(<ToolCallCard toolCall={grep} />);
    expect(container.querySelector('.search-result')).toBeTruthy();
    expect(container.querySelectorAll('.search-row-match').length).toBe(2);
  });

  it('highlights the matched term inside grep results', () => {
    const { container } = render(<ToolCallCard toolCall={grep} />);
    const marks = container.querySelectorAll('.search-hit');
    expect(marks.length).toBeGreaterThan(0);
    expect(marks[0].textContent).toBe('const');
  });

  it('shows the query view for path/glob fields', () => {
    const { container } = render(<ToolCallCard toolCall={grep} />);
    const keys = Array.from(container.querySelectorAll('.search-query-key')).map(n => n.textContent);
    expect(keys).toContain('path');
    expect(keys).toContain('glob');
  });

  it('renders glob output as file rows even with no input body code', () => {
    const glob = {
      id: 'g2',
      type: 'file_search' as const,
      name: 'Glob',
      input: JSON.stringify({ pattern: '**/*.ts' }),
      output: 'src/a.ts\nsrc/b.ts',
    };
    const { container } = render(<ToolCallCard toolCall={glob} />);
    expect(container.querySelectorAll('.search-row-file').length).toBe(2);
  });

  it('does not crash and renders plain content for an invalid regex pattern', () => {
    const bad = {
      id: 'g3',
      type: 'file_search' as const,
      name: 'Grep',
      input: JSON.stringify({ pattern: '(' }),
      output: 'src/a.ts:1:a(b',
    };
    const { container } = render(<ToolCallCard toolCall={bad} />);
    expect(container.querySelector('.search-row-match')).toBeTruthy();
    expect(container.querySelector('.search-hit')).toBeNull();
  });

  it('leaves a non-search tool (Read output) unchanged', () => {
    const read = {
      id: 'r1',
      type: 'file_read' as const,
      name: 'Read',
      input: JSON.stringify({ file_path: 'src/a.ts' }),
      output: 'just some file contents here',
    };
    const { container } = render(<ToolCallCard toolCall={read} />);
    expect(container.querySelector('.search-result')).toBeNull();
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run tests/unit/components/Chat/ToolCallCard.test.tsx --maxWorkers=2`
Expected: FAIL — no `.search-result` element.

- [ ] **Step 3: Compute the `search` flag and read `query`**

In the `ToolCallCard` component body, the destructure at line 762 currently reads:

```tsx
  const { label, code, langOverride, diff } = formatInput(toolCall);
```

Change it to also pull `query`:

```tsx
  const { label, code, langOverride, diff, query } = formatInput(toolCall);
```

Immediately after the `renderMarkdown`/`mdView` lines (around line 766), add:

```tsx
  const search = !diff && !renderMarkdown && isSearchTool(toolCall.name, toolCall.output || '');
  const searchParsed = search && toolCall.output && !parseToolError(toolCall.output).isToolError
    ? parseSearchResults(toolCall.output)
    : null;
```

- [ ] **Step 4: Fix `hasBody` for search tools**

The `hasBody` line (around line 784) currently reads:

```tsx
  const hasBody = isAskUserQuestion ? true : isBash ? !!toolCall.output : isTodo ? true : !!code;
```

Change to:

```tsx
  const hasBody = isAskUserQuestion ? true : isBash ? !!toolCall.output : isTodo ? true : search ? (!!toolCall.output || !!query) : !!code;
```

- [ ] **Step 5: Add the search body branch and guard the generic branch**

The generic body branch currently opens (line 887):

```tsx
            {!isBash && !isTodo && !isAskUserQuestion && code && (
```

Change that guard to also exclude search:

```tsx
            {!isBash && !isTodo && !isAskUserQuestion && !search && code && (
```

Then, immediately BEFORE that generic branch (right after the `isAskUserQuestion` block that ends around line 886), insert a new search branch:

```tsx
            {search && (
              <div className="tool-call-body search-tool-body">
                {query && <SearchQueryView query={query} />}
                {toolCall.output && (() => {
                  const parsedOutput = parseToolError(toolCall.output);
                  if (parsedOutput.isToolError) {
                    return (
                      <div className="tool-call-output">
                        <ToolErrorDisplay message={parsedOutput.message} />
                      </div>
                    );
                  }
                  return (
                    <div className="tool-call-output">
                      <div className="tool-call-output-header">
                        <span className="tool-call-output-label">Results</span>
                      </div>
                      <SearchResultView rows={searchParsed?.rows || []} pattern={query?.pattern} />
                    </div>
                  );
                })()}
              </div>
            )}
```

- [ ] **Step 6: Add the CSS**

Inside the big inline `<style>` template literal (after the `.tool-call-md-seg-on { ... }` block added previously, near line 1115), add:

```css
          .search-tool-body { padding-bottom: 4px; }
          .search-query {
            display: flex;
            flex-direction: column;
            gap: 3px;
            padding: 10px 12px 6px;
          }
          .search-query-row {
            display: flex;
            align-items: baseline;
            gap: 8px;
            font-family: 'Geist Mono', 'JetBrains Mono', monospace;
            font-size: 11.5px;
          }
          .search-query-key {
            flex-shrink: 0;
            min-width: 56px;
            font-size: 9px;
            text-transform: uppercase;
            letter-spacing: 0.5px;
            color: var(--text-muted);
            padding-top: 1px;
          }
          .search-query-val { color: var(--text); word-break: break-all; }
          .search-result {
            display: flex;
            flex-direction: column;
            gap: 1px;
            padding: 4px 0;
          }
          .search-row {
            display: flex;
            align-items: baseline;
            gap: 6px;
            padding: 1px 12px;
            font-family: 'Geist Mono', 'JetBrains Mono', monospace;
            font-size: 11.5px;
            line-height: 1.5;
            white-space: pre-wrap;
            word-break: break-word;
          }
          .search-dot {
            flex-shrink: 0;
            width: 4px;
            height: 4px;
            border-radius: 50%;
            background: var(--accent);
            opacity: 0.7;
            transform: translateY(-2px);
          }
          .search-path { color: var(--accent); flex-shrink: 0; }
          .search-row-match .search-path { opacity: 0.85; }
          .search-gutter { color: var(--text-muted); flex-shrink: 0; }
          .search-line-text { color: var(--text-secondary); }
          .search-hit {
            background: color-mix(in srgb, var(--accent) 30%, transparent);
            color: var(--text);
            border-radius: 2px;
            padding: 0 1px;
          }
          .search-row-raw { color: var(--text-muted); }
          .search-sep {
            height: 0;
            border-top: 1px dashed var(--border);
            margin: 3px 12px;
          }
```

- [ ] **Step 7: Run to verify it passes**

Run: `npx vitest run tests/unit/components/Chat/ToolCallCard.test.tsx --maxWorkers=2`
Expected: PASS — all search rendering tests plus the pre-existing tests.

- [ ] **Step 8: Typecheck**

Run: `npx tsc --noEmit`
Expected: no new errors.

- [ ] **Step 9: Commit**

```bash
git add src/components/Chat/ToolCallCard.tsx tests/unit/components/Chat/ToolCallCard.test.tsx
git commit -m "feat(ui): render Grep/Glob cards with structured search results"
```

---

## Task 4: Full verification

**Files:** none (verification only)

- [ ] **Step 1: Run the full Chat test suite**

Run: `npx vitest run tests/unit/components/Chat --maxWorkers=2`
Expected: PASS — searchResults, ToolCallCard, PlanReviewCard, ChatMessage suites all green.

- [ ] **Step 2: Typecheck the whole project**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Manual smoke (optional, if running the app)**

Launch the app; run a Grep (with a pattern, path, and glob) and a Glob. Confirm: query rows show pattern/path/glob; grep results show emphasized path, dimmed `:line:`, highlighted match term; glob shows file rows; a Read/Bash card is unchanged; a `.md` Write still renders markdown.

- [ ] **Step 4: Final commit (empty if nothing to add)**

```bash
git add -A
git commit -m "test(ui): verify search-result highlighting" --allow-empty
```

---

## Self-Review Notes

- **Spec coverage:** parser+detector → Task 1; query view (key→value rows) + result view with match `<mark>` + truncation → Task 2; wiring/`hasBody`/priority over markdown+diff → Task 3; full verification → Task 4. ✅
- **No placeholders:** all code shown in full. ✅
- **Type consistency:** `SearchRow`, `parseSearchResults`, `isSearchTool`, `highlightMatches`/`HighlightSegment`, `SearchQueryView({ query })`, `SearchResultView({ rows, pattern })`, `FormatResult.query`, the `search`/`searchParsed` locals — used consistently across tasks. ✅
- **Priority/ordering:** `search = !diff && !renderMarkdown && …` ensures diff and markdown win; generic branch guarded with `!search`. A `.md` Write never reaches the search branch (Write has no `pattern`, and `isSearchTool('Write', …)` is name-false and its content won't hit 75% file/match for prose). ✅
- **Machine constraint:** vitest `--maxWorkers=2`.
