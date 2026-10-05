import type { Plugin, PluginInventory, RegistryPlugin } from '../../types';

export const INVENTORY_SECTIONS: { key: keyof PluginInventory; label: string; one: string; many: string }[] = [
  { key: 'skills', label: 'Skills', one: 'skill', many: 'skills' },
  { key: 'commands', label: 'Commands', one: 'cmd', many: 'cmds' },
  { key: 'agents', label: 'Agents', one: 'agent', many: 'agents' },
  { key: 'hooks', label: 'Hooks', one: 'hook', many: 'hooks' },
  { key: 'mcpServers', label: 'MCP servers', one: 'MCP', many: 'MCP' },
  { key: 'lspServers', label: 'LSP servers', one: 'LSP', many: 'LSP' },
];

/** "14 skills · 1 hook · v6.4.1" — git-sha versions are noise, so only dotted ones show. */
export function pluginSubtitle(p: Plugin): string {
  if (!p.enabled) return 'disabled';
  const parts = INVENTORY_SECTIONS
    .map(s => [s, p.inventory[s.key].length] as const)
    .filter(([, n]) => n > 0)
    .map(([s, n]) => `${n} ${n === 1 ? s.one : s.many}`);
  if (/^v?\d+(\.\d+)+/.test(p.version)) parts.push(`v${p.version.replace(/^v/, '')}`);
  return parts.join(' · ') || p.description;
}

export function matchesQuery(p: { name: string; description: string }, query: string): boolean {
  const q = query.trim().toLowerCase();
  return !q || p.name.toLowerCase().includes(q) || p.description.toLowerCase().includes(q);
}

export interface PluginGroup<T> { id: string; rows: T[] }

/** Group by marketplace, biggest first, rows alphabetical within a group. */
export function groupByMarketplace<T extends { marketplace: string; name: string }>(items: T[]): PluginGroup<T>[] {
  const groups = new Map<string, T[]>();
  for (const item of items) groups.set(item.marketplace, [...(groups.get(item.marketplace) ?? []), item]);
  return [...groups.entries()]
    .map(([id, rows]) => ({ id, rows: rows.sort((a, b) => a.name.localeCompare(b.name)) }))
    .sort((a, b) => b.rows.length - a.rows.length || a.id.localeCompare(b.id));
}

/** Categories present in the registry, most common first. */
export function registryCategories(registry: RegistryPlugin[], limit = 8): string[] {
  const counts = new Map<string, number>();
  for (const p of registry) if (p.category) counts.set(p.category, (counts.get(p.category) ?? 0) + 1);
  return [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).slice(0, limit).map(([c]) => c);
}

export function formatDate(iso?: string): string | undefined {
  if (!iso) return undefined;
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? undefined : d.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
}

export function scopeLabel(p: Plugin): string {
  const names = p.scopes.map(s => (s === 'project' || s === 'local' ? 'this project' : s));
  return [...new Set(names)].join(' + ');
}
