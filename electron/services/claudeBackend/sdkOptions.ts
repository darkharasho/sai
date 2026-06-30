import type { Options, EffortLevel, CanUseTool } from '@anthropic-ai/claude-agent-sdk';

export interface SdkOptionInputs {
  kind: 'chat' | 'task' | 'orchestrator';
  permMode?: string;           // 'bypass' | 'default' | undefined
  effort?: string;             // 'low'|'medium'|'high'|'max'
  model?: string;
  cwd: string;
  sessionId?: string;          // when set → resume
  claudeExecutablePath?: string;
  appendSystemPrompt?: string; // CHAT_RENDER_NUDGE + CHAT_GITHUB_WATCH_NUDGE + metaPreamble, joined
  canUseTool?: CanUseTool;     // tool-approval callback; not set in bypass mode
}

const VALID_EFFORT = new Set<string>(['low', 'medium', 'high', 'max']);

/**
 * Pure function that maps SAI's per-scope config to the claude-agent-sdk
 * `Options` object. Mirrors the CHAT path of `buildArgs` in claude.ts, minus
 * MCP — no mcpServers / canUseTool / strictMcpConfig / tools keys are set here.
 */
export function buildSdkOptions(input: SdkOptionInputs): Options {
  const {
    kind,
    permMode,
    effort,
    model,
    cwd,
    sessionId,
    claudeExecutablePath,
    appendSystemPrompt,
    canUseTool,
  } = input;

  const permissionMode: Options['permissionMode'] =
    kind === 'orchestrator' || permMode === 'bypass'
      ? 'bypassPermissions'
      : 'acceptEdits';

  const systemPrompt: Options['systemPrompt'] =
    appendSystemPrompt && appendSystemPrompt.length > 0
      ? { type: 'preset', preset: 'claude_code', append: appendSystemPrompt }
      : { type: 'preset', preset: 'claude_code' };

  const opts: Options = {
    permissionMode,
    cwd,
    includePartialMessages: true,
    systemPrompt,
  };

  if (effort && VALID_EFFORT.has(effort)) {
    opts.effort = effort as EffortLevel;
  }

  if (model) {
    opts.model = model;
  }

  if (sessionId) {
    opts.resume = sessionId;
  }

  if (claudeExecutablePath) {
    opts.pathToClaudeCodeExecutable = claudeExecutablePath;
  }

  // canUseTool is never set in bypass mode (bypassPermissions handles all tools automatically)
  const isBypass = kind === 'orchestrator' || permMode === 'bypass';
  if (canUseTool && !isBypass) {
    opts.canUseTool = canUseTool;
  }

  return opts;
}
