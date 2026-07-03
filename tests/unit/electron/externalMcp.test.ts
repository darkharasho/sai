// @vitest-environment node
import { describe, it, expect } from 'vitest';
import {
  collectClaudeJsonServers,
  collectPluginSdkConfigs,
  type ClaudeJsonConfig,
} from '@electron/services/claudeBackend/externalMcp';

const HOME = '/home/user';

describe('collectClaudeJsonServers', () => {
  it('returns user servers, dropping disabled-list and entry-level disabled', () => {
    const config: ClaudeJsonConfig = {
      mcpServers: {
        github: { command: 'npx', args: ['-y', 'server-github'] },
        linear: { type: 'http', url: 'https://mcp.linear.app/mcp' },
        off: { command: 'x', disabled: true },
        listed: { command: 'y' },
      },
      projects: { [HOME]: { disabledMcpServers: ['listed'] } },
    };
    const out = collectClaudeJsonServers(config, HOME);
    expect(Object.keys(out).sort()).toEqual(['github', 'linear']);
  });

  it('normalizes streamable-http to http and infers type from url', () => {
    const config: ClaudeJsonConfig = {
      mcpServers: {
        a: { type: 'streamable-http', url: 'https://x.example/mcp' },
        b: { url: 'https://x.example/sse' },
        c: { url: 'https://x.example/mcp' },
      },
    };
    const out = collectClaudeJsonServers(config, HOME) as Record<string, { type?: string }>;
    expect(out.a.type).toBe('http');
    expect(out.b.type).toBe('sse');
    expect(out.c.type).toBe('http');
  });

  it('strips the disabled flag and non-stdio keys from command servers', () => {
    const config: ClaudeJsonConfig = {
      mcpServers: { s: { command: 'x', args: ['a'], env: { K: 'v' } } },
    };
    const out = collectClaudeJsonServers(config, HOME);
    expect(out.s).toEqual({ command: 'x', args: ['a'], env: { K: 'v' } });
  });

  it('empty/missing config → empty object', () => {
    expect(collectClaudeJsonServers({}, HOME)).toEqual({});
  });
});

describe('collectPluginSdkConfigs', () => {
  const installed = {
    plugins: {
      'tools@official': [{ installPath: '/plugins/tools' }],
      'extra@official': [{ installPath: '/plugins/extra' }],
    },
  };
  const pluginMcp: Record<string, Record<string, any>> = {
    '/plugins/tools': { alpha: { command: 'a' }, beta: { command: 'b' } },
    '/plugins/extra': {},
  };
  const read = (p: string) => pluginMcp[p] ?? {};

  it('maps enabled plugins to local SDK plugin configs', () => {
    const { plugins, servers } = collectPluginSdkConfigs(installed, {}, {}, HOME, read);
    expect(plugins).toEqual([
      { type: 'local', path: '/plugins/tools' },
      { type: 'local', path: '/plugins/extra' },
    ]);
    expect(servers).toEqual({});
  });

  it('skips plugins disabled in settings.enabledPlugins', () => {
    const { plugins } = collectPluginSdkConfigs(
      installed,
      { enabledPlugins: { 'tools@official': false } },
      {},
      HOME,
      read,
    );
    expect(plugins).toEqual([{ type: 'local', path: '/plugins/extra' }]);
  });

  it('partially-disabled plugin → skipMcpDiscovery + SAI owns enabled subset', () => {
    const config: ClaudeJsonConfig = {
      projects: { [HOME]: { disabledMcpServers: ['plugin:tools:alpha'] } },
    };
    const { plugins, servers } = collectPluginSdkConfigs(installed, {}, config, HOME, read);
    expect(plugins[0]).toEqual({ type: 'local', path: '/plugins/tools', skipMcpDiscovery: true });
    expect(Object.keys(servers)).toEqual(['tools-beta']);
  });

  it('fully-disabled plugin servers → skipMcpDiscovery with no re-added servers', () => {
    const config: ClaudeJsonConfig = {
      projects: { [HOME]: { disabledMcpServers: ['plugin:tools:alpha', 'plugin:tools:beta'] } },
    };
    const { plugins, servers } = collectPluginSdkConfigs(installed, {}, config, HOME, read);
    expect(plugins[0]).toEqual({ type: 'local', path: '/plugins/tools', skipMcpDiscovery: true });
    expect(servers).toEqual({});
  });

  it('dedupes repeated install paths', () => {
    const dup = { plugins: { 'tools@official': [{ installPath: '/plugins/tools' }, { installPath: '/plugins/tools' }] } };
    const { plugins } = collectPluginSdkConfigs(dup, {}, {}, HOME, read);
    expect(plugins).toHaveLength(1);
  });
});
