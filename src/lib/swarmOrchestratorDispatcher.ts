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
  const inp = input ?? {};
  const reqString = (field: string): string | null =>
    typeof inp[field] === 'string' && inp[field].length > 0 ? inp[field] : null;
  switch (name) {
    case 'spawn_task': {
      if (typeof inp.prompt !== 'string' || !inp.prompt) return { ok: false, error: 'spawn_task requires a non-empty "prompt" string' };
      return { ok: true, task: await host.spawnTask(inp) };
    }
    case 'spawn_tasks': {
      if (!Array.isArray(inp.prompts) || inp.prompts.length === 0) return { ok: false, error: 'spawn_tasks requires a non-empty "prompts" array' };
      const projects = inp.projects === undefined || Array.isArray(inp.projects) ? inp.projects : undefined;
      return { ok: true, tasks: await host.spawnTasks(inp.prompts, projects) };
    }
    case 'query_status':
      return { ok: true, snapshot: await host.snapshot(typeof inp.filter === 'string' ? inp.filter : undefined) };
    case 'pause_task': {
      const ref = reqString('taskRef'); if (!ref) return { ok: false, error: 'pause_task requires a "taskRef" string' };
      await host.pause(ref); return { ok: true };
    }
    case 'resume_task': {
      const ref = reqString('taskRef'); if (!ref) return { ok: false, error: 'resume_task requires a "taskRef" string' };
      await host.resume(ref); return { ok: true };
    }
    case 'approve_tool_call': {
      const id = reqString('approvalId'); if (!id) return { ok: false, error: 'approve_tool_call requires an "approvalId" string' };
      await host.approve(id); return { ok: true };
    }
    case 'deny_tool_call': {
      const id = reqString('approvalId'); if (!id) return { ok: false, error: 'deny_tool_call requires an "approvalId" string' };
      await host.deny(id); return { ok: true };
    }
    case 'land': {
      const ref = reqString('taskRef'); if (!ref) return { ok: false, error: 'land requires a "taskRef" string' };
      return await host.land(ref);
    }
    case 'discard': {
      const ref = reqString('taskRef'); if (!ref) return { ok: false, error: 'discard requires a "taskRef" string' };
      await host.discard(ref); return { ok: true };
    }
    default:
      return { ok: false, error: `unknown tool: ${name}` };
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
