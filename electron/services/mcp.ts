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
      const res = await fetch('https://raw.githubusercontent.com/modelcontextprotocol/servers/main/README.md');
      if (!res.ok) throw new Error(`Registry fetch error: ${res.status}`);
      const text = await res.text();

      const servers: { name: string; description: string; source: string; transport: 'stdio'; installed: boolean }[] = [];
      const linkRegex = /\[([^\]]+)\]\(([^)]+)\)\s*[-–—]\s*(.+)/g;
      let match;
      while ((match = linkRegex.exec(text)) !== null) {
        servers.push({
          name: match[1].trim().toLowerCase().replace(/\s+/g, '-'),
          description: match[3].trim(),
          source: match[2].trim(),
          transport: 'stdio',
          installed: false,
        });
      }

      const config = readConfig();
      const installed = new Set(Object.keys(config.mcpServers || {}));
      for (const s of servers) {
        s.installed = installed.has(s.name);
      }

      return servers;
    } catch (err: any) {
      return { error: err.message || 'Failed to fetch MCP registry' };
    }
  });
}
