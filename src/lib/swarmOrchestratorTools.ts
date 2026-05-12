export const SWARM_TOOL_SCHEMA = [
  {
    name: 'spawn_task',
    description: 'Spawn a new SwarmTask in the active workspace.',
    input_schema: {
      type: 'object',
      properties: {
        prompt: { type: 'string' },
        title: { type: 'string' },
        provider: { type: 'string', enum: ['claude','codex','gemini'] },
        model: { type: 'string' },
        approvalPolicy: { type: 'string', enum: ['auto','auto-read','always-ask'] },
      },
      required: ['prompt'],
    },
  },
  {
    name: 'spawn_tasks',
    description: 'Spawn multiple SwarmTasks at once.',
    input_schema: {
      type: 'object',
      properties: { prompts: { type: 'array', items: { type: 'string' } } },
      required: ['prompts'],
    },
  },
  { name: 'query_status', description: 'Return the current swarm state.', input_schema: { type: 'object', properties: { filter: { type: 'string' } } } },
  { name: 'pause_task', description: 'Pause a task.', input_schema: { type: 'object', properties: { taskRef: { type: 'string' } }, required: ['taskRef'] } },
  { name: 'resume_task', description: 'Resume a paused task.', input_schema: { type: 'object', properties: { taskRef: { type: 'string' } }, required: ['taskRef'] } },
  { name: 'approve_tool_call', description: 'Approve a pending tool-call approval.', input_schema: { type: 'object', properties: { approvalId: { type: 'string' } }, required: ['approvalId'] } },
  { name: 'deny_tool_call', description: 'Deny a pending tool-call approval.', input_schema: { type: 'object', properties: { approvalId: { type: 'string' } }, required: ['approvalId'] } },
  { name: 'land', description: 'Fast-forward merge a done task into its base branch and remove the worktree.', input_schema: { type: 'object', properties: { taskRef: { type: 'string' } }, required: ['taskRef'] } },
  { name: 'discard', description: 'Discard a task — delete branch and worktree.', input_schema: { type: 'object', properties: { taskRef: { type: 'string' } }, required: ['taskRef'] } },
] as const;
