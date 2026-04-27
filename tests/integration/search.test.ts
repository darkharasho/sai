import { describe, it, expect, vi } from 'vitest';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

// Mock the electron module so search.ts can be imported in a plain Node environment.
vi.mock('electron', () => ({
  ipcMain: { handle: vi.fn() },
}));

import { buildRgArgs, parseRgOutput } from '../../electron/services/search';

const execFileAsync = promisify(execFile);
const FIXTURE = path.resolve(__dirname, '../e2e/fixtures/test-project');

// Skip the suite if ripgrep isn't installed on this machine (e.g. some CI runners).
// Unit tests cover argv building and JSON parsing separately; this suite verifies
// the real rg pipeline end-to-end when available.
let rgAvailable = false;
try {
  await execFileAsync('rg', ['--version']);
  rgAvailable = true;
} catch { /* rg not installed */ }

describe.skipIf(!rgAvailable)('search integration (real rg)', () => {

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

    // Pass FIXTURE explicitly so rg reports absolute paths (parseRgOutput expects them)
    const { stdout } = await execFileAsync('rg', [...argv, FIXTURE], { cwd: FIXTURE, maxBuffer: 5 * 1024 * 1024 });
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
      const { stdout } = await execFileAsync('rg', [...argv, FIXTURE], { cwd: FIXTURE });
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
