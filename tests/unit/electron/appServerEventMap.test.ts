// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { mapAppServerEvent } from '@electron/services/codexBackend/appServerEventMap';

const ctx = {
  projectPath: '/repo', scope: 'scope-a', turnSeq: 3, threadId: 'thread-1', turnId: 'turn-1',
};
const metadata = { projectPath: '/repo', scope: 'scope-a', turnSeq: 3 };

describe('mapAppServerEvent', () => {
  it('maps the matching thread identity using the renderer session convention', () => {
    expect(mapAppServerEvent({
      method: 'thread/started', params: { thread: { id: 'thread-1' } },
    }, ctx)).toEqual([{
      type: 'session_id', sessionId: 'thread-1', projectPath: '/repo', scope: 'scope-a',
    }]);
  });

  it('ignores a stale thread identity', () => {
    expect(mapAppServerEvent({
      method: 'thread/started', params: { thread: { id: 'thread-stale' } },
    }, ctx)).toEqual([]);
  });

  it('does not emit for a matching turn start', () => {
    expect(mapAppServerEvent({
      method: 'turn/started', params: { threadId: 'thread-1', turn: { id: 'turn-1' } },
    }, ctx)).toEqual([]);
  });

  it('maps assistant text deltas for the active turn', () => {
    expect(mapAppServerEvent({
      method: 'item/agentMessage/delta',
      params: { threadId: 'thread-1', turnId: 'turn-1', itemId: 'message-1', delta: 'Hello' },
    }, ctx)).toEqual([{
      type: 'assistant', ...metadata, message: { content: [{ type: 'text', text: 'Hello' }] },
    }]);
  });

  it('maps readable reasoning summaries without mapping raw reasoning text', () => {
    expect(mapAppServerEvent({
      method: 'item/reasoning/summaryTextDelta',
      params: { threadId: 'thread-1', turnId: 'turn-1', itemId: 'reason-1', delta: 'Checking files.' },
    }, ctx)).toEqual([{ type: 'reasoning_delta', text: 'Checking files.', ...metadata }]);

    expect(mapAppServerEvent({
      method: 'item/reasoning/textDelta',
      params: { threadId: 'thread-1', turnId: 'turn-1', itemId: 'reason-1', delta: 'private tokens' },
    }, ctx)).toEqual([]);
  });

  it('maps known tool and todo items to SDK-compatible tool events', () => {
    expect(mapAppServerEvent({
      method: 'item/started',
      params: {
        threadId: 'thread-1', turnId: 'turn-1',
        item: { id: 'cmd-1', type: 'commandExecution', command: 'npm test', status: 'inProgress' },
      },
    }, ctx)).toEqual([{
      type: 'assistant', ...metadata,
      message: { content: [{ id: 'cmd-1', type: 'tool_use', name: 'Bash', input: { command: 'npm test' } }] },
    }]);

    expect(mapAppServerEvent({
      method: 'item/started',
      params: {
        threadId: 'thread-1', turnId: 'turn-1',
        item: {
          id: 'todo-1', type: 'todoList',
          items: [{ text: 'Inspect', completed: true }, { text: 'Implement', completed: false }],
        },
      },
    }, ctx)).toEqual([{
      type: 'assistant', ...metadata,
      message: { content: [{
        id: 'todo-1', type: 'tool_use', name: 'TodoWrite', input: { todos: [
          { id: 'todo-1:0', content: 'Inspect', status: 'completed' },
          { id: 'todo-1:1', content: 'Implement', status: 'in_progress' },
        ] },
      }] },
    }]);
  });

  it('maps a collabToolCall start to scoped running subagent activity', () => {
    expect(mapAppServerEvent({
      method: 'item/started',
      params: {
        threadId: 'thread-1', turnId: 'turn-1',
        item: {
          id: 'child-1', type: 'collabToolCall', tool: 'spawn_agent',
          status: 'inProgress', prompt: 'Review the event mapper', agentStatus: 'running',
        },
      },
    }, ctx)).toEqual([{
      type: 'subagent_activity', agentId: 'child-1', status: 'running',
      summary: 'Review the event mapper', ...metadata,
    }]);
  });

  it('maps known item completion to a matching tool result', () => {
    expect(mapAppServerEvent({
      method: 'item/completed',
      params: {
        threadId: 'thread-1', turnId: 'turn-1',
        item: {
          id: 'cmd-1', type: 'commandExecution', command: 'npm test',
          aggregatedOutput: 'all green', exitCode: 0, status: 'completed',
        },
      },
    }, ctx)).toEqual([{
      type: 'user', ...metadata,
      message: { content: [{
        type: 'tool_result', tool_use_id: 'cmd-1', content: 'all green', is_error: false,
      }] },
    }]);
  });

  it('normalizes MCP completion content into renderer-safe text and image blocks', () => {
    expect(mapAppServerEvent({
      method: 'item/completed',
      params: {
        threadId: 'thread-1', turnId: 'turn-1',
        item: {
          id: 'mcp-1', type: 'mcpToolCall', status: 'completed',
          result: {
            content: [
              { type: 'text', text: 'Screenshot attached.' },
              { type: 'image', mimeType: 'image/png', data: 'aW1hZ2U=' },
              { type: 'resource_link', uri: 'file:///report.json', name: 'report.json' },
            ],
            structuredContent: { findings: ['clean'], count: 1 },
          },
        },
      },
    }, ctx)).toEqual([{
      type: 'user', ...metadata,
      message: { content: [{
        type: 'tool_result', tool_use_id: 'mcp-1', is_error: false,
        content: [
          { type: 'text', text: 'Screenshot attached.' },
          { type: 'image', source: { type: 'base64', media_type: 'image/png', data: 'aW1hZ2U=' } },
          { type: 'text', text: '{"name":"report.json","type":"resource_link","uri":"file:///report.json"}' },
          { type: 'text', text: '\n{"count":1,"findings":["clean"]}' },
        ],
      }] },
    }]);
  });

  it('wraps failed structured MCP completion content for the renderer', () => {
    expect(mapAppServerEvent({
      method: 'item/completed',
      params: {
        threadId: 'thread-1', turnId: 'turn-1',
        item: {
          id: 'mcp-failed', type: 'mcpToolCall', status: 'failed',
          result: { content: [{ type: 'text', text: 'The remote service rejected the request.' }] },
        },
      },
    }, ctx)).toEqual([{
      type: 'user', ...metadata,
      message: { content: [{
        type: 'tool_result', tool_use_id: 'mcp-failed', is_error: true,
        content: [
          { type: 'text', text: '<tool_error>' },
          { type: 'text', text: 'The remote service rejected the request.' },
          { type: 'text', text: '</tool_error>' },
        ],
      }] },
    }]);
  });

  it.each([
    { type: 'commandExecution', item: { aggregatedOutput: 'declined', exitCode: 0, status: 'declined' } },
    { type: 'fileChange', item: { changes: [], status: 'cancelled' } },
  ])('marks non-completed $type completions as errors', ({ type, item }) => {
    expect(mapAppServerEvent({
      method: 'item/completed',
      params: { threadId: 'thread-1', turnId: 'turn-1', item: { id: 'tool-1', type, ...item } },
    }, ctx)).toEqual([{
      type: 'user', ...metadata,
      message: { content: [{
        type: 'tool_result', tool_use_id: 'tool-1', is_error: true,
        content: type === 'commandExecution'
          ? '<tool_error>declined</tool_error>'
          : '<tool_error>[]</tool_error>',
      }] },
    }]);
  });

  it.each([
    { agentStatus: 'completed', expected: 'completed' },
    { agentStatus: 'cancelled', expected: 'cancelled' },
  ])('maps collabToolCall completion agentStatus $agentStatus', ({ agentStatus, expected }) => {
    expect(mapAppServerEvent({
      method: 'item/completed',
      params: {
        threadId: 'thread-1', turnId: 'turn-1',
        item: {
          id: 'child-1', type: 'collabToolCall', tool: 'spawn_agent',
          status: 'completed', agentStatus,
        },
      },
    }, ctx)).toEqual([{
      type: 'subagent_activity', agentId: 'child-1', status: expected,
      summary: 'spawn_agent', ...metadata,
    }]);
  });

  it.each([
    { status: 'completed', expected: [{ type: 'result', ...metadata }, { type: 'done', ...metadata }] },
    { status: 'interrupted', expected: [{ type: 'done', ...metadata }] },
    {
      status: 'failed', error: { message: 'boom' },
      expected: [{ type: 'error', text: 'boom', ...metadata }, { type: 'done', ...metadata }],
    },
  ])('maps matching turn completion status $status', ({ status, error, expected }) => {
    expect(mapAppServerEvent({
      method: 'turn/completed',
      params: { threadId: 'thread-1', turn: { id: 'turn-1', status, ...(error ? { error } : {}) } },
    }, ctx)).toEqual(expected);
  });

  it('does not terminate the active turn for a stale completion', () => {
    expect(mapAppServerEvent({
      method: 'turn/completed',
      params: { threadId: 'thread-1', turn: { id: 'turn-stale', status: 'completed' } },
    }, ctx)).toEqual([]);
  });

  it('ignores unknown notifications safely', () => {
    expect(mapAppServerEvent({ method: 'future/event', params: { unexpected: true } }, ctx)).toEqual([]);
  });
});
