import * as fs from 'node:fs';
import * as path from 'node:path';
import type {
  Plugin, PluginInventory, PluginItem, PluginScope, RegistryPlugin,
} from '../../src/types';

/** One entry of `claude plugins list --json` — one per (plugin, scope). */
export interface CliPlugin {
  id: string;
  version: string;
  scope: PluginScope;
  enabled: boolean;
  installPath: string;
  installedAt?: string;
  lastUpdated?: string;
  projectPath?: string;
  mcpServers?: Record<string, any>;
}

export interface MarketplaceEntry {
  name: string;
  description?: string;
  version?: string;
  category?: string;
  author?: { name?: string } | string;
  homepage?: string;
  source?: string | Record<string, any>;
  strict?: boolean;
  [key: string]: any;
}

export interface Marketplace {
  name: string;
  installLocation: string;
  plugins: MarketplaceEntry[];
}

/** Most specific scope wins: it's the one whose enabled flag the CLI honors. */
const SCOPE_PRECEDENCE: PluginScope[] = ['managed', 'local', 'project', 'user'];

function readJson(file: string): any {
  try { return JSON.parse(fs.readFileSync(file, 'utf-8')); } catch { return null; }
}

function isDir(p: string): boolean {
  try { return fs.statSync(p).isDirectory(); } catch { return false; }
}

function sameDir(a: string, b: string): boolean {
  const real = (p: string) => { try { return fs.realpathSync(p); } catch { return path.resolve(p); } };
  return real(a) === real(b);
}

function asList(v: unknown): string[] {
  if (typeof v === 'string') return [v];
  return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [];
}

function authorName(a: MarketplaceEntry['author']): string | undefined {
  return typeof a === 'string' ? a : a?.name || undefined;
}

/** `description:` from a markdown file's YAML frontmatter (plain or `>`/`|` block). */
export function frontmatterDescription(text: string): string | undefined {
  const m = /^---\r?\n([\s\S]*?)\r?\n---/.exec(text);
  if (!m) return undefined;
  const lines = m[1].split(/\r?\n/);
  const i = lines.findIndex(l => /^description:/.test(l));
  if (i < 0) return undefined;
  let value = lines[i].replace(/^description:\s*/, '');
  if (/^[>|][-+]?$/.test(value)) {
    const block: string[] = [];
    for (const l of lines.slice(i + 1)) {
      if (!/^\s+/.test(l)) break;
      block.push(l.trim());
    }
    value = block.join(' ');
  }
  return value.replace(/^(['"])([\s\S]*)\1$/, '$2').trim() || undefined;
}

function mdItem(file: string, name: string): PluginItem {
  let description: string | undefined;
  try { description = frontmatterDescription(fs.readFileSync(file, 'utf-8')); } catch { /* unreadable */ }
  return { name, description };
}

/** Markdown files under a commands/agents dir; nested dirs namespace as `dir:name`. */
function mdItems(dir: string, prefix = '', depth = 0): PluginItem[] {
  if (depth > 3) return [];
  let entries: fs.Dirent[];
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return []; }
  const out: PluginItem[] = [];
  for (const e of entries) {
    if (e.name.startsWith('.')) continue;
    const full = path.join(dir, e.name);
    if (e.isDirectory()) out.push(...mdItems(full, `${prefix}${e.name}:`, depth + 1));
    else if (e.name.endsWith('.md')) out.push(mdItem(full, prefix + e.name.slice(0, -3)));
  }
  return out;
}

function mdPathItems(root: string, paths: string[]): PluginItem[] {
  return paths.flatMap(p => {
    const full = path.resolve(root, p);
    if (isDir(full)) return mdItems(full);
    return full.endsWith('.md') && fs.existsSync(full) ? [mdItem(full, path.basename(full, '.md'))] : [];
  });
}

function skillItems(root: string, paths: string[]): PluginItem[] {
  return paths.flatMap(p => {
    const full = path.resolve(root, p);
    const own = path.join(full, 'SKILL.md');
    if (fs.existsSync(own)) return [mdItem(own, path.basename(full))];
    let entries: fs.Dirent[];
    try { entries = fs.readdirSync(full, { withFileTypes: true }); } catch { return []; }
    return entries
      .filter(e => e.isDirectory() && !e.name.startsWith('.') && fs.existsSync(path.join(full, e.name, 'SKILL.md')))
      .map(e => mdItem(path.join(full, e.name, 'SKILL.md'), e.name));
  });
}

/** Inline object, or a path (relative to the plugin root) to a JSON file holding one. */
function objectOrFile(root: string, v: unknown, key?: string): Record<string, any> {
  if (typeof v === 'string') {
    const json = readJson(path.resolve(root, v));
    return (key && json?.[key]) || json || {};
  }
  return v && typeof v === 'object' && !Array.isArray(v) ? v as Record<string, any> : {};
}

function hookItems(hooks: Record<string, any>): PluginItem[] {
  return Object.entries(hooks).map(([event, groups]) => {
    const commands = (Array.isArray(groups) ? groups : [])
      .flatMap((g: any) => (Array.isArray(g?.hooks) ? g.hooks : []))
      .map((h: any) => (typeof h?.command === 'string'
        ? h.command.replace(/"?\$\{CLAUDE_PLUGIN_ROOT\}\/?/g, '').replace(/"/g, '')
        : h?.type))
      .filter(Boolean);
    return { name: event, description: commands.join(', ') || undefined };
  });
}

function serverItems(servers: Record<string, any>): PluginItem[] {
  return Object.entries(servers).map(([name, cfg]) => ({
    name,
    description: cfg?.url || [cfg?.command, ...(Array.isArray(cfg?.args) ? cfg.args : [])].filter(Boolean).join(' ') || undefined,
  }));
}

/**
 * Everything a plugin contributes, read from its directory. `manifest` is
 * plugin.json merged over the marketplace entry (non-strict plugins declare
 * components in the marketplace entry and ship no plugin.json at all).
 */
export function readInventory(root: string, manifest: Record<string, any>, cliMcp?: Record<string, any>): PluginInventory {
  const hooks = manifest.hooks !== undefined
    ? objectOrFile(root, manifest.hooks, 'hooks')
    : (readJson(path.join(root, 'hooks', 'hooks.json'))?.hooks ?? {});
  const mcp = cliMcp && Object.keys(cliMcp).length ? cliMcp
    : manifest.mcpServers !== undefined ? objectOrFile(root, manifest.mcpServers, 'mcpServers')
      : (() => { const j = readJson(path.join(root, '.mcp.json')); return j?.mcpServers ?? j ?? {}; })();
  const lsp = manifest.lspServers !== undefined
    ? objectOrFile(root, manifest.lspServers)
    : (readJson(path.join(root, '.lsp.json')) ?? {});
  return {
    skills: skillItems(root, ['skills', ...asList(manifest.skills)]),
    commands: mdPathItems(root, ['commands', ...asList(manifest.commands)]),
    agents: mdPathItems(root, ['agents', ...asList(manifest.agents)]),
    hooks: hookItems(hooks),
    mcpServers: serverItems(mcp),
    lspServers: serverItems(lsp),
  };
}

/** Dedupe by name — a manifest path can repeat a default dir. */
function dedupe(inv: PluginInventory): PluginInventory {
  const uniq = (items: PluginItem[]) => [...new Map(items.map(i => [i.name, i])).values()];
  return {
    skills: uniq(inv.skills), commands: uniq(inv.commands), agents: uniq(inv.agents),
    hooks: uniq(inv.hooks), mcpServers: uniq(inv.mcpServers), lspServers: uniq(inv.lspServers),
  };
}

export function readMarketplaces(knownFile: string): Marketplace[] {
  const known = readJson(knownFile);
  if (!known || typeof known !== 'object') return [];
  return Object.entries(known).flatMap(([name, info]: [string, any]) => {
    const loc = info?.installLocation;
    if (typeof loc !== 'string') return [];
    const json = readJson(path.join(loc, '.claude-plugin', 'marketplace.json'));
    const plugins = Array.isArray(json?.plugins) ? json.plugins.filter((p: any) => typeof p?.name === 'string') : [];
    return [{ name, installLocation: loc, plugins }];
  });
}

/** The plugin's own directory inside a marketplace clone, when its source is relative. */
function localSourceDir(m: Marketplace, entry: MarketplaceEntry): string | null {
  const src = typeof entry.source === 'string' ? entry.source
    : entry.source?.source === 'local' || entry.source?.source === 'relative' ? entry.source.path : null;
  if (typeof src !== 'string' || !src.startsWith('.')) return null;
  const dir = path.resolve(m.installLocation, src);
  return isDir(dir) ? dir : null;
}

/** Newest version the marketplace offers, if knowable offline. */
export function latestVersion(m: Marketplace, entry: MarketplaceEntry): string | undefined {
  if (entry.version) return entry.version;
  const dir = localSourceDir(m, entry);
  return (dir && readJson(path.join(dir, '.claude-plugin', 'plugin.json'))?.version) || undefined;
}

/** a > b for dotted numeric versions; anything non-semver (git shas) never compares newer. */
export function isNewerVersion(a: string | undefined, b: string | undefined): boolean {
  const parse = (v?: string) => (v && /^v?\d+(\.\d+)*$/.test(v.split(/[-+]/)[0]) ? v.replace(/^v/, '').split(/[-+]/)[0].split('.').map(Number) : null);
  const pa = parse(a); const pb = parse(b);
  if (!pa || !pb) return false;
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (d) return d > 0;
  }
  return false;
}

function splitId(id: string): [string, string] {
  const at = id.lastIndexOf('@');
  return at > 0 ? [id.slice(0, at), id.slice(at + 1)] : [id, ''];
}

/**
 * One row per plugin id, from the CLI's one-entry-per-scope list. Only scopes
 * that apply here count: user/managed always, project/local only for the
 * current project. The most specific applicable scope supplies the state.
 */
export function mergeInstalled(raw: CliPlugin[], projectPath: string | undefined, marketplaces: Marketplace[]): Plugin[] {
  const applies = (p: CliPlugin) => p.scope === 'user' || p.scope === 'managed'
    || (!!projectPath && !!p.projectPath && sameDir(p.projectPath, projectPath));
  const byId = new Map<string, CliPlugin[]>();
  for (const p of raw) {
    if (!p?.id || !applies(p)) continue;
    byId.set(p.id, [...(byId.get(p.id) ?? []), p]);
  }
  const markets = new Map(marketplaces.map(m => [m.name, m]));

  return [...byId.entries()].map(([id, entries]) => {
    entries.sort((a, b) => SCOPE_PRECEDENCE.indexOf(a.scope) - SCOPE_PRECEDENCE.indexOf(b.scope));
    const top = entries[0];
    const [name, marketplace] = splitId(id);
    const market = markets.get(marketplace);
    const entry = market?.plugins.find(p => p.name === name);
    const pluginJson = readJson(path.join(top.installPath, '.claude-plugin', 'plugin.json'));
    const manifest = { ...(entry ?? {}), ...(pluginJson ?? {}) };
    const latest = market && entry ? latestVersion(market, entry) : undefined;
    return {
      id,
      name,
      marketplace,
      description: pluginJson?.description || entry?.description || '',
      version: top.version,
      enabled: top.enabled,
      scopes: entries.map(e => e.scope),
      activeScope: top.scope,
      installPath: top.installPath,
      installedAt: entries.map(e => e.installedAt).filter(Boolean).sort()[0],
      lastUpdated: top.lastUpdated,
      author: authorName(manifest.author),
      homepage: manifest.homepage || (typeof manifest.repository === 'string' ? manifest.repository : undefined),
      inventory: dedupe(readInventory(top.installPath, manifest, top.mcpServers)),
      latestVersion: latest,
      updateAvailable: isNewerVersion(latest, top.version),
    };
  });
}

export function registryPlugins(marketplaces: Marketplace[], installedIds: Set<string>): RegistryPlugin[] {
  return marketplaces.flatMap(m => m.plugins.map(entry => {
    const id = `${entry.name}@${m.name}`;
    return {
      id,
      name: entry.name,
      marketplace: m.name,
      description: entry.description || '',
      version: entry.version,
      category: entry.category,
      author: authorName(entry.author),
      homepage: entry.homepage,
      installed: installedIds.has(id),
    };
  }));
}

/** Inventory of a not-yet-installed plugin, when its files are in the marketplace clone. */
export function registryInventory(marketplaces: Marketplace[], marketplace: string, name: string): PluginInventory | null {
  const m = marketplaces.find(x => x.name === marketplace);
  const entry = m?.plugins.find(p => p.name === name);
  if (!m || !entry) return null;
  const dir = localSourceDir(m, entry);
  if (!dir) return null;
  const pluginJson = readJson(path.join(dir, '.claude-plugin', 'plugin.json'));
  return dedupe(readInventory(dir, { ...entry, ...(pluginJson ?? {}) }));
}
