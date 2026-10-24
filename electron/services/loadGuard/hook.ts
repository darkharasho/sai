import type { HookCallback } from '@anthropic-ai/claude-agent-sdk';
import { getLoadGuard } from './index';
import type { Provider, ScopeTag } from './types';

/** Pending load note for a scope, consumed on read. Never throws; null when there is no guard (non-linux). */
function takeNoteSafe(provider: Provider, projectPath: string, scope: string): string | null {
  try {
    return getLoadGuard()?.takeNote(provider, projectPath, scope) ?? null;
  } catch {
    return null;
  }
}

/** Claude SDK hook (PreToolUse, no matcher, + UserPromptSubmit): hands a pending
 *  load note to the model as additionalContext — mid-turn on the next tool call,
 *  or with the next prompt. Never denies, never throws. */
export function buildLoadGuardHook(provider: 'claude', projectPath: string, scope: string): HookCallback {
  return async (input) => {
    try {
      const note = takeNoteSafe(provider, projectPath, scope);
      if (!note) return {};
      return {
        hookSpecificOutput: { hookEventName: input.hook_event_name, additionalContext: note },
      } as Awaited<ReturnType<HookCallback>>;
    } catch {
      return {};
    }
  };
}

/** Prompt-prefix delivery for providers without hooks. Apply to the payload sent
 *  to the provider only — never to the user message SAI stores or displays. */
export function withLoadNote(provider: Provider, projectPath: string, scope: string, prompt: string): string {
  // A slash command must stay first or the CLI never parses it; the note waits
  // for the next normal send.
  if (prompt.trimStart().startsWith('/')) return prompt;
  const note = takeNoteSafe(provider, projectPath, scope);
  return note ? `${note}\n\n${prompt}` : prompt;
}

/** The SdkBackend surface onAgentKilled needs (CliBackend lacks it → no-op). */
export interface ScopeSuspender {
  suspendScope?(projectPath: string, scope?: string): void;
}

/** LoadGuard's onAgentKilled dep. A killed claude SDK runtime leaves a dead query
 *  in SdkBackend: suspend the scope so the next send resume-respawns it. Other
 *  providers (and '*' hosts) just die and are restarted by their own next-send
 *  paths. Never throws into the guard. */
export function makeOnAgentKilled(
  getBackend: () => ScopeSuspender | null | undefined,
  devlog: (event: string, data?: Record<string, unknown>) => void,
): (tag: ScopeTag) => void {
  return (tag) => {
    try {
      devlog('agent_killed', { ...tag });
      if (tag.provider !== 'claude' || tag.scope === '*') return;
      getBackend()?.suspendScope?.(tag.projectPath, tag.scope);
    } catch { /* never throws */ }
  };
}
