import { describe, it, expect, vi } from 'vitest';

vi.mock('electron', () => ({
  BrowserWindow: class {},
  ipcMain: { on: vi.fn(), handle: vi.fn() },
  app: { getPath: vi.fn(() => '/tmp') },
}));
vi.mock('../../../electron/services/notify', () => ({ notifyCompletion: vi.fn() }));
vi.mock('../../../electron/services/workspace', () => ({
  getOrCreate: vi.fn(), get: vi.fn(), touchActivity: vi.fn(),
}));

import { translateAcpEvent } from '../../../electron/services/acpProvider';

describe('translateAcpEvent', () => {
  it('maps agent_message_chunk to a streaming assistant delta', () => {
    const out = translateAcpEvent({
      method: 'session/update',
      params: { update: { sessionUpdate: 'agent_message_chunk', content: { text: 'hi' } } },
    }, '/p', 'chat');
    expect(out).toMatchObject({
      type: 'assistant', projectPath: '/p', scope: 'chat',
      message: { content: [{ type: 'text', text: 'hi', delta: true }] },
    });
  });

  it('maps ACP-standard kinds (kimi dialect) to Claude tool names', () => {
    const out = translateAcpEvent({
      method: 'session/update',
      params: { update: { sessionUpdate: 'tool_call', toolCallId: 't1', kind: 'execute', title: 'ls -la' } },
    }, '/p', 'chat');
    expect(out.message.content[0]).toMatchObject({ id: 't1', type: 'tool_use', name: 'Bash', input: { command: 'ls -la' } });
  });

  it('maps failed tool_call_update to an error tool_result', () => {
    const out = translateAcpEvent({
      method: 'session/update',
      params: { update: { sessionUpdate: 'tool_call_update', toolCallId: 't1', status: 'failed', content: [{ type: 'content', content: { type: 'text', text: 'boom' } }] } },
    }, '/p', 'chat');
    expect(out.message.content[0]).toMatchObject({ type: 'tool_result', tool_use_id: 't1', content: 'boom', is_error: true });
  });
});
