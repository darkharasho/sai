// PreToolUse gate for agent-run sudo. A hook (not canUseTool) because hooks
// fire in EVERY permission mode — bypassPermissions included — and for
// pre-approved tools, which skip canUseTool entirely (the user's global
// settings allow Bash(*)). Free of electron imports.

import type { HookCallback } from '@anthropic-ai/claude-agent-sdk';
import { commandRequiresSudo } from './sudoSession';
import type { SudoPromptArgs } from './sudoBroker';

export const SUDO_DENY_REASON =
  'Sudo elevation was not granted (cancelled, timed out, or wrong password). The command was not run.';

export interface SudoHookDeps {
  projectPath: string;
  scope: string;
  ensureUnlocked: (args: SudoPromptArgs) => Promise<boolean>;
  /** Cancel the outstanding prompt if this scope owns it (turn aborted). */
  cancelPromptForScope?: (scope: string) => void;
}

const DENY = {
  hookSpecificOutput: {
    hookEventName: 'PreToolUse',
    permissionDecision: 'deny',
    permissionDecisionReason: SUDO_DENY_REASON,
  },
} as const;

/**
 * Build the per-session PreToolUse hook. Blocks a sudo-bearing Bash command
 * until the app-wide credential is unlocked (prompting once if needed);
 * denies with a clear reason when elevation is not granted.
 */
export function buildSudoPreToolUseHook(deps: SudoHookDeps): HookCallback {
  return async (input, _toolUseID, options) => {
    if (input.hook_event_name !== 'PreToolUse' || input.tool_name !== 'Bash') return {};
    const command = (input.tool_input as { command?: unknown } | null)?.command;
    if (typeof command !== 'string' || !commandRequiresSudo(command)) return {};

    const signal = options?.signal;
    // If the turn was already aborted before we got here, don't even start a
    // prompt — deny immediately without touching the broker.
    if (signal?.aborted) return DENY;

    const promptArgs: SudoPromptArgs = {
      projectPath: deps.projectPath,
      scope: deps.scope,
      toolUseId: input.tool_use_id,
      command,
    };

    const unlocked = await new Promise<boolean>((resolve) => {
      let settled = false;
      const onAbort = () => {
        if (settled) return;
        settled = true;
        deps.cancelPromptForScope?.(deps.scope);
        resolve(false);
      };
      signal?.addEventListener('abort', onAbort, { once: true });
      deps.ensureUnlocked(promptArgs).then((ok) => {
        if (settled) return;
        settled = true;
        signal?.removeEventListener('abort', onAbort);
        resolve(ok);
      });
    });

    if (unlocked) return {};
    return DENY;
  };
}
