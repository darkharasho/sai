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
