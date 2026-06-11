import type { EffortLevel, ModelChoice } from '../types';

export interface ClaudeWorkspaceOverride {
  model?: ModelChoice;
  effort?: EffortLevel;
}
/** Keyed by projectPath — the SAME strings used as keys of the workspaces Map.
 *  Never re-derive keys from another path form (symlinked-home trap). */
export type ClaudeOverrideMap = Record<string, ClaudeWorkspaceOverride>;

export interface ResolvedClaudeConfig {
  model: ModelChoice;
  effort: EffortLevel;
  modelOverridden: boolean;
  effortOverridden: boolean;
}

export function resolveClaudeConfig(
  overrides: ClaudeOverrideMap,
  wsPath: string,
  globals: { model: ModelChoice; effort: EffortLevel },
): ResolvedClaudeConfig {
  const o = overrides[wsPath] ?? {};
  return {
    model: o.model ?? globals.model,
    effort: o.effort ?? globals.effort,
    modelOverridden: o.model != null,
    effortOverridden: o.effort != null,
  };
}

/** Immutable update; null clears a field; entries with no fields left are pruned. */
export function setWorkspaceOverride(
  overrides: ClaudeOverrideMap,
  wsPath: string,
  patch: { model?: ModelChoice | null; effort?: EffortLevel | null },
): ClaudeOverrideMap {
  const current = { ...(overrides[wsPath] ?? {}) };
  if ('model' in patch) {
    if (patch.model == null) delete current.model;
    else current.model = patch.model;
  }
  if ('effort' in patch) {
    if (patch.effort == null) delete current.effort;
    else current.effort = patch.effort;
  }
  const next = { ...overrides };
  if (Object.keys(current).length === 0) delete next[wsPath];
  else next[wsPath] = current;
  return next;
}

/** Validate a persisted map: drop unknown shapes and invalid values. */
export function sanitizeOverrideMap(
  raw: unknown,
  isModel: (v: unknown) => v is ModelChoice,
  isEffort: (v: unknown) => v is EffortLevel,
): ClaudeOverrideMap {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};
  const out: ClaudeOverrideMap = {};
  for (const [path, entry] of Object.entries(raw as Record<string, unknown>)) {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) continue;
    const e = entry as Record<string, unknown>;
    const cleaned: ClaudeWorkspaceOverride = {};
    if (isModel(e.model)) cleaned.model = e.model;
    if (isEffort(e.effort)) cleaned.effort = e.effort;
    if (Object.keys(cleaned).length > 0) out[path] = cleaned;
  }
  return out;
}
