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
    'Track multi-step work as tasks the user can open as feeds. When the user asks for several things at once, or for multi-step work, call this FIRST with action "create": one task per distinct request, title only (steps are optional and not displayed). Mark a task running (action "update", status "running") right before you start it and whenever you switch to a different task: everything you say and every tool you run is filed under the task you last marked running. Set status "done" with a one-line `note` when finished, or "failed" with the reason. When you hand a task to the Agent tool, pass `agent` = the exact `description` you gave the Agent call. While a chat has tasks, write one short sentence before each batch of tool calls. Use this instead of TaskCreate/TodoWrite. Skip it for single-step or conversational requests.',
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
            steps: { type: 'array', items: { type: 'string' }, description: 'Optional, not displayed.' },
            agent: { type: 'string', description: 'If a background agent will do this task: the exact `description` you will pass to the Agent tool.' },
          },
          required: ['id', 'title'],
        },
      },
      id: { type: 'string', description: 'For update: the task id. Also tags the work that follows onto this task\'s card.' },
      status: { type: 'string', enum: ['running', 'done', 'failed'] },
      step: { type: 'number', description: 'Optional, not displayed.' },
      note: { type: 'string', description: 'One-line result or failure reason.' },
      agent: { type: 'string', description: 'The exact `description` passed to the Agent tool.' },
      add_steps: { type: 'array', items: { type: 'string' }, description: 'Optional, not displayed.' },
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
      if (!r || typeof r.id !== 'string' || typeof r.title !== 'string') {
        return { ok: false, error: 'each task needs string id and string title' };
      }
      if (r.steps !== undefined && !Array.isArray(r.steps)) {
        return { ok: false, error: 'steps must be an array of strings' };
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
  return name === 'task' || name === 'mcp__sai__sai_task' || name === 'sai_task';
}
