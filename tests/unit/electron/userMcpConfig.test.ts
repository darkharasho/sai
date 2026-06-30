// @vitest-environment node
import { describe, it, expect } from 'vitest';
import { parseUserMcpConfigPaths } from '../../../electron/services/claudeBackend/userMcpConfig';

describe('parseUserMcpConfigPaths', () => {
  const files: Record<string, string> = {
    '/cfg/a.json': JSON.stringify({ mcpServers: { foo: { type: 'stdio', command: 'foo' } } }),
    '/cfg/b.json': JSON.stringify({ mcpServers: { bar: { type: 'stdio', command: 'bar' } } }),
  };
  const readFile = (p: string) => { if (!(p in files)) throw new Error('ENOENT'); return files[p]; };

  it('returns {} for falsy/empty setting', () => {
    expect(parseUserMcpConfigPaths(undefined, readFile)).toEqual({});
    expect(parseUserMcpConfigPaths('', readFile)).toEqual({});
    expect(parseUserMcpConfigPaths([], readFile)).toEqual({});
  });

  it('parses a single string path', () => {
    expect(parseUserMcpConfigPaths('/cfg/a.json', readFile)).toEqual({ foo: { type: 'stdio', command: 'foo' } });
  });

  it('merges multiple paths', () => {
    expect(parseUserMcpConfigPaths(['/cfg/a.json', '/cfg/b.json'], readFile)).toEqual({
      foo: { type: 'stdio', command: 'foo' }, bar: { type: 'stdio', command: 'bar' },
    });
  });

  it('skips missing/malformed files without throwing', () => {
    const bad = { '/cfg/x.json': '{ not json' };
    const rf = (p: string) => { if (p === '/cfg/a.json') return files['/cfg/a.json']; if (p in bad) return bad[p]; throw new Error('ENOENT'); };
    expect(parseUserMcpConfigPaths(['/cfg/a.json', '/cfg/x.json', '/cfg/missing.json'], rf)).toEqual({ foo: { type: 'stdio', command: 'foo' } });
  });
});
