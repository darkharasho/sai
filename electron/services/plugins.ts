import { ipcMain } from 'electron';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import * as os from 'node:os';
import * as path from 'node:path';
import * as fs from 'node:fs';

const execFileAsync = promisify(execFile);

function findClaude(): string {
  const home = os.homedir();
  const candidates = [
    path.join(home, '.local', 'bin', 'claude'),
    path.join(home, '.volta', 'bin', 'claude'),
    '/usr/local/bin/claude',
    '/opt/homebrew/bin/claude',
    'claude',
  ];
  for (const c of candidates) {
    try {
      if (c === 'claude' || fs.existsSync(c)) return c;
    } catch { /* skip */ }
  }
  return 'claude';
}

interface PluginInfo {
  name: string;
  description: string;
  version: string;
  source: string;
  enabled: boolean;
  skills: string[];
  icon?: string;
}

async function runClaude(args: string[]): Promise<string> {
  const claude = findClaude();
  const { stdout } = await execFileAsync(claude, args, { timeout: 30000 });
  return stdout.trim();
}

export function registerPluginHandlers() {
  ipcMain.handle('plugins:list', async () => {
    try {
      const output = await runClaude(['plugins', 'list', '--json']);
      return JSON.parse(output) as PluginInfo[];
    } catch (err: any) {
      return { error: err.message || 'Failed to list plugins' };
    }
  });

  ipcMain.handle('plugins:install', async (_event, name: string) => {
    try {
      await runClaude(['plugins', 'install', name]);
      return { success: true };
    } catch (err: any) {
      return { error: err.message || 'Failed to install plugin' };
    }
  });

  ipcMain.handle('plugins:uninstall', async (_event, name: string) => {
    try {
      await runClaude(['plugins', 'uninstall', name]);
      return { success: true };
    } catch (err: any) {
      return { error: err.message || 'Failed to uninstall plugin' };
    }
  });

  ipcMain.handle('plugins:registryList', async () => {
    try {
      const res = await fetch('https://api.github.com/repos/anthropics/claude-code-plugins/contents');
      if (!res.ok) throw new Error(`GitHub API error: ${res.status}`);
      const entries = await res.json() as { name: string; type: string }[];
      const dirs = entries.filter(e => e.type === 'dir' && !e.name.startsWith('.'));

      const plugins = await Promise.all(dirs.map(async (dir) => {
        try {
          const pkgRes = await fetch(`https://raw.githubusercontent.com/anthropics/claude-code-plugins/main/${dir.name}/package.json`);
          if (!pkgRes.ok) return null;
          const pkg = await pkgRes.json() as Record<string, any>;
          return {
            name: dir.name,
            description: pkg.description || '',
            version: pkg.version || '0.0.0',
            source: 'anthropics/claude-code-plugins',
            skills: [],
            installed: false,
          };
        } catch {
          return null;
        }
      }));

      return plugins.filter(Boolean);
    } catch (err: any) {
      return { error: err.message || 'Failed to fetch registry' };
    }
  });
}
