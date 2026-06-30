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
 * MCP — no mcpServers / strictMcpConfig / tools keys are set here. `canUseTool`
 * is passed through (set only for non-bypass) so SDK mode can prompt for tool
 * approvals; bypass never carries it.
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
  // NOTE (Phase 2 dogfood correction, 2026-06-30): canUseTool DOES fire in the
  // real app — but only for tools the user hasn't pre-approved. Earlier headless
  // spikes that concluded "dormant" were masked by the user's global
  // ~/.claude/settings.json (defaultMode: bypassPermissions + allow:[Bash(*),...])
  // and project .claude/settings.local.json (allow:[Bash(*)]), so the Bash we
  // tested was always pre-approved and never prompted. To make SDK-mode approvals
  // reliable regardless of the user's global config, this still needs
  // `settingSources` control so a global defaultMode: bypassPermissions doesn't
  // silently auto-allow everything. (AskUserQuestion/ExitPlanMode are auto-allowed
  // in SdkBackend._buildCanUseTool — they have their own cards, not approval banners.)

  return opts;
}
