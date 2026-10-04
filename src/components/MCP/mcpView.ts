import { Cloud, Folder, Puzzle, User } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import type { McpAuthState, McpLiveServer, McpServer, McpSource } from '../../types';

export type McpGroupId = 'attention' | 'user' | 'project' | 'plugin' | 'claudeai';
export type McpDot = 'ok' | 'pending' | 'bad' | 'off' | 'unknown';

export interface McpRow {
  key: string;
  name: string;
  controlName: string;
  displayName: string;
  source: McpSource;
  pluginShort?: string;
  server?: McpServer;
  live?: McpLiveServer;
  auth?: McpAuthState;
  transport: McpServer['transport'] | 'unknown';
  subtitle: string;
  dot: McpDot;
  fix?: 'sign-in' | 'retry';
  enabled: boolean;
  editable: boolean;
  removable: boolean;
}

/** SAI's own in-process servers — not user-manageable. */
export const HIDDEN_LIVE_NAMES: ReadonlySet<string> = new Set(['sai', 'swarm']);
const PLUGIN_RE = /^plugin:([^:]+):(.+)$/;

/** Shared by the list, detail and nudge components. */
export const MCP_SOURCE_ICON: Record<McpSource, LucideIcon> = { user: User, project: Folder, plugin: Puzzle, claudeai: Cloud };
export const MCP_TERMINAL_HINT = 'Manage this server from a terminal with `claude mcp`.';

/** Plugin servers show their bare name (`plugin:<short>:<name>` -> `<name>`). */
export function mcpDisplayName(name: string): string {
  const m = PLUGIN_RE.exec(name);
  return m ? m[2] : name;
}

const TRANSPORT_LABEL: Record<string, string> = { stdio: 'stdio', sse: 'sse', 'streamable-http': 'http', unknown: 'remote' };

/** Exact name first. A plugin server not reported under its full
 *  `plugin:<short>:<name>` may fall back to its bare name — but never to an
 *  entry in `claimed` (another config server's exact match). */
export function liveFor(
  name: string,
  live: Record<string, McpLiveServer>,
  claimed: ReadonlySet<string> = new Set(),
): McpLiveServer | undefined {
  if (live[name]) return live[name];
  const m = PLUGIN_RE.exec(name);
  return m && !claimed.has(m[2]) ? live[m[2]] : undefined;
}

function transportOfLive(l: McpLiveServer): McpRow['transport'] {
  const t = l.config?.type;
  if (t === 'stdio') return 'stdio';
  if (t === 'sse') return 'sse';
  if (t === 'http') return 'streamable-http';
  return 'unknown';
}

function sourceOfLive(l: McpLiveServer): McpSource {
  if (l.scope === 'claudeai') return 'claudeai';
  // `local` = ~/.claude.json projects[cwd].mcpServers: private to this
  // project, so it belongs with the project's servers.
  if (l.scope === 'project' || l.scope === 'local') return 'project';
  if (PLUGIN_RE.test(l.name)) return 'plugin';
  return 'user';
}

function finish(input: Omit<McpRow, 'subtitle' | 'dot' | 'fix'>): McpRow {
  // A connected server is signed in: a leftover auth entry is stale.
  const base = input.live?.status === 'connected' ? { ...input, auth: undefined } : input;
  const { live, auth, enabled, transport, source, pluginShort, displayName } = base;
  // Repeating the title (`playwright` over `playwright · …`) says nothing.
  const prefix = source === 'plugin' && pluginShort ? (pluginShort === displayName ? 'plugin' : pluginShort)
    : source === 'claudeai' ? 'connector'
    : TRANSPORT_LABEL[transport];
  const tools = live?.tools?.length;
  const remote = transport !== 'stdio';

  if (!enabled || live?.status === 'disabled') return { ...base, subtitle: `${prefix} · disabled`, dot: 'off' };
  if (auth?.phase === 'waiting') return { ...base, subtitle: 'Waiting for browser sign-in…', dot: 'pending' };
  switch (live?.status) {
    case 'connected':
      return { ...base, subtitle: tools !== undefined ? `${prefix} · ${tools} tools` : prefix, dot: 'ok' };
    case 'pending':
      return { ...base, subtitle: `${prefix} · connecting…`, dot: 'pending' };
    case 'needs-auth':
      return { ...base, subtitle: 'Needs sign-in', dot: 'bad', ...(remote ? { fix: 'sign-in' as const } : {}) };
    case 'failed':
      return { ...base, subtitle: live.error || 'Failed to connect', dot: 'bad', fix: 'retry' };
    default:
      return { ...base, subtitle: prefix, dot: 'unknown' };
  }
}

export function buildMcpRows(
  config: McpServer[],
  live: Record<string, McpLiveServer>,
  auth: Record<string, McpAuthState>,
): McpRow[] {
  const rows: McpRow[] = [];
  // Exact matches claim their live entries first, so a fallback can't take one.
  const claimed = new Set<string>(config.filter((s) => live[s.name]).map((s) => s.name));

  for (const server of config) {
    const source = server.source ?? 'user';
    const l = liveFor(server.name, live, claimed);
    if (l) claimed.add(l.name);
    const m = PLUGIN_RE.exec(server.name);
    const controlName = l?.name ?? server.name;
    rows.push(finish({
      key: `${source}:${server.name}`,
      name: server.name,
      controlName,
      displayName: mcpDisplayName(server.name),
      source,
      pluginShort: m?.[1],
      server,
      live: l,
      auth: auth[controlName] ?? auth[server.name],
      transport: server.transport,
      enabled: server.enabled,
      editable: source === 'user' || source === 'project',
      removable: source === 'user' || source === 'project',
    }));
  }

  for (const l of Object.values(live)) {
    if (claimed.has(l.name) || HIDDEN_LIVE_NAMES.has(l.name)) continue;
    const source = sourceOfLive(l);
    const m = PLUGIN_RE.exec(l.name);
    rows.push(finish({
      key: `${source}:${l.name}`,
      name: l.name,
      controlName: l.name,
      displayName: mcpDisplayName(l.name),
      source,
      pluginShort: m?.[1],
      live: l,
      auth: auth[l.name],
      transport: transportOfLive(l),
      enabled: true,
      editable: false,
      removable: false,
    }));
  }
  return rows;
}

export function needsAttention(row: McpRow): boolean {
  if (!row.enabled) return false;
  return row.live?.status === 'needs-auth' || row.live?.status === 'failed' || row.auth?.phase === 'timeout' || row.auth?.phase === 'error';
}

const GROUPS: Array<{ id: Exclude<McpGroupId, 'attention'>; label: string; hint?: string }> = [
  { id: 'user', label: 'Global', hint: '~/.claude.json' },
  { id: 'project', label: 'Project', hint: '.mcp.json' },
  { id: 'plugin', label: 'Plugins' },
  { id: 'claudeai', label: 'claude.ai', hint: 'read-only' },
];

export function groupMcpRows(rows: McpRow[]): Array<{ id: McpGroupId; label: string; hint?: string; rows: McpRow[] }> {
  const attention = rows.filter(needsAttention);
  const rest = rows.filter((r) => !needsAttention(r));
  const out: Array<{ id: McpGroupId; label: string; hint?: string; rows: McpRow[] }> = [];
  if (attention.length) out.push({ id: 'attention', label: 'Needs attention', rows: attention });
  for (const g of GROUPS) {
    const members = rest.filter((r) => r.source === g.id);
    if (members.length) out.push({ ...g, hint: g.id === 'plugin' ? String(members.length) : g.hint, rows: members });
  }
  return out;
}
