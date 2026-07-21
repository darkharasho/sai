import { describe, expect, it } from 'vitest';
import { effortsForCodexModel, normalizeCodexEffort } from '../../../src/lib/codexEffort';

describe('Codex model effort normalization', () => {
  const model = { id: 'no-min', name: 'No Minimal', supportedReasoningEfforts: ['low', 'high', 'xhigh'] as const, defaultReasoningEffort: 'high' as const };
  it('uses reported values and excludes unsupported minimal', () => expect(effortsForCodexModel(model as any)).toEqual(['low', 'high', 'xhigh']));
  it('uses the reported default when persisted effort is unsupported', () => expect(normalizeCodexEffort('minimal', model as any)).toBe('high'));
  it('uses a stable first supported fallback without a reported default', () => expect(normalizeCodexEffort('ultra', { id: 'x', name: 'X', supportedReasoningEfforts: ['low', 'medium'] })).toBe('low'));
  it('preserves an explicit empty supported set and produces no effort', () => {
    const noEffort = { id: 'none', name: 'None', supportedReasoningEfforts: [] };
    expect(effortsForCodexModel(noEffort)).toEqual([]);
    expect(normalizeCodexEffort('high', noEffort)).toBeUndefined();
  });
  it('keeps the legacy all-efforts fallback when metadata is absent', () => {
    expect(effortsForCodexModel({ id: 'legacy', name: 'Legacy' })).toContain('ultra');
  });
});
