import { describe, expect, it } from 'vitest';
import { resolveSwarmClaudeConfig } from '@/lib/swarmClaudeConfig';

describe('resolveSwarmClaudeConfig', () => {
  it('keeps the selected orchestrator model and app-wide effort for automatic status turns', () => {
    expect(resolveSwarmClaudeConfig({
      orchestratorModel: 'opus',
      fallbackModel: 'sonnet',
      effort: 'medium',
    })).toEqual({ model: 'opus', effort: 'medium' });
  });

  it('falls back to the app-wide model when no orchestrator model is configured', () => {
    expect(resolveSwarmClaudeConfig({
      orchestratorModel: null,
      fallbackModel: 'opus',
      effort: 'medium',
    })).toEqual({ model: 'opus', effort: 'medium' });
  });
});
