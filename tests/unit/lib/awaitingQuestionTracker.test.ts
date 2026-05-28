import { describe, it, expect } from 'vitest';
import { applyQuestionEvent } from '@/lib/awaitingQuestionTracker';

describe('applyQuestionEvent', () => {
  it('adds projectPath on question_needed', () => {
    const out = applyQuestionEvent(new Set(), { type: 'question_needed', projectPath: '/a' });
    expect(out.has('/a')).toBe(true);
  });

  it('removes projectPath on question_answered', () => {
    const out = applyQuestionEvent(new Set(['/a']), { type: 'question_answered', projectPath: '/a' });
    expect(out.has('/a')).toBe(false);
  });

  it('removes projectPath on result', () => {
    const out = applyQuestionEvent(new Set(['/a']), { type: 'result', projectPath: '/a' });
    expect(out.has('/a')).toBe(false);
  });

  it('removes projectPath on done', () => {
    const out = applyQuestionEvent(new Set(['/a']), { type: 'done', projectPath: '/a' });
    expect(out.has('/a')).toBe(false);
  });

  it('returns the same instance for unrelated message types (no churn)', () => {
    const prev = new Set(['/a']);
    const out = applyQuestionEvent(prev, { type: 'assistant', projectPath: '/a' });
    expect(out).toBe(prev);
  });

  it('returns the same instance when question_answered fires for a workspace not in the set', () => {
    const prev = new Set<string>();
    const out = applyQuestionEvent(prev, { type: 'question_answered', projectPath: '/a' });
    expect(out).toBe(prev);
  });

  it('returns the same instance when question_needed fires for a workspace already in the set', () => {
    const prev = new Set(['/a']);
    const out = applyQuestionEvent(prev, { type: 'question_needed', projectPath: '/a' });
    expect(out).toBe(prev);
  });

  it('does not touch other workspaces in the set', () => {
    const prev = new Set(['/a', '/b']);
    const out = applyQuestionEvent(prev, { type: 'question_answered', projectPath: '/a' });
    expect(out.has('/a')).toBe(false);
    expect(out.has('/b')).toBe(true);
  });
});
