// @vitest-environment node
import { describe, it, expect, vi } from 'vitest';

vi.mock('electron', () => ({ BrowserWindow: vi.fn(), app: { getPath: () => '/tmp' }, ipcMain: { handle: vi.fn(), on: vi.fn() } }));

import { getOrCreate, getClaude, listAcpLiveScopes } from '../../../electron/services/workspace';
import { CliBackend } from '../../../electron/services/claudeBackend/cliBackend';

describe('live scope accessors', () => {
  it('listAcpLiveScopes reports known scopes only while the provider process/transport is alive', () => {
    const ws = getOrCreate('/live/acp');
    ws.kimi.chatSessionId = 's0';
    ws.kimi.terminalSessions.set('c1', 's1');
    expect(listAcpLiveScopes('kimi').filter(e => e.projectPath === '/live/acp')).toEqual([]);
    ws.kimi.transport = {} as never;
    expect(listAcpLiveScopes('kimi').filter(e => e.projectPath === '/live/acp').map(e => e.scope).sort()).toEqual(['c1', 'chat']);
    expect(listAcpLiveScopes('gemini').filter(e => e.projectPath === '/live/acp')).toEqual([]);
    ws.kimi.transport = null;
  });

  it('CliBackend.liveScopes lists scopes with a running CLI process', () => {
    const ws = getOrCreate('/live/cli');
    getClaude(ws, 'c1').process = {} as never;
    getClaude(ws, 'c2');
    expect(new CliBackend().liveScopes().filter(e => e.projectPath === '/live/cli')).toEqual([{ projectPath: '/live/cli', scope: 'c1' }]);
  });
});
