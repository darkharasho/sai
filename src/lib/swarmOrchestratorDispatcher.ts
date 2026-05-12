export interface SwarmHost {
  spawnTask(input: { prompt: string; title?: string; provider?: string; model?: string; approvalPolicy?: string }): Promise<{ id: string; title: string }>;
  spawnTasks(prompts: string[]): Promise<Array<{ id: string; title: string }>>;
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
    case 'spawn_tasks': return { ok: true, tasks: await host.spawnTasks(input.prompts) };
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
