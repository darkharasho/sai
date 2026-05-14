export interface SwarmHost {
  spawnTask(input: { prompt: string; title?: string; provider?: string; model?: string; approvalPolicy?: string; project?: string }): Promise<{ id: string; title: string }>;
  spawnTasks(prompts: string[], projects?: string[]): Promise<Array<{ id: string; title: string }>>;
  snapshot(filter?: string): Promise<unknown>;
  pause(taskRef: string): Promise<void>;
  resume(taskRef: string): Promise<void>;
  approve(approvalId: string): Promise<void>;
  deny(approvalId: string): Promise<void>;
  land(taskRef: string): Promise<{ ok: true } | { ok: false; reason: string }>;
  discard(taskRef: string): Promise<void>;
}

export async function dispatchSwarmTool(name: string, input: any, host: SwarmHost) {
  switch (name) {
    case 'spawn_task': return { ok: true, task: await host.spawnTask(input) };
    case 'spawn_tasks': return { ok: true, tasks: await host.spawnTasks(input.prompts, input.projects) };
    case 'query_status': return { ok: true, snapshot: await host.snapshot(input.filter) };
    case 'pause_task': await host.pause(input.taskRef); return { ok: true };
    case 'resume_task': await host.resume(input.taskRef); return { ok: true };
    case 'approve_tool_call': await host.approve(input.approvalId); return { ok: true };
    case 'deny_tool_call': await host.deny(input.approvalId); return { ok: true };
    case 'land': return await host.land(input.taskRef);
    case 'discard': await host.discard(input.taskRef); return { ok: true };
    default: return { ok: false, error: `unknown tool: ${name}` };
  }
}

export interface SwarmToolRequest {
  id: string;
  tool: string;
  input: any;
  workspace: string;
}

export interface SwarmToolResponder {
  respond: (id: string, result: unknown) => void;
  respondError: (id: string, error: string) => void;
}

/**
 * Build a synthetic assistant ChatMessage that carries a single tool_use card
 * for an MCP swarm tool. Used as a fallback render path when the Claude CLI
 * does not surface MCP tool_use blocks in its stream-json output (so the
 * orchestrator chat would otherwise show no card for spawn_task et al.).
 *
 * The id format `mcp-tooluse-${requestId}` lets a follow-up call to
 * {@link applySyntheticToolResult} attach the tool's output to the same card.
 */
export function buildSyntheticToolUseMessage(req: SwarmToolRequest, now: number = Date.now()): {
  id: string;
  role: 'assistant';
  content: string;
  timestamp: number;
  startedAt: number;
  toolCalls: Array<{
    id: string;
    type: 'other';
    name: string;
    input: string;
    startedAt: number;
  }>;
} {
  const fullName = req.tool.startsWith('mcp__swarm__') ? req.tool : `mcp__swarm__${req.tool}`;
  return {
    id: `mcp-msg-${req.id}`,
    role: 'assistant',
    content: '',
    timestamp: now,
    startedAt: now,
    toolCalls: [
      {
        id: `mcp-tooluse-${req.id}`,
        type: 'other',
        name: fullName,
        input: typeof req.input === 'string' ? req.input : JSON.stringify(req.input ?? {}, null, 2),
        startedAt: now,
      },
    ],
  };
}

/**
 * Returns a new message list with the tool-call output attached to the
 * synthetic card created by {@link buildSyntheticToolUseMessage}. If no card
 * matching `requestId` is found, returns the input unchanged (best-effort).
 */
export function applySyntheticToolResult<M extends { id: string; toolCalls?: Array<{ id?: string; output?: string; durationMs?: number; startedAt?: number }> }>(
  messages: M[],
  requestId: string,
  result: unknown,
  now: number = Date.now(),
): M[] {
  const targetId = `mcp-tooluse-${requestId}`;
  let touched = false;
  const next = messages.map(m => {
    if (!m.toolCalls || !m.toolCalls.length) return m;
    let updated = false;
    const newCalls = m.toolCalls.map(tc => {
      if (tc.id !== targetId) return tc;
      updated = true;
      const output = typeof result === 'string' ? result : JSON.stringify(result, null, 2);
      const durationMs = typeof tc.startedAt === 'number' ? now - tc.startedAt : undefined;
      return { ...tc, output, ...(durationMs != null ? { durationMs } : {}) };
    });
    if (updated) {
      touched = true;
      return { ...m, toolCalls: newCalls };
    }
    return m;
  });
  return touched ? next : messages;
}

/**
 * Routes an incoming swarm tool request from the orchestrator MCP socket
 * (forwarded over IPC by the main process) to the active workspace's
 * SwarmHost. Rejects when the request's workspace does not match the
 * currently active workspace — orchestrator sessions are bound to the
 * workspace that was active when the socket connected.
 */
export async function handleSwarmToolRequest(
  req: SwarmToolRequest,
  opts: {
    activeWorkspace: string;
    host: SwarmHost;
    responder: SwarmToolResponder;
  },
): Promise<void> {
  const { activeWorkspace, host, responder } = opts;
  try {
    if (req.workspace && req.workspace !== activeWorkspace) {
      responder.respondError(
        req.id,
        `workspace mismatch: orchestrator socket bound to ${req.workspace} but active workspace is ${activeWorkspace}`,
      );
      return;
    }
    const result = await dispatchSwarmTool(req.tool, req.input, host);
    responder.respond(req.id, result);
  } catch (err: any) {
    responder.respondError(req.id, err?.message ?? String(err));
  }
}
