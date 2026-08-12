import { EventEmitter } from 'node:events';
import { describe, expect, it, vi } from 'vitest';
import {
  resolveBundledCodex,
  parseCodexModelContextWindows,
  enrichCodexModelsWithContext,
  fetchBundledCodexModels,
  type FetchBundledCodexModelsDeps,
} from '../../../electron/services/codexBackend/bundledModels';
import { normalizeCodexModelOption } from '../../../electron/services/codexBackend/types';

describe('bundled Codex resolver', () => {
  it('uses headerless JSONL for the App Server model catalog handshake', async () => {
    const proc = new EventEmitter() as EventEmitter & {
      stdin: { write: (line: string) => boolean };
      stdout: EventEmitter;
      kill: ReturnType<typeof vi.fn>;
    };
    const writes: string[] = [];
    proc.stdin = { write: (line) => { writes.push(line); return true; } };
    proc.stdout = new EventEmitter();
    proc.kill = vi.fn();
    const deps: FetchBundledCodexModelsDeps = {
      spawn: vi.fn().mockReturnValue(proc) as unknown as FetchBundledCodexModelsDeps['spawn'],
      resolveBundledCodex: () => ({ executablePath: '/bin/codex', pathDirs: [] }),
      enrichedEnv: () => ({ PATH: '/usr/bin' }),
    };

    const result = fetchBundledCodexModels(true, deps);
    expect(JSON.parse(writes[0])).toEqual({
      id: 0,
      method: 'initialize',
      params: { clientInfo: { name: 'sai', version: '1.0' } },
    });
    proc.stdout.emit('data', Buffer.from(`${JSON.stringify({ id: 0, result: {} })}\n`));
    expect(JSON.parse(writes[1])).toEqual({ id: 1, method: 'model/list', params: {} });
    expect(writes.map((line) => JSON.parse(line)).every((message) => !Object.hasOwn(message, 'jsonrpc'))).toBe(true);

    proc.stdout.emit('data', Buffer.from(`${JSON.stringify({ id: 1, result: { data: [] } })}\n`));
    await expect(result).resolves.toEqual({ models: [], defaultModel: '' });
    expect(proc.kill).toHaveBeenCalledOnce();
  });

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

  it('calculates the effective context window from the local model catalog', () => {
    const windows = parseCodexModelContextWindows(JSON.stringify([
      { slug: 'gpt-5-codex', context_window: 272_000, effective_context_window_percent: 95 },
      { slug: 'broken', context_window: -1, effective_context_window_percent: 95 },
    ]));
    expect(windows.get('gpt-5-codex')).toBe(258_400);
    expect(windows.has('broken')).toBe(false);
  });

  it('enriches known models and leaves unknown models unset', () => {
    expect(enrichCodexModelsWithContext([
      { id: 'gpt-5-codex', name: 'GPT-5 Codex' },
      { id: 'unknown', name: 'Unknown' },
    ], new Map([['gpt-5-codex', 258_400]]))).toEqual([
      { id: 'gpt-5-codex', name: 'GPT-5 Codex', effectiveContextWindow: 258_400 },
      { id: 'unknown', name: 'Unknown' },
    ]);
  });
});
