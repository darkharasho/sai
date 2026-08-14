import type { EffortLevel, ModelChoice } from '../types';

export function resolveSwarmClaudeConfig({
  orchestratorModel,
  fallbackModel,
  effort,
}: {
  orchestratorModel?: ModelChoice | null;
  fallbackModel: ModelChoice;
  effort: EffortLevel;
}): { model: ModelChoice; effort: EffortLevel } {
  return {
    model: orchestratorModel || fallbackModel,
    effort,
  };
}
