import type { SaiToolDef } from './saiTools';

/**
 * `sai_task` — lets the model declare/update task cards in SAI's task rail.
 * Deliberately NOT in SAI_TOOL_SCHEMA: it is registered only on the SDK chat
 * MCP server, so the CLI socket server and Codex never see it.
 */
export const SAI_TASK_TOOL: SaiToolDef = {
  name: 'task',
  toolset: 'chat',
  description:
    'Show and update task cards in SAI\'s task panel. When the user asks for several things at once, or for one piece of multi-step work, call this FIRST with action "create" and one task per distinct request. Each task gets a short id, a short title, and its real steps. As you work, call action "update": set status "running" with `step` = index of the step now in progress (earlier steps count as done), set status "done" with a one-line `note` when finished, or "failed" with the reason. When you hand a task to the Agent tool, pass `agent` = the exact `description` you gave the Agent call. Use this instead of TaskCreate/TodoWrite. Skip it for single-step or conversational requests.',
  input_schema: {
    type: 'object',
    properties: {
      action: { type: 'string', enum: ['create', 'update'], description: 'create declares tasks; update changes one.' },
      tasks: {
        type: 'array',
        description: 'For create: one entry per distinct request.',
        items: {
          type: 'object',
          properties: {
            id: { type: 'string', description: 'Short stable id.' },
            title: { type: 'string', description: 'Short title.' },
            steps: { type: 'array', items: { type: 'string' }, description: 'The real steps, in order.' },
          },
          required: ['id', 'title', 'steps'],
        },
      },
      id: { type: 'string', description: 'For update: the task id.' },
      status: { type: 'string', enum: ['running', 'done', 'failed'] },
      step: { type: 'number', description: 'Index of the step now in progress.' },
      note: { type: 'string', description: 'One-line result or failure reason.' },
      agent: { type: 'string', description: 'The exact `description` passed to the Agent tool.' },
      add_steps: { type: 'array', items: { type: 'string' }, description: 'Steps to append.' },
    },
    required: ['action'],
  },
};

export function validateSaiTaskInput(input: unknown): { ok: true } | { ok: false; error: string } {
  if (!input || typeof input !== 'object') return { ok: false, error: 'input must be an object' };
  const i = input as Record<string, unknown>;
  if (i.action !== 'create' && i.action !== 'update') {
    return { ok: false, error: 'action must be "create" or "update"' };
  }
  if (i.action === 'create') {
    if (!Array.isArray(i.tasks) || i.tasks.length === 0) {
      return { ok: false, error: 'tasks is required for create (non-empty array)' };
    }
    for (const t of i.tasks) {
      const r = t as Record<string, unknown> | null;
      if (!r || typeof r.id !== 'string' || typeof r.title !== 'string' || !Array.isArray(r.steps)) {
        return { ok: false, error: 'each task needs string id, string title and steps array' };
      }
    }
    return { ok: true };
  }
  if (typeof i.id !== 'string' || !i.id) return { ok: false, error: 'id is required for update' };
  if (i.step !== undefined && (typeof i.step !== 'number' || !Number.isFinite(i.step))) {
    return { ok: false, error: 'step must be a number' };
  }
  if (i.status !== undefined && i.status !== 'running' && i.status !== 'done' && i.status !== 'failed') {
    return { ok: false, error: 'status must be running, done or failed' };
  }
  if (i.add_steps !== undefined && !Array.isArray(i.add_steps)) {
    return { ok: false, error: 'add_steps must be an array of strings' };
  }
  return { ok: true };
}

export function isSaiTaskToolName(name: string): boolean {
  return typeof name === 'string' && (name === 'task' || name.endsWith('sai_task'));
}
