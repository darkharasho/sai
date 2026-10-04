/**
 * mcpConfig.ts — read/write Claude MCP server config files for the MCP sidebar.
 *   user    → ~/.claude.json `mcpServers`
 *   project → <projectPath>/.mcp.json `mcpServers`
 *   plugin  → <installPath>/.mcp.json of enabled plugins (read-only)
 * Disables mirror the CLI: user/plugin names in projects[home].disabledMcpServers,
 * project names in projects[projectPath].disabledMcpjsonServers.
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import { readPluginMcpFile, type InstalledPluginsFile, type PluginSettingsFile } from './claudeBackend/externalMcp';
import type { McpServer, McpServerConfig, McpSource } from '../../src/types';

export interface McpPaths { home: string; projectPath?: string }

interface McpConfigEntry {
  type?: string;
  command?: string;
  args?: string[];
  url?: string;
  env?: Record<string, string>;
  headers?: Record<string, string>;
  disabled?: boolean;
  [k: string]: unknown;
}
interface ProjectEntry { disabledMcpServers?: string[]; disabledMcpjsonServers?: string[]; [k: string]: unknown }
interface ClaudeConfig { mcpServers?: Record<string, McpConfigEntry>; projects?: Record<string, ProjectEntry>; [k: string]: unknown }

const PROJECT_DISABLE_KEY = 'disabledMcpjsonServers';
const claudeJson = (p: McpPaths) => path.join(p.home, '.claude.json');
const projectJson = (p: McpPaths) => {
  if (!p.projectPath) throw new Error('No project open');
  return path.join(p.projectPath, '.mcp.json');
};

function readJson<T>(file: string, fallback: T): T {
  try {
    if (fs.existsSync(file)) {
      const parsed = JSON.parse(fs.readFileSync(file, 'utf-8'));
      if (parsed && typeof parsed === 'object') return parsed as T;
    }
  } catch { /* missing or malformed → fallback */ }
  return fallback;
}
const writeJson = (file: string, data: unknown) => fs.writeFileSync(file, JSON.stringify(data, null, 2), 'utf-8');

/** `.mcp.json` may be `{ mcpServers: {...} }` or a bare server map. */
function serverMap(data: Record<string, unknown>): Record<string, McpConfigEntry> {
  const raw = data.mcpServers && typeof data.mcpServers === 'object' ? data.mcpServers : data;
  const out: Record<string, McpConfigEntry> = {};
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    if (v && typeof v === 'object' && !Array.isArray(v)) out[k] = v as McpConfigEntry;
  }
  return out;
}

export function detectTransport(entry: McpConfigEntry): McpServer['transport'] {
  if (entry.type === 'sse') return 'sse';
  if (entry.type === 'http' || entry.type === 'streamable-http') return 'streamable-http';
  if (entry.url) return entry.url.includes('/sse') ? 'sse' : 'streamable-http';
  return 'stdio';
}

function disabledSet(cfg: ClaudeConfig, scopeDir: string | undefined, key: 'disabledMcpServers' | typeof PROJECT_DISABLE_KEY): Set<string> {
  const list = scopeDir ? cfg.projects?.[scopeDir]?.[key] : undefined;
  return new Set(Array.isArray(list) ? list : []);
}

function toServer(name: string, entry: McpConfigEntry, source: McpSource, enabled: boolean): McpServer {
  return {
    name,
    transport: detectTransport(entry),
    command: entry.command,
    args: entry.args,
    url: entry.url,
    env: entry.env,
    headers: entry.headers,
    enabled,
    source,
  };
}

function listPluginServers(home: string): Array<{ pluginShort: string; serverName: string; entry: McpConfigEntry }> {
  const installed = readJson<InstalledPluginsFile>(path.join(home, '.claude', 'plugins', 'installed_plugins.json'), {});
  const settings = readJson<PluginSettingsFile>(path.join(home, '.claude', 'settings.json'), {});
  const enabled = settings.enabledPlugins ?? {};
  const out: Array<{ pluginShort: string; serverName: string; entry: McpConfigEntry }> = [];
  for (const [pluginKey, entries] of Object.entries(installed.plugins ?? {})) {
    if (enabled[pluginKey] === false) continue;
    const pluginShort = pluginKey.split('@')[0];
    for (const inst of entries ?? []) {
      if (!inst?.installPath) continue;
      for (const [serverName, entry] of Object.entries(readPluginMcpFile(inst.installPath))) {
        out.push({ pluginShort, serverName, entry: entry as McpConfigEntry });
      }
    }
  }
  return out;
}

export function listMcpServers(paths: McpPaths): McpServer[] {
  const cfg = readJson<ClaudeConfig>(claudeJson(paths), {});
  const homeDisabled = disabledSet(cfg, paths.home, 'disabledMcpServers');
  const items: McpServer[] = [];
  for (const [name, entry] of Object.entries(serverMap({ mcpServers: cfg.mcpServers ?? {} }))) {
    items.push(toServer(name, entry, 'user', !homeDisabled.has(name) && !entry.disabled));
  }
  if (paths.projectPath) {
    const projDisabled = disabledSet(cfg, paths.projectPath, PROJECT_DISABLE_KEY);
    const proj = serverMap(readJson<Record<string, unknown>>(projectJson(paths), {}));
    for (const [name, entry] of Object.entries(proj)) {
      items.push(toServer(name, entry, 'project', !projDisabled.has(name) && !entry.disabled));
    }
  }
  for (const ps of listPluginServers(paths.home)) {
    const full = `plugin:${ps.pluginShort}:${ps.serverName}`;
    items.push(toServer(full, ps.entry, 'plugin', !homeDisabled.has(full)));
  }
  return items;
}

const TRANSPORT_KEYS = ['type', 'url', 'headers', 'command', 'args', 'env'] as const;

export function upsertMcpServer(paths: McpPaths, config: McpServerConfig): void {
  const source = config.source ?? 'user';
  const file = source === 'project' ? projectJson(paths) : claudeJson(paths);
  const data = readJson<ClaudeConfig>(file, {});
  if (!data.mcpServers || typeof data.mcpServers !== 'object') data.mcpServers = {};
  const entry: McpConfigEntry = { ...(data.mcpServers[config.name] ?? {}) };
  for (const k of TRANSPORT_KEYS) delete entry[k];
  if (config.transport === 'stdio') {
    entry.command = config.command;
    if (config.args?.length) entry.args = config.args;
  } else {
    entry.type = config.transport === 'sse' ? 'sse' : 'http';
    entry.url = config.url;
    if (config.headers && Object.keys(config.headers).length) entry.headers = config.headers;
  }
  if (config.env && Object.keys(config.env).length) entry.env = config.env;
  data.mcpServers[config.name] = entry;
  writeJson(file, data);
}

export function removeMcpServer(paths: McpPaths, name: string, source: 'user' | 'project'): void {
  const file = source === 'project' ? projectJson(paths) : claudeJson(paths);
  const data = readJson<ClaudeConfig>(file, {});
  if (data.mcpServers?.[name]) {
    delete data.mcpServers[name];
    writeJson(file, data);
  }
}

export function setMcpServerDisabled(paths: McpPaths, name: string, source: McpSource, disabled: boolean): void {
  if (source === 'claudeai') throw new Error('claude.ai connectors are managed on claude.ai');
  const cfg = readJson<ClaudeConfig>(claudeJson(paths), {});
  const scopeDir = source === 'project' ? paths.projectPath : paths.home;
  if (!scopeDir) throw new Error('No project open');
  const key = source === 'project' ? PROJECT_DISABLE_KEY : 'disabledMcpServers';
  cfg.projects ??= {};
  cfg.projects[scopeDir] ??= {};
  const set = disabledSet(cfg, scopeDir, key);
  if (disabled) set.add(name); else set.delete(name);
  cfg.projects[scopeDir][key] = Array.from(set);
  writeJson(claudeJson(paths), cfg);
}
