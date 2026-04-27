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
