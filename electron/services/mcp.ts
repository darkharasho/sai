import { ipcMain } from 'electron';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';

interface McpConfigEntry {
  type?: string;
  command?: string;
  args?: string[];
  url?: string;
  env?: Record<string, string>;
  headers?: Record<string, string>;
  disabled?: boolean;
}

interface ProjectEntry {
  mcpServers?: Record<string, McpConfigEntry>;
  disabledMcpServers?: string[];
  [k: string]: any;
}

interface ClaudeConfig {
  mcpServers?: Record<string, McpConfigEntry>;
  projects?: Record<string, ProjectEntry>;
  [k: string]: any;
}

interface InstalledPlugins {
  version?: number;
  plugins?: Record<string, Array<{ installPath: string; scope?: string }>>;
}

interface SettingsFile {
  enabledPlugins?: Record<string, boolean>;
  [k: string]: any;
}

const claudeConfigPath = () => path.join(os.homedir(), '.claude.json');
const settingsPath = () => path.join(os.homedir(), '.claude', 'settings.json');
const installedPluginsPath = () => path.join(os.homedir(), '.claude', 'plugins', 'installed_plugins.json');
const disableScope = () => os.homedir();

function readJson<T>(p: string, fallback: T): T {
  try {
    if (fs.existsSync(p)) return JSON.parse(fs.readFileSync(p, 'utf-8')) as T;
  } catch { /* ignore */ }
  return fallback;
}

function readClaudeConfig(): ClaudeConfig {
  return readJson<ClaudeConfig>(claudeConfigPath(), { mcpServers: {} });
}

function writeClaudeConfig(config: ClaudeConfig): void {
  fs.writeFileSync(claudeConfigPath(), JSON.stringify(config, null, 2), 'utf-8');
}

function detectTransport(entry: McpConfigEntry): 'stdio' | 'sse' | 'streamable-http' {
  if (entry.type === 'sse') return 'sse';
  if (entry.type === 'http' || entry.type === 'streamable-http') return 'streamable-http';
  if (entry.url) return entry.url.includes('/sse') ? 'sse' : 'streamable-http';
  return 'stdio';
}

interface PluginServer {
  pluginShort: string;
  serverName: string;
  entry: McpConfigEntry;
}

function listPluginServers(): PluginServer[] {
  const installed = readJson<InstalledPlugins>(installedPluginsPath(), {});
  const settings = readJson<SettingsFile>(settingsPath(), {});
  const enabledPlugins = settings.enabledPlugins || {};
  const out: PluginServer[] = [];

  for (const [pluginKey, entries] of Object.entries(installed.plugins || {})) {
    if (enabledPlugins[pluginKey] === false) continue;
    const pluginShort = pluginKey.split('@')[0];
    for (const inst of entries) {
      const mcpFile = path.join(inst.installPath, '.mcp.json');
      const data = readJson<Record<string, McpConfigEntry> | { mcpServers?: Record<string, McpConfigEntry> }>(mcpFile, {} as any);
      const servers = (data as any).mcpServers && typeof (data as any).mcpServers === 'object'
        ? (data as any).mcpServers as Record<string, McpConfigEntry>
        : data as Record<string, McpConfigEntry>;
      for (const [serverName, entry] of Object.entries(servers || {})) {
        if (!entry || typeof entry !== 'object') continue;
        out.push({ pluginShort, serverName, entry });
      }
    }
  }
  return out;
}

function disabledList(config: ClaudeConfig): string[] {
  const proj = config.projects?.[disableScope()];
  return Array.isArray(proj?.disabledMcpServers) ? proj!.disabledMcpServers! : [];
}

function setDisabled(config: ClaudeConfig, fullName: string, disabled: boolean) {
  if (!config.projects) config.projects = {};
  const scope = disableScope();
  if (!config.projects[scope]) config.projects[scope] = {};
  const proj = config.projects[scope];
  const current = new Set(Array.isArray(proj.disabledMcpServers) ? proj.disabledMcpServers : []);
  if (disabled) current.add(fullName); else current.delete(fullName);
  proj.disabledMcpServers = Array.from(current);
}

export function registerMcpHandlers() {
  ipcMain.handle('mcp:list', async () => {
    try {
      const config = readClaudeConfig();
      const disabled = new Set(disabledList(config));
      const userServers = config.mcpServers || {};

      const items = Object.entries(userServers).map(([name, entry]) => ({
        name,
        transport: detectTransport(entry),
        command: entry.command,
        args: entry.args,
        url: entry.url,
        env: entry.env,
        enabled: !disabled.has(name) && !entry.disabled,
        source: 'user' as const,
      }));

      for (const ps of listPluginServers()) {
        const fullName = `plugin:${ps.pluginShort}:${ps.serverName}`;
        items.push({
          name: fullName,
          transport: detectTransport(ps.entry),
          command: ps.entry.command,
          args: ps.entry.args,
          url: ps.entry.url,
          env: ps.entry.env,
          enabled: !disabled.has(fullName),
          source: 'plugin' as const,
        } as any);
      }

      return items;
    } catch (err: any) {
      return { error: err.message || 'Failed to read MCP config' };
    }
  });

  ipcMain.handle('mcp:add', async (_event, config: {
    name: string;
    transport: string;
    command?: string;
    args?: string[];
    url?: string;
    env?: Record<string, string>;
  }) => {
    try {
      const file = readClaudeConfig();
      if (!file.mcpServers) file.mcpServers = {};

      const entry: McpConfigEntry = {};
      if (config.transport === 'stdio') {
        entry.command = config.command;
        if (config.args?.length) entry.args = config.args;
      } else {
        entry.url = config.url;
        entry.type = config.transport === 'sse' ? 'sse' : 'http';
      }
      if (config.env && Object.keys(config.env).length > 0) {
        entry.env = config.env;
      }

      file.mcpServers[config.name] = entry;
      writeClaudeConfig(file);
      return { success: true };
    } catch (err: any) {
      return { error: err.message || 'Failed to add MCP server' };
    }
  });

  ipcMain.handle('mcp:remove', async (_event, name: string) => {
    try {
      if (name.startsWith('plugin:')) {
        return { error: 'Plugin-provided MCP servers must be removed via the plugin itself' };
      }
      const file = readClaudeConfig();
      if (file.mcpServers) {
        delete file.mcpServers[name];
        writeClaudeConfig(file);
      }
      return { success: true };
    } catch (err: any) {
      return { error: err.message || 'Failed to remove MCP server' };
    }
  });

  ipcMain.handle('mcp:update', async (_event, name: string, updates: Partial<McpConfigEntry & { disabled?: boolean }>) => {
    try {
      const file = readClaudeConfig();

      if (typeof updates.disabled === 'boolean') {
        setDisabled(file, name, updates.disabled);
      }

      if (!name.startsWith('plugin:')) {
        if (!file.mcpServers) file.mcpServers = {};
        if (!file.mcpServers[name]) {
          if (updates.disabled === undefined) {
            return { error: `Server "${name}" not found` };
          }
        } else {
          const { disabled: _omit, ...rest } = updates;
          Object.assign(file.mcpServers[name], rest);
        }
      }

      writeClaudeConfig(file);
      return { success: true };
    } catch (err: any) {
      return { error: err.message || 'Failed to update MCP server' };
    }
  });

  ipcMain.handle('mcp:registryList', async () => {
    try {
      const allServers: any[] = [];
      let cursor: string | undefined;
      const limit = 100;
      const maxPages = 10;

      for (let page = 0; page < maxPages; page++) {
        const url = cursor
          ? `https://registry.modelcontextprotocol.io/v0/servers?limit=${limit}&cursor=${encodeURIComponent(cursor)}`
          : `https://registry.modelcontextprotocol.io/v0/servers?limit=${limit}`;
        const res = await fetch(url);
        if (!res.ok) throw new Error(`Registry fetch error: ${res.status}`);
        const data = await res.json() as { servers: any[]; metadata?: { nextCursor?: string } };
        allServers.push(...data.servers);
        if (!data.metadata?.nextCursor) break;
        cursor = data.metadata.nextCursor;
      }

      const config = readClaudeConfig();
      const installed = new Set(Object.keys(config.mcpServers || {}));

      const seen = new Set<string>();
      const results: any[] = [];

      for (const s of allServers) {
        const repoUrl = s.server?.repository?.url || '';
        const name = s.server?.title || s.server?.name || '';
        const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
        if (!slug || seen.has(slug)) continue;
        seen.add(slug);

        const remotes = Array.isArray(s.server?.remotes) ? s.server.remotes : [];
        const packages = Array.isArray(s.server?.packages) ? s.server.packages : [];
        const icons = Array.isArray(s.server?.icons) ? s.server.icons : [];
        const iconUrl = icons.length > 0 ? (icons[0].src || '') : '';

        results.push({
          name: slug,
          title: name,
          description: s.server?.description || '',
          source: repoUrl,
          repositoryUrl: repoUrl,
          websiteUrl: s.server?.websiteUrl || '',
          iconUrl,
          transport: remotes.length > 0 ? 'streamable-http' as const : 'stdio' as const,
          version: s.server?.version || '',
          installed: installed.has(slug),
          packages,
          remotes,
        });
      }

      return results;
    } catch (err: any) {
      return { error: err.message || 'Failed to fetch MCP registry' };
    }
  });
}
