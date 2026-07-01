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
  systemPromptOverride?: string; // full-replacement system prompt (orchestrator); overrides the preset+append form
  canUseTool?: CanUseTool;     // tool-approval callback; not set in bypass mode
  mcpServers?: Record<string, unknown>; // in-process SDK MCP servers (chat tools); set only for chat
  env?: Record<string, string | undefined>; // subprocess env (enriched login-shell + memory cap)
  stderr?: (data: string) => void; // subprocess stderr (auth failures, crash diagnostics)
}

const VALID_EFFORT = new Set<string>(['low', 'medium', 'high', 'max']);

/**
 * Pure function that maps SAI's per-scope config to the claude-agent-sdk
 * `Options` object. Mirrors the CHAT path of `buildArgs` in claude.ts, minus
 * MCP — mcpServers is wired through when provided (for chat tools);
 * strictMcpConfig / tools keys are not set. `canUseTool`
 * is passed through (set only for non-bypass) so SDK mode can prompt for tool
 * approvals; bypass never carries it.
 *
 * Sets `settingSources: ['project', 'local']` to exclude the user-global
 * `~/.claude/settings.json` layer (where a `defaultMode: bypassPermissions` or
 * global allow-lists would otherwise auto-allow tools and disable SAI's
 * `canUseTool` approval flow). Project/local settings and the global CLAUDE.md
 * context still load via the system-prompt preset.
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
    systemPromptOverride,
    canUseTool,
    mcpServers,
    env,
    stderr,
  } = input;

  const permissionMode: Options['permissionMode'] =
    kind === 'orchestrator' || permMode === 'bypass'
      ? 'bypassPermissions'
      : 'acceptEdits';

  const systemPrompt: Options['systemPrompt'] =
    systemPromptOverride && systemPromptOverride.length > 0
      ? systemPromptOverride
      : appendSystemPrompt && appendSystemPrompt.length > 0
        ? { type: 'preset', preset: 'claude_code', append: appendSystemPrompt }
        : { type: 'preset', preset: 'claude_code' };

  const opts: Options = {
    permissionMode,
    cwd,
    includePartialMessages: true,
    systemPrompt,
    settingSources: ['project', 'local'],
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

  // Enriched login-shell env (+ NODE_OPTIONS memory cap) — without this a
  // Finder-launched packaged app hands the SDK subprocess the stripped GUI env,
  // losing ANTHROPIC_* / proxy vars, and the subprocess-memory-cap setting.
  if (env) {
    opts.env = env;
  }

  if (stderr) {
    opts.stderr = stderr;
  }

  if (mcpServers && Object.keys(mcpServers).length > 0) {
    opts.mcpServers = mcpServers as Options['mcpServers'];
  }

  if (kind === 'orchestrator') {
    opts.tools = [];
    opts.disallowedTools = ['Skill', 'Task', 'Agent', 'TodoWrite'];
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
