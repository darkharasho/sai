# Project-Wide Find & Replace Design

**Status:** Approved (brainstorm 2026-04-27)
**Owner:** SAI 1.0 readiness
**Related:** Roadmap audit `docs/superpowers/plans/2026-04-27-unskip-e2e-tests.md` (sibling 1.0 item)

## Goal

Add a VS Code-style Search sidebar to SAI with project-wide find and replace across all files, with inline result preview and Monaco-routed edits for open files so a single Ctrl+Z undoes a replace.

## Non-goals (v1)

- Search history dropdown
- "Search only in open editors" toggle
- Search across multiple workspace folders simultaneously
- A separate replace-preview diff modal (inline strikethrough is the preview)
- Replacing the existing CommandPalette `#` grep mode (that stays as-is for quick lookups)

## User-facing behavior

### Entry points

- **Nav button** in the left sidebar, between Source Control and Explorer (icon: `Search`).
- **Keybinding:** `Ctrl+Shift+F` (Cmd+Shift+F on macOS) toggles the panel and focuses the search input.

### Layout (top to bottom)

```
┌─────────────────────────────────────┐
│ [Search input............] [Aa][\b][.*]│   case / word / regex toggles
│ [Replace input...........]          │
│ ▸ Toggle search details             │   collapsible:
│   files to include: [..............] │     glob, comma-separated
│   files to exclude: [..............] │     glob, comma-separated
│   [☑ Use .gitignore]                 │
├─────────────────────────────────────┤
│ ▾ src/foo.ts (3)             [↪ all]│   per-file replace-all on hover
│   12  function foo(x) {…       [↪]  │   per-match replace on hover
│   25  return foo(x);           [↪]  │
│   ⋮                                  │
│ ▾ src/bar.ts (1)                    │
├─────────────────────────────────────┤
│ 4 results in 2 files     [Replace All]│   footer
└─────────────────────────────────────┘
```

When the replace input is non-empty, each match row shows the matched text struck through followed by the replacement text inline (VS Code style).

### Search options

| Toggle           | Default | Backend flag                     |
| ---------------- | ------- | -------------------------------- |
| Case sensitive   | off     | `--case-sensitive` else `-i`     |
| Whole word       | off     | `--word-regexp`                  |
| Regex            | off     | omits `--fixed-strings`          |
| Files to include | empty   | `--glob <pattern>` (each)        |
| Files to exclude | empty   | `--glob !<pattern>` (each)       |
| Use .gitignore   | on      | omits `--no-ignore`              |

Include/exclude inputs accept comma-separated glob patterns.

### Replace flow

- **Per-match replace** (button on each row): replace just that occurrence.
- **Per-file Replace All** (button on each file group header): replace all matches in that file.
- **Global Replace All** (footer button): opens a confirmation dialog "About to replace N matches in M files. Continue?" then applies everything.
- After any replace, results refresh automatically.
- For each open file affected, replaces are applied through Monaco's edit API as a single undo unit per file (one Ctrl+Z undoes the whole file's changes).
- For unopened files, replaces write directly to disk via the filesystem service.

### Dirty/open file behavior

- **Search:** the in-memory buffer is searched for any file currently open in `OpenFile[]`; rg is told to skip those paths.
- **Replace:** open files go through Monaco; unopened files go through `fs.writeFile`.

## Architecture

### Components

```
src/components/SearchPanel/
  SearchPanel.tsx        — top-level UI: input rows, toggles, results tree, footer
  SearchResult.tsx       — one file group + its match rows
  searchTypes.ts         — SearchQuery, SearchMatch, FileMatches types

src/hooks/
  useSearch.ts           — debounced search hook owning state machine
                           (idle | searching | results | replacing | error)

electron/services/
  search.ts              — registerSearchHandlers(): IPC for search:run + search:replaceFile

electron/preload.ts      — adds searchRun(), searchReplaceFile()
src/types.ts             — adds SearchQuery, SearchMatch, FileMatches
src/App.tsx              — wires nav button + Ctrl+Shift+F + sidebar mount
```

### Types

```typescript
// src/components/SearchPanel/searchTypes.ts (also re-exported from src/types.ts)

export interface SearchQuery {
  pattern: string;
  caseSensitive: boolean;
  wholeWord: boolean;
  regex: boolean;
  includeGlobs: string[];   // parsed from comma-separated input
  excludeGlobs: string[];
  useGitignore: boolean;
}

export interface SearchMatch {
  line: number;            // 1-indexed
  column: number;          // 1-indexed start column of the match
  length: number;          // byte length of the matched text
  preview: string;         // full line, capped at 500 chars (matched range marked separately)
  matchStart: number;      // index within preview where match begins
  matchEnd: number;
}

export interface FileMatches {
  path: string;            // relative to project root, forward-slash
  matches: SearchMatch[];
}

export interface SearchResults {
  files: FileMatches[];
  truncated: boolean;      // true if hit the 5000-result or 200-file cap
  durationMs: number;
}
```

### IPC

```typescript
// electron/services/search.ts

export function registerSearchHandlers(): void;

// search:run
type SearchRunArgs = {
  rootPath: string;
  query: SearchQuery;
  openBuffers: { path: string; content: string }[];  // path is absolute
};
type SearchRunResult = SearchResults;

// search:replaceFile
type SearchReplaceFileArgs = {
  filePath: string;        // absolute
  // edits sorted descending by (line, column) so the renderer can apply
  // them in order without offset bookkeeping
  edits: { line: number; column: number; length: number; replacement: string }[];
};
type SearchReplaceFileResult = void;
```

### Search execution

1. Build rg argv:
   - Always: `--json --max-filesize 5M`
   - Toggles → flags per the table above
   - For each path in `openBuffers`, append `--glob !<relativePath>` so rg skips it
2. Spawn rg, parse `--json` line stream, build `FileMatches[]`.
3. For each `openBuffers` entry, scan its `content` against the same compiled regex; merge results with rg output. Buffer scan uses the same matcher so regex/case/word/literal semantics are identical.
4. Apply caps: stop at 5000 total matches or 200 files; set `truncated: true`.
5. 30-second timeout; on timeout, return whatever's accumulated with `truncated: true`.

### Replace execution (renderer side)

```typescript
async function executeReplace(targets: FileMatches[], replacement: string, query: SearchQuery): Promise<void> {
  // Build per-file edit lists, sorted descending by (line, column).
  const editsByPath = computeEdits(targets, replacement, query);

  for (const [path, edits] of editsByPath) {
    const openFile = openFiles.find(f => f.path === path);
    if (openFile) {
      // Route through Monaco: apply as a single undo group.
      applyMonacoEdits(openFile, edits);
    } else {
      // Disk write: compute new content, fs.writeFile.
      await window.sai.searchReplaceFile({ filePath: path, edits });
    }
  }
  // Trigger a fresh search to refresh the panel.
  await runSearch();
}
```

`applyMonacoEdits` uses the editor's `pushEditOperations` with a single undo stop so one Ctrl+Z undoes the entire file's changes.

For regex with capture groups (`$1`, `$2`), the renderer pre-computes the actual replacement string per match by re-running the regex on the matched line preview before sending to disk/Monaco. This keeps capture-group semantics consistent across both code paths.

## Error handling & edge cases

- **rg not on PATH** — show a one-time toast "Install ripgrep for fast project search" and fall back to a JS scanner walking `fsWalkFiles` results. Fallback supports literal-substring search only; regex / whole-word / case-sensitive options are disabled with a tooltip "Requires ripgrep". (Note: SAI already depends on rg for the existing `fs:grep`; this fallback is defensive.)
- **Binary files** — rg skips by default; we don't override.
- **Symlinks** — rg follows by default within the project root; keep that behavior.
- **Empty pattern** — search disabled, footer shows "Type to search".
- **Regex matches empty string** (e.g. `.*` with empty replacement) — block replace, show inline error "Pattern matches empty string."
- **Invalid regex** — show inline error under the search input "Invalid regex: <message>".
- **Replace target file modified outside SAI between search and replace** — disk-write path uses `fs.writeFile` blindly (acceptable for v1; matches VS Code behavior).
- **Replace target file deleted between search and replace** — `fs.writeFile` errors; surface a per-file error toast and continue with other files.
- **Massive result set (>5000 matches)** — show "Showing first 5000 results. Refine your query." in the footer; replace operates only on what's shown.

## Testing

### Unit — `electron/services/search.test.ts`

- Builds rg argv correctly for each toggle combination (matrix test).
- Parses rg `--json` output into `FileMatches[]`.
- Applies result/file caps correctly; sets `truncated` flag.
- Buffer scan produces same results as rg for matching content.
- `search:replaceFile` writes the right bytes for descending-ordered edits.

### Component — `src/components/SearchPanel/SearchPanel.test.tsx`

- Renders empty state when query is empty.
- Renders results tree from fixture `FileMatches[]`.
- Toggles expand/collapse a file group.
- Per-match replace button calls handler with the right edit.
- Per-file Replace All calls handler with all that file's edits.
- Global Replace All shows confirmation dialog before invoking handler.
- Disabled state when `truncated` and a global replace is attempted (allow but warn).

### Integration — `tests/integration/search.test.ts`

- Run real rg against `tests/e2e/fixtures/test-project`; verify results match expectations for a known pattern.
- `search:replaceFile` round-trip: write, read back, assert content.

### E2E — `tests/e2e/search.spec.ts`

- Open sidebar via Ctrl+Shift+F; assert focus is on the search input.
- Type a query (with `saiMock.searchRun` returning fixture results); assert results render.
- Click per-match replace; assert IPC was called with right args.
- Click global Replace All; assert confirmation appears, click confirm, assert IPC called.
- Toggle each search option; assert the corresponding flag appears in the IPC payload.

## File-by-file impact

| File | Change |
| --- | --- |
| `electron/services/search.ts` | NEW: ~200 lines, IPC handlers + rg invocation + buffer scan |
| `electron/main.ts` | +1 line: `registerSearchHandlers()` |
| `electron/preload.ts` | +2 lines: expose `searchRun`, `searchReplaceFile` |
| `src/types.ts` | +30 lines: SearchQuery / SearchMatch / FileMatches / SearchResults |
| `src/components/SearchPanel/SearchPanel.tsx` | NEW: ~250 lines |
| `src/components/SearchPanel/SearchResult.tsx` | NEW: ~120 lines |
| `src/components/SearchPanel/searchTypes.ts` | NEW: re-exports from src/types.ts |
| `src/components/SearchPanel/SearchPanel.css` | NEW: ~150 lines |
| `src/hooks/useSearch.ts` | NEW: ~150 lines, debounce + state machine |
| `src/App.tsx` | +20 lines: nav button, sidebar mount, Ctrl+Shift+F handler |

Estimated 7-10 days of focused work.

## Out-of-scope follow-ups (post-1.0)

- Search history dropdown (recent N queries)
- "Search only in open editors" filter
- Multi-workspace search
- Replace preview as a diff modal (alternative to inline strikethrough)
- Streaming results (currently we wait for rg to finish before rendering)
- "Files" mode (filter to file names, like VS Code's Quick Open) — already covered by CommandPalette files mode
