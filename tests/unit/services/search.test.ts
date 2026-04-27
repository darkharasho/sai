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
