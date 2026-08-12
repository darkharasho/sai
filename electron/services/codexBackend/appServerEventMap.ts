import type { AppServerNotification } from './appServerClient';
import type { SaiEnvelope } from './sdkEventMap';

export interface AppServerMapContext {
  projectPath: string;
  scope: string;
  turnSeq: number;
  /** A known thread prevents late notifications from a previous session leaking into this scope. */
  threadId?: string;
  /** Terminal notifications must name this turn before they can settle the scope. */
  turnId?: string;
}

type RecordValue = Record<string, unknown>;

const base = (ctx: AppServerMapContext) => ({
  projectPath: ctx.projectPath,
  scope: ctx.scope,
  turnSeq: ctx.turnSeq,
});

function isRecord(value: unknown): value is RecordValue {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function text(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

function threadId(params: RecordValue): string | undefined {
  return text(params.threadId) ?? (isRecord(params.thread) ? text(params.thread.id) : undefined);
}

function turnId(params: RecordValue): string | undefined {
  return text(params.turnId) ?? (isRecord(params.turn) ? text(params.turn.id) : undefined);
}

function belongsToThread(params: RecordValue, ctx: AppServerMapContext): boolean {
  const received = threadId(params);
  return !ctx.threadId || !received || received === ctx.threadId;
}

function belongsToTurn(params: RecordValue, ctx: AppServerMapContext): boolean {
  const received = turnId(params);
  return belongsToThread(params, ctx) && (!ctx.turnId || received === ctx.turnId);
}

function toolUse(id: string, name: string, input: unknown, ctx: AppServerMapContext): SaiEnvelope {
  return {
    type: 'assistant', ...base(ctx), message: { content: [{ id, type: 'tool_use', name, input }] },
  };
}

function toolResult(
  id: string,
  content: unknown,
  isError: boolean,
  ctx: AppServerMapContext,
): SaiEnvelope {
  return {
    type: 'user', ...base(ctx), message: {
      content: [{
        type: 'tool_result', tool_use_id: id,
        content: isError && typeof content === 'string' ? `<tool_error>${content || 'Tool failed'}</tool_error>` : content,
        is_error: isError,
      }],
    },
  };
}

function todoSnapshot(item: RecordValue, ctx: AppServerMapContext): SaiEnvelope[] {
  const id = text(item.id);
  if (!id || !Array.isArray(item.items)) return [];
  const todos = item.items
    .filter((entry): entry is RecordValue => isRecord(entry) && typeof entry.text === 'string' && typeof entry.completed === 'boolean')
    .map((entry) => ({ content: entry.text as string, completed: entry.completed as boolean }));
  const firstIncomplete = todos.findIndex((todo) => !todo.completed);
  return [toolUse(id, 'TodoWrite', {
    todos: todos.map((todo, index) => ({
      id: `${id}:${index}`,
      content: todo.content,
      status: todo.completed ? 'completed' : index === firstIncomplete ? 'in_progress' : 'pending',
    })),
  }, ctx)];
}

type SubagentStatus = 'running' | 'completed' | 'failed' | 'cancelled';

function collaborationActivity(
  item: RecordValue,
  ctx: AppServerMapContext,
  completed = false,
): SaiEnvelope[] | undefined {
  if (item.type !== 'collabToolCall') return undefined;
  const id = text(item.id);
  if (!id) return [];
  const rawStatus = text(item.agentStatus) ?? text(item.status) ?? '';
  const status: SubagentStatus = rawStatus === 'completed'
    ? 'completed'
    : rawStatus === 'failed'
      ? 'failed'
      : rawStatus === 'cancelled' || rawStatus === 'canceled'
        ? 'cancelled'
        : completed
          ? 'completed'
          : 'running';
  const source = text(item.prompt)?.trim() || text(item.tool)?.trim();
  const summary = source ? source.slice(0, 160) + (source.length > 160 ? '…' : '') : undefined;
  return [{
    type: 'subagent_activity', agentId: id, status,
    ...(summary ? { summary } : {}), ...base(ctx),
  }];
}

function startedItem(item: RecordValue, ctx: AppServerMapContext): SaiEnvelope[] {
  const collaboration = collaborationActivity(item, ctx);
  if (collaboration) return collaboration;
  const id = text(item.id);
  if (!id) return [];
  switch (item.type) {
    case 'commandExecution':
      return [toolUse(id, 'Bash', { command: text(item.command) ?? '' }, ctx)];
    case 'fileChange':
      return [toolUse(id, 'Edit', { changes: Array.isArray(item.changes) ? item.changes : [] }, ctx)];
    case 'mcpToolCall':
      return [toolUse(
        id,
        `mcp__${text(item.server) ?? 'unknown'}__${text(item.tool) ?? 'unknown'}`,
        item.arguments ?? {},
        ctx,
      )];
    case 'webSearch':
      return [toolUse(id, 'WebSearch', { query: text(item.query) ?? '' }, ctx)];
    case 'todoList':
    case 'todo_list':
      return todoSnapshot(item, ctx);
    default:
      return [];
  }
}

function completedItem(item: RecordValue, ctx: AppServerMapContext): SaiEnvelope[] {
  const collaboration = collaborationActivity(item, ctx, true);
  if (collaboration) return collaboration;
  const id = text(item.id);
  if (!id) return [];
  switch (item.type) {
    // Assistant and reasoning content is streamed by the dedicated delta
    // notifications. Re-emitting the completed aggregate would duplicate it.
    case 'agentMessage':
    case 'reasoning':
      return [];
    case 'commandExecution': {
      const status = text(item.status);
      const exitCode = typeof item.exitCode === 'number' ? item.exitCode : 0;
      return [toolResult(id, text(item.aggregatedOutput) ?? '', status === 'failed' || exitCode !== 0, ctx)];
    }
    case 'fileChange':
      return [toolResult(id, JSON.stringify(Array.isArray(item.changes) ? item.changes : []), text(item.status) === 'failed', ctx)];
    case 'mcpToolCall': {
      const error = isRecord(item.error) ? text(item.error.message) : undefined;
      return [toolResult(id, error ?? item.result ?? [], text(item.status) === 'failed', ctx)];
    }
    case 'webSearch':
      return [toolResult(id, text(item.query) ?? '', false, ctx)];
    case 'todoList':
    case 'todo_list':
      return [toolResult(id, JSON.stringify(Array.isArray(item.items) ? item.items : []), false, ctx)];
    default:
      return [];
  }
}

/**
 * Maps only the documented, renderer-safe App Server notification subset.
 * Raw reasoning (`item/reasoning/textDelta`) is deliberately never surfaced.
 */
export function mapAppServerEvent(
  event: Pick<AppServerNotification, 'method' | 'params'>,
  ctx: AppServerMapContext,
): SaiEnvelope[] {
  const params = isRecord(event.params) ? event.params : {};
  switch (event.method) {
    case 'thread/started': {
      const id = threadId(params);
      return id && belongsToThread(params, ctx)
        ? [{ type: 'session_id', sessionId: id, projectPath: ctx.projectPath, scope: ctx.scope }]
        : [];
    }
    case 'turn/started':
      return [];
    case 'item/agentMessage/delta': {
      const delta = text(params.delta);
      return belongsToTurn(params, ctx) && delta
        ? [{ type: 'assistant', ...base(ctx), message: { content: [{ type: 'text', text: delta }] } }]
        : [];
    }
    case 'item/reasoning/summaryTextDelta': {
      const delta = text(params.delta);
      return belongsToTurn(params, ctx) && delta
        ? [{ type: 'reasoning_delta', text: delta, ...base(ctx) }]
        : [];
    }
    case 'item/started':
      return belongsToTurn(params, ctx) && isRecord(params.item) ? startedItem(params.item, ctx) : [];
    case 'item/completed':
      return belongsToTurn(params, ctx) && isRecord(params.item) ? completedItem(params.item, ctx) : [];
    case 'turn/completed': {
      if (!belongsToTurn(params, ctx) || (ctx.turnId && turnId(params) !== ctx.turnId)) return [];
      const turn = isRecord(params.turn) ? params.turn : {};
      const status = text(turn.status);
      if (status === 'failed') {
        const error = isRecord(turn.error) ? text(turn.error.message) : undefined;
        return [{ type: 'error', text: error ?? 'Codex turn failed', ...base(ctx) }, { type: 'done', ...base(ctx) }];
      }
      if (status === 'interrupted') return [{ type: 'done', ...base(ctx) }];
      if (status === 'completed') return [{ type: 'result', ...base(ctx) }, { type: 'done', ...base(ctx) }];
      return [];
    }
    default:
      return [];
  }
}
