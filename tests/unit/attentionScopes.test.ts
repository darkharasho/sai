import { describe, it, expect } from 'vitest';
import { mergeAttentionScopes, questionSessionIdsFor } from '../../src/lib/awaitingQuestionTracker';
import { computeChatToasts } from '../../src/lib/chatToasts';

describe('mergeAttentionScopes', () => {
  it('adds stalled follow-ups only, without mutating the question set', () => {
    const q = new Set(['/p:a']);
    const out = mergeAttentionScopes(q, new Map([
      ['/p:b', { state: 'stalled' }], ['/p:c', { state: 'following' }],
    ]));
    expect([...out].sort()).toEqual(['/p:a', '/p:b']);
    expect([...q]).toEqual(['/p:a']);
  });
  it('returns the same set when nothing stalled', () => {
    const q = new Set<string>();
    expect(mergeAttentionScopes(q, new Map([['/p:c', { state: 'following' }]]))).toBe(q);
  });
  it('a stalled-only scope yields no question toast when toasts use the question-only set', () => {
    const q = new Set<string>();
    const attention = mergeAttentionScopes(q, new Map([['/p:s1', { state: 'stalled' }]]));
    expect(questionSessionIdsFor(attention, '/p').has('s1')).toBe(true);
    const sessions: any[] = [{ id: 's1', title: 'T' }];
    const seeds = computeChatToasts(new Set(), new Set(), new Set(), new Set(), sessions, 'other', 1, new Set(), new Set(), questionSessionIdsFor(q, '/p'));
    expect(seeds.some(x => x.message.includes('Waiting for your answer'))).toBe(false);
  });
});
