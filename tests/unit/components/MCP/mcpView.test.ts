// tests/unit/components/MCP/mcpView.test.ts
import { describe, it, expect } from 'vitest';
import { buildMcpRows, groupMcpRows, liveFor, mcpDisplayName, needsAttention } from '../../../../src/components/MCP/mcpView';
import type { McpServer } from '../../../../src/types';

const cfg = (over: Partial<McpServer>): McpServer => ({ name: 'x', transport: 'stdio', enabled: true, source: 'user', ...over });

describe('mcpView', () => {
  it('liveFor matches exact, then bare plugin name, then legacy <short>-<name>', () => {
    const live = { 'cloudflare-api': { name: 'cloudflare-api', status: 'connected' as const }, 'pw-browser': { name: 'pw-browser', status: 'failed' as const } };
    expect(liveFor('plugin:cloudflare:cloudflare-api', live)?.status).toBe('connected');
    expect(liveFor('plugin:pw:browser', live)?.status).toBe('failed');
    expect(liveFor('nope', live)).toBeUndefined();
  });

  it('builds rows with subtitles, dots and fixes', () => {
    const rows = buildMcpRows(
      [
        cfg({ name: 'gh', transport: 'streamable-http', url: 'https://gh' }),
        cfg({ name: 'pg', enabled: false }),
        cfg({ name: 'plugin:cloudflare:cloudflare-api', transport: 'streamable-http', source: 'plugin' }),
        cfg({ name: 'local', transport: 'stdio' }),
        cfg({ name: 'e2e', source: 'project' }),
      ],
      {
        gh: { name: 'gh', status: 'connected', tools: [{ name: 'a' }, { name: 'b' }] },
        'plugin:cloudflare:cloudflare-api': { name: 'plugin:cloudflare:cloudflare-api', status: 'needs-auth' },
        local: { name: 'local', status: 'failed', error: 'spawn ENOENT' },
        e2e: { name: 'e2e', status: 'pending' },
        'claude.ai Gmail': { name: 'claude.ai Gmail', status: 'connected', scope: 'claudeai', tools: [{ name: 't' }] },
        sai: { name: 'sai', status: 'connected' },
      },
      {},
    );
    const by = Object.fromEntries(rows.map((r) => [r.name, r]));
    expect(by.gh).toMatchObject({ subtitle: 'http · 2 tools', dot: 'ok', editable: true, removable: true });
    expect(by.pg).toMatchObject({ subtitle: 'stdio · disabled', dot: 'off', enabled: false });
    expect(by['plugin:cloudflare:cloudflare-api']).toMatchObject({
      displayName: 'cloudflare-api', pluginShort: 'cloudflare', subtitle: 'Needs sign-in', dot: 'bad', fix: 'sign-in', editable: false,
    });
    expect(by.local).toMatchObject({ subtitle: 'spawn ENOENT', dot: 'bad', fix: 'retry' });
    expect(by.e2e).toMatchObject({ subtitle: 'stdio · connecting…', dot: 'pending', source: 'project' });
    expect(by['claude.ai Gmail']).toMatchObject({ source: 'claudeai', subtitle: 'connector · 1 tools', editable: false, removable: false });
    expect(by.sai).toBeUndefined();
  });

  it('stdio needs-auth gets no sign-in fix', () => {
    const [row] = buildMcpRows([cfg({ name: 's' })], { s: { name: 's', status: 'needs-auth' } }, {});
    expect(row.fix).toBeUndefined();
  });

  it('auth waiting overrides subtitle', () => {
    const [row] = buildMcpRows(
      [cfg({ name: 'cf', transport: 'streamable-http' })],
      { cf: { name: 'cf', status: 'needs-auth' } },
      { cf: { phase: 'waiting', authUrl: 'https://a' } },
    );
    expect(row).toMatchObject({ subtitle: 'Waiting for browser sign-in…', dot: 'pending' });
  });

  it('groups: attention first, then user/project/plugin/claudeai, empty groups dropped', () => {
    const rows = buildMcpRows(
      [cfg({ name: 'gh' }), cfg({ name: 'cf', transport: 'sse', source: 'plugin' })],
      { gh: { name: 'gh', status: 'connected' }, cf: { name: 'cf', status: 'needs-auth' } },
      {},
    );
    const groups = groupMcpRows(rows);
    expect(groups.map((g) => [g.id, g.rows.map((r) => r.name)])).toEqual([
      ['attention', ['cf']],
      ['user', ['gh']],
    ]);
    expect(needsAttention(rows.find((r) => r.name === 'cf')!)).toBe(true);
  });

  it('disabled servers never need attention even if live says failed', () => {
    const [row] = buildMcpRows([cfg({ name: 'pg', enabled: false })], { pg: { name: 'pg', status: 'failed' } }, {});
    expect(needsAttention(row)).toBe(false);
  });

  it('mcpDisplayName strips the plugin prefix only', () => {
    expect(mcpDisplayName('plugin:cf:cloudflare-api')).toBe('cloudflare-api');
    expect(mcpDisplayName('claude.ai Gmail')).toBe('claude.ai Gmail');
  });
});
