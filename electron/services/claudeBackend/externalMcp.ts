/**
 * externalMcp.ts — collect the user's external MCP surface for the SDK backend:
 *
 *   - user MCP servers from `~/.claude.json` (the same source the CLI path
 *     forwards via --mcp-config), minus the per-user disabled list stored at
 *     `projects[homedir].disabledMcpServers` (see services/mcp.ts)
 *   - installed + enabled plugins as SDK `plugins` entries, so plugin skills,
 *     agents, hooks, and MCP servers load natively in SDK sessions
 *
 * The collectors are pure (parsed file contents in, config out) so they can be
 * unit-tested; `loadExternalMcpForSdk()` does the fs reads using the same
 * paths/semantics as services/mcp.ts.
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import type { SdkPluginConfig } from '@anthropic-ai/claude-agent-sdk';

interface McpConfigEntry {
  type?: string;
  command?: string;
  args?: string[];
  url?: string;
  env?: Record<string, string>;
  headers?: Record<string, string>;
  disabled?: boolean;
}

export interface ClaudeJsonConfig {
  mcpServers?: Record<string, McpConfigEntry>;
  projects?: Record<string, { disabledMcpServers?: string[] }>;
}

export interface InstalledPluginsFile {
  plugins?: Record<string, Array<{ installPath: string }>>;
}

export interface PluginSettingsFile {
  enabledPlugins?: Record<string, boolean>;
}

export interface ExternalMcpForSdk {
  /** User + (partially-disabled) plugin servers, keyed by server name. */
  servers: Record<string, unknown>;
  /** Installed & enabled plugins for the SDK `plugins` option. */
  plugins: SdkPluginConfig[];
}

/**
 * Normalize a `.claude.json`-shape server entry into the SDK's programmatic
 * `mcpServers` shape: the SDK option accepts only `http` (not the JSON alias
 * `streamable-http`), and `disabled` is SAI bookkeeping, not an SDK field.
 */
function normalizeServerEntry(entry: McpConfigEntry): Record<string, unknown> {
  const { disabled: _omit, ...rest } = entry;
  if (rest.command) {
    const { type: _t, url: _u, headers: _h, ...stdio } = rest;
    return stdio;
  }
  if (rest.type === 'streamable-http') return { ...rest, type: 'http' };
  if (!rest.type && rest.url) {
    return { ...rest, type: rest.url.includes('/sse') ? 'sse' : 'http' };
  }
  return rest;
}

function disabledNames(config: ClaudeJsonConfig, disableScope: string): Set<string> {
  const list = config.projects?.[disableScope]?.disabledMcpServers;
  return new Set(Array.isArray(list) ? list : []);
}

/** User servers from ~/.claude.json, minus the disabled list, SDK-normalized. */
export function collectClaudeJsonServers(
  config: ClaudeJsonConfig,
  disableScope: string,
): Record<string, unknown> {
  const disabled = disabledNames(config, disableScope);
  const out: Record<string, unknown> = {};
  for (const [name, entry] of Object.entries(config.mcpServers ?? {})) {
    if (!entry || typeof entry !== 'object') continue;
    if (disabled.has(name) || entry.disabled) continue;
    out[name] = normalizeServerEntry(entry);
  }
  return out;
}

/**
 * Map installed + enabled plugins to SDK `plugins` entries.
 *
 * Per-server disable granularity (CLI stores `plugin:<short>:<server>` in the
 * disabled list) doesn't exist on the SDK `plugins` option, so when any of a
 * plugin's servers is disabled we set `skipMcpDiscovery` (skills/agents/hooks
 * still load) and hand the *enabled* subset back as plain `mcpServers` entries
 * keyed `<pluginShort>-<serverName>`.
 */
export function collectPluginSdkConfigs(
  installed: InstalledPluginsFile,
  settings: PluginSettingsFile,
  config: ClaudeJsonConfig,
  disableScope: string,
  readPluginMcpServers: (installPath: string) => Record<string, McpConfigEntry>,
): { plugins: SdkPluginConfig[]; servers: Record<string, unknown> } {
  const disabled = disabledNames(config, disableScope);
  const enabledPlugins = settings.enabledPlugins ?? {};
  const plugins: SdkPluginConfig[] = [];
  const servers: Record<string, unknown> = {};
  const seenPaths = new Set<string>();

  for (const [pluginKey, entries] of Object.entries(installed.plugins ?? {})) {
    if (enabledPlugins[pluginKey] === false) continue;
    const pluginShort = pluginKey.split('@')[0];
    for (const inst of entries ?? []) {
      if (!inst?.installPath || seenPaths.has(inst.installPath)) continue;
      seenPaths.add(inst.installPath);

      const pluginServers = readPluginMcpServers(inst.installPath);
      const names = Object.keys(pluginServers);
      const disabledHere = names.filter((n) => disabled.has(`plugin:${pluginShort}:${n}`));

      if (disabledHere.length === 0) {
        plugins.push({ type: 'local', path: inst.installPath });
        continue;
      }

      // Some servers disabled: SAI owns this plugin's MCP connections.
      plugins.push({ type: 'local', path: inst.installPath, skipMcpDiscovery: true });
      for (const name of names) {
        if (disabledHere.includes(name)) continue;
        servers[`${pluginShort}-${name}`] = normalizeServerEntry(pluginServers[name]);
      }
    }
  }
  return { plugins, servers };
}

// ─── fs-bound loader (paths mirror services/mcp.ts) ───────────────────────────

function readJson<T>(p: string, fallback: T): T {
  try {
    if (fs.existsSync(p)) return JSON.parse(fs.readFileSync(p, 'utf-8')) as T;
  } catch { /* ignore malformed/unreadable */ }
  return fallback;
}

function readPluginMcpFile(installPath: string): Record<string, McpConfigEntry> {
  const data = readJson<Record<string, unknown>>(path.join(installPath, '.mcp.json'), {});
  const servers = data.mcpServers && typeof data.mcpServers === 'object'
    ? (data.mcpServers as Record<string, McpConfigEntry>)
    : (data as Record<string, McpConfigEntry>);
  const out: Record<string, McpConfigEntry> = {};
  for (const [name, entry] of Object.entries(servers ?? {})) {
    if (entry && typeof entry === 'object') out[name] = entry;
  }
  return out;
}

/** Read the user's MCP servers + installed plugins for an SDK session. */
export function loadExternalMcpForSdk(homedir: string = os.homedir()): ExternalMcpForSdk {
  const config = readJson<ClaudeJsonConfig>(path.join(homedir, '.claude.json'), {});
  const settings = readJson<PluginSettingsFile>(path.join(homedir, '.claude', 'settings.json'), {});
  const installed = readJson<InstalledPluginsFile>(
    path.join(homedir, '.claude', 'plugins', 'installed_plugins.json'),
    {},
  );

  const servers = collectClaudeJsonServers(config, homedir);
  const fromPlugins = collectPluginSdkConfigs(installed, settings, config, homedir, readPluginMcpFile);
  return {
    servers: { ...servers, ...fromPlugins.servers },
    plugins: fromPlugins.plugins,
  };
}
