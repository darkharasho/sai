// Standalone shell-env capture, shared by services that spawn user CLIs
// (`claude`, `codex`, `gemini`, etc.). Kept free of Electron imports so it
// can be loaded in unit tests without the app context.

import { spawn } from 'node:child_process';
import * as path from 'node:path';
import * as fs from 'node:fs';
import * as os from 'node:os';

let cachedShellEnv: NodeJS.ProcessEnv | null = null;

/**
 * Spawn the user's login shell, run `env`, and parse the full environment.
 * Falls back to heuristicEnv() on failure or timeout.
 */
function captureShellEnv(): Promise<NodeJS.ProcessEnv> {
  return new Promise((resolve) => {
    const fallback = () => resolve(heuristicEnv());

    let proc: ReturnType<typeof spawn>;
    try {
      const userShell = process.env.SHELL || '/bin/zsh';
      proc = spawn(userShell, ['-ilc', 'env'], {
        stdio: ['ignore', 'pipe', 'ignore'],
        env: { ...process.env, TERM: 'dumb' },
        timeout: 5000,
      });
      if (!proc || !proc.on) { fallback(); return; }
    } catch {
      fallback();
      return;
    }

    let output = '';
    proc.stdout?.on('data', (d: Buffer) => { output += d.toString(); });

    proc.on('error', fallback);
    proc.on('exit', () => {
      if (!output.trim()) { fallback(); return; }
      const env: Record<string, string> = {};
      let currentKey = '';
      let currentVal = '';
      for (const line of output.split('\n')) {
        const eqIdx = line.indexOf('=');
        if (eqIdx > 0 && /^[A-Za-z_][A-Za-z0-9_]*$/.test(line.slice(0, eqIdx))) {
          if (currentKey) env[currentKey] = currentVal;
          currentKey = line.slice(0, eqIdx);
          currentVal = line.slice(eqIdx + 1);
        } else if (currentKey) {
          currentVal += '\n' + line;
        }
      }
      if (currentKey) env[currentKey] = currentVal;

      // Strip shell-specific vars that shouldn't be inherited by spawned tools.
      for (const k of ['SHLVL', '_', 'PWD', 'OLDPWD']) delete env[k];

      if (env.PATH) {
        cachedShellEnv = env;
        resolve(env);
      } else {
        fallback();
      }
    });

    setTimeout(() => { try { proc.kill(); } catch { /* ignore */ } }, 5000);
  });
}

/**
 * Heuristic fallback: prepend common tool paths to PATH so nvm/volta/homebrew
 * installs of `claude` etc. are discoverable.
 */
function heuristicEnv(): NodeJS.ProcessEnv {
  const env = { ...process.env };
  if (process.platform === 'win32') {
    return env;
  }
  const home = os.homedir();
  const extraPaths: string[] = [];
  const nvmDir = path.join(home, '.nvm', 'versions', 'node');
  if (fs.existsSync(nvmDir)) {
    try {
      for (const v of fs.readdirSync(nvmDir)) {
        extraPaths.push(path.join(nvmDir, v, 'bin'));
      }
    } catch { /* ignore */ }
  }
  extraPaths.push(
    path.join(home, '.local', 'bin'),
    path.join(home, '.volta', 'bin'),
    '/usr/local/bin',
    '/opt/homebrew/bin',
  );
  env.PATH = [...extraPaths, env.PATH || ''].join(path.delimiter);
  return env;
}

// Capture the login-shell env at module load, then patch process.env.PATH once
// the real PATH is known (see patchProcessPath).
if (process.platform !== 'win32') {
  captureShellEnv().then(patchProcessPath).catch(() => { /* ignore */ });
}

/**
 * Return the best available environment for spawning CLI processes.
 * Prefers the captured login-shell env; falls back to heuristic.
 */
export function enrichedEnv(): NodeJS.ProcessEnv {
  if (cachedShellEnv) {
    return { ...cachedShellEnv };
  }
  return heuristicEnv();
}

/**
 * Merge the enriched login-shell PATH into `process.env.PATH` in place.
 *
 * A Finder-launched macOS app inherits a stripped PATH. Child processes spawned
 * *without* an explicit env inherit that stripped PATH — most notably the
 * `@anthropic-ai/claude-agent-sdk`, which spawns the `claude` CLI with a plain
 * `{...process.env}`. Without this patch that CLI (and every tool it shells out
 * to: git, node, rg, …) can't be found. The CLI backend sidesteps this by
 * passing `enrichedEnv()` explicitly; the SDK gives us no env hook, so we widen
 * the process-global PATH instead.
 *
 * Idempotent and safe to call repeatedly — entries are de-duplicated with the
 * enriched dirs taking precedence. No-op on Windows.
 */
export function patchProcessPath(): void {
  if (process.platform === 'win32') return;
  const enriched = enrichedEnv().PATH;
  if (!enriched) return;
  const sep = path.delimiter;
  const seen = new Set<string>();
  const merged: string[] = [];
  for (const dir of [...enriched.split(sep), ...(process.env.PATH ?? '').split(sep)]) {
    if (!dir || seen.has(dir)) continue;
    seen.add(dir);
    merged.push(dir);
  }
  process.env.PATH = merged.join(sep);
}

/**
 * Append `--max-old-space-size=<capMB>` to NODE_OPTIONS so child Node processes
 * (claude CLI itself plus any node grandchildren it spawns: vitest, tsc, vite,
 * webpack, etc.) cap their heap. No-op when capMB <= 0 or the env already
 * pins a max-old-space-size (respect user override).
 */
export function withNodeMemoryCap(env: NodeJS.ProcessEnv, capMB: number): NodeJS.ProcessEnv {
  if (!capMB || capMB <= 0) return env;
  const existing = env.NODE_OPTIONS || '';
  if (existing.includes('--max-old-space-size')) return env;
  const flag = `--max-old-space-size=${Math.floor(capMB)}`;
  return { ...env, NODE_OPTIONS: existing ? `${existing} ${flag}` : flag };
}
