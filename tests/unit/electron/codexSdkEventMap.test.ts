// @vitest-environment node
import { describe, expect, it } from 'vitest';
import type { ThreadEvent, ThreadItem } from '@openai/codex-sdk';
import { mapCodexSdkEvent } from '@electron/services/codexBackend/sdkEventMap';
import { parseToolError, parseToolResultBlocks } from '../../../src/lib/toolResultContent';

const ctx = { projectPath: '/repo', scope: 'scope-a', turnSeq: 3 };
const metadata = { projectPath: '/repo', scope: 'scope-a', turnSeq: 3 };

const toolUse = (id: string, name: string, input: unknown) => ({
  type: 'assistant',
  ...metadata,
  message: { content: [{ id, type: 'tool_use', name, input }] },
});

const toolResult = (id: string, content: unknown, isError = false) => ({
  type: 'user',
  ...metadata,
  message: {
    content: [{
      type: 'tool_result',
      tool_use_id: id,
      content: isError && typeof content === 'string'
        ? `<tool_error>${content}</tool_error>`
        : content,
      is_error: isError,
    }],
  },
});

function resultContent(envelope: ReturnType<typeof mapCodexSdkEvent>[number]): unknown {
  const message = envelope.message as { content: Array<{ content: unknown }> };
  return message.content[0].content;
}

describe('mapCodexSdkEvent', () => {
  it('maps thread identity using the renderer session convention', () => {
    const event = { type: 'thread.started', thread_id: 'thr-1' } satisfies ThreadEvent;

    expect(mapCodexSdkEvent(event, ctx)).toEqual([
      {
        type: 'session_id',
        sessionId: 'thr-1',
        projectPath: '/repo',
        scope: 'scope-a',
      },
    ]);
  });

  it('does not emit for turn start', () => {
    expect(mapCodexSdkEvent({ type: 'turn.started' } satisfies ThreadEvent, ctx)).toEqual([]);
  });

  it.each(['item.started', 'item.updated', 'item.completed'] as const)(
    'ignores an unknown %s item without throwing',
    (type) => {
      expect(mapCodexSdkEvent({
        type,
        item: { id: 'future-item', type: 'future_item' },
      } as unknown as ThreadEvent, ctx)).toEqual([]);
    },
  );

  describe('item.started', () => {
    it('maps a legacy collaboration start to running agent activity', () => {
      const event = {
        type: 'item.started',
        item: {
          id: 'agent-1',
          type: 'collab_tool_call',
          tool: 'spawn_agent',
          status: 'in_progress',
          description: 'Inspect the renderer state',
        },
      } as unknown as ThreadEvent;

      expect(mapCodexSdkEvent(event, ctx)).toEqual([{
        type: 'subagent_activity',
        agentId: 'agent-1',
        status: 'running',
        summary: 'Inspect the renderer state',
        ...metadata,
      }]);
    });

    it.each([
      {
        label: 'command execution',
        item: {
          id: 'cmd-1',
          type: 'command_execution',
          command: 'npm test',
          aggregated_output: '',
          status: 'in_progress',
        } satisfies ThreadItem,
        expected: toolUse('cmd-1', 'Bash', { command: 'npm test' }),
      },
      {
        label: 'file change',
        item: {
          id: 'file-1',
          type: 'file_change',
          changes: [{ path: 'src/a.ts', kind: 'update' }],
          status: 'completed',
        } satisfies ThreadItem,
        expected: toolUse('file-1', 'Edit', {
          changes: [{ path: 'src/a.ts', kind: 'update' }],
        }),
      },
      {
        label: 'MCP call',
        item: {
          id: 'mcp-1',
          type: 'mcp_tool_call',
          server: 'github',
          tool: 'search',
          arguments: { q: 'bug' },
          status: 'in_progress',
        } satisfies ThreadItem,
        expected: toolUse('mcp-1', 'mcp__github__search', { q: 'bug' }),
      },
      {
        label: 'web search',
        item: { id: 'web-1', type: 'web_search', query: 'Codex SDK' } satisfies ThreadItem,
        expected: toolUse('web-1', 'WebSearch', { query: 'Codex SDK' }),
      },
      {
        label: 'todo list',
        item: {
          id: 'todo-1',
          type: 'todo_list',
          items: [{ text: 'write tests', completed: false }],
        } satisfies ThreadItem,
        expected: toolUse('todo-1', 'TodoWrite', {
          todos: [{ id: 'todo-1:0', content: 'write tests', status: 'in_progress' }],
        }),
      },
    ])('maps $label to a tool use', ({ item, expected }) => {
      expect(mapCodexSdkEvent({ type: 'item.started', item } satisfies ThreadEvent, ctx))
        .toEqual([expected]);
    });

    it('normalizes a multi-item todo list, marking the first incomplete item in progress', () => {
      const event = {
        type: 'item.started',
        item: {
          id: 'todo-1',
          type: 'todo_list',
          items: [
            { text: 'Inspect', completed: true },
            { text: 'Implement', completed: false },
            { text: 'Verify', completed: false },
          ],
        },
      } satisfies ThreadEvent;

      expect(mapCodexSdkEvent(event, ctx)).toEqual([expect.objectContaining({
        type: 'assistant',
        message: { content: [expect.objectContaining({
          type: 'tool_use',
          id: 'todo-1',
          name: 'TodoWrite',
          input: { todos: [
            { id: 'todo-1:0', content: 'Inspect', status: 'completed' },
            { id: 'todo-1:1', content: 'Implement', status: 'in_progress' },
            { id: 'todo-1:2', content: 'Verify', status: 'pending' },
          ] },
        })] },
      })]);
    });

    it('drops malformed todo entries individually without throwing', () => {
      const event = {
        type: 'item.started',
        item: {
          id: 'todo-1',
          type: 'todo_list',
          items: [
            null,
            { text: '   ', completed: false },
            { text: 'bad completed', completed: 'yes' },
            { text: 'Valid', completed: false },
          ],
        },
      } as unknown as ThreadEvent;

      expect(() => mapCodexSdkEvent(event, ctx)).not.toThrow();
      expect(mapCodexSdkEvent(event, ctx)).toEqual([toolUse('todo-1', 'TodoWrite', {
        todos: [{ id: 'todo-1:0', content: 'Valid', status: 'in_progress' }],
      })]);
    });

    it('marks every item completed when the whole todo list is done', () => {
      const event = {
        type: 'item.started',
        item: {
          id: 'todo-1',
          type: 'todo_list',
          items: [
            { text: 'Inspect', completed: true },
            { text: 'Implement', completed: true },
          ],
        },
      } satisfies ThreadEvent;

      expect(mapCodexSdkEvent(event, ctx)).toEqual([toolUse('todo-1', 'TodoWrite', {
        todos: [
          { id: 'todo-1:0', content: 'Inspect', status: 'completed' },
          { id: 'todo-1:1', content: 'Implement', status: 'completed' },
        ],
      })]);
    });

    it.each([
      { id: 'message-1', type: 'agent_message', text: 'hello' } satisfies ThreadItem,
      { id: 'reason-1', type: 'reasoning', text: 'thinking' } satisfies ThreadItem,
      { id: 'error-1', type: 'error', message: 'non-fatal' } satisfies ThreadItem,
    ])('does not emit for $type', (item) => {
      expect(mapCodexSdkEvent({ type: 'item.started', item } satisfies ThreadEvent, ctx))
        .toEqual([]);
    });
  });

  describe('item.updated', () => {
    const updatedItems = [
      { id: 'message-1', type: 'agent_message', text: 'partial' },
      { id: 'reason-1', type: 'reasoning', text: 'partial thought' },
      {
        id: 'cmd-1',
        type: 'command_execution',
        command: 'npm test',
        aggregated_output: 'running',
        status: 'in_progress',
      },
      {
        id: 'file-1',
        type: 'file_change',
        changes: [{ path: 'src/a.ts', kind: 'update' }],
        status: 'completed',
      },
      {
        id: 'mcp-1',
        type: 'mcp_tool_call',
        server: 'github',
        tool: 'search',
        arguments: { q: 'bug' },
        status: 'in_progress',
      },
      { id: 'web-1', type: 'web_search', query: 'Codex SDK' },
      { id: 'error-1', type: 'error', message: 'non-fatal' },
    ] satisfies ThreadItem[];

    it.each(updatedItems)('defers $type progress updates in compatibility mode', (item) => {
      expect(mapCodexSdkEvent({ type: 'item.updated', item } satisfies ThreadEvent, ctx))
        .toEqual([]);
    });

    it('maps a legacy collaboration update to running agent activity with a bounded prompt fallback', () => {
      const event = {
        type: 'item.updated',
        item: {
          id: 'agent-1', type: 'collab_tool_call', status: 'in_progress',
          prompt: 'Investigate why the thinking animation stalls while an agent is running.',
        },
      } as unknown as ThreadEvent;

      expect(mapCodexSdkEvent(event, ctx)).toEqual([{
        type: 'subagent_activity',
        agentId: 'agent-1',
        status: 'running',
        summary: 'Investigate why the thinking animation stalls while an agent is running.',
        ...metadata,
      }]);
    });

    it('re-emits the same TodoWrite tool-use id with advanced statuses', () => {
      const startedEvent = {
        type: 'item.started',
        item: {
          id: 'todo-1',
          type: 'todo_list',
          items: [
            { text: 'Inspect', completed: true },
            { text: 'Implement', completed: false },
            { text: 'Verify', completed: false },
          ],
        },
      } satisfies ThreadEvent;
      const updatedEvent = {
        type: 'item.updated',
        item: {
          id: 'todo-1',
          type: 'todo_list',
          items: [
            { text: 'Inspect', completed: true },
            { text: 'Implement', completed: true },
            { text: 'Verify', completed: false },
          ],
        },
      } satisfies ThreadEvent;

      const started = mapCodexSdkEvent(startedEvent, ctx);
      const updated = mapCodexSdkEvent(updatedEvent, ctx);

      expect(started).toEqual([toolUse('todo-1', 'TodoWrite', {
        todos: [
          { id: 'todo-1:0', content: 'Inspect', status: 'completed' },
          { id: 'todo-1:1', content: 'Implement', status: 'in_progress' },
          { id: 'todo-1:2', content: 'Verify', status: 'pending' },
        ],
      })]);
      expect(updated).toEqual([toolUse('todo-1', 'TodoWrite', {
        todos: [
          { id: 'todo-1:0', content: 'Inspect', status: 'completed' },
          { id: 'todo-1:1', content: 'Implement', status: 'completed' },
          { id: 'todo-1:2', content: 'Verify', status: 'in_progress' },
        ],
      })]);
      const startedId = (started[0].message as { content: Array<{ id: string }> }).content[0].id;
      const updatedId = (updated[0].message as { content: Array<{ id: string }> }).content[0].id;
      expect(updatedId).toBe(startedId);
    });
  });

  describe('item.completed', () => {
    it.each([
      ['completed', 'completed'],
      ['failed', 'failed'],
      ['cancelled', 'cancelled'],
    ])('maps a legacy collaboration completion with %s status', (itemStatus, status) => {
      const event = {
        type: 'item.completed',
        item: { id: 'agent-1', type: 'collab_tool_call', status: itemStatus },
      } as unknown as ThreadEvent;

      expect(mapCodexSdkEvent(event, ctx)).toEqual([{
        type: 'subagent_activity',
        agentId: 'agent-1',
        status,
        ...metadata,
      }]);
    });

    it('treats a completion without a status as completed activity', () => {
      const event = {
        type: 'item.completed',
        item: { id: 'agent-1', type: 'collab_tool_call' },
      } as unknown as ThreadEvent;

      expect(mapCodexSdkEvent(event, ctx)).toEqual([{
        type: 'subagent_activity',
        agentId: 'agent-1',
        status: 'completed',
        ...metadata,
      }]);
    });

    it('maps a nonempty agent message to assistant text', () => {
      const event = {
        type: 'item.completed',
        item: { id: 'message-1', type: 'agent_message', text: 'Done.' },
      } satisfies ThreadEvent;

      expect(mapCodexSdkEvent(event, ctx)).toEqual([{
        type: 'assistant',
        ...metadata,
        message: { content: [{ type: 'text', text: 'Done.' }] },
      }]);
    });

    it('does not emit an empty agent message', () => {
      const event = {
        type: 'item.completed',
        item: { id: 'message-1', type: 'agent_message', text: '' },
      } satisfies ThreadEvent;

      expect(mapCodexSdkEvent(event, ctx)).toEqual([]);
    });

    it('maps one completed reasoning summary to the dedicated reasoning channel', () => {
      const event = {
        type: 'item.completed',
        item: { id: 'reason-1', type: 'reasoning', text: 'Checked both call paths.' },
      } satisfies ThreadEvent;

      expect(mapCodexSdkEvent(event, ctx)).toEqual([{
        type: 'reasoning_delta',
        text: 'Checked both call paths.',
        ...metadata,
      }]);
    });

    it('does not emit an empty reasoning summary', () => {
      const event = {
        type: 'item.completed',
        item: { id: 'reason-1', type: 'reasoning', text: '' },
      } satisfies ThreadEvent;

      expect(mapCodexSdkEvent(event, ctx)).toEqual([]);
    });

    it.each([
      { label: 'zero exit', status: 'completed' as const, exit_code: 0, isError: false },
      { label: 'missing exit', status: 'completed' as const, exit_code: undefined, isError: false },
      { label: 'nonzero exit', status: 'completed' as const, exit_code: 2, isError: true },
      { label: 'failed status', status: 'failed' as const, exit_code: 0, isError: true },
    ])('maps command output for $label', ({ status, exit_code, isError }) => {
      const event = {
        type: 'item.completed',
        item: {
          id: 'cmd-1',
          type: 'command_execution',
          command: 'npm test',
          aggregated_output: 'combined output',
          exit_code,
          status,
        },
      } satisfies ThreadEvent;

      expect(mapCodexSdkEvent(event, ctx)).toEqual([
        toolResult('cmd-1', 'combined output', isError),
      ]);
    });

    it.each([
      { status: 'completed' as const, isError: false },
      { status: 'failed' as const, isError: true },
    ])('maps deterministic file change JSON for $status status', ({ status, isError }) => {
      const changes = [
        { path: 'src/a.ts', kind: 'update' as const },
        { path: 'src/b.ts', kind: 'add' as const },
      ];
      const event = {
        type: 'item.completed',
        item: { id: 'file-1', type: 'file_change', changes, status },
      } satisfies ThreadEvent;

      expect(mapCodexSdkEvent(event, ctx)).toEqual([
        toolResult('file-1', JSON.stringify(changes), isError),
      ]);
    });

    it('preserves successful MCP text and appends structured content', () => {
      const content = [{ type: 'text' as const, text: 'found it' }];
      const event = {
        type: 'item.completed',
        item: {
          id: 'mcp-1',
          type: 'mcp_tool_call',
          server: 'github',
          tool: 'search',
          arguments: { q: 'bug' },
          result: { content, structured_content: { count: 1 } },
          status: 'completed',
        },
      } satisfies ThreadEvent;

      expect(mapCodexSdkEvent(event, ctx)).toEqual([toolResult('mcp-1', [
        { type: 'text', text: 'found it' },
        { type: 'text', text: '\n{"count":1}' },
      ])]);
    });

    it('treats malformed MCP result content as empty while preserving structured output', () => {
      const event = {
        type: 'item.completed',
        item: {
          id: 'mcp-malformed-content',
          type: 'mcp_tool_call',
          server: 'superpowers',
          tool: 'executing_plans',
          arguments: {},
          result: { content: { unexpected: true }, structured_content: { ok: true } },
          status: 'completed',
        },
      } as unknown as ThreadEvent;

      expect(mapCodexSdkEvent(event, ctx)).toEqual([toolResult('mcp-malformed-content', [
        { type: 'text', text: '{"ok":true}' },
      ])]);
    });

    it('uses deterministically serialized structured-only MCP output', () => {
      const event = {
        type: 'item.completed',
        item: {
          id: 'mcp-structured',
          type: 'mcp_tool_call',
          server: 'github',
          tool: 'search',
          arguments: {},
          result: { content: [], structured_content: { z: 2, a: { y: true, b: false } } },
          status: 'completed',
        },
      } satisfies ThreadEvent;

      expect(mapCodexSdkEvent(event, ctx)).toEqual([toolResult('mcp-structured', [
        { type: 'text', text: '{"a":{"b":false,"y":true},"z":2}' },
      ])]);
    });

    it('preserves an own enumerable __proto__ key in structured MCP output', () => {
      const structuredContent: unknown = JSON.parse(
        '{"z":2,"__proto__":{"polluted":false},"a":1}',
      );
      const event = {
        type: 'item.completed',
        item: {
          id: 'mcp-proto',
          type: 'mcp_tool_call',
          server: 'github',
          tool: 'search',
          arguments: {},
          result: { content: [], structured_content: structuredContent },
          status: 'completed',
        },
      } satisfies ThreadEvent;

      expect(mapCodexSdkEvent(event, ctx)).toEqual([toolResult('mcp-proto', [
        { type: 'text', text: '{"__proto__":{"polluted":false},"a":1,"z":2}' },
      ])]);
    });

    it('converts native MCP images to the renderer image convention', () => {
      const event = {
        type: 'item.completed',
        item: {
          id: 'mcp-image',
          type: 'mcp_tool_call',
          server: 'screenshots',
          tool: 'capture',
          arguments: {},
          result: {
            content: [{ type: 'image', data: 'AAAA', mimeType: 'image/png' }],
            structured_content: null,
          },
          status: 'completed',
        },
      } satisfies ThreadEvent;

      const content = resultContent(mapCodexSdkEvent(event, ctx)[0]);
      expect(content).toEqual([{
        type: 'image',
        source: { type: 'base64', media_type: 'image/png', data: 'AAAA' },
      }]);
      expect(parseToolResultBlocks(content)).toEqual({
        text: '',
        images: [{ dataUrl: 'data:image/png;base64,AAAA', mimeType: 'image/png' }],
      });
    });

    it('safely and deterministically serializes unsupported MCP content blocks as text', () => {
      const event = {
        type: 'item.completed',
        item: {
          id: 'mcp-other',
          type: 'mcp_tool_call',
          server: 'media',
          tool: 'inspect',
          arguments: {},
          result: {
            content: [
              { type: 'audio', data: 'BBBB', mimeType: 'audio/wav' },
              { type: 'resource_link', name: 'docs', uri: 'file:///docs', description: 'Docs' },
            ],
            structured_content: null,
          },
          status: 'completed',
        },
      } satisfies ThreadEvent;

      expect(mapCodexSdkEvent(event, ctx)).toEqual([toolResult('mcp-other', [
        { type: 'text', text: '{"data":"BBBB","mimeType":"audio/wav","type":"audio"}' },
        {
          type: 'text',
          text: '{"description":"Docs","name":"docs","type":"resource_link","uri":"file:///docs"}',
        },
      ])]);
    });

    it('preserves an empty successful MCP result', () => {
      const event = {
        type: 'item.completed',
        item: {
          id: 'mcp-empty',
          type: 'mcp_tool_call',
          server: 'github',
          tool: 'search',
          arguments: {},
          result: { content: [], structured_content: null },
          status: 'completed',
        },
      } satisfies ThreadEvent;

      expect(mapCodexSdkEvent(event, ctx)).toEqual([toolResult('mcp-empty', [])]);
    });

    it('maps an MCP failure message as an error result', () => {
      const event = {
        type: 'item.completed',
        item: {
          id: 'mcp-failed',
          type: 'mcp_tool_call',
          server: 'github',
          tool: 'search',
          arguments: {},
          error: { message: 'denied' },
          status: 'failed',
        },
      } satisfies ThreadEvent;

      expect(mapCodexSdkEvent(event, ctx)).toEqual([
        toolResult('mcp-failed', 'denied', true),
      ]);
    });

    it('keeps failed image results parseable and recognizable as a tool error', () => {
      const event = {
        type: 'item.completed',
        item: {
          id: 'mcp-image-failed',
          type: 'mcp_tool_call',
          server: 'screenshots',
          tool: 'capture',
          arguments: {},
          result: {
            content: [{ type: 'image', data: 'AAAA', mimeType: 'image/png' }],
            structured_content: null,
          },
          status: 'failed',
        },
      } satisfies ThreadEvent;

      const envelope = mapCodexSdkEvent(event, ctx)[0];
      const parsed = parseToolResultBlocks(resultContent(envelope));

      expect(parsed.images).toEqual([
        { dataUrl: 'data:image/png;base64,AAAA', mimeType: 'image/png' },
      ]);
      expect(parseToolError(parsed.text)).toEqual({
        isToolError: true,
        message: 'Tool failed',
      });
    });

    it('survives the ChatPanel result parser with the current tool-card error convention', () => {
      const event = {
        type: 'item.completed',
        item: {
          id: 'cmd-failed',
          type: 'command_execution',
          command: 'exit 2',
          aggregated_output: 'command failed',
          exit_code: 2,
          status: 'failed',
        },
      } satisfies ThreadEvent;

      const envelope = mapCodexSdkEvent(event, ctx)[0];
      const parsed = parseToolResultBlocks(resultContent(envelope));

      expect(parseToolError(parsed.text)).toEqual({
        isToolError: true,
        message: 'command failed',
      });
    });

    it('maps web search completion to its matching tool result', () => {
      const event = {
        type: 'item.completed',
        item: { id: 'web-1', type: 'web_search', query: 'Codex SDK' },
      } satisfies ThreadEvent;

      expect(mapCodexSdkEvent(event, ctx)).toEqual([
        toolResult('web-1', 'Codex SDK'),
      ]);
    });

    it('maps deterministic todo JSON to its matching tool result', () => {
      const items = [
        { text: 'write tests', completed: true },
        { text: 'implement', completed: false },
      ];
      const event = {
        type: 'item.completed',
        item: { id: 'todo-1', type: 'todo_list', items },
      } satisfies ThreadEvent;

      expect(mapCodexSdkEvent(event, ctx)).toEqual([
        toolResult('todo-1', JSON.stringify(items)),
      ]);
    });

    it('maps a nonfatal item error without ending the turn', () => {
      const event = {
        type: 'item.completed',
        item: { id: 'error-1', type: 'error', message: 'non-fatal' },
      } satisfies ThreadEvent;

      expect(mapCodexSdkEvent(event, ctx)).toEqual([{
        type: 'error',
        text: 'non-fatal',
        ...metadata,
      }]);
    });
  });

  it('maps completed usage and then emits exactly one done envelope', () => {
    const event = {
      type: 'turn.completed',
      usage: {
        input_tokens: 10,
        cached_input_tokens: 4,
        output_tokens: 5,
        reasoning_output_tokens: 3,
      },
    } satisfies ThreadEvent;

    expect(mapCodexSdkEvent(event, ctx)).toEqual([
      {
        type: 'result',
        ...metadata,
        usage: {
          input_tokens: 10,
          cache_read_input_tokens: 4,
          cache_creation_input_tokens: 0,
          output_tokens: 5,
          reasoning_output_tokens: 3,
        },
      },
      { type: 'done', ...metadata },
    ]);
  });

  it.each([
    {
      label: 'failed turn',
      event: { type: 'turn.failed', error: { message: 'boom' } } satisfies ThreadEvent,
      message: 'boom',
    },
    {
      label: 'fatal stream error',
      event: { type: 'error', message: 'broken stream' } satisfies ThreadEvent,
      message: 'broken stream',
    },
  ])('maps $label to error then done', ({ event, message }) => {
    expect(mapCodexSdkEvent(event, ctx)).toEqual([
      { type: 'error', text: message, ...metadata },
      { type: 'done', ...metadata },
    ]);
  });

  it('does not mutate its input event or context', () => {
    const event = {
      type: 'item.completed',
      item: {
        id: 'file-1',
        type: 'file_change',
        changes: [{ path: 'src/a.ts', kind: 'update' }],
        status: 'completed',
      },
    } satisfies ThreadEvent;
    const localContext = { projectPath: '/repo', scope: 'scope-a', turnSeq: 3 };
    const eventBefore = structuredClone(event);
    const contextBefore = structuredClone(localContext);

    mapCodexSdkEvent(event, localContext);

    expect(event).toEqual(eventBefore);
    expect(localContext).toEqual(contextBefore);
  });

  it('ignores an unknown top-level event', () => {
    expect(mapCodexSdkEvent({ type: 'future.event' } as unknown as ThreadEvent, ctx)).toEqual([]);
  });
});
