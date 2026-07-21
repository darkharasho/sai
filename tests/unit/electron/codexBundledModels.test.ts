import { describe, expect, it } from 'vitest';
import { resolveBundledCodex } from '../../../electron/services/codexBackend/bundledModels';
import { normalizeCodexModelOption } from '../../../electron/services/codexBackend/types';

describe('bundled Codex resolver', () => {
  it('normalizes dynamic model reasoning metadata including max and ultra', () => {
    expect(normalizeCodexModelOption({
      model: 'gpt-5.6-sol', displayName: 'GPT 5.6 Sol',
      supportedReasoningEfforts: [
        { reasoningEffort: 'low', description: 'Fast' },
        { reasoningEffort: 'max', description: 'Deep' },
        { reasoningEffort: 'ultra', description: 'Deepest' },
        { reasoningEffort: 'future', description: 'Unknown' },
      ],
      defaultReasoningEffort: 'max',
    })).toEqual({
      id: 'gpt-5.6-sol', name: 'GPT 5.6 Sol',
      supportedReasoningEfforts: ['low', 'max', 'ultra'],
      defaultReasoningEffort: 'max',
    });
  });
  it('preserves an explicitly empty supported reasoning effort list', () => {
    expect(normalizeCodexModelOption({ model: 'none', supportedReasoningEfforts: [] }))
      .toEqual({ id: 'none', name: 'none', supportedReasoningEfforts: [] });
  });
  it('resolves Linux x64 from the SDK optional platform package, never PATH', () => {
    const seen: string[] = [];
    const result = resolveBundledCodex({
      platform: 'linux', arch: 'x64',
      resolve: (specifier) => { seen.push(specifier); return '/app/node_modules/@openai/codex-linux-x64/package.json'; },
      exists: () => true,
    });
    expect(seen).toEqual(['@openai/codex-linux-x64/package.json']);
    expect(result.executablePath).toBe('/app/node_modules/@openai/codex-linux-x64/vendor/x86_64-unknown-linux-musl/bin/codex');
  });

  it('uses the unpacked executable in packaged Electron apps', () => {
    const result = resolveBundledCodex({
      platform: 'win32', arch: 'arm64',
      resolve: () => 'C:\\SAI\\resources\\app.asar\\node_modules\\@openai\\codex-win32-arm64\\package.json',
      exists: (candidate) => candidate.includes('app.asar.unpacked'),
    });
    expect(result.executablePath).toContain('app.asar.unpacked');
    expect(result.executablePath).toContain('codex.exe');
    expect(result.pathDirs).toEqual([expect.stringContaining('app.asar.unpacked\\node_modules\\@openai\\codex-win32-arm64\\vendor\\aarch64-pc-windows-msvc\\codex-path')]);
  });

  it('reports unsupported targets and missing optional dependencies', () => {
    expect(() => resolveBundledCodex({ platform: 'freebsd', arch: 'x64' })).toThrow(/Unsupported/);
    expect(() => resolveBundledCodex({ platform: 'darwin', arch: 'arm64', resolve: () => { throw new Error('missing'); } })).toThrow(/optional dependency/);
  });
});
