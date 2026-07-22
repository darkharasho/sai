import { describe, expect, it } from 'vitest';
import {
  contextUsageFromCodex,
  codexRateLimitsToViews,
  claudeRateLimitsToViews,
  resolveEffectiveContextWindow,
} from '../../../src/lib/composerTelemetry';

describe('contextUsageFromCodex', () => {
  it('does not add cached input a second time and retains reasoning output', () => {
    expect(contextUsageFromCodex({
      input_tokens: 1_000,
      cached_input_tokens: 700,
      output_tokens: 250,
      reasoning_output_tokens: 100,
    }, 8_000)).toEqual({
      used: 1_250,
      total: 8_000,
      inputTokens: 1_000,
      cachedInputTokens: 700,
      cacheCreationTokens: 0,
      outputTokens: 250,
      reasoningOutputTokens: 100,
    });
  });

  it('returns token detail without a percentage denominator when the model window is unknown', () => {
    expect(contextUsageFromCodex({ input_tokens: 50, output_tokens: 10 }, undefined)).toMatchObject({
      used: 60,
      total: null,
    });
  });

  it('prefers an explicit smaller runtime context limit', () => {
    expect(resolveEffectiveContextWindow(258_400, 200_000)).toBe(200_000);
    expect(resolveEffectiveContextWindow(258_400, 300_000)).toBe(258_400);
    expect(resolveEffectiveContextWindow(undefined, undefined)).toBeUndefined();
  });
});

describe('usage limit adapters', () => {
  it('maps Codex primary and secondary windows into session and weekly groups', () => {
    expect(codexRateLimitsToViews({
      provider: 'codex',
      fetchedAt: 1_000,
      stale: false,
      primary: { usedPercent: 42, windowDurationMins: 300, resetsAt: 2_000 },
      secondary: { usedPercent: 73, windowDurationMins: 10_080, resetsAt: 3_000 },
    })).toEqual([
      { id: 'codex-primary', label: 'Current session', group: 'session', usedPercent: 42, resetsAt: 2_000, windowDurationMins: 300, updatedAt: 1_000, stale: false },
      { id: 'codex-secondary', label: 'All models', group: 'weekly', usedPercent: 73, resetsAt: 3_000, windowDurationMins: 10_080, updatedAt: 1_000, stale: false },
    ]);
  });

  it('preserves Claude labels, utilization, grouping, and overage metadata', () => {
    const limits = new Map([['five_hour', {
      rateLimitType: 'five_hour', resetsAt: 99, status: 'allowed',
      isUsingOverage: false, overageResetsAt: 0, utilization: 0.25, lastUpdated: 10,
    }]]);
    expect(claudeRateLimitsToViews(limits)[0]).toMatchObject({
      id: 'five_hour', label: 'Current session', group: 'session', usedPercent: 25,
      resetsAt: 99, updatedAt: 10, isUsingOverage: false,
    });
  });
});
