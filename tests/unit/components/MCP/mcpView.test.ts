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

  it('plugin config row claims its live plugin:<short>:<name> entry without a duplicate', () => {
    const live = { 'plugin:cf:api': { name: 'plugin:cf:api', status: 'connected' as const, tools: [{ name: 't' }] } };
    const rows = buildMcpRows([cfg({ name: 'plugin:cf:api', transport: 'streamable-http', source: 'plugin' })], live, {});
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ controlName: 'plugin:cf:api', dot: 'ok', subtitle: 'cf · 1 tools' });
  });

  it('plugin config row matched to a bare live name uses the live name as controlName', () => {
    const live = { api: { name: 'api', status: 'connected' as const } };
    const rows = buildMcpRows([cfg({ name: 'plugin:cf:api', transport: 'sse', source: 'plugin' })], live, {});
    expect(rows).toHaveLength(1);
    expect(rows[0].controlName).toBe('api');
  });

  it('live-only plugin and project rows get the right source and are read-only', () => {
    const rows = buildMcpRows([], {
      'plugin:x:y': { name: 'plugin:x:y', status: 'connected', scope: 'dynamic', config: { type: 'http' } },
      proj: { name: 'proj', status: 'pending', scope: 'project', config: { type: 'stdio' } },
    }, {});
    const by = Object.fromEntries(rows.map((r) => [r.name, r]));
    expect(by['plugin:x:y']).toMatchObject({ source: 'plugin', displayName: 'y', pluginShort: 'x', transport: 'streamable-http', editable: false, removable: false });
    expect(by.proj).toMatchObject({ source: 'project', transport: 'stdio', editable: false, removable: false });
  });

  it('groups claudeai connectors and keeps the real plugin: name', () => {
    const rows = buildMcpRows(
      [cfg({ name: 'plugin:cf:api', transport: 'sse', source: 'plugin' })],
      {
        'plugin:cf:api': { name: 'plugin:cf:api', status: 'connected' },
        'claude.ai Gmail': { name: 'claude.ai Gmail', status: 'connected', scope: 'claudeai' },
      },
      {},
    );
    const groups = groupMcpRows(rows);
    expect(groups.map((g) => [g.id, g.rows.map((r) => r.name)])).toEqual([
      ['plugin', ['plugin:cf:api']],
      ['claudeai', ['claude.ai Gmail']],
    ]);
  });

  it('auth state is looked up by controlName', () => {
    const [row] = buildMcpRows(
      [cfg({ name: 'plugin:cf:api', transport: 'sse', source: 'plugin' })],
      { api: { name: 'api', status: 'needs-auth' } },
      { api: { phase: 'waiting', authUrl: 'https://a' } },
    );
    expect(row.auth?.phase).toBe('waiting');
    expect(row.subtitle).toBe('Waiting for browser sign-in…');
  });

  it('auth timeout/error puts a row in the attention group', () => {
    for (const phase of ['timeout', 'error'] as const) {
      const rows = buildMcpRows(
        [cfg({ name: 'cf', transport: 'sse' })],
        { cf: { name: 'cf', status: 'needs-auth' } },
        { cf: { phase } },
      );
      expect(needsAttention(rows[0])).toBe(true);
      expect(groupMcpRows(rows)[0].id).toBe('attention');
    }
    const rows = buildMcpRows([cfg({ name: 'ok' })], { ok: { name: 'ok', status: 'connected' } }, { ok: { phase: 'error' } });
    expect(groupMcpRows(rows)[0].id).toBe('attention');
  });
});
