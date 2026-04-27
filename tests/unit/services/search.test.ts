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
