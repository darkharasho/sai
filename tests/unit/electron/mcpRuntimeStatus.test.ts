// @vitest-environment node
import { describe, it, expect, beforeEach } from 'vitest';
import {
  recordMcpRuntimeStatus,
  replaceMcpRuntimeStatus,
  setMcpAuthState,
  getMcpRuntimeStatus,
  __resetMcpRuntimeStatusForTests,
} from '@electron/services/claudeBackend/mcpRuntimeStatus';

describe('mcpRuntimeStatus (per scope)', () => {
  beforeEach(() => __resetMcpRuntimeStatusForTests());

  it('keeps scopes separate', () => {
    recordMcpRuntimeStatus('/p', 'a', [{ name: 'github', status: 'failed' }]);
    recordMcpRuntimeStatus('/p', 'b', [{ name: 'github', status: 'connected' }]);
    expect(getMcpRuntimeStatus('/p', 'a').servers.github.status).toBe('failed');
    expect(getMcpRuntimeStatus('/p', 'b').servers.github.status).toBe('connected');
  });

  it('undefined scope is "chat"', () => {
    recordMcpRuntimeStatus('/p', undefined, [{ name: 'x', status: 'connected' }]);
    expect(getMcpRuntimeStatus('/p', 'chat')).toMatchObject({ projectPath: '/p', scope: 'chat' });
    expect(getMcpRuntimeStatus('/p', 'chat').servers.x.status).toBe('connected');
  });

  it('record() merges: same status keeps tools/serverInfo, changed status drops them', () => {
    replaceMcpRuntimeStatus('/p', 'a', [
      { name: 'gh', status: 'connected', tools: [{ name: 't1' }], serverInfo: { name: 'GH', version: '1' } },
    ]);
    recordMcpRuntimeStatus('/p', 'a', [{ name: 'gh', status: 'connected' }]);
    expect(getMcpRuntimeStatus('/p', 'a').servers.gh.tools).toEqual([{ name: 't1' }]);
    recordMcpRuntimeStatus('/p', 'a', [{ name: 'gh', status: 'failed' }]);
    expect(getMcpRuntimeStatus('/p', 'a').servers.gh.tools).toBeUndefined();
  });

  it('replace() is authoritative and normalizes unknown statuses', () => {
    recordMcpRuntimeStatus('/p', 'a', [{ name: 'old', status: 'connected' }]);
    replaceMcpRuntimeStatus('/p', 'a', [{ name: 'new', status: 'weird' }, null, { status: 'connected' }]);
    const { servers } = getMcpRuntimeStatus('/p', 'a');
    expect(Object.keys(servers)).toEqual(['new']);
    expect(servers.new.status).toBe('unknown');
  });

  it('replace() keeps error, scope, config and strips tool fields to name/description', () => {
    replaceMcpRuntimeStatus('/p', 'a', [{
      name: 'cf', status: 'failed', error: 'boom', scope: 'claudeai',
      config: { type: 'http', url: 'https://x', headers: { a: 'secret' } },
      tools: [{ name: 't', description: 'd', annotations: { readOnly: true } }],
    }]);
    expect(getMcpRuntimeStatus('/p', 'a').servers.cf).toEqual({
      name: 'cf', status: 'failed', error: 'boom', scope: 'claudeai',
      config: { type: 'http', url: 'https://x' },
      tools: [{ name: 't', description: 'd' }],
    });
  });

  it('auth state set/clear per scope', () => {
    setMcpAuthState('/p', 'a', 'cf', { phase: 'waiting', authUrl: 'https://auth' });
    expect(getMcpRuntimeStatus('/p', 'a').auth.cf).toEqual({ phase: 'waiting', authUrl: 'https://auth' });
    expect(getMcpRuntimeStatus('/p', 'b').auth).toEqual({});
    setMcpAuthState('/p', 'a', 'cf', null);
    expect(getMcpRuntimeStatus('/p', 'a').auth).toEqual({});
  });
});
