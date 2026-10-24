import type { HookCallback } from '@anthropic-ai/claude-agent-sdk';
import { getLoadGuard } from './index';
import type { Provider } from './types';

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
  const note = takeNoteSafe(provider, projectPath, scope);
  return note ? `${note}\n\n${prompt}` : prompt;
}
