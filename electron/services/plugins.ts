import { ipcMain } from 'electron';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import * as os from 'node:os';
import * as path from 'node:path';
import * as fs from 'node:fs';
import {
  mergeInstalled, readMarketplaces, registryInventory, registryPlugins, type CliPlugin,
} from './pluginCatalog';
import type { Plugin } from '../../src/types';

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

/** Project/local scopes resolve against the CLI's cwd, so run in the project. */
function cwdFor(projectPath?: string): string {
  return projectPath && fs.existsSync(projectPath) ? projectPath : os.homedir();
}

async function runClaude(args: string[], projectPath?: string): Promise<string> {
  const { stdout } = await execFileAsync(findClaude(), args, { timeout: 120000, cwd: cwdFor(projectPath) });
  return stdout.trim();
}

/** The CLI's own message (stderr) beats execFile's "Command failed: …" wrapper. */
function cliError(err: any, fallback: string): { error: string } {
  const stderr = typeof err?.stderr === 'string' ? err.stderr.trim() : '';
  const stdout = typeof err?.stdout === 'string' ? err.stdout.trim() : '';
  return { error: stderr || stdout || err?.message || fallback };
}

const knownMarketplacesFile = () => path.join(os.homedir(), '.claude', 'plugins', 'known_marketplaces.json');

async function listInstalled(projectPath?: string): Promise<Plugin[]> {
  const raw = JSON.parse(await runClaude(['plugins', 'list', '--json'], projectPath)) as CliPlugin[];
  return mergeInstalled(Array.isArray(raw) ? raw : [], projectPath, readMarketplaces(knownMarketplacesFile()));
}

async function findInstalled(id: string, projectPath?: string): Promise<Plugin> {
  const plugin = (await listInstalled(projectPath)).find(p => p.id === id);
  if (!plugin) throw new Error(`${id} isn't installed here`);
  return plugin;
}

export function registerPluginHandlers() {
  ipcMain.handle('plugins:list', async (_event, projectPath?: string) => {
    try {
      return await listInstalled(projectPath);
    } catch (err: any) {
      return cliError(err, 'Failed to list plugins');
    }
  });

  ipcMain.handle('plugins:install', async (_event, id: string) => {
    try {
      await runClaude(['plugins', 'install', id]);
      return { success: true };
    } catch (err: any) {
      return cliError(err, 'Failed to install plugin');
    }
  });

  // Removes the plugin from every scope that applies here, so it's really gone.
  ipcMain.handle('plugins:uninstall', async (_event, id: string, projectPath?: string) => {
    try {
      const plugin = await findInstalled(id, projectPath);
      if (plugin.scopes.includes('managed')) return { error: 'Managed by your organization — it can\'t be uninstalled here' };
      for (const scope of plugin.scopes) {
        await runClaude(['plugins', 'uninstall', id, '--scope', scope], projectPath);
      }
      return { success: true };
    } catch (err: any) {
      return cliError(err, 'Failed to uninstall plugin');
    }
  });

  // Flips the effective (most specific) scope — the one whose flag the CLI honors.
  ipcMain.handle('plugins:setEnabled', async (_event, id: string, enabled: boolean, projectPath?: string) => {
    try {
      const plugin = await findInstalled(id, projectPath);
      if (plugin.activeScope === 'managed') return { error: 'Managed by your organization' };
      await runClaude(['plugins', enabled ? 'enable' : 'disable', id, '--scope', plugin.activeScope], projectPath);
      return { success: true };
    } catch (err: any) {
      return cliError(err, `Failed to ${enabled ? 'enable' : 'disable'} plugin`);
    }
  });

  ipcMain.handle('plugins:update', async (_event, id: string, projectPath?: string) => {
    try {
      const plugin = await findInstalled(id, projectPath);
      await runClaude(['plugins', 'update', id, '--scope', plugin.activeScope], projectPath);
      return { success: true };
    } catch (err: any) {
      return cliError(err, 'Failed to update plugin');
    }
  });

  // Read from the CLI's local marketplace clones — no network, every marketplace.
  ipcMain.handle('plugins:registryList', async () => {
    try {
      let installedIds = new Set<string>();
      try {
        const raw = JSON.parse(await runClaude(['plugins', 'list', '--json'])) as CliPlugin[];
        installedIds = new Set(raw.map(p => p.id));
      } catch { /* nothing installed */ }
      return registryPlugins(readMarketplaces(knownMarketplacesFile()), installedIds);
    } catch (err: any) {
      return cliError(err, 'Failed to read marketplaces');
    }
  });

  ipcMain.handle('plugins:registryInventory', async (_event, marketplace: string, name: string) => {
    return registryInventory(readMarketplaces(knownMarketplacesFile()), marketplace, name);
  });
}
