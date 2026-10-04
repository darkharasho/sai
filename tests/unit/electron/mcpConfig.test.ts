// tests/unit/electron/mcpConfig.test.ts
// @vitest-environment node
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import {
  listMcpServers, upsertMcpServer, removeMcpServer, setMcpServerDisabled,
} from '@electron/services/mcpConfig';

let home: string;
let proj: string;
const write = (p: string, data: unknown) => { fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, JSON.stringify(data)); };
const read = (p: string) => JSON.parse(fs.readFileSync(p, 'utf-8'));

beforeEach(() => {
  home = fs.mkdtempSync(path.join(os.tmpdir(), 'mcpcfg-home-'));
  proj = fs.mkdtempSync(path.join(os.tmpdir(), 'mcpcfg-proj-'));
});
afterEach(() => {
  fs.rmSync(home, { recursive: true, force: true });
  fs.rmSync(proj, { recursive: true, force: true });
});

describe('mcpConfig', () => {
  it('lists user, project and plugin servers with sources', () => {
    write(path.join(home, '.claude.json'), { mcpServers: { gh: { type: 'http', url: 'https://gh', headers: { Authorization: 'x' } } } });
    write(path.join(proj, '.mcp.json'), { mcpServers: { e2e: { command: 'node', args: ['s.js'] } } });
    const pluginDir = path.join(home, 'plug');
    write(path.join(pluginDir, '.mcp.json'), { cf: { type: 'http', url: 'https://cf' } });
    write(path.join(home, '.claude', 'plugins', 'installed_plugins.json'), { plugins: { 'cloudflare@mk': [{ installPath: pluginDir }] } });

    const list = listMcpServers({ home, projectPath: proj });
    expect(list.map((s) => [s.name, s.source, s.transport])).toEqual([
      ['gh', 'user', 'streamable-http'],
      ['e2e', 'project', 'stdio'],
      ['plugin:cloudflare:cf', 'plugin', 'streamable-http'],
    ]);
    expect(list[0].headers).toEqual({ Authorization: 'x' });
  });

  it('survives missing and malformed files', () => {
    fs.writeFileSync(path.join(home, '.claude.json'), '{not json');
    expect(listMcpServers({ home, projectPath: proj })).toEqual([]);
    expect(listMcpServers({ home })).toEqual([]);
  });

  it('upsert creates in the chosen file and merges on edit, keeping unknown keys', () => {
    write(path.join(home, '.claude.json'), { other: 1, mcpServers: { gh: { type: 'http', url: 'https://old', timeout: 5 } } });
    upsertMcpServer({ home }, { name: 'gh', transport: 'streamable-http', url: 'https://new', headers: { A: 'b' } });
    expect(read(path.join(home, '.claude.json'))).toEqual({
      other: 1,
      mcpServers: { gh: { type: 'http', url: 'https://new', timeout: 5, headers: { A: 'b' } } },
    });

    upsertMcpServer({ home, projectPath: proj }, { name: 'e2e', transport: 'stdio', command: 'node', args: ['a'], source: 'project' });
    expect(read(path.join(proj, '.mcp.json'))).toEqual({ mcpServers: { e2e: { command: 'node', args: ['a'] } } });
  });

  it('upsert switching http→stdio drops url/type/headers', () => {
    write(path.join(home, '.claude.json'), { mcpServers: { s: { type: 'http', url: 'https://x', headers: { A: 'b' } } } });
    upsertMcpServer({ home }, { name: 's', transport: 'stdio', command: 'run' });
    expect(read(path.join(home, '.claude.json')).mcpServers.s).toEqual({ command: 'run' });
  });

  it('remove deletes from the chosen file only', () => {
    write(path.join(home, '.claude.json'), { mcpServers: { a: { command: 'x' } } });
    write(path.join(proj, '.mcp.json'), { mcpServers: { a: { command: 'y' } } });
    removeMcpServer({ home, projectPath: proj }, 'a', 'project');
    expect(read(path.join(proj, '.mcp.json')).mcpServers).toEqual({});
    expect(read(path.join(home, '.claude.json')).mcpServers.a).toBeDefined();
  });

  it('disable: user/plugin → home disabledMcpServers; project → project disabledMcpjsonServers', () => {
    setMcpServerDisabled({ home, projectPath: proj }, 'gh', 'user', true);
    setMcpServerDisabled({ home, projectPath: proj }, 'e2e', 'project', true);
    const cfg = read(path.join(home, '.claude.json'));
    expect(cfg.projects[home].disabledMcpServers).toEqual(['gh']);
    expect(cfg.projects[proj].disabledMcpjsonServers).toEqual(['e2e']);
    setMcpServerDisabled({ home, projectPath: proj }, 'gh', 'user', false);
    expect(read(path.join(home, '.claude.json')).projects[home].disabledMcpServers).toEqual([]);
  });

  it('listing reflects disables', () => {
    write(path.join(proj, '.mcp.json'), { mcpServers: { e2e: { command: 'node' } } });
    setMcpServerDisabled({ home, projectPath: proj }, 'e2e', 'project', true);
    expect(listMcpServers({ home, projectPath: proj })[0].enabled).toBe(false);
  });
});
