import type { CodexEffort, CodexModelOption } from '../types';

export const ALL_CODEX_EFFORTS: CodexEffort[] = ['minimal', 'low', 'medium', 'high', 'xhigh', 'max', 'ultra'];

export function effortsForCodexModel(model: CodexModelOption | undefined): CodexEffort[] {
  return model && 'supportedReasoningEfforts' in model
    ? [...(model.supportedReasoningEfforts ?? [])]
    : [...ALL_CODEX_EFFORTS];
}

export function normalizeCodexEffort(effort: CodexEffort, model: CodexModelOption | undefined): CodexEffort | undefined {
  const supported = effortsForCodexModel(model);
  if (supported.includes(effort)) return effort;
  if (model?.defaultReasoningEffort && supported.includes(model.defaultReasoningEffort)) return model.defaultReasoningEffort;
  return supported.includes('high') ? 'high' : supported[0];
}
