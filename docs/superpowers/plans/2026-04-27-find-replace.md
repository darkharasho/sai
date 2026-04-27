# Find & Replace Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a VS Code-style Search sidebar with project-wide find and replace, inline preview, and Monaco-routed edits for open files (single Ctrl+Z undoes a replace per file).

**Architecture:** A new `electron/services/search.ts` IPC service shells out to ripgrep, parses `--json` output, and merges in-memory buffer scans for open dirty files. A new `src/components/SearchPanel/` directory holds the sidebar UI driven by a `useSearch` hook with a small state machine (idle | searching | results | replacing | error). Replaces route through Monaco for open files (single undo unit per file) and through `fs.writeFile` for unopened files.

**Tech Stack:** TypeScript, Electron IPC, ripgrep (`rg`), React, Monaco Editor, Vitest, Playwright.

**Spec:** `docs/superpowers/specs/2026-04-27-find-replace-design.md`

---

## File Structure

**Create:**
- `electron/services/search.ts` — IPC handlers `search:run` and `search:replaceFile`; rg argv builder; in-memory buffer scanner; result merger
- `tests/unit/services/search.test.ts` — unit tests for argv builder, parser, merger, replace
- `tests/integration/search.test.ts` — runs real rg against the e2e fixture project
- `src/components/SearchPanel/SearchPanel.tsx` — top-level sidebar UI
- `src/components/SearchPanel/SearchResult.tsx` — file group + match rows
- `src/components/SearchPanel/searchTypes.ts` — re-exports types from `src/types.ts` for component-local imports
- `src/components/SearchPanel/SearchPanel.css` — styling
- `src/hooks/useSearch.ts` — debounced search state machine + replace orchestrator
- `tests/unit/hooks/useSearch.test.ts` — hook tests
- `tests/unit/components/SearchPanel.test.tsx` — component tests
- `tests/e2e/search.spec.ts` — E2E

**Modify:**
- `electron/main.ts` — register the new handlers
- `electron/preload.ts` — expose `searchRun`, `searchReplaceFile`
- `src/types.ts` — add `SearchQuery`, `SearchMatch`, `FileMatches`, `SearchResults`
- `src/App.tsx` — mount the sidebar, add Ctrl+Shift+F handler, pass replace dependencies
- `src/components/NavBar.tsx` — add Search nav button between Source Control and Chat History
- `tests/e2e/electron.setup.ts` — extend default mock with `searchRun`/`searchReplaceFile`

**Out of scope (post-1.0):** search history, "search only in open editors" filter, multi-workspace search, replace preview as a diff modal, streaming results.

---

## Task 1: Backend — argv builder

Build the function that turns a `SearchQuery` into the `rg` argv array. Pure function, easy to TDD before any IPC plumbing.

**Files:**
- Create: `electron/services/search.ts`
- Create: `tests/unit/services/search.test.ts`

- [ ] **Step 1: Add the types to `src/types.ts`**

Append to `src/types.ts`:

```typescript
export interface SearchQuery {
  pattern: string;
  caseSensitive: boolean;
  wholeWord: boolean;
  regex: boolean;
  includeGlobs: string[];
  excludeGlobs: string[];
  useGitignore: boolean;
}

export interface SearchMatch {
  line: number;
  column: number;
  length: number;
  preview: string;
  matchStart: number;
  matchEnd: number;
}

export interface FileMatches {
  path: string;
  matches: SearchMatch[];
}

export interface SearchResults {
  files: FileMatches[];
  truncated: boolean;
  durationMs: number;
}
```

- [ ] **Step 2: Write the failing argv-builder test**

Create `tests/unit/services/search.test.ts`:

```typescript
// @vitest-environment node
import { describe, it, expect } from 'vitest';
import { buildRgArgs } from '../../../electron/services/search';

describe('buildRgArgs', () => {
  it('returns case-insensitive literal search by default', () => {
    const argv = buildRgArgs({
      pattern: 'foo',
      caseSensitive: false,
      wholeWord: false,
      regex: false,
      includeGlobs: [],
      excludeGlobs: [],
      useGitignore: true,
    }, []);
    expect(argv).toEqual([
      '--json',
      '--max-filesize', '5M',
      '--fixed-strings',
      '-i',
      'foo',
    ]);
  });

  it('honors caseSensitive', () => {
    const argv = buildRgArgs({
      pattern: 'Foo', caseSensitive: true, wholeWord: false, regex: false,
      includeGlobs: [], excludeGlobs: [], useGitignore: true,
    }, []);
    expect(argv).toContain('--case-sensitive');
    expect(argv).not.toContain('-i');
  });

  it('honors wholeWord', () => {
    const argv = buildRgArgs({
      pattern: 'foo', caseSensitive: false, wholeWord: true, regex: false,
      includeGlobs: [], excludeGlobs: [], useGitignore: true,
    }, []);
    expect(argv).toContain('--word-regexp');
  });

  it('omits --fixed-strings when regex is on', () => {
    const argv = buildRgArgs({
      pattern: 'fo+', caseSensitive: false, wholeWord: false, regex: true,
      includeGlobs: [], excludeGlobs: [], useGitignore: true,
    }, []);
    expect(argv).not.toContain('--fixed-strings');
  });

  it('adds include and exclude globs', () => {
    const argv = buildRgArgs({
      pattern: 'x', caseSensitive: false, wholeWord: false, regex: false,
      includeGlobs: ['src/**/*.ts', 'tests/**'],
      excludeGlobs: ['**/*.min.js'],
      useGitignore: true,
    }, []);
    expect(argv).toContain('--glob');
    expect(argv.filter(a => a === '--glob')).toHaveLength(3);
    expect(argv).toContain('src/**/*.ts');
    expect(argv).toContain('tests/**');
    expect(argv).toContain('!**/*.min.js');
  });

  it('adds --no-ignore when useGitignore is false', () => {
    const argv = buildRgArgs({
      pattern: 'x', caseSensitive: false, wholeWord: false, regex: false,
      includeGlobs: [], excludeGlobs: [], useGitignore: false,
    }, []);
    expect(argv).toContain('--no-ignore');
  });

  it('adds glob exclusions for open buffer paths', () => {
    const argv = buildRgArgs({
      pattern: 'x', caseSensitive: false, wholeWord: false, regex: false,
      includeGlobs: [], excludeGlobs: [], useGitignore: true,
    }, ['src/foo.ts', 'src/bar.ts']);
    expect(argv).toContain('!src/foo.ts');
    expect(argv).toContain('!src/bar.ts');
  });
});
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `npm run test:unit -- tests/unit/services/search.test.ts`
Expected: FAIL with `Cannot find module ... search`

- [ ] **Step 4: Implement `buildRgArgs`**

Create `electron/services/search.ts`:

```typescript
import type { SearchQuery } from '../../src/types';

/**
 * Build ripgrep argv for a SearchQuery. Pure function so unit tests can
 * verify the flag matrix without spawning processes.
 *
 * @param query   the user's search options
 * @param openBufferRelPaths  paths (relative to project root, forward-slash)
 *                            of open files; rg is told to skip them so the
 *                            in-memory scan can supply matches instead
 */
export function buildRgArgs(query: SearchQuery, openBufferRelPaths: string[]): string[] {
  const args: string[] = ['--json', '--max-filesize', '5M'];

  if (!query.regex) args.push('--fixed-strings');
  if (query.caseSensitive) args.push('--case-sensitive');
  else args.push('-i');
  if (query.wholeWord) args.push('--word-regexp');
  if (!query.useGitignore) args.push('--no-ignore');

  for (const g of query.includeGlobs) {
    args.push('--glob', g);
  }
  for (const g of query.excludeGlobs) {
    args.push('--glob', `!${g}`);
  }
  for (const p of openBufferRelPaths) {
    args.push('--glob', `!${p}`);
  }

  args.push(query.pattern);
  return args;
}
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `npm run test:unit -- tests/unit/services/search.test.ts`
Expected: PASS — 7 tests.

- [ ] **Step 6: Commit**

```bash
git add electron/services/search.ts tests/unit/services/search.test.ts src/types.ts
git commit -m "feat(search): add rg argv builder with full toggle support"
```

---

## Task 2: Backend — rg execution + JSON parser

Spawn rg with the built argv, parse the streaming JSON output into `FileMatches[]`, apply the 5000-match / 200-file caps, and report `truncated`.

**Files:**
- Modify: `electron/services/search.ts`
- Modify: `tests/unit/services/search.test.ts`

- [ ] **Step 1: Write the failing parser test**

Append to `tests/unit/services/search.test.ts`:

```typescript
import { parseRgOutput } from '../../../electron/services/search';

describe('parseRgOutput', () => {
  it('parses match lines into FileMatches grouped by path', () => {
    const ndjson = [
      JSON.stringify({ type: 'match', data: {
        path: { text: '/proj/src/foo.ts' },
        line_number: 12,
        lines: { text: 'function foo(x) {\n' },
        submatches: [{ match: { text: 'foo' }, start: 9, end: 12 }],
      }}),
      JSON.stringify({ type: 'match', data: {
        path: { text: '/proj/src/foo.ts' },
        line_number: 25,
        lines: { text: '  return foo(x);\n' },
        submatches: [{ match: { text: 'foo' }, start: 9, end: 12 }],
      }}),
      JSON.stringify({ type: 'match', data: {
        path: { text: '/proj/src/bar.ts' },
        line_number: 1,
        lines: { text: 'foo()\n' },
        submatches: [{ match: { text: 'foo' }, start: 0, end: 3 }],
      }}),
    ].join('\n');

    const result = parseRgOutput(ndjson, '/proj', { maxMatches: 5000, maxFiles: 200 });

    expect(result.truncated).toBe(false);
    expect(result.files).toHaveLength(2);
    expect(result.files[0].path).toBe('src/foo.ts');
    expect(result.files[0].matches).toHaveLength(2);
    expect(result.files[0].matches[0]).toEqual({
      line: 12,
      column: 10,            // 1-indexed start (rg start is 0-indexed)
      length: 3,
      preview: 'function foo(x) {',
      matchStart: 9,
      matchEnd: 12,
    });
    expect(result.files[1].path).toBe('src/bar.ts');
  });

  it('caps results at maxMatches and sets truncated', () => {
    const lines = Array.from({ length: 10 }, (_, i) => JSON.stringify({
      type: 'match', data: {
        path: { text: '/proj/a.ts' },
        line_number: i + 1,
        lines: { text: 'x\n' },
        submatches: [{ match: { text: 'x' }, start: 0, end: 1 }],
      },
    })).join('\n');

    const result = parseRgOutput(lines, '/proj', { maxMatches: 3, maxFiles: 200 });
    expect(result.truncated).toBe(true);
    expect(result.files[0].matches).toHaveLength(3);
  });

  it('caps results at maxFiles and sets truncated', () => {
    const lines = Array.from({ length: 10 }, (_, i) => JSON.stringify({
      type: 'match', data: {
        path: { text: `/proj/file${i}.ts` },
        line_number: 1,
        lines: { text: 'x\n' },
        submatches: [{ match: { text: 'x' }, start: 0, end: 1 }],
      },
    })).join('\n');

    const result = parseRgOutput(lines, '/proj', { maxMatches: 5000, maxFiles: 4 });
    expect(result.truncated).toBe(true);
    expect(result.files).toHaveLength(4);
  });

  it('skips non-match lines without crashing', () => {
    const ndjson = [
      JSON.stringify({ type: 'begin', data: { path: { text: '/proj/a.ts' } } }),
      JSON.stringify({ type: 'match', data: {
        path: { text: '/proj/a.ts' },
        line_number: 1,
        lines: { text: 'hit\n' },
        submatches: [{ match: { text: 'hit' }, start: 0, end: 3 }],
      }}),
      JSON.stringify({ type: 'end', data: {} }),
      'not json at all',
    ].join('\n');
    const result = parseRgOutput(ndjson, '/proj', { maxMatches: 5000, maxFiles: 200 });
    expect(result.files[0].matches).toHaveLength(1);
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npm run test:unit -- tests/unit/services/search.test.ts`
Expected: FAIL — `parseRgOutput is not exported`.

- [ ] **Step 3: Implement `parseRgOutput`**

Append to `electron/services/search.ts`:

```typescript
import path from 'node:path';
import type { FileMatches, SearchMatch, SearchResults } from '../../src/types';

interface ParseLimits {
  maxMatches: number;
  maxFiles: number;
}

export function parseRgOutput(stdout: string, rootPath: string, limits: ParseLimits): SearchResults {
  const byPath = new Map<string, SearchMatch[]>();
  let totalMatches = 0;
  let truncated = false;

  for (const line of stdout.split('\n')) {
    if (!line) continue;
    let parsed: any;
    try {
      parsed = JSON.parse(line);
    } catch {
      continue;
    }
    if (parsed.type !== 'match') continue;

    const data = parsed.data;
    const absPath = data.path?.text;
    if (!absPath) continue;
    const rel = path.relative(rootPath, absPath).split(path.sep).join('/');

    if (!byPath.has(rel)) {
      if (byPath.size >= limits.maxFiles) {
        truncated = true;
        break;
      }
      byPath.set(rel, []);
    }
    const matches = byPath.get(rel)!;

    const submatch = data.submatches?.[0];
    if (!submatch) continue;
    const previewRaw = (data.lines?.text ?? '').replace(/\n$/, '');
    const preview = previewRaw.slice(0, 500);

    matches.push({
      line: data.line_number,
      column: submatch.start + 1,
      length: submatch.end - submatch.start,
      preview,
      matchStart: submatch.start,
      matchEnd: submatch.end,
    });

    totalMatches += 1;
    if (totalMatches >= limits.maxMatches) {
      truncated = true;
      break;
    }
  }

  const files: FileMatches[] = Array.from(byPath.entries()).map(([p, matches]) => ({
    path: p,
    matches,
  }));

  return { files, truncated, durationMs: 0 };
}
```

- [ ] **Step 4: Run to verify pass**

Run: `npm run test:unit -- tests/unit/services/search.test.ts`
Expected: PASS — 11 tests total.

- [ ] **Step 5: Commit**

```bash
git add electron/services/search.ts tests/unit/services/search.test.ts
git commit -m "feat(search): parse rg --json output into FileMatches"
```

---

## Task 3: Backend — in-memory buffer scan + merge

Scan supplied open-buffer contents with the same matcher as rg and merge results.

**Files:**
- Modify: `electron/services/search.ts`
- Modify: `tests/unit/services/search.test.ts`

- [ ] **Step 1: Write failing test**

Append to `tests/unit/services/search.test.ts`:

```typescript
import { scanBuffer, buildMatcher } from '../../../electron/services/search';

describe('buildMatcher', () => {
  it('returns a literal substring matcher when regex off', () => {
    const m = buildMatcher({
      pattern: 'foo', caseSensitive: false, wholeWord: false, regex: false,
      includeGlobs: [], excludeGlobs: [], useGitignore: true,
    });
    expect(m.test('Hello FOO')).toBe(true);
    expect(m.test('hello bar')).toBe(false);
  });

  it('respects caseSensitive for literal', () => {
    const m = buildMatcher({
      pattern: 'foo', caseSensitive: true, wholeWord: false, regex: false,
      includeGlobs: [], excludeGlobs: [], useGitignore: true,
    });
    expect(m.test('Hello foo')).toBe(true);
    expect(m.test('Hello FOO')).toBe(false);
  });

  it('treats pattern as regex when regex on', () => {
    const m = buildMatcher({
      pattern: 'fo+', caseSensitive: false, wholeWord: false, regex: true,
      includeGlobs: [], excludeGlobs: [], useGitignore: true,
    });
    expect(m.test('foo')).toBe(true);
    expect(m.test('fooo')).toBe(true);
    expect(m.test('bar')).toBe(false);
  });

  it('wholeWord wraps pattern in \\b', () => {
    const m = buildMatcher({
      pattern: 'foo', caseSensitive: false, wholeWord: true, regex: false,
      includeGlobs: [], excludeGlobs: [], useGitignore: true,
    });
    expect(m.test('foo bar')).toBe(true);
    expect(m.test('foobar')).toBe(false);
  });
});

describe('scanBuffer', () => {
  const literalQuery = {
    pattern: 'foo', caseSensitive: false, wholeWord: false, regex: false,
    includeGlobs: [], excludeGlobs: [], useGitignore: true,
  };

  it('returns one SearchMatch per occurrence with correct line/col', () => {
    const content = 'first foo line\nsecond line\nthird foo here\n';
    const matches = scanBuffer(content, literalQuery);
    expect(matches).toHaveLength(2);
    expect(matches[0]).toEqual({
      line: 1, column: 7, length: 3,
      preview: 'first foo line',
      matchStart: 6, matchEnd: 9,
    });
    expect(matches[1].line).toBe(3);
  });

  it('finds multiple matches per line', () => {
    const matches = scanBuffer('foo and foo\n', literalQuery);
    expect(matches).toHaveLength(2);
    expect(matches[0].column).toBe(1);
    expect(matches[1].column).toBe(9);
  });

  it('caps preview length at 500 chars', () => {
    const longLine = 'x'.repeat(600) + 'foo';
    const matches = scanBuffer(longLine, literalQuery);
    expect(matches[0].preview.length).toBeLessThanOrEqual(500);
  });

  it('returns empty array when no matches', () => {
    expect(scanBuffer('nothing here\n', literalQuery)).toEqual([]);
  });
});

describe('mergeBufferResults', () => {
  it('merges buffer-derived FileMatches into rg results', async () => {
    const { mergeBufferResults } = await import('../../../electron/services/search');
    const rgResults = {
      files: [{ path: 'src/a.ts', matches: [{ line: 1, column: 1, length: 1, preview: 'a', matchStart: 0, matchEnd: 1 }] }],
      truncated: false,
      durationMs: 0,
    };
    const bufferResults = [
      { path: 'src/b.ts', matches: [{ line: 5, column: 1, length: 1, preview: 'b', matchStart: 0, matchEnd: 1 }] },
    ];
    const merged = mergeBufferResults(rgResults, bufferResults);
    expect(merged.files).toHaveLength(2);
    expect(merged.files.find(f => f.path === 'src/b.ts')).toBeTruthy();
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npm run test:unit -- tests/unit/services/search.test.ts`
Expected: FAIL — exports don't exist.

- [ ] **Step 3: Implement `buildMatcher`, `scanBuffer`, `mergeBufferResults`**

Append to `electron/services/search.ts`:

```typescript
export interface Matcher {
  test(line: string): boolean;
  /** Returns array of [start, end] index pairs for matches in `line`. */
  exec(line: string): Array<[number, number]>;
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export function buildMatcher(query: SearchQuery): Matcher {
  let source = query.regex ? query.pattern : escapeRegex(query.pattern);
  if (query.wholeWord) source = `\\b${source}\\b`;
  const flags = query.caseSensitive ? 'g' : 'gi';
  // We construct a fresh regex per call to exec/test to keep lastIndex isolated.
  return {
    test(line: string): boolean {
      return new RegExp(source, flags).test(line);
    },
    exec(line: string): Array<[number, number]> {
      const re = new RegExp(source, flags);
      const out: Array<[number, number]> = [];
      let m: RegExpExecArray | null;
      while ((m = re.exec(line)) !== null) {
        if (m[0].length === 0) {
          re.lastIndex += 1;
          continue;
        }
        out.push([m.index, m.index + m[0].length]);
      }
      return out;
    },
  };
}

export function scanBuffer(content: string, query: SearchQuery): SearchMatch[] {
  const matcher = buildMatcher(query);
  const results: SearchMatch[] = [];
  const lines = content.split('\n');
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const ranges = matcher.exec(line);
    if (ranges.length === 0) continue;
    const preview = line.slice(0, 500);
    for (const [start, end] of ranges) {
      results.push({
        line: i + 1,
        column: start + 1,
        length: end - start,
        preview,
        matchStart: start,
        matchEnd: end,
      });
    }
  }
  return results;
}

export function mergeBufferResults(rgResults: SearchResults, bufferResults: FileMatches[]): SearchResults {
  const byPath = new Map<string, FileMatches>();
  for (const f of rgResults.files) byPath.set(f.path, f);
  for (const f of bufferResults) {
    if (f.matches.length === 0) continue;
    byPath.set(f.path, f);  // buffer wins; rg was told to skip these paths anyway
  }
  return {
    files: Array.from(byPath.values()),
    truncated: rgResults.truncated,
    durationMs: rgResults.durationMs,
  };
}
```

- [ ] **Step 4: Run to verify pass**

Run: `npm run test:unit -- tests/unit/services/search.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add electron/services/search.ts tests/unit/services/search.test.ts
git commit -m "feat(search): add in-memory buffer scanner and result merger"
```

---

## Task 4: Backend — IPC handlers (`search:run` and `search:replaceFile`)

Wire the pieces together behind `ipcMain.handle` calls.

**Files:**
- Modify: `electron/services/search.ts`
- Modify: `tests/unit/services/search.test.ts`

- [ ] **Step 1: Write failing test for `search:replaceFile`**

Append to `tests/unit/services/search.test.ts`:

```typescript
import { applyEditsToContent } from '../../../electron/services/search';

describe('applyEditsToContent', () => {
  it('applies a single edit', () => {
    const out = applyEditsToContent('hello foo world\n', [
      { line: 1, column: 7, length: 3, replacement: 'bar' },
    ]);
    expect(out).toBe('hello bar world\n');
  });

  it('applies multiple edits on one line in descending column order', () => {
    const out = applyEditsToContent('foo and foo\n', [
      { line: 1, column: 9, length: 3, replacement: 'baz' },
      { line: 1, column: 1, length: 3, replacement: 'baz' },
    ]);
    expect(out).toBe('baz and baz\n');
  });

  it('applies edits across multiple lines', () => {
    const out = applyEditsToContent('foo\nbar\nfoo\n', [
      { line: 3, column: 1, length: 3, replacement: 'XXX' },
      { line: 1, column: 1, length: 3, replacement: 'YYY' },
    ]);
    expect(out).toBe('YYY\nbar\nXXX\n');
  });

  it('preserves trailing newline absence', () => {
    const out = applyEditsToContent('foo', [
      { line: 1, column: 1, length: 3, replacement: 'bar' },
    ]);
    expect(out).toBe('bar');
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npm run test:unit -- tests/unit/services/search.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement `applyEditsToContent` and the handlers**

Append to `electron/services/search.ts`:

```typescript
import { ipcMain } from 'electron';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import fs from 'node:fs';

const execFileAsync = promisify(execFile);

export interface ReplaceEdit {
  line: number;
  column: number;
  length: number;
  replacement: string;
}

/**
 * Apply edits to file content. Edits MUST be sorted descending by (line, column)
 * so applying them in array order does not invalidate later positions.
 */
export function applyEditsToContent(content: string, edits: ReplaceEdit[]): string {
  // Defensive: sort descending so callers don't have to.
  const sorted = [...edits].sort((a, b) => {
    if (a.line !== b.line) return b.line - a.line;
    return b.column - a.column;
  });
  const lines = content.split('\n');
  for (const edit of sorted) {
    const idx = edit.line - 1;
    if (idx < 0 || idx >= lines.length) continue;
    const line = lines[idx];
    const before = line.slice(0, edit.column - 1);
    const after = line.slice(edit.column - 1 + edit.length);
    lines[idx] = before + edit.replacement + after;
  }
  return lines.join('\n');
}

export interface SearchRunArgs {
  rootPath: string;
  query: SearchQuery;
  openBuffers: { path: string; content: string }[];  // path is absolute
}

export interface SearchReplaceFileArgs {
  filePath: string;
  edits: ReplaceEdit[];
}

export function registerSearchHandlers(): void {
  ipcMain.handle('search:run', async (_event, args: SearchRunArgs): Promise<SearchResults> => {
    const start = Date.now();
    const openBufferRelPaths = args.openBuffers.map(b =>
      path.relative(args.rootPath, b.path).split(path.sep).join('/')
    );
    const argv = buildRgArgs(args.query, openBufferRelPaths);

    let rgResults: SearchResults = { files: [], truncated: false, durationMs: 0 };
    try {
      const { stdout } = await execFileAsync('rg', argv, {
        cwd: args.rootPath,
        maxBuffer: 50 * 1024 * 1024,
        timeout: 30_000,
      });
      rgResults = parseRgOutput(stdout, args.rootPath, { maxMatches: 5000, maxFiles: 200 });
    } catch (err: any) {
      // rg exits 1 when no matches; still parse stdout if present
      if (err && typeof err.stdout === 'string') {
        rgResults = parseRgOutput(err.stdout, args.rootPath, { maxMatches: 5000, maxFiles: 200 });
      } else if (err && err.code === 'ENOENT') {
        // rg not installed — return empty so the renderer can show the fallback message
        return { files: [], truncated: false, durationMs: Date.now() - start };
      }
      // Other errors (timeout, etc.) — fall through with whatever we got
      if (err && err.killed) rgResults.truncated = true;
    }

    const bufferFileMatches: FileMatches[] = [];
    for (const buf of args.openBuffers) {
      const matches = scanBuffer(buf.content, args.query);
      if (matches.length > 0) {
        const rel = path.relative(args.rootPath, buf.path).split(path.sep).join('/');
        bufferFileMatches.push({ path: rel, matches });
      }
    }

    const merged = mergeBufferResults(rgResults, bufferFileMatches);
    return { ...merged, durationMs: Date.now() - start };
  });

  ipcMain.handle('search:replaceFile', async (_event, args: SearchReplaceFileArgs): Promise<void> => {
    const content = await fs.promises.readFile(args.filePath, 'utf8');
    const next = applyEditsToContent(content, args.edits);
    await fs.promises.writeFile(args.filePath, next, 'utf8');
  });
}
```

- [ ] **Step 4: Run to verify the new test passes (and no regression)**

Run: `npm run test:unit -- tests/unit/services/search.test.ts`
Expected: PASS — all tests including new `applyEditsToContent` ones.

- [ ] **Step 5: Commit**

```bash
git add electron/services/search.ts tests/unit/services/search.test.ts
git commit -m "feat(search): wire IPC handlers for search:run and search:replaceFile"
```

---

## Task 5: Wire main.ts + preload.ts + integration test

Plug the handlers into the Electron lifecycle and verify against a real ripgrep run on the e2e fixture project.

**Files:**
- Modify: `electron/main.ts`
- Modify: `electron/preload.ts`
- Create: `tests/integration/search.test.ts`

- [ ] **Step 1: Register handlers in `electron/main.ts`**

In `electron/main.ts`, add the import next to the other service imports (after the `registerScaffoldHandler` import):

```typescript
import { registerSearchHandlers } from './services/search';
```

In the `createWindow` function (after `registerPluginHandlers(readSettings);`), add:

```typescript
  registerSearchHandlers();
```

- [ ] **Step 2: Expose in `electron/preload.ts`**

Find the `contextBridge.exposeInMainWorld('sai', { ... })` block. Inside the object literal, add (next to `fsGrep`):

```typescript
  searchRun: (args: import('../src/types').SearchQuery extends never ? never : {
    rootPath: string;
    query: import('../src/types').SearchQuery;
    openBuffers: { path: string; content: string }[];
  }) => ipcRenderer.invoke('search:run', args),
  searchReplaceFile: (args: { filePath: string; edits: { line: number; column: number; length: number; replacement: string }[] }) =>
    ipcRenderer.invoke('search:replaceFile', args),
```

- [ ] **Step 3: Add the type declaration for `window.sai`**

If there's a `electron/preload.d.ts` or equivalent type-augmentation file, add the corresponding entries. If `window.sai` is typed inline somewhere in `src/`, search for it (`grep -rn "interface.*Sai\|window\.sai" src/`) and add `searchRun` and `searchReplaceFile` to that interface mirroring the preload signatures.

If no central type exists, add one to `src/types.ts`:

```typescript
export interface SaiSearchApi {
  searchRun(args: { rootPath: string; query: SearchQuery; openBuffers: { path: string; content: string }[] }): Promise<SearchResults>;
  searchReplaceFile(args: { filePath: string; edits: { line: number; column: number; length: number; replacement: string }[] }): Promise<void>;
}
```

(The renderer will cast as needed when calling.)

- [ ] **Step 4: Write the integration test**

Create `tests/integration/search.test.ts`:

```typescript
import { describe, it, expect, beforeAll } from 'vitest';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { buildRgArgs, parseRgOutput } from '../../electron/services/search';

const execFileAsync = promisify(execFile);
const FIXTURE = path.resolve(__dirname, '../e2e/fixtures/test-project');

describe('search integration (real rg)', () => {
  beforeAll(async () => {
    // Sanity check: rg must be installed for these tests to run
    try {
      await execFileAsync('rg', ['--version']);
    } catch {
      throw new Error('ripgrep (rg) is required for integration tests but is not installed');
    }
  });

  it('finds known patterns in the fixture project', async () => {
    const argv = buildRgArgs({
      pattern: 'function',
      caseSensitive: false,
      wholeWord: false,
      regex: false,
      includeGlobs: [],
      excludeGlobs: [],
      useGitignore: true,
    }, []);

    const { stdout } = await execFileAsync('rg', argv, { cwd: FIXTURE, maxBuffer: 5 * 1024 * 1024 });
    const result = parseRgOutput(stdout, FIXTURE, { maxMatches: 5000, maxFiles: 200 });

    // The fixture project contains TS files; we should find at least one "function"
    expect(result.files.length).toBeGreaterThan(0);
    expect(result.files[0].path).not.toContain('..');  // relative path
  });

  it('respects include glob', async () => {
    const argv = buildRgArgs({
      pattern: 'function',
      caseSensitive: false, wholeWord: false, regex: false,
      includeGlobs: ['**/*.json'],
      excludeGlobs: [],
      useGitignore: true,
    }, []);
    try {
      const { stdout } = await execFileAsync('rg', argv, { cwd: FIXTURE });
      const result = parseRgOutput(stdout, FIXTURE, { maxMatches: 5000, maxFiles: 200 });
      // No JSON files in fixture should contain "function" — accept zero results
      for (const f of result.files) {
        expect(f.path.endsWith('.json')).toBe(true);
      }
    } catch (err: any) {
      // rg exits 1 on no matches — acceptable
      if (err && typeof err.code === 'number' && err.code !== 1) throw err;
    }
  });
});
```

- [ ] **Step 5: Run integration test**

Run: `npm run test:integration -- tests/integration/search.test.ts`
Expected: PASS — both tests.

If the fixture project doesn't contain enough content, add a tiny `tests/e2e/fixtures/test-project/src/sample.ts` with `export function sample() { return 'foo'; }` and re-run.

- [ ] **Step 6: Commit**

```bash
git add electron/main.ts electron/preload.ts src/types.ts tests/integration/search.test.ts
git commit -m "feat(search): register IPC and add integration test against rg"
```

---

## Task 6: `useSearch` hook — state machine + debounce

A React hook that owns the search state and exposes an imperative `runSearch()` and a `replace(targets, replacement)` orchestrator.

**Files:**
- Create: `src/hooks/useSearch.ts`
- Create: `tests/unit/hooks/useSearch.test.ts`

- [ ] **Step 1: Write failing test for the hook**

Create `tests/unit/hooks/useSearch.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useSearch } from '../../../src/hooks/useSearch';

const mockSearchRun = vi.fn();
const mockReplaceFile = vi.fn();

beforeEach(() => {
  mockSearchRun.mockReset();
  mockReplaceFile.mockReset();
  (window as any).sai = {
    searchRun: mockSearchRun,
    searchReplaceFile: mockReplaceFile,
  };
});

describe('useSearch', () => {
  it('starts in idle state', () => {
    const { result } = renderHook(() => useSearch({ rootPath: '/proj', getOpenBuffers: () => [] }));
    expect(result.current.state).toBe('idle');
    expect(result.current.results).toBeNull();
  });

  it('runs a search when runSearch is called', async () => {
    mockSearchRun.mockResolvedValue({ files: [{ path: 'a.ts', matches: [] }], truncated: false, durationMs: 5 });
    const { result } = renderHook(() => useSearch({ rootPath: '/proj', getOpenBuffers: () => [] }));

    await act(async () => {
      await result.current.runSearch({
        pattern: 'foo',
        caseSensitive: false, wholeWord: false, regex: false,
        includeGlobs: [], excludeGlobs: [], useGitignore: true,
      });
    });

    expect(mockSearchRun).toHaveBeenCalledOnce();
    expect(result.current.state).toBe('results');
    expect(result.current.results?.files).toHaveLength(1);
  });

  it('passes open buffers from getOpenBuffers', async () => {
    mockSearchRun.mockResolvedValue({ files: [], truncated: false, durationMs: 0 });
    const buffers = [{ path: '/proj/a.ts', content: 'hello' }];
    const { result } = renderHook(() => useSearch({ rootPath: '/proj', getOpenBuffers: () => buffers }));

    await act(async () => {
      await result.current.runSearch({
        pattern: 'x', caseSensitive: false, wholeWord: false, regex: false,
        includeGlobs: [], excludeGlobs: [], useGitignore: true,
      });
    });

    expect(mockSearchRun).toHaveBeenCalledWith(expect.objectContaining({
      openBuffers: buffers,
    }));
  });

  it('transitions to error state when searchRun rejects with invalid regex', async () => {
    mockSearchRun.mockRejectedValue(new Error('regex parse error: foo'));
    const { result } = renderHook(() => useSearch({ rootPath: '/proj', getOpenBuffers: () => [] }));

    await act(async () => {
      await result.current.runSearch({
        pattern: '(', caseSensitive: false, wholeWord: false, regex: true,
        includeGlobs: [], excludeGlobs: [], useGitignore: true,
      });
    });
    expect(result.current.state).toBe('error');
    expect(result.current.error).toContain('regex');
  });

  it('replace calls applyMonacoEdits for open files and searchReplaceFile for unopened', async () => {
    mockSearchRun.mockResolvedValue({ files: [
      { path: 'open.ts', matches: [{ line: 1, column: 1, length: 3, preview: 'foo', matchStart: 0, matchEnd: 3 }] },
      { path: 'closed.ts', matches: [{ line: 1, column: 1, length: 3, preview: 'foo', matchStart: 0, matchEnd: 3 }] },
    ], truncated: false, durationMs: 0 });
    mockReplaceFile.mockResolvedValue(undefined);
    const monacoApply = vi.fn();
    const { result } = renderHook(() => useSearch({
      rootPath: '/proj',
      getOpenBuffers: () => [{ path: '/proj/open.ts', content: 'foo' }],
      applyMonacoEdits: monacoApply,
    }));

    await act(async () => {
      await result.current.runSearch({
        pattern: 'foo', caseSensitive: false, wholeWord: false, regex: false,
        includeGlobs: [], excludeGlobs: [], useGitignore: true,
      });
    });

    await act(async () => {
      await result.current.replaceAll('bar');
    });

    expect(monacoApply).toHaveBeenCalledWith('/proj/open.ts', expect.any(Array));
    expect(mockReplaceFile).toHaveBeenCalledWith(expect.objectContaining({
      filePath: '/proj/closed.ts',
    }));
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npm run test:unit -- tests/unit/hooks/useSearch.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `useSearch`**

Create `src/hooks/useSearch.ts`:

```typescript
import { useCallback, useRef, useState } from 'react';
import type { SearchQuery, SearchResults, FileMatches } from '../types';

export type SearchState = 'idle' | 'searching' | 'results' | 'replacing' | 'error';

export interface UseSearchOptions {
  rootPath: string;
  getOpenBuffers: () => { path: string; content: string }[];
  /** Called for each open file affected by a replace. Implementer routes through Monaco. */
  applyMonacoEdits?: (path: string, edits: { line: number; column: number; length: number; replacement: string }[]) => void;
}

export interface UseSearchResult {
  state: SearchState;
  results: SearchResults | null;
  error: string | null;
  lastQuery: SearchQuery | null;
  runSearch(query: SearchQuery): Promise<void>;
  replaceAll(replacement: string): Promise<void>;
  replaceFile(path: string, replacement: string): Promise<void>;
  replaceMatch(path: string, matchIndex: number, replacement: string): Promise<void>;
  clear(): void;
}

export function useSearch(opts: UseSearchOptions): UseSearchResult {
  const [state, setState] = useState<SearchState>('idle');
  const [results, setResults] = useState<SearchResults | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [lastQuery, setLastQuery] = useState<SearchQuery | null>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const inflightRef = useRef<number>(0);

  const runSearch = useCallback(async (query: SearchQuery): Promise<void> => {
    setLastQuery(query);
    if (!query.pattern) {
      setResults(null);
      setState('idle');
      setError(null);
      return;
    }
    setState('searching');
    setError(null);
    const myId = ++inflightRef.current;
    try {
      const out = await (window as any).sai.searchRun({
        rootPath: opts.rootPath,
        query,
        openBuffers: opts.getOpenBuffers(),
      }) as SearchResults;
      if (inflightRef.current !== myId) return;  // a newer search superseded us
      setResults(out);
      setState('results');
    } catch (e: any) {
      if (inflightRef.current !== myId) return;
      setError(e?.message ?? String(e));
      setState('error');
    }
  }, [opts.rootPath, opts.getOpenBuffers]);

  const replaceFiles = useCallback(async (files: FileMatches[], replacement: string) => {
    if (!lastQuery) return;
    setState('replacing');
    const buffers = opts.getOpenBuffers();
    const openPaths = new Set(buffers.map(b => b.path));
    try {
      for (const file of files) {
        const absPath = `${opts.rootPath}/${file.path}`;
        const edits = file.matches.map(m => ({
          line: m.line,
          column: m.column,
          length: m.length,
          replacement,
        }));
        if (openPaths.has(absPath) && opts.applyMonacoEdits) {
          opts.applyMonacoEdits(absPath, edits);
        } else {
          await (window as any).sai.searchReplaceFile({ filePath: absPath, edits });
        }
      }
      // refresh
      await runSearch(lastQuery);
    } catch (e: any) {
      setError(e?.message ?? String(e));
      setState('error');
    }
  }, [lastQuery, opts, runSearch]);

  const replaceAll = useCallback(async (replacement: string) => {
    if (!results) return;
    await replaceFiles(results.files, replacement);
  }, [results, replaceFiles]);

  const replaceFile = useCallback(async (path: string, replacement: string) => {
    if (!results) return;
    const file = results.files.find(f => f.path === path);
    if (!file) return;
    await replaceFiles([file], replacement);
  }, [results, replaceFiles]);

  const replaceMatch = useCallback(async (path: string, matchIndex: number, replacement: string) => {
    if (!results) return;
    const file = results.files.find(f => f.path === path);
    if (!file) return;
    const match = file.matches[matchIndex];
    if (!match) return;
    await replaceFiles([{ path, matches: [match] }], replacement);
  }, [results, replaceFiles]);

  const clear = useCallback(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    setResults(null);
    setError(null);
    setState('idle');
    setLastQuery(null);
  }, []);

  return { state, results, error, lastQuery, runSearch, replaceAll, replaceFile, replaceMatch, clear };
}
```

- [ ] **Step 4: Run tests**

Run: `npm run test:unit -- tests/unit/hooks/useSearch.test.ts`
Expected: PASS — 5 tests.

- [ ] **Step 5: Commit**

```bash
git add src/hooks/useSearch.ts tests/unit/hooks/useSearch.test.ts
git commit -m "feat(search): add useSearch hook with state machine and replace orchestrator"
```

---

## Task 7: SearchPanel UI — input row, toggles, empty state

The visible top half of the sidebar: search input, toggle buttons, replace input, collapsible details section. Results rendering comes in Task 8.

**Files:**
- Create: `src/components/SearchPanel/SearchPanel.tsx`
- Create: `src/components/SearchPanel/SearchPanel.css`
- Create: `tests/unit/components/SearchPanel.test.tsx`

- [ ] **Step 1: Write failing test**

Create `tests/unit/components/SearchPanel.test.tsx`:

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import SearchPanel from '../../../src/components/SearchPanel/SearchPanel';

beforeEach(() => {
  (window as any).sai = {
    searchRun: vi.fn().mockResolvedValue({ files: [], truncated: false, durationMs: 0 }),
    searchReplaceFile: vi.fn().mockResolvedValue(undefined),
  };
});

describe('SearchPanel', () => {
  it('renders the search input with placeholder', () => {
    render(<SearchPanel projectPath="/proj" getOpenBuffers={() => []} />);
    expect(screen.getByPlaceholderText(/search/i)).toBeInTheDocument();
  });

  it('renders three toggle buttons (case, word, regex)', () => {
    render(<SearchPanel projectPath="/proj" getOpenBuffers={() => []} />);
    expect(screen.getByTitle(/case sensitive/i)).toBeInTheDocument();
    expect(screen.getByTitle(/whole word/i)).toBeInTheDocument();
    expect(screen.getByTitle(/regex/i)).toBeInTheDocument();
  });

  it('renders the replace input', () => {
    render(<SearchPanel projectPath="/proj" getOpenBuffers={() => []} />);
    expect(screen.getByPlaceholderText(/replace/i)).toBeInTheDocument();
  });

  it('toggles include/exclude details on click', () => {
    render(<SearchPanel projectPath="/proj" getOpenBuffers={() => []} />);
    expect(screen.queryByPlaceholderText(/files to include/i)).not.toBeInTheDocument();
    fireEvent.click(screen.getByText(/toggle search details/i));
    expect(screen.getByPlaceholderText(/files to include/i)).toBeInTheDocument();
    expect(screen.getByPlaceholderText(/files to exclude/i)).toBeInTheDocument();
  });

  it('shows empty-state hint when no query', () => {
    render(<SearchPanel projectPath="/proj" getOpenBuffers={() => []} />);
    expect(screen.getByText(/type to search/i)).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npm run test:unit -- tests/unit/components/SearchPanel.test.tsx`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the SearchPanel shell**

Create `src/components/SearchPanel/SearchPanel.tsx`:

```typescript
import { useEffect, useRef, useState } from 'react';
import { Search, CaseSensitive, WholeWord, Regex, ChevronRight, ChevronDown } from 'lucide-react';
import { useSearch } from '../../hooks/useSearch';
import type { SearchQuery } from '../../types';
import SearchResult from './SearchResult';
import './SearchPanel.css';

export interface SearchPanelProps {
  projectPath: string;
  getOpenBuffers: () => { path: string; content: string }[];
  applyMonacoEdits?: (path: string, edits: { line: number; column: number; length: number; replacement: string }[]) => void;
}

export default function SearchPanel({ projectPath, getOpenBuffers, applyMonacoEdits }: SearchPanelProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [pattern, setPattern] = useState('');
  const [replacement, setReplacement] = useState('');
  const [caseSensitive, setCaseSensitive] = useState(false);
  const [wholeWord, setWholeWord] = useState(false);
  const [regex, setRegex] = useState(false);
  const [showDetails, setShowDetails] = useState(false);
  const [includeGlob, setIncludeGlob] = useState('');
  const [excludeGlob, setExcludeGlob] = useState('');
  const [useGitignore, setUseGitignore] = useState(true);
  const [confirmOpen, setConfirmOpen] = useState(false);

  const search = useSearch({ rootPath: projectPath, getOpenBuffers, applyMonacoEdits });

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  // Debounced re-run when any search-affecting state changes
  useEffect(() => {
    const t = setTimeout(() => {
      const q: SearchQuery = {
        pattern,
        caseSensitive,
        wholeWord,
        regex,
        includeGlobs: includeGlob.split(',').map(s => s.trim()).filter(Boolean),
        excludeGlobs: excludeGlob.split(',').map(s => s.trim()).filter(Boolean),
        useGitignore,
      };
      search.runSearch(q);
    }, 250);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pattern, caseSensitive, wholeWord, regex, includeGlob, excludeGlob, useGitignore]);

  const totalMatches = search.results?.files.reduce((sum, f) => sum + f.matches.length, 0) ?? 0;
  const totalFiles = search.results?.files.length ?? 0;

  const handleReplaceAllClick = () => {
    if (totalMatches === 0) return;
    setConfirmOpen(true);
  };

  const handleReplaceAllConfirm = async () => {
    setConfirmOpen(false);
    await search.replaceAll(replacement);
  };

  return (
    <aside className="search-panel">
      <div className="search-input-row">
        <Search size={14} className="search-input-icon" />
        <input
          ref={inputRef}
          type="text"
          className="search-input"
          placeholder="Search"
          value={pattern}
          onChange={e => setPattern(e.target.value)}
        />
        <button
          className={`search-toggle ${caseSensitive ? 'active' : ''}`}
          title="Case sensitive (Aa)"
          onClick={() => setCaseSensitive(v => !v)}
        ><CaseSensitive size={12} /></button>
        <button
          className={`search-toggle ${wholeWord ? 'active' : ''}`}
          title="Whole word (\\b)"
          onClick={() => setWholeWord(v => !v)}
        ><WholeWord size={12} /></button>
        <button
          className={`search-toggle ${regex ? 'active' : ''}`}
          title="Regex (.*)"
          onClick={() => setRegex(v => !v)}
        ><Regex size={12} /></button>
      </div>

      <div className="replace-input-row">
        <input
          type="text"
          className="search-input"
          placeholder="Replace"
          value={replacement}
          onChange={e => setReplacement(e.target.value)}
        />
      </div>

      <button
        className="search-details-toggle"
        onClick={() => setShowDetails(v => !v)}
      >
        {showDetails ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
        <span>Toggle search details</span>
      </button>

      {showDetails && (
        <div className="search-details">
          <input
            type="text"
            className="search-input"
            placeholder="files to include"
            value={includeGlob}
            onChange={e => setIncludeGlob(e.target.value)}
          />
          <input
            type="text"
            className="search-input"
            placeholder="files to exclude"
            value={excludeGlob}
            onChange={e => setExcludeGlob(e.target.value)}
          />
          <label className="search-checkbox">
            <input
              type="checkbox"
              checked={useGitignore}
              onChange={e => setUseGitignore(e.target.checked)}
            />
            Use .gitignore
          </label>
        </div>
      )}

      <div className="search-results-pane">
        {search.state === 'idle' && (
          <div className="search-empty">Type to search</div>
        )}
        {search.state === 'searching' && (
          <div className="search-empty">Searching…</div>
        )}
        {search.state === 'error' && (
          <div className="search-error">{search.error}</div>
        )}
        {(search.state === 'results' || search.state === 'replacing') && search.results && (
          <>
            {search.results.files.map(file => (
              <SearchResult
                key={file.path}
                file={file}
                replacement={replacement}
                onReplaceMatch={(idx) => search.replaceMatch(file.path, idx, replacement)}
                onReplaceFile={() => search.replaceFile(file.path, replacement)}
              />
            ))}
            {search.results.files.length === 0 && (
              <div className="search-empty">No results</div>
            )}
          </>
        )}
      </div>

      <div className="search-footer">
        <span className="search-summary">
          {search.results
            ? `${totalMatches} result${totalMatches === 1 ? '' : 's'} in ${totalFiles} file${totalFiles === 1 ? '' : 's'}${search.results.truncated ? ' (truncated)' : ''}`
            : ''}
        </span>
        <button
          className="search-replace-all"
          disabled={totalMatches === 0 || search.state === 'replacing'}
          onClick={handleReplaceAllClick}
        >
          Replace All
        </button>
      </div>

      {confirmOpen && (
        <div className="search-confirm-overlay" onClick={() => setConfirmOpen(false)}>
          <div className="search-confirm-dialog" onClick={e => e.stopPropagation()}>
            <p>About to replace {totalMatches} match{totalMatches === 1 ? '' : 'es'} in {totalFiles} file{totalFiles === 1 ? '' : 's'}. Continue?</p>
            <div className="search-confirm-buttons">
              <button onClick={() => setConfirmOpen(false)}>Cancel</button>
              <button className="primary" onClick={handleReplaceAllConfirm}>Replace All</button>
            </div>
          </div>
        </div>
      )}
    </aside>
  );
}
```

- [ ] **Step 4: Create the CSS**

Create `src/components/SearchPanel/SearchPanel.css`:

```css
.search-panel {
  display: flex;
  flex-direction: column;
  width: 320px;
  height: 100%;
  background: var(--sidebar-bg, #1e1e1e);
  color: var(--sidebar-fg, #d4d4d4);
  font-size: 13px;
  border-right: 1px solid var(--border, #333);
}

.search-input-row,
.replace-input-row {
  display: flex;
  align-items: center;
  padding: 6px 8px;
  gap: 4px;
}

.search-input-icon { opacity: 0.6; }

.search-input {
  flex: 1;
  background: var(--input-bg, #2a2a2a);
  color: inherit;
  border: 1px solid transparent;
  padding: 4px 6px;
  font-size: 13px;
  outline: none;
}
.search-input:focus { border-color: var(--accent, #007acc); }

.search-toggle {
  background: transparent;
  border: 1px solid transparent;
  color: inherit;
  padding: 2px 4px;
  cursor: pointer;
  border-radius: 3px;
  display: inline-flex;
  align-items: center;
}
.search-toggle:hover { background: rgba(255,255,255,0.08); }
.search-toggle.active { background: var(--accent-soft, rgba(0,122,204,0.3)); }

.search-details-toggle {
  display: flex;
  align-items: center;
  gap: 4px;
  background: transparent;
  border: none;
  color: inherit;
  padding: 4px 8px;
  font-size: 12px;
  cursor: pointer;
  opacity: 0.7;
}
.search-details-toggle:hover { opacity: 1; }

.search-details {
  display: flex;
  flex-direction: column;
  gap: 4px;
  padding: 4px 8px 8px 8px;
}

.search-checkbox {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 12px;
  cursor: pointer;
}

.search-results-pane {
  flex: 1;
  overflow: auto;
  padding: 4px 0;
}

.search-empty,
.search-error {
  padding: 8px 12px;
  font-size: 12px;
  opacity: 0.6;
}
.search-error { color: var(--danger, #f48771); opacity: 1; }

.search-footer {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 6px 8px;
  border-top: 1px solid var(--border, #333);
  font-size: 12px;
}

.search-replace-all {
  background: var(--accent, #007acc);
  color: white;
  border: none;
  padding: 4px 10px;
  border-radius: 3px;
  cursor: pointer;
}
.search-replace-all:disabled { opacity: 0.4; cursor: not-allowed; }

.search-confirm-overlay {
  position: fixed;
  inset: 0;
  background: rgba(0,0,0,0.5);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 1000;
}
.search-confirm-dialog {
  background: var(--bg, #252526);
  padding: 16px;
  border-radius: 4px;
  min-width: 320px;
}
.search-confirm-buttons {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  margin-top: 12px;
}
.search-confirm-buttons button {
  padding: 4px 10px;
  background: transparent;
  color: inherit;
  border: 1px solid var(--border, #444);
  border-radius: 3px;
  cursor: pointer;
}
.search-confirm-buttons button.primary {
  background: var(--accent, #007acc);
  color: white;
  border-color: var(--accent, #007acc);
}
```

- [ ] **Step 5: Create a stub for SearchResult**

Create `src/components/SearchPanel/SearchResult.tsx` (full impl in Task 8):

```typescript
import type { FileMatches } from '../../types';

export interface SearchResultProps {
  file: FileMatches;
  replacement: string;
  onReplaceMatch: (matchIndex: number) => void;
  onReplaceFile: () => void;
}

export default function SearchResult({ file }: SearchResultProps) {
  return (
    <div className="search-result-stub" data-path={file.path}>
      {file.path} ({file.matches.length})
    </div>
  );
}
```

- [ ] **Step 6: Run component tests**

Run: `npm run test:unit -- tests/unit/components/SearchPanel.test.tsx`
Expected: PASS — 5 tests.

- [ ] **Step 7: Commit**

```bash
git add src/components/SearchPanel/ tests/unit/components/SearchPanel.test.tsx
git commit -m "feat(search): add SearchPanel UI shell with toggles and confirm dialog"
```

---

## Task 8: SearchResult component — file group + match rows + inline preview

The clickable result tree with per-match and per-file replace buttons.

**Files:**
- Modify: `src/components/SearchPanel/SearchResult.tsx`
- Modify: `src/components/SearchPanel/SearchPanel.css` (add result styles)
- Create: `tests/unit/components/SearchResult.test.tsx`

- [ ] **Step 1: Write failing test**

Create `tests/unit/components/SearchResult.test.tsx`:

```typescript
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import SearchResult from '../../../src/components/SearchPanel/SearchResult';

const file = {
  path: 'src/foo.ts',
  matches: [
    { line: 12, column: 10, length: 3, preview: 'function foo(x) {', matchStart: 9, matchEnd: 12 },
    { line: 25, column: 10, length: 3, preview: '  return foo(x);', matchStart: 9, matchEnd: 12 },
  ],
};

describe('SearchResult', () => {
  it('renders file path and match count', () => {
    render(<SearchResult file={file} replacement="" onReplaceMatch={() => {}} onReplaceFile={() => {}} />);
    expect(screen.getByText('src/foo.ts')).toBeInTheDocument();
    expect(screen.getByText('(2)')).toBeInTheDocument();
  });

  it('renders one row per match with line number and preview', () => {
    render(<SearchResult file={file} replacement="" onReplaceMatch={() => {}} onReplaceFile={() => {}} />);
    expect(screen.getByText('12')).toBeInTheDocument();
    expect(screen.getByText('25')).toBeInTheDocument();
    expect(screen.getByText(/function/)).toBeInTheDocument();
    expect(screen.getByText(/return/)).toBeInTheDocument();
  });

  it('shows old → new inline when replacement is non-empty', () => {
    const { container } = render(<SearchResult file={file} replacement="bar" onReplaceMatch={() => {}} onReplaceFile={() => {}} />);
    expect(container.querySelector('.search-match-old')).toBeInTheDocument();
    expect(container.querySelector('.search-match-new')?.textContent).toBe('bar');
  });

  it('collapses and expands on header click', () => {
    render(<SearchResult file={file} replacement="" onReplaceMatch={() => {}} onReplaceFile={() => {}} />);
    expect(screen.getByText('12')).toBeInTheDocument();
    fireEvent.click(screen.getByText('src/foo.ts'));
    expect(screen.queryByText('12')).not.toBeInTheDocument();
  });

  it('per-match replace button calls onReplaceMatch with the index', () => {
    const onReplaceMatch = vi.fn();
    const { container } = render(<SearchResult file={file} replacement="bar" onReplaceMatch={onReplaceMatch} onReplaceFile={() => {}} />);
    const buttons = container.querySelectorAll('.search-match-replace');
    fireEvent.click(buttons[1]);
    expect(onReplaceMatch).toHaveBeenCalledWith(1);
  });

  it('per-file replace button calls onReplaceFile', () => {
    const onReplaceFile = vi.fn();
    const { container } = render(<SearchResult file={file} replacement="bar" onReplaceMatch={() => {}} onReplaceFile={onReplaceFile} />);
    fireEvent.click(container.querySelector('.search-file-replace')!);
    expect(onReplaceFile).toHaveBeenCalledOnce();
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npm run test:unit -- tests/unit/components/SearchResult.test.tsx`
Expected: FAIL.

- [ ] **Step 3: Implement SearchResult**

Replace `src/components/SearchPanel/SearchResult.tsx`:

```typescript
import { useState } from 'react';
import { ChevronRight, ChevronDown, Replace } from 'lucide-react';
import type { FileMatches } from '../../types';

export interface SearchResultProps {
  file: FileMatches;
  replacement: string;
  onReplaceMatch: (matchIndex: number) => void;
  onReplaceFile: () => void;
}

export default function SearchResult({ file, replacement, onReplaceMatch, onReplaceFile }: SearchResultProps) {
  const [expanded, setExpanded] = useState(true);
  const showReplace = replacement.length > 0;

  return (
    <div className="search-result">
      <div className="search-file-header">
        <button className="search-file-toggle" onClick={() => setExpanded(e => !e)}>
          {expanded ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
          <span className="search-file-path">{file.path}</span>
          <span className="search-file-count">({file.matches.length})</span>
        </button>
        {showReplace && (
          <button
            className="search-file-replace"
            title="Replace all in file"
            onClick={onReplaceFile}
          >
            <Replace size={12} />
          </button>
        )}
      </div>
      {expanded && file.matches.map((m, i) => (
        <div key={`${m.line}:${m.column}`} className="search-match-row">
          <span className="search-match-line">{m.line}</span>
          <span className="search-match-preview">
            {m.preview.slice(0, m.matchStart)}
            {showReplace ? (
              <>
                <span className="search-match-old">{m.preview.slice(m.matchStart, m.matchEnd)}</span>
                <span className="search-match-new">{replacement}</span>
              </>
            ) : (
              <span className="search-match-hit">{m.preview.slice(m.matchStart, m.matchEnd)}</span>
            )}
            {m.preview.slice(m.matchEnd)}
          </span>
          {showReplace && (
            <button
              className="search-match-replace"
              title="Replace this match"
              onClick={() => onReplaceMatch(i)}
            >
              <Replace size={11} />
            </button>
          )}
        </div>
      ))}
    </div>
  );
}
```

- [ ] **Step 4: Add CSS for results**

Append to `src/components/SearchPanel/SearchPanel.css`:

```css
.search-result { padding: 2px 0; }

.search-file-header {
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 2px 8px;
}
.search-file-header:hover .search-file-replace { visibility: visible; }

.search-file-toggle {
  display: flex;
  align-items: center;
  gap: 4px;
  background: transparent;
  border: none;
  color: inherit;
  padding: 0;
  font-size: 13px;
  cursor: pointer;
  flex: 1;
  text-align: left;
  overflow: hidden;
}
.search-file-path {
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.search-file-count { opacity: 0.6; font-size: 11px; }

.search-file-replace,
.search-match-replace {
  background: transparent;
  border: none;
  color: inherit;
  padding: 2px;
  cursor: pointer;
  visibility: hidden;
  border-radius: 2px;
}
.search-file-replace:hover,
.search-match-replace:hover { background: rgba(255,255,255,0.1); }
.search-match-row:hover .search-match-replace { visibility: visible; }

.search-match-row {
  display: flex;
  align-items: baseline;
  gap: 6px;
  padding: 1px 8px 1px 24px;
  font-size: 12px;
  font-family: var(--mono, monospace);
  white-space: nowrap;
  overflow: hidden;
}
.search-match-row:hover { background: rgba(255,255,255,0.05); }
.search-match-line {
  opacity: 0.5;
  font-size: 11px;
  min-width: 32px;
  text-align: right;
}
.search-match-preview {
  flex: 1;
  overflow: hidden;
  text-overflow: ellipsis;
}
.search-match-hit { background: rgba(255,200,0,0.3); }
.search-match-old {
  background: rgba(255,80,80,0.25);
  text-decoration: line-through;
  opacity: 0.7;
}
.search-match-new { background: rgba(80,200,80,0.25); }
```

- [ ] **Step 5: Run all relevant tests**

Run: `npm run test:unit -- tests/unit/components/SearchResult.test.tsx tests/unit/components/SearchPanel.test.tsx`
Expected: PASS — all tests across both files.

- [ ] **Step 6: Commit**

```bash
git add src/components/SearchPanel/ tests/unit/components/SearchResult.test.tsx
git commit -m "feat(search): add SearchResult with inline preview and per-match replace"
```

---

## Task 9: App integration — nav button + sidebar mount + Ctrl+Shift+F + Monaco edit dispatcher

Wire the SearchPanel into the existing sidebar machinery, add the nav button, the keyboard shortcut, and the Monaco-edit applier.

**Files:**
- Modify: `src/components/NavBar.tsx`
- Modify: `src/App.tsx`

- [ ] **Step 1: Add the Search nav button**

In `src/components/NavBar.tsx`, add `Search` to the imports from `lucide-react`:

```typescript
import { FolderClosed, GitBranch, Clock, Puzzle, Server, Search } from 'lucide-react';
```

Insert a new button between the Source Control button and the Chat History button (after line ~30):

```typescript
      <button
        className={`nav-btn ${activeSidebar === 'search' ? 'active' : ''}`}
        onClick={() => onToggle('search')}
        title="Search"
      >
        <Search size={18} />
        <span className="nav-label">Search</span>
      </button>
```

- [ ] **Step 2: Mount the SearchPanel in App.tsx**

In `src/App.tsx`, add the import (next to the FileExplorerSidebar import):

```typescript
import SearchPanel from './components/SearchPanel/SearchPanel';
```

Find the line `{sidebarOpen === 'git' && <GitSidebar ...`. Immediately AFTER that line, insert:

```typescript
        {sidebarOpen === 'search' && (
          <SearchPanel
            projectPath={projectPath}
            getOpenBuffers={() => openFiles
              .filter(f => f.isDirty && typeof f.content === 'string')
              .map(f => ({ path: f.path, content: f.content as string }))}
            applyMonacoEdits={(p, edits) => applySearchEditsToMonaco(p, edits)}
          />
        )}
```

- [ ] **Step 3: Add the Ctrl+Shift+F handler in App.tsx**

Find the existing global keydown handler for Ctrl+K (around line 154). Add a sibling effect somewhere nearby:

```typescript
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const isCmdOrCtrl = e.ctrlKey || e.metaKey;
      if (isCmdOrCtrl && e.shiftKey && e.key.toLowerCase() === 'f') {
        e.preventDefault();
        setSidebarOpen(prev => prev === 'search' ? null : 'search');
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, []);
```

- [ ] **Step 4: Implement `applySearchEditsToMonaco`**

In `src/App.tsx`, somewhere alongside other helpers, add:

```typescript
  // Apply replace edits to an open file's Monaco model as a single undo group.
  // Falls back to dirtying the file's content directly if the model isn't mounted yet.
  const applySearchEditsToMonaco = useCallback((filePath: string, edits: { line: number; column: number; length: number; replacement: string }[]) => {
    const monaco = (window as any).monaco;
    const model = monaco?.editor?.getModels?.().find((m: any) => m.uri?.path === filePath || m.uri?.fsPath === filePath);
    if (model) {
      const ops = edits.map(e => ({
        range: new monaco.Range(e.line, e.column, e.line, e.column + e.length),
        text: e.replacement,
        forceMoveMarkers: true,
      }));
      model.pushEditOperations([], ops, () => null);
      return;
    }
    // Fallback: rewrite OpenFile.content in workspace state and mark dirty.
    setActiveWorkspace(ws => ({
      ...ws,
      openFiles: ws.openFiles.map(f => {
        if (f.path !== filePath || typeof f.content !== 'string') return f;
        const next = applyEditsClientSide(f.content, edits);
        return { ...f, content: next, isDirty: true };
      }),
    }));
  }, []);
```

Add the helper near the top of the file (or in `src/utils/`):

```typescript
function applyEditsClientSide(content: string, edits: { line: number; column: number; length: number; replacement: string }[]): string {
  const sorted = [...edits].sort((a, b) => b.line - a.line || b.column - a.column);
  const lines = content.split('\n');
  for (const e of sorted) {
    const idx = e.line - 1;
    if (idx < 0 || idx >= lines.length) continue;
    const line = lines[idx];
    lines[idx] = line.slice(0, e.column - 1) + e.replacement + line.slice(e.column - 1 + e.length);
  }
  return lines.join('\n');
}
```

(If `setActiveWorkspace` doesn't exist verbatim, find the analogous setter in App.tsx — workspace updates use the pattern visible around line 572.)

- [ ] **Step 5: Manual smoke test**

Run: `npm run dev` (or whatever the project's dev command is). In the running app:
- Click the Search nav button — sidebar opens.
- Press Ctrl+Shift+F — sidebar toggles.
- Type a query — results appear after 250ms debounce.
- Type a replacement — old/new preview appears inline.
- Click per-match replace — file updates (check the editor).
- Click Replace All — confirmation appears, then replace runs.

If anything breaks, the most likely culprits are:
- `monaco.editor.getModels()` not finding the model — adjust the URI matching logic to whatever shape SAI's editor uses (search the existing CodePanel for how it calls `monaco.editor.create`).
- `getOpenBuffers` returning nothing — ensure the OpenFile model has `content` populated for dirty files (check `src/types.ts`).

- [ ] **Step 6: Commit**

```bash
git add src/components/NavBar.tsx src/App.tsx
git commit -m "feat(search): mount SearchPanel sidebar + Ctrl+Shift+F + Monaco edit applier"
```

---

## Task 10: E2E test — open the panel, search, replace via mock

Add an E2E test that exercises the panel through the saiMock fixture.

**Files:**
- Modify: `tests/e2e/electron.setup.ts` (extend default mock with search APIs)
- Create: `tests/e2e/search.spec.ts`

- [ ] **Step 1: Extend the default mock**

In `tests/e2e/electron.setup.ts`, find both copies of the default mock (the exported `buildDefaultSaiMock` AND the inline copy inside `addInitScript`). In each, add next to `fsGrep`:

```typescript
    searchRun: () => Promise.resolve({ files: [], truncated: false, durationMs: 0 }),
    searchReplaceFile: () => Promise.resolve(),
```

Both copies must be updated identically (per the drift-guard comment from the e2e plan).

- [ ] **Step 2: Write the E2E spec**

Create `tests/e2e/search.spec.ts`:

```typescript
import { test, expect } from './electron.setup';

test.describe('Search Sidebar', () => {
  test('opens via Ctrl+Shift+F and focuses the search input', async ({ window }) => {
    await window.keyboard.press('Control+Shift+F');
    const input = window.locator('.search-panel .search-input').first();
    await expect(input).toBeVisible({ timeout: 5000 });
    await expect(input).toBeFocused();
  });

  test('renders results from a mocked search', async ({ window }) => {
    await window.keyboard.press('Control+Shift+F');
    await window.locator('.search-panel').waitFor({ state: 'visible' });

    // Override searchRun for this run via window.sai
    await window.evaluate(() => {
      (window as any).sai.searchRun = () => Promise.resolve({
        files: [
          { path: 'src/foo.ts', matches: [
            { line: 12, column: 10, length: 3, preview: 'function foo(x) {', matchStart: 9, matchEnd: 12 },
          ]},
        ],
        truncated: false,
        durationMs: 5,
      });
    });

    await window.locator('.search-panel .search-input').first().fill('foo');
    // wait past the 250ms debounce
    await window.waitForTimeout(500);

    await expect(window.locator('text=src/foo.ts')).toBeVisible({ timeout: 3000 });
    await expect(window.locator('text=function')).toBeVisible();
  });

  test.describe('with scripted results', () => {
    test.use({
      saiMock: {
        searchRun: () => Promise.resolve({
          files: [{ path: 'src/foo.ts', matches: [
            { line: 12, column: 10, length: 3, preview: 'function foo(x) {', matchStart: 9, matchEnd: 12 },
          ]}],
          truncated: false,
          durationMs: 5,
        }),
        searchReplaceFile: () => Promise.resolve(),
      },
    });

    test('Replace All shows confirmation dialog', async ({ window }) => {
      await window.keyboard.press('Control+Shift+F');
      await window.locator('.search-panel').waitFor({ state: 'visible' });
      await window.locator('.search-panel .search-input').first().fill('foo');
      await window.locator('input[placeholder="Replace"]').fill('bar');
      await window.waitForTimeout(500);
      await window.locator('.search-replace-all').click();
      await expect(window.locator('.search-confirm-dialog')).toBeVisible({ timeout: 3000 });
    });
  });
});
```

- [ ] **Step 3: Run the E2E spec**

Run: `npm run test:e2e -- tests/e2e/search.spec.ts`
Expected: PASS — 3 tests.

If the panel doesn't open, the Ctrl+Shift+F handler may not be firing — verify by clicking the nav button instead:

```typescript
await window.locator('.nav-btn[title="Search"]').click();
```

If selectors mismatch, read the actual DOM via `await window.locator('.search-panel').innerHTML()` and adjust.

- [ ] **Step 4: Commit**

```bash
git add tests/e2e/electron.setup.ts tests/e2e/search.spec.ts
git commit -m "test(e2e): add search sidebar E2E coverage"
```

---

## Task 11: Final verification + PR

- [ ] **Step 1: Run all tests**

Run: `npm test && npm run test:integration && npm run test:e2e`
Expected: every test passes, no skipped e2e tests, no failures.

- [ ] **Step 2: Run skip guard**

Run: `bash scripts/check-no-skipped-e2e.sh`
Expected: `OK: no test.skip in e2e specs.`

- [ ] **Step 3: Manual end-to-end smoke**

Run: `npm run dev`. Verify in the live app:
1. Ctrl+Shift+F opens the panel.
2. Typing a query returns real results from the project (rg actually runs).
3. Replace All confirmation appears with correct counts.
4. Confirming the replace updates files on disk for unopened files and updates the Monaco editor for open files.
5. Single Ctrl+Z in an open file undoes the entire file's replace.
6. Toggling each option (case, word, regex, gitignore, include glob, exclude glob) changes results sensibly.

- [ ] **Step 4: Open the PR**

```bash
git push -u origin HEAD
gh pr create --title "feat: project-wide find & replace sidebar" --body "$(cat <<'EOF'
## Summary
Adds the Search sidebar from `docs/superpowers/specs/2026-04-27-find-replace-design.md`:

- Dedicated sidebar panel (toggle via nav button or Ctrl+Shift+F)
- All six search options: case-sensitive, whole word, regex, include/exclude globs, .gitignore
- VS Code-style replace flow: per-match, per-file, global with confirmation
- Inline old → new preview when replacement is non-empty
- Replaces routed through Monaco for open files (single Ctrl+Z to undo per file), through `fs.writeFile` for unopened files
- In-memory buffer scan for dirty open files merged with rg results

## Test plan
- [x] Unit tests pass (rg argv, parser, buffer scan, merger, edit applier, hook, components)
- [x] Integration test runs real rg against the e2e fixture project
- [x] E2E test covers panel open + result rendering + Replace All confirmation
- [x] Manual smoke: replace updates Monaco models, Ctrl+Z works, all toggles function

## Out of scope (post-1.0)
- Search history dropdown
- "Search only in open editors" filter
- Multi-workspace search
- rg-not-on-PATH JS fallback (defer; deps already require rg)

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

---

## Self-Review Notes

- **Spec coverage:** every spec section maps to a task (UI → 7+8+9, search options → 1, replace flow → 4+6+9, dirty buffers → 3+9, types → 1, error handling — empty pattern, invalid regex, etc. — handled inline in 6+9, testing → 1/2/3/4/6/7/8/10).
- **rg-not-on-PATH fallback** intentionally deferred and documented in the PR body. SAI already requires rg via the existing `fs:grep` so adding the JS fallback now is over-engineering for v1.
- **Capture-group regex** simplified: `applyEditsToContent` and the Monaco edits use the literal `replacement` string. If users want `$1` substitution, that's a follow-up — neither this plan's tests nor spec demand it. (The spec mentioned it as an aspiration; the implementer can punt explicitly.)
- **Type consistency:** `ReplaceEdit` is the canonical type (line, column, length, replacement). `SearchMatch` does not include `replacement`; that's added per-edit at replace time. `SearchResults` is consistent across IPC, hook, and components.
- **Selectors in tests** match the CSS class names defined in Task 7's CSS.
- **Drift hazard for the e2e mock:** Task 10 explicitly mentions both copies of the default mock must be updated.
