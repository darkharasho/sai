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

interface CliPlugin {
  id: string;
  version: string;
  scope: string;
  enabled: boolean;
  installPath: string;
}

async function runClaude(args: string[]): Promise<string> {
  const claude = findClaude();
  const { stdout } = await execFileAsync(claude, args, { timeout: 30000 });
  return stdout.trim();
}

function readPluginMeta(installPath: string): { description: string; skills: string[] } {
  let description = '';
  let skills: string[] = [];

  try {
    const pkgPath = path.join(installPath, 'package.json');
    if (fs.existsSync(pkgPath)) {
      const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf-8'));
      description = pkg.description || '';
    }

    if (!description) {
      const readme = path.join(installPath, 'README.md');
      if (fs.existsSync(readme)) {
        const lines = fs.readFileSync(readme, 'utf-8').split('\n');
        const descLine = lines.find(l => l.trim() && !l.startsWith('#'));
        if (descLine) description = descLine.trim().slice(0, 120);
      }
    }

    const skillsDir = path.join(installPath, 'skills');
    if (fs.existsSync(skillsDir)) {
      skills = fs.readdirSync(skillsDir).filter(f => !f.startsWith('.'));
    }
  } catch { /* ignore */ }

  return { description, skills };
}

export function registerPluginHandlers(readSettings?: () => Record<string, any>) {
  function ghHeaders(): HeadersInit {
    const token = readSettings?.()?.github_auth?.token;
    return token ? { Authorization: `Bearer ${token}` } : {};
  }

  ipcMain.handle('plugins:list', async () => {
    try {
      const output = await runClaude(['plugins', 'list', '--json']);
      const raw = JSON.parse(output) as CliPlugin[];
      return raw.map(p => {
        const [pluginName, source] = p.id.includes('@') ? p.id.split('@') : [p.id, ''];
        const meta = readPluginMeta(p.installPath);
        return {
          name: pluginName,
          description: meta.description,
          version: p.version,
          source,
          enabled: p.enabled,
          skills: meta.skills,
        };
      });
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
      let installedNames = new Set<string>();
      try {
        const output = await runClaude(['plugins', 'list', '--json']);
        const raw = JSON.parse(output) as CliPlugin[];
        for (const p of raw) {
          const pluginName = p.id.includes('@') ? p.id.split('@')[0] : p.id;
          installedNames.add(pluginName);
        }
      } catch { /* no installed plugins */ }

      const res = await fetch('https://api.github.com/repos/anthropics/claude-plugins-official/contents/plugins', { headers: ghHeaders() });
      if (!res.ok) throw new Error(`GitHub API error: ${res.status}`);
      const entries = await res.json() as { name: string; type: string }[];
      const dirs = entries.filter(e => e.type === 'dir' && !e.name.startsWith('.'));

      const baseUrl = 'https://api.github.com/repos/anthropics/claude-plugins-official/contents/plugins';

      const plugins = await Promise.all(dirs.map(async (dir) => {
        try {
          const metaRes = await fetch(`https://raw.githubusercontent.com/anthropics/claude-plugins-official/main/plugins/${dir.name}/.claude-plugin/plugin.json`);
          if (!metaRes.ok) return null;
          const meta = await metaRes.json() as Record<string, any>;
          const name = meta.name || dir.name;
          const author = meta.author?.name || '';

          let skills: string[] = [];
          let commands: string[] = [];
          try {
            const contentsRes = await fetch(`${baseUrl}/${dir.name}`, { headers: ghHeaders() });
            if (contentsRes.ok) {
              const contents = await contentsRes.json() as { name: string; type: string }[];
              const hasSkills = contents.some(e => e.name === 'skills' && e.type === 'dir');
              const hasCommands = contents.some(e => e.name === 'commands' && e.type === 'dir');

              if (hasSkills) {
                const skillsRes = await fetch(`${baseUrl}/${dir.name}/skills`, { headers: ghHeaders() });
                if (skillsRes.ok) {
                  const skillEntries = await skillsRes.json() as { name: string }[];
                  skills = skillEntries.map(e => e.name).filter(n => !n.startsWith('.'));
                }
              }
              if (hasCommands) {
                const cmdsRes = await fetch(`${baseUrl}/${dir.name}/commands`, { headers: ghHeaders() });
                if (cmdsRes.ok) {
                  const cmdEntries = await cmdsRes.json() as { name: string }[];
                  commands = cmdEntries.map(e => e.name.replace(/\.md$/, '')).filter(n => !n.startsWith('.'));
                }
              }
            }
          } catch { /* skip enrichment */ }

          return {
            name,
            description: meta.description || '',
            version: meta.version || '',
            source: 'anthropics/claude-plugins-official',
            skills,
            commands,
            author,
            repositoryUrl: `https://github.com/anthropics/claude-plugins-official/tree/main/plugins/${dir.name}`,
            installed: installedNames.has(name),
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
