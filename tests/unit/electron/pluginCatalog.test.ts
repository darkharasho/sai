import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import {
  frontmatterDescription, isNewerVersion, mergeInstalled, readInventory, readMarketplaces,
  registryInventory, registryPlugins, type CliPlugin, type Marketplace,
} from '../../../electron/services/pluginCatalog';

let tmp: string;

function write(rel: string, content: string | object) {
  const file = path.join(tmp, rel);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, typeof content === 'string' ? content : JSON.stringify(content));
}

beforeEach(() => { tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'plugincat-')); });
afterEach(() => { fs.rmSync(tmp, { recursive: true, force: true }); });

describe('frontmatterDescription', () => {
  it('reads plain, quoted and folded descriptions', () => {
    expect(frontmatterDescription('---\nname: x\ndescription: Does a thing\n---\nbody')).toBe('Does a thing');
    expect(frontmatterDescription('---\ndescription: "Quoted: yes"\n---')).toBe('Quoted: yes');
    expect(frontmatterDescription('---\ndescription: >\n  line one\n  line two\nother: 1\n---')).toBe('line one line two');
    expect(frontmatterDescription('# no frontmatter')).toBeUndefined();
  });
});

describe('isNewerVersion', () => {
  it('compares dotted versions and never flags non-semver', () => {
    expect(isNewerVersion('6.5.0', '6.4.1')).toBe(true);
    expect(isNewerVersion('1.10.0', '1.9.0')).toBe(true);
    expect(isNewerVersion('1.0.0', '1.0.0')).toBe(false);
    expect(isNewerVersion('1.0', '1.0.1')).toBe(false);
    expect(isNewerVersion('2.0.0', 'd182ca456ca0')).toBe(false);
    expect(isNewerVersion(undefined, '1.0.0')).toBe(false);
  });
});

describe('readInventory', () => {
  it('reads default component dirs', () => {
    write('p/skills/tdd/SKILL.md', '---\ndescription: Test first\n---');
    write('p/skills/not-a-skill/README.md', 'x');
    write('p/commands/setup.md', '---\ndescription: Set up\n---');
    write('p/commands/git/push.md', 'no fm');
    write('p/agents/reviewer.md', '---\ndescription: Reviews\n---');
    write('p/hooks/hooks.json', { hooks: { SessionStart: [{ hooks: [{ type: 'command', command: '"${CLAUDE_PLUGIN_ROOT}/hooks/run" start' }] }] } });
    write('p/.mcp.json', { mcpServers: { gh: { url: 'https://api.example/mcp' } } });
    const inv = readInventory(path.join(tmp, 'p'), {});
    expect(inv.skills).toEqual([{ name: 'tdd', description: 'Test first' }]);
    expect(inv.commands.map(c => c.name).sort()).toEqual(['git:push', 'setup']);
    expect(inv.agents).toEqual([{ name: 'reviewer', description: 'Reviews' }]);
    expect(inv.hooks).toEqual([{ name: 'SessionStart', description: 'hooks/run start' }]);
    expect(inv.mcpServers).toEqual([{ name: 'gh', description: 'https://api.example/mcp' }]);
  });

  it('honors manifest paths and inline component objects', () => {
    write('p/extra/one/SKILL.md', '---\ndescription: One\n---');
    write('p/cmds/go.md', '');
    const inv = readInventory(path.join(tmp, 'p'), {
      skills: ['./extra/one'],
      commands: './cmds',
      lspServers: { ts: { command: 'typescript-language-server', args: ['--stdio'] } },
      hooks: { Stop: [{ hooks: [{ type: 'command', command: 'x' }] }] },
    });
    expect(inv.skills.map(s => s.name)).toEqual(['one']);
    expect(inv.commands.map(c => c.name)).toEqual(['go']);
    expect(inv.lspServers).toEqual([{ name: 'ts', description: 'typescript-language-server --stdio' }]);
    expect(inv.hooks.map(h => h.name)).toEqual(['Stop']);
  });

  it('prefers the CLI-reported MCP servers', () => {
    write('p/.mcp.json', { mcpServers: { stale: { command: 'old' } } });
    const inv = readInventory(path.join(tmp, 'p'), {}, { live: { command: 'npx', args: ['srv'] } });
    expect(inv.mcpServers).toEqual([{ name: 'live', description: 'npx srv' }]);
  });
});

function setupMarketplace(): Marketplace[] {
  write('mk/.claude-plugin/marketplace.json', {
    plugins: [
      { name: 'alpha', description: 'Alpha from market', category: 'development', source: './plugins/alpha', author: { name: 'Ann' } },
      { name: 'lsp', description: 'An LSP', version: '1.0.0', source: './plugins/lsp', strict: false, lspServers: { ts: { command: 'tsls' } } },
      { name: 'remote', description: 'Remote', source: { source: 'url', url: 'https://x' } },
    ],
  });
  write('mk/plugins/alpha/.claude-plugin/plugin.json', { name: 'alpha', version: '2.0.0' });
  write('mk/plugins/alpha/commands/hi.md', '');
  write('known.json', { mk: { installLocation: path.join(tmp, 'mk') }, broken: { installLocation: path.join(tmp, 'nope') } });
  return readMarketplaces(path.join(tmp, 'known.json'));
}

function cli(over: Partial<CliPlugin>): CliPlugin {
  return { id: 'alpha@mk', version: '1.0.0', scope: 'user', enabled: true, installPath: path.join(tmp, 'cache/alpha'), ...over };
}

describe('mergeInstalled', () => {
  it('collapses scopes into one row and lets the most specific applicable scope win', () => {
    const markets = setupMarketplace();
    write('proj/.keep', '');
    const proj = path.join(tmp, 'proj');
    const rows = mergeInstalled([
      cli({ scope: 'user', enabled: true, installedAt: '2026-01-02' }),
      cli({ scope: 'project', enabled: false, projectPath: proj, installedAt: '2026-01-01' }),
      cli({ scope: 'project', enabled: true, projectPath: path.join(tmp, 'elsewhere') }),
    ], proj, markets);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      id: 'alpha@mk', name: 'alpha', marketplace: 'mk', enabled: false,
      scopes: ['project', 'user'], activeScope: 'project', installedAt: '2026-01-01',
      description: 'Alpha from market', author: 'Ann',
      latestVersion: '2.0.0', updateAvailable: true,
    });
  });

  it('matches the project through symlinks', () => {
    const markets = setupMarketplace();
    fs.mkdirSync(path.join(tmp, 'real'));
    fs.symlinkSync(path.join(tmp, 'real'), path.join(tmp, 'link'));
    const rows = mergeInstalled([cli({ scope: 'local', projectPath: path.join(tmp, 'real') })], path.join(tmp, 'link'), markets);
    expect(rows[0].scopes).toEqual(['local']);
  });

  it('hides plugins installed only for another project', () => {
    const markets = setupMarketplace();
    expect(mergeInstalled([cli({ scope: 'project', projectPath: '/other' })], tmp, markets)).toEqual([]);
    expect(mergeInstalled([cli({ scope: 'project', projectPath: '/other' })], undefined, markets)).toEqual([]);
  });

  it('reads non-strict components from the marketplace entry when there is no plugin.json', () => {
    const markets = setupMarketplace();
    const [row] = mergeInstalled([cli({ id: 'lsp@mk', installPath: path.join(tmp, 'cache/lsp') })], undefined, markets);
    expect(row.description).toBe('An LSP');
    expect(row.inventory.lspServers).toEqual([{ name: 'ts', description: 'tsls' }]);
    expect(row.updateAvailable).toBe(false);
  });
});

describe('registry', () => {
  it('lists every marketplace entry, marking installed ids', () => {
    const markets = setupMarketplace();
    expect(markets.map(m => m.name)).toEqual(['mk', 'broken']);
    const list = registryPlugins(markets, new Set(['alpha@mk']));
    expect(list.map(p => [p.id, p.installed, p.category])).toEqual([
      ['alpha@mk', true, 'development'], ['lsp@mk', false, undefined], ['remote@mk', false, undefined],
    ]);
  });

  it('reads inventory for local-source entries only', () => {
    const markets = setupMarketplace();
    expect(registryInventory(markets, 'mk', 'alpha')?.commands).toEqual([{ name: 'hi', description: undefined }]);
    expect(registryInventory(markets, 'mk', 'remote')).toBeNull();
    expect(registryInventory(markets, 'nope', 'alpha')).toBeNull();
  });
});
