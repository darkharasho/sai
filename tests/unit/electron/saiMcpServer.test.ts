// tests/unit/electron/saiMcpServer.test.ts
import { describe, it, expect, vi } from 'vitest';
import { buildSaiChatMcpServer, SAI_MCP_SERVER_NAME } from '../../../electron/services/claudeBackend/saiMcpServer';
import { toolsForToolset } from '../../../src/lib/saiTools';

describe('buildSaiChatMcpServer', () => {
  it('builds an sdk-type server registering all chat tools as sai_<name>', () => {
    const server = buildSaiChatMcpServer({ workspace: '/ws', dispatch: async () => ({}) });
    expect(server.type).toBe('sdk');
    expect(server.name).toBe(SAI_MCP_SERVER_NAME);
    // The SDK McpServer instance exists.
    expect(server.instance).toBeDefined();
  });

  it('registers a handler for every chat tool, and nothing else', () => {
    const expected = [...toolsForToolset('chat').map((t) => `sai_${t.name}`), 'sai_task'].sort();
    expect(expected.length).toBeGreaterThan(0);

    const server = buildSaiChatMcpServer({ workspace: '/ws', dispatch: async () => ({}) });
    const registered = [...(server as any).__handlersForTest.keys()].sort();

    // Asserting set equality rather than a count keeps this honest as tools
    // are added — a missing or stray registration names itself in the diff.
    expect(registered).toEqual(expected);
  });

  it('handler routes to dispatch with the bare tool name + workspace, wraps success', async () => {
    const dispatch = vi.fn(async () => ({ ok: true, __mcpImage: { base64: 'AAA', mimeType: 'image/png' } }));
    const server = buildSaiChatMcpServer({ workspace: '/ws', dispatch });
    // Invoke a tool handler directly through the captured registration.
    const handler = (server as any).__handlersForTest.get('sai_render_html');
    expect(handler).toBeTypeOf('function');
    const result = await handler({ html: '<b>hi</b>' });
    expect(dispatch).toHaveBeenCalledWith({ tool: 'render_html', input: { html: '<b>hi</b>' }, workspace: '/ws' });
    expect(result.content[0]).toEqual({ type: 'text', text: JSON.stringify({ ok: true, __mcpImage: undefined }) });
    expect(result.content[1]).toEqual({ type: 'image', data: 'AAA', mimeType: 'image/png' });
  });

  it('handler wraps a dispatch error with isError', async () => {
    const dispatch = vi.fn(async () => { throw new Error('boom'); });
    const server = buildSaiChatMcpServer({ workspace: '/ws', dispatch });
    const handler = (server as any).__handlersForTest.get('sai_confirm');
    const result = await handler({ message: 'ok?' });
    expect(result).toEqual({ content: [{ type: 'text', text: 'boom' }], isError: true });
  });

  it('registers sai_task alongside the chat tools', async () => {
    const dispatch = vi.fn(async () => ({ ok: true }));
    const server = buildSaiChatMcpServer({ workspace: '/ws', dispatch });
    const handlers = (server as any).__handlersForTest;
    expect(handlers.has('sai_task')).toBe(true);
    const input = { action: 'update', id: 'a', status: 'done' };
    await handlers.get('sai_task')(input);
    expect(dispatch).toHaveBeenCalledWith({ tool: 'task', input, workspace: '/ws' });
  });
});
