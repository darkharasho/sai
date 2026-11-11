import type { ToolCall } from '../../../types';

export function classifyToolType(name: string | undefined): ToolCall['type'] {
  return name?.includes('Edit') || name === 'Write' ? 'file_edit' :
         name?.includes('Bash') ? 'terminal_command' :
         name?.includes('Glob') || name?.includes('Grep') || name === 'ToolSearch' ? 'file_search' :
         name?.includes('Read') ? 'file_read' :
         name?.includes('WebFetch') || name?.includes('WebSearch') ? 'web_fetch' :
         name === 'TodoWrite' ? 'todo' :
         name === 'Agent' || name === 'SendUserMessage' ? 'agent' :
         name?.includes('Notebook') ? 'notebook' :
         name === 'AskUserQuestion' ? 'question' :
         name === 'EnterPlanMode' || name === 'ExitPlanMode' ? 'plan' :
         name === 'EnterWorktree' || name === 'ExitWorktree' ? 'worktree' :
         name === 'Skill' ? 'skill' :
         name === 'Monitor' || name === 'ScheduleWakeup' || name?.startsWith('Cron') ? 'schedule' :
         name === 'TaskOutput' || name === 'TaskStop' || name === 'RemoteTrigger' ? 'task' :
         name?.startsWith('mcp__') ? 'mcp' : 'other';
}
