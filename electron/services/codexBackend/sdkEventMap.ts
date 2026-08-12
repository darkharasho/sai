import type { ThreadEvent, ThreadItem } from '@openai/codex-sdk';

export interface CodexMapContext {
  projectPath: string;
  scope: string;
  turnSeq: number;
}

export type SaiEnvelope = Record<string, unknown> & { type: string };

type McpResult = NonNullable<Extract<ThreadItem, { type: 'mcp_tool_call' }>['result']>;
type McpContentBlock = McpResult['content'][number];

type RendererContentBlock =
  | { type: 'text'; text: string }
  | {
      type: 'image';
      source: { type: 'base64'; media_type: string; data: string };
    };

type ToolResultContent = string | RendererContentBlock[];

const base = (ctx: CodexMapContext) => ({
  projectPath: ctx.projectPath,
  scope: ctx.scope,
  turnSeq: ctx.turnSeq,
});

function toolUse(
  id: string,
  name: string,
  input: unknown,
  ctx: CodexMapContext,
): SaiEnvelope {
  return {
    type: 'assistant',
    ...base(ctx),
    message: { content: [{ id, type: 'tool_use', name, input }] },
  };
}

function toolResult(
  id: string,
  content: ToolResultContent,
  isError: boolean,
  ctx: CodexMapContext,
): SaiEnvelope {
  const compatibleContent = isError ? toolErrorContent(content) : content;
  return {
    type: 'user',
    ...base(ctx),
    message: {
      content: [{
        type: 'tool_result',
        tool_use_id: id,
        content: compatibleContent,
        is_error: isError,
      }],
    },
  };
}

function stableJson(value: unknown): string {
  const seen = new WeakSet<object>();

  const normalize = (current: unknown): unknown => {
    if (
      current === null
      || typeof current === 'string'
      || typeof current === 'boolean'
      || typeof current === 'number'
    ) {
      return current;
    }
    if (typeof current === 'bigint') return current.toString();
    if (typeof current !== 'object') return String(current);
    if (seen.has(current)) return '[Circular]';

    seen.add(current);
    if (Array.isArray(current)) {
      const normalized = current.map(normalize);
      seen.delete(current);
      return normalized;
    }

    const record = current as Record<string, unknown>;
    const normalized: Record<string, unknown> = Object.create(null);
    for (const key of Object.keys(record).sort()) {
      normalized[key] = normalize(record[key]);
    }
    seen.delete(current);
    return normalized;
  };

  return JSON.stringify(normalize(value));
}

function rendererMcpBlock(block: McpContentBlock): RendererContentBlock {
  switch (block.type) {
    case 'text':
      return { type: 'text', text: block.text };
    case 'image':
      return {
        type: 'image',
        source: {
          type: 'base64',
          media_type: block.mimeType,
          data: block.data,
        },
      };
    case 'audio':
    case 'resource_link':
    case 'resource':
      return { type: 'text', text: stableJson(block) };
  }
}

function rendererMcpContent(result: McpResult | undefined): RendererContentBlock[] {
  if (!result) return [];

  const content = Array.isArray(result.content) ? result.content.map(rendererMcpBlock) : [];
  if (result.structured_content !== null && result.structured_content !== undefined) {
    content.push({
      type: 'text',
      text: `${content.length > 0 ? '\n' : ''}${stableJson(result.structured_content)}`,
    });
  }
  return content;
}

function toolErrorContent(content: ToolResultContent): ToolResultContent {
  if (typeof content === 'string') {
    return `<tool_error>${content || 'Tool failed'}</tool_error>`;
  }

  const hasMessage = content.some(
    (block) => block.type === 'text' && block.text.trim().length > 0,
  );
  return [
    { type: 'text', text: '<tool_error>' },
    ...(!hasMessage ? [{ type: 'text' as const, text: 'Tool failed' }] : []),
    ...content,
    { type: 'text', text: '</tool_error>' },
  ];
}

function normalizeTodos(item: Extract<ThreadItem, { type: 'todo_list' }>) {
  const valid = (Array.isArray(item.items) ? item.items : []).filter(
    (todo): todo is { text: string; completed: boolean } =>
      !!todo && typeof todo.text === 'string' && todo.text.trim().length > 0
      && typeof todo.completed === 'boolean',
  );
  const firstIncomplete = valid.findIndex((todo) => !todo.completed);
  return valid.map((todo, index) => ({
    id: `${item.id}:${index}`,
    content: todo.text,
    status: todo.completed ? 'completed' : index === firstIncomplete ? 'in_progress' : 'pending',
  }));
}

function todoSnapshot(
  item: Extract<ThreadItem, { type: 'todo_list' }>,
  ctx: CodexMapContext,
): SaiEnvelope[] {
  return [toolUse(item.id, 'TodoWrite', { todos: normalizeTodos(item) }, ctx)];
}

type SubagentStatus = 'running' | 'completed' | 'failed' | 'cancelled';

function collaborationActivity(
  item: unknown,
  ctx: CodexMapContext,
  completed = false,
): SaiEnvelope[] | null {
  // `collab_tool_call` is emitted by the bundled Codex CLI but is not yet part
  // of the SDK's ThreadItem union. Read it defensively so a future SDK shape
  // change cannot take down the whole turn stream.
  if (!item || typeof item !== 'object') return null;
  const record = item as Record<string, unknown>;
  if (record.type !== 'collab_tool_call') return null;
  if (typeof record.id !== 'string' || record.id.trim().length === 0) return [];

  const rawStatus = typeof record.status === 'string' ? record.status : '';
  const status: SubagentStatus = rawStatus === 'completed'
    ? 'completed'
    : rawStatus === 'failed'
      ? 'failed'
      : rawStatus === 'cancelled' || rawStatus === 'canceled'
        ? 'cancelled'
        : completed
          ? 'completed'
          : 'running';
  const description = typeof record.description === 'string' ? record.description.trim() : '';
  const prompt = typeof record.prompt === 'string' ? record.prompt.trim() : '';
  const source = description || prompt;
  const summary = source ? source.slice(0, 160) + (source.length > 160 ? '…' : '') : undefined;

  return [{
    type: 'subagent_activity',
    agentId: record.id,
    status,
    ...(summary ? { summary } : {}),
    ...base(ctx),
  }];
}

function startedItem(item: ThreadItem, ctx: CodexMapContext): SaiEnvelope[] {
  const collaboration = collaborationActivity(item, ctx);
  if (collaboration !== null) return collaboration;
  switch (item.type) {
    case 'command_execution':
      return [toolUse(item.id, 'Bash', { command: item.command }, ctx)];
    case 'file_change':
      return [toolUse(item.id, 'Edit', { changes: item.changes }, ctx)];
    case 'mcp_tool_call':
      return [toolUse(item.id, `mcp__${item.server}__${item.tool}`, item.arguments, ctx)];
    case 'web_search':
      return [toolUse(item.id, 'WebSearch', { query: item.query }, ctx)];
    case 'todo_list':
      return todoSnapshot(item, ctx);
    case 'agent_message':
    case 'reasoning':
    case 'error':
      return [];
    default:
      return [];
  }
}

function updatedItem(item: ThreadItem, ctx: CodexMapContext): SaiEnvelope[] {
  const collaboration = collaborationActivity(item, ctx);
  if (collaboration !== null) return collaboration;
  switch (item.type) {
    case 'todo_list':
      return todoSnapshot(item, ctx);
    case 'agent_message':
    case 'reasoning':
    case 'command_execution':
    case 'file_change':
    case 'mcp_tool_call':
    case 'web_search':
    case 'error':
      return [];
    default:
      return [];
  }
}

function completedItem(item: ThreadItem, ctx: CodexMapContext): SaiEnvelope[] {
  const collaboration = collaborationActivity(item, ctx, true);
  if (collaboration !== null) return collaboration;
  switch (item.type) {
    case 'agent_message':
      return item.text
        ? [{
            type: 'assistant',
            ...base(ctx),
            message: { content: [{ type: 'text', text: item.text }] },
          }]
        : [];
    case 'reasoning':
      return item.text
        ? [{ type: 'reasoning_delta', text: item.text, ...base(ctx) }]
        : [];
    case 'command_execution':
      return [toolResult(
        item.id,
        item.aggregated_output,
        item.status === 'failed' || (item.exit_code ?? 0) !== 0,
        ctx,
      )];
    case 'file_change':
      return [toolResult(
        item.id,
        JSON.stringify(item.changes),
        item.status === 'failed',
        ctx,
      )];
    case 'mcp_tool_call':
      return [toolResult(
        item.id,
        item.error?.message ?? rendererMcpContent(item.result),
        item.status === 'failed',
        ctx,
      )];
    case 'web_search':
      return [toolResult(item.id, item.query, false, ctx)];
    case 'todo_list':
      return [toolResult(item.id, JSON.stringify(item.items), false, ctx)];
    case 'error':
      return [{ type: 'error', text: item.message, ...base(ctx) }];
    default:
      return [];
  }
}

export function mapCodexSdkEvent(
  event: ThreadEvent,
  ctx: CodexMapContext,
): SaiEnvelope[] {
  switch (event.type) {
    case 'thread.started':
      return [{
        type: 'session_id',
        sessionId: event.thread_id,
        projectPath: ctx.projectPath,
        scope: ctx.scope,
      }];
    case 'turn.started':
      return [];
    case 'item.started':
      return startedItem(event.item, ctx);
    case 'item.updated':
      return updatedItem(event.item, ctx);
    case 'item.completed':
      return completedItem(event.item, ctx);
    case 'turn.completed':
      return [
        {
          type: 'result',
          ...base(ctx),
          usage: {
            input_tokens: event.usage.input_tokens,
            cache_read_input_tokens: event.usage.cached_input_tokens,
            cache_creation_input_tokens: 0,
            output_tokens: event.usage.output_tokens,
            reasoning_output_tokens: event.usage.reasoning_output_tokens,
          },
        },
        { type: 'done', ...base(ctx) },
      ];
    case 'turn.failed':
      return [
        { type: 'error', text: event.error.message, ...base(ctx) },
        { type: 'done', ...base(ctx) },
      ];
    case 'error':
      return [
        { type: 'error', text: event.message, ...base(ctx) },
        { type: 'done', ...base(ctx) },
      ];
    default:
      return [];
  }
}
