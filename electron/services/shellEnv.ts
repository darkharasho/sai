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

      if (Object.keys(env).length > 0) {
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

if (process.platform !== 'win32') captureShellEnv();

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
