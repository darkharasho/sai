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
  // NOTE (Phase 2 dogfood, 2026-06-30): with @anthropic-ai/claude-agent-sdk@0.3.196
  // driving the installed claude CLI 2.1.195, the runtime never issues a
  // `can_use_tool` control request, so the canUseTool callback above is wired but
  // never invoked — tool approvals are DORMANT in SDK mode until the SDK/CLI
  // support lands. Tried: both runtimes, all permission modes, settingSources:[],
  // env-unset, headless + real app. When canUseTool starts firing, SDK mode will
  // also need `settingSources` control so a user's global defaultMode:
  // bypassPermissions doesn't silently disable approvals.

  return opts;
}
