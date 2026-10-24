import type { Provider, ScopeTag } from './types';

/**
 * Env var stamped on every AI-provider child so the load guard can tell what
 * SAI's AI launched (descendants inherit it). Never set for user terminals.
 */
export const SCOPE_ENV = 'SAI_LOAD_SCOPE';

const VERSION = 'v1';
const PROVIDERS: ReadonlySet<string> = new Set(['claude', 'codex', 'gemini', 'kimi']);

/** `v1|<instance>|<provider>|<encoded scope>|<projectPath>` — projectPath last, unencoded. */
export function formatScopeTag(t: ScopeTag): string {
  return [VERSION, t.instance, t.provider, encodeURIComponent(t.scope), t.projectPath].join('|');
}

export function parseScopeTag(s: string): ScopeTag | null {
  const parts = s.split('|');
  if (parts.length < 5 || parts[0] !== VERSION) return null;
  const instance = Number(parts[1]);
  if (!Number.isInteger(instance) || instance <= 0) return null;
  if (!PROVIDERS.has(parts[2])) return null;
  let scope: string;
  try {
    scope = decodeURIComponent(parts[3]);
  } catch {
    return null;
  }
  return { instance, provider: parts[2] as Provider, scope, projectPath: parts.slice(4).join('|') };
}

/** Returns a copy of `env` stamped with this instance's tag. */
export function withScopeTag<E extends Record<string, string | undefined>>(
  env: E,
  t: Omit<ScopeTag, 'instance'>,
): E {
  return { ...env, [SCOPE_ENV]: formatScopeTag({ ...t, instance: process.pid }) };
}

/** Drop a tag inherited from a parent SAI so our own terminals stay untagged. */
export function stripInheritedScopeTag(env: NodeJS.ProcessEnv): void {
  delete env[SCOPE_ENV];
}
