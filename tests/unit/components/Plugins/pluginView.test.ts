import { describe, it, expect } from 'vitest';
import { groupByMarketplace, matchesQuery, pluginSubtitle, registryCategories, scopeLabel } from '../../../../src/components/Plugins/pluginView';
import type { Plugin, PluginInventory } from '../../../../src/types';

const empty: PluginInventory = { skills: [], commands: [], agents: [], hooks: [], mcpServers: [], lspServers: [] };
const items = (n: number) => Array.from({ length: n }, (_, i) => ({ name: `i${i}` }));

function plugin(over: Partial<Plugin>): Plugin {
  return {
    id: 'x@m', name: 'x', marketplace: 'm', description: 'Desc', version: '1.0.0', enabled: true,
    scopes: ['user'], activeScope: 'user', installPath: '/p', inventory: empty, updateAvailable: false, ...over,
  };
}

describe('pluginSubtitle', () => {
  it('summarizes contents with pluralization and a dotted version', () => {
    expect(pluginSubtitle(plugin({ version: '6.4.1', inventory: { ...empty, skills: items(14), hooks: items(1), mcpServers: items(2) } })))
      .toBe('14 skills · 1 hook · 2 MCP · v6.4.1');
  });
  it('hides git-sha versions and falls back to the description', () => {
    expect(pluginSubtitle(plugin({ version: 'd182ca456ca0' }))).toBe('Desc');
    expect(pluginSubtitle(plugin({ version: 'd182ca456ca0', inventory: { ...empty, commands: items(1) } }))).toBe('1 cmd');
  });
  it('says disabled for disabled plugins', () => {
    expect(pluginSubtitle(plugin({ enabled: false, inventory: { ...empty, skills: items(3) } }))).toBe('disabled');
  });
});

describe('groupByMarketplace', () => {
  it('orders groups by size then name, rows alphabetically', () => {
    const g = groupByMarketplace([
      { marketplace: 'b', name: 'z' }, { marketplace: 'a', name: 'q' }, { marketplace: 'c', name: 'y' }, { marketplace: 'c', name: 'b' },
    ]);
    expect(g.map(x => [x.id, x.rows.map(r => r.name)])).toEqual([['c', ['b', 'y']], ['a', ['q']], ['b', ['z']]]);
  });
});

describe('helpers', () => {
  it('matches name or description case-insensitively', () => {
    expect(matchesQuery({ name: 'GitHub', description: '' }, 'git')).toBe(true);
    expect(matchesQuery({ name: 'x', description: 'Browser automation' }, 'BROWSER')).toBe(true);
    expect(matchesQuery({ name: 'x', description: 'y' }, 'z')).toBe(false);
  });
  it('ranks categories by frequency', () => {
    const reg = ['dev', 'prod', 'dev', undefined].map((category, i) => ({ id: `${i}`, name: `${i}`, marketplace: 'm', description: '', installed: false, category }));
    expect(registryCategories(reg)).toEqual(['dev', 'prod']);
  });
  it('labels project and local scopes as this project', () => {
    expect(scopeLabel(plugin({ scopes: ['local', 'project', 'user'] }))).toBe('this project + user');
  });
});
