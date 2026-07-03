// @vitest-environment node
import { describe, it, expect, beforeEach } from 'vitest';
import {
  recordMcpRuntimeStatus,
  getMcpRuntimeStatus,
  __resetMcpRuntimeStatusForTests,
} from '@electron/services/claudeBackend/mcpRuntimeStatus';

describe('mcpRuntimeStatus', () => {
  beforeEach(() => __resetMcpRuntimeStatusForTests());

  it('records servers and plugins from an init report', () => {
    recordMcpRuntimeStatus('proj::chat', [
      { name: 'github', status: 'connected' },
      { name: 'db', status: 'failed' },
    ], [{ name: 'my-plugin', path: '/p/my-plugin' }]);

    const { servers, plugins } = getMcpRuntimeStatus();
    expect(servers.github.status).toBe('connected');
    expect(servers.db.status).toBe('failed');
    expect(servers.github.scopeKey).toBe('proj::chat');
    expect(plugins).toEqual([{ name: 'my-plugin', path: '/p/my-plugin' }]);
  });

  it('latest report wins per server name across scopes', () => {
    recordMcpRuntimeStatus('a', [{ name: 'github', status: 'failed' }]);
    recordMcpRuntimeStatus('b', [{ name: 'github', status: 'connected' }]);
    expect(getMcpRuntimeStatus().servers.github).toMatchObject({ status: 'connected', scopeKey: 'b' });
  });

  it('ignores malformed entries and keeps plugins when omitted', () => {
    recordMcpRuntimeStatus('a', [{ name: 'ok', status: 'connected' }], [{ name: 'p', path: '/p' }]);
    recordMcpRuntimeStatus('a', [{ status: 'connected' }, null as any, { name: '' }]);
    const { servers, plugins } = getMcpRuntimeStatus();
    expect(Object.keys(servers)).toEqual(['ok']);
    expect(plugins).toHaveLength(1);
  });

  it('missing status → "unknown"', () => {
    recordMcpRuntimeStatus('a', [{ name: 'x' }]);
    expect(getMcpRuntimeStatus().servers.x.status).toBe('unknown');
  });
});
