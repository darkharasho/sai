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
