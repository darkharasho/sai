// @vitest-environment node
/**
 * Unit tests for the per-project slash-command cache.
 *
 * The cache replaced a single global file whose contents leaked between
 * workspaces, so project isolation is the headline behaviour here. The rest
 * guards the two invariants every consumer depends on: names are stored bare,
 * and a names-only write cannot erase descriptions a structured write supplied.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as path from 'node:path';

const { fsMock } = vi.hoisted(() => {
  const store = new Map<string, string>();
  return {
    fsMock: {
      store,
      readFileSync: vi.fn((p: string) => {
        if (!store.has(p)) throw Object.assign(new Error('ENOENT'), { code: 'ENOENT' });
        return store.get(p)!;
      }),
      writeFileSync: vi.fn((p: string, content: string) => { store.set(p, content); }),
    },
  };
});

vi.mock('node:fs', () => ({
  default: fsMock,
  readFileSync: fsMock.readFileSync,
  writeFileSync: fsMock.writeFileSync,
}));

vi.mock('electron', () => ({
  app: { getPath: vi.fn().mockReturnValue('/tmp/sai-slash-unit') },
}));

import {
  readCachedSlashCommands,
  writeCachedSlashCommands,
  clearCachedSlashCommands,
  hasCachedSlashCommands,
  normalizeSlashCommands,
} from '@electron/services/slashCommands';

const CACHE_PATH = path.join('/tmp/sai-slash-unit', 'slash-commands-cache.json');
const A = '/repo/alpha';
const B = '/repo/beta';

beforeEach(() => {
  fsMock.store.clear();
  vi.clearAllMocks();
});

describe('normalizeSlashCommands', () => {
  it('strips leading slashes so consumers can add exactly one', () => {
    expect(normalizeSlashCommands(['/help', 'clear', '//weird'])).toEqual([
      { name: 'help', description: '' },
      { name: 'clear', description: '' },
      { name: 'weird', description: '' },
    ]);
  });

  it('keeps description, argumentHint and aliases from SDK objects', () => {
    expect(normalizeSlashCommands([
      { name: '/deploy', description: '  Ship it  ', argumentHint: '<env>', aliases: ['/ship'] },
    ])).toEqual([
      { name: 'deploy', description: 'Ship it', argumentHint: '<env>', aliases: ['ship'] },
    ]);
  });

  it('accepts the snake_case argument_hint spelling', () => {
    expect(normalizeSlashCommands([{ name: 'x', argument_hint: '<n>' }])[0].argumentHint).toBe('<n>');
  });

  it('drops blanks and duplicate names, and tolerates non-arrays', () => {
    expect(normalizeSlashCommands(['/a', 'a', '', '   ', null, { name: '' }, 42])).toEqual([
      { name: 'a', description: '' },
    ]);
    expect(normalizeSlashCommands(undefined)).toEqual([]);
    expect(normalizeSlashCommands('nope')).toEqual([]);
  });
});

describe('per-project cache', () => {
  it('keeps projects isolated', () => {
    writeCachedSlashCommands(A, ['alpha-only']);
    writeCachedSlashCommands(B, ['beta-only']);

    expect(readCachedSlashCommands(A).map(c => c.name)).toEqual(['alpha-only']);
    expect(readCachedSlashCommands(B).map(c => c.name)).toEqual(['beta-only']);
  });

  it('returns an empty list for an unknown project or a missing path', () => {
    writeCachedSlashCommands(A, ['x']);
    expect(readCachedSlashCommands('/repo/never-opened')).toEqual([]);
    expect(readCachedSlashCommands(undefined)).toEqual([]);
    expect(hasCachedSlashCommands('/repo/never-opened')).toBe(false);
    expect(hasCachedSlashCommands(A)).toBe(true);
  });

  it('replaces rather than merges — a removed command disappears', () => {
    writeCachedSlashCommands(A, ['one', 'two']);
    writeCachedSlashCommands(A, ['one']);
    expect(readCachedSlashCommands(A).map(c => c.name)).toEqual(['one']);
  });

  it('a names-only write inherits descriptions already cached for those names', () => {
    writeCachedSlashCommands(A, [{ name: 'deploy', description: 'Ship it', argumentHint: '<env>' }]);
    // What a `system/init` frame looks like: names, no descriptions.
    writeCachedSlashCommands(A, ['deploy', 'lint']);

    expect(readCachedSlashCommands(A)).toEqual([
      { name: 'deploy', description: 'Ship it', argumentHint: '<env>' },
      { name: 'lint', description: '' },
    ]);
  });

  it('a structured write overwrites a stale description', () => {
    writeCachedSlashCommands(A, [{ name: 'deploy', description: 'old' }]);
    writeCachedSlashCommands(A, [{ name: 'deploy', description: 'new' }]);
    expect(readCachedSlashCommands(A)[0].description).toBe('new');
  });

  it('skips the disk write when nothing changed', () => {
    writeCachedSlashCommands(A, ['one']);
    expect(fsMock.writeFileSync).toHaveBeenCalledTimes(1);
    writeCachedSlashCommands(A, ['one']);
    expect(fsMock.writeFileSync).toHaveBeenCalledTimes(1);
  });

  it('discards a pre-v2 global flat-array file instead of misattributing it', () => {
    fsMock.store.set(CACHE_PATH, JSON.stringify(['/legacy']));
    expect(readCachedSlashCommands(A)).toEqual([]);
  });

  it('survives a corrupt cache file', () => {
    fsMock.store.set(CACHE_PATH, '{not json');
    expect(readCachedSlashCommands(A)).toEqual([]);
    writeCachedSlashCommands(A, ['fresh']);
    expect(readCachedSlashCommands(A).map(c => c.name)).toEqual(['fresh']);
  });

  it('ignores write errors rather than throwing into the drain loop', () => {
    fsMock.writeFileSync.mockImplementationOnce(() => { throw new Error('EACCES'); });
    expect(() => writeCachedSlashCommands(A, ['x'])).not.toThrow();
  });

  it('clear removes only the named project', () => {
    writeCachedSlashCommands(A, ['a']);
    writeCachedSlashCommands(B, ['b']);
    clearCachedSlashCommands(A);
    expect(readCachedSlashCommands(A)).toEqual([]);
    expect(readCachedSlashCommands(B).map(c => c.name)).toEqual(['b']);
  });
});
