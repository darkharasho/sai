import { ipcMain } from 'electron';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';

interface McpConfigEntry {
  command?: string;
  args?: string[];
  url?: string;
  env?: Record<string, string>;
  disabled?: boolean;
}

interface McpConfigFile {
  mcpServers?: Record<string, McpConfigEntry>;
}

function getConfigPath(): string {
  return path.join(os.homedir(), '.claude', 'mcp.json');
}

function readConfig(): McpConfigFile {
  const configPath = getConfigPath();
  try {
    if (fs.existsSync(configPath)) {
      return JSON.parse(fs.readFileSync(configPath, 'utf-8'));
    }
  } catch { /* return empty */ }
  return { mcpServers: {} };
}

function writeConfig(config: McpConfigFile): void {
  const configPath = getConfigPath();
  const dir = path.dirname(configPath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  fs.writeFileSync(configPath, JSON.stringify(config, null, 2), 'utf-8');
}

function detectTransport(entry: McpConfigEntry): 'stdio' | 'sse' | 'streamable-http' {
  if (entry.url) {
    return entry.url.includes('/sse') ? 'sse' : 'streamable-http';
  }
  return 'stdio';
}

export function registerMcpHandlers() {
  ipcMain.handle('mcp:list', async () => {
    try {
      const config = readConfig();
      const servers = config.mcpServers || {};
      return Object.entries(servers).map(([name, entry]) => ({
        name,
        transport: detectTransport(entry),
        command: entry.command,
        args: entry.args,
        url: entry.url,
        env: entry.env,
        enabled: !entry.disabled,
      }));
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
      const file = readConfig();
      if (!file.mcpServers) file.mcpServers = {};

      const entry: McpConfigEntry = {};
      if (config.transport === 'stdio') {
        entry.command = config.command;
        if (config.args?.length) entry.args = config.args;
      } else {
        entry.url = config.url;
      }
      if (config.env && Object.keys(config.env).length > 0) {
        entry.env = config.env;
      }

      file.mcpServers[config.name] = entry;
      writeConfig(file);
      return { success: true };
    } catch (err: any) {
      return { error: err.message || 'Failed to add MCP server' };
    }
  });

  ipcMain.handle('mcp:remove', async (_event, name: string) => {
    try {
      const file = readConfig();
      if (file.mcpServers) {
        delete file.mcpServers[name];
        writeConfig(file);
      }
      return { success: true };
    } catch (err: any) {
      return { error: err.message || 'Failed to remove MCP server' };
    }
  });

  ipcMain.handle('mcp:update', async (_event, name: string, updates: Partial<McpConfigEntry & { disabled?: boolean }>) => {
    try {
      const file = readConfig();
      if (!file.mcpServers?.[name]) {
        return { error: `Server "${name}" not found` };
      }
      Object.assign(file.mcpServers[name], updates);
      writeConfig(file);
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

      const config = readConfig();
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
