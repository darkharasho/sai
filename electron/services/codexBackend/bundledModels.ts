import { spawn, type ChildProcess } from 'node:child_process';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';
import { enrichedEnv } from '../shellEnv';
import { normalizeCodexModelOption, type CodexModelResult } from './types';

const TARGETS: Record<string, { triple: string; packageName: string }> = {
  'linux:x64': { triple: 'x86_64-unknown-linux-musl', packageName: '@openai/codex-linux-x64' },
  'linux:arm64': { triple: 'aarch64-unknown-linux-musl', packageName: '@openai/codex-linux-arm64' },
  'android:x64': { triple: 'x86_64-unknown-linux-musl', packageName: '@openai/codex-linux-x64' },
  'android:arm64': { triple: 'aarch64-unknown-linux-musl', packageName: '@openai/codex-linux-arm64' },
  'darwin:x64': { triple: 'x86_64-apple-darwin', packageName: '@openai/codex-darwin-x64' },
  'darwin:arm64': { triple: 'aarch64-apple-darwin', packageName: '@openai/codex-darwin-arm64' },
  'win32:x64': { triple: 'x86_64-pc-windows-msvc', packageName: '@openai/codex-win32-x64' },
  'win32:arm64': { triple: 'aarch64-pc-windows-msvc', packageName: '@openai/codex-win32-arm64' },
};

export interface BundledCodexPathDeps {
  platform?: NodeJS.Platform;
  arch?: string;
  resolve?: (specifier: string) => string;
  exists?: (candidatePath: string) => boolean;
}

export function resolveBundledCodex(deps: BundledCodexPathDeps = {}): { executablePath: string; pathDirs: string[] } {
  const platform = deps.platform ?? process.platform;
  const arch = deps.arch ?? process.arch;
  const target = TARGETS[`${platform}:${arch}`];
  if (!target) throw new Error(`Unsupported Codex platform: ${platform} (${arch})`);
  const resolve = deps.resolve ?? createRequire(import.meta.url).resolve;
  const pathApi = platform === 'win32' ? path.win32 : path;
  const exists = deps.exists ?? fs.existsSync;
  let packageJson: string;
  try { packageJson = resolve(`${target.packageName}/package.json`); }
  catch { throw new Error(`Bundled Codex optional dependency is unavailable: ${target.packageName}`); }
  const vendor = pathApi.join(pathApi.dirname(packageJson), 'vendor', target.triple);
  const binaryName = platform === 'win32' ? 'codex.exe' : 'codex';
  let executablePath = pathApi.join(vendor, 'bin', binaryName);
  if (executablePath.includes(`${pathApi.sep}app.asar${pathApi.sep}`)) {
    const unpacked = executablePath.replace(`${pathApi.sep}app.asar${pathApi.sep}`, `${pathApi.sep}app.asar.unpacked${pathApi.sep}`);
    if (exists(unpacked)) executablePath = unpacked;
  }
  if (!exists(executablePath)) throw new Error(`Bundled Codex executable is unavailable for ${target.triple}`);
  const resolvedTargetRoot = pathApi.dirname(pathApi.dirname(executablePath));
  const codexPath = pathApi.join(resolvedTargetRoot, 'codex-path');
  return { executablePath, pathDirs: exists(codexPath) ? [codexPath] : [] };
}

let cachedModels: CodexModelResult | null = null;

/** Model discovery for the SDK backend using the SDK's bundled native CLI. */
export function fetchBundledCodexModels(forceRefresh = false): Promise<CodexModelResult> {
  if (!forceRefresh && cachedModels) return Promise.resolve(cachedModels);
  const fallback: CodexModelResult = { models: [], defaultModel: '' };
  return new Promise((resolve) => {
    let proc: ChildProcess;
    try {
      const bundled = resolveBundledCodex();
      const env = enrichedEnv();
      const pathKey = process.platform === 'win32' ? (Object.keys(env).find(key => key.toLowerCase() === 'path') ?? 'Path') : 'PATH';
      env[pathKey] = [...bundled.pathDirs, env[pathKey]].filter(Boolean).join(path.delimiter);
      proc = spawn(bundled.executablePath, ['app-server'], { env, stdio: ['pipe', 'pipe', 'pipe'], shell: false });
    } catch { resolve(fallback); return; }
    let buffer = '';
    let settled = false;
    const finish = (result: CodexModelResult) => {
      if (settled) return;
      settled = true;
      if (result.models.length) cachedModels = result;
      try { proc.kill(); } catch { /* exited */ }
      resolve(result);
    };
    const timeout = setTimeout(() => finish(fallback), 10_000);
    const line = (raw: string) => {
      try {
        const msg = JSON.parse(raw);
        if (msg.id === 0 && !msg.error) proc.stdin?.write(`${JSON.stringify({ jsonrpc: '2.0', method: 'model/list', id: 1, params: {} })}\n`);
        if (msg.id === 1 && msg.result) {
          const data = msg.result.data ?? [];
          const models = data.filter((m: any) => !m.hidden).map(normalizeCodexModelOption);
          clearTimeout(timeout);
          finish({ models, defaultModel: data.find((m: any) => m.isDefault)?.model || models[0]?.id || '' });
        } else if (msg.error) { clearTimeout(timeout); finish(fallback); }
      } catch { /* tolerate non-JSON diagnostics */ }
    };
    proc.stdout?.on('data', (chunk: Buffer) => { buffer += chunk.toString(); const lines = buffer.split('\n'); buffer = lines.pop() ?? ''; lines.forEach(line); });
    proc.on('error', () => { clearTimeout(timeout); finish(fallback); });
    proc.on('exit', () => { clearTimeout(timeout); setTimeout(() => { if (buffer.trim()) line(buffer); finish(fallback); }, 0); });
    proc.stdin?.write(`${JSON.stringify({ jsonrpc: '2.0', method: 'initialize', id: 0, params: { clientInfo: { name: 'sai', version: '1.0' } } })}\n`);
  });
}
