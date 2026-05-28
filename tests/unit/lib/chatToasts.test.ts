import { describe, it, expect } from 'vitest';
import { computeChatToasts } from '../../../src/lib/chatToasts';
import type { ChatSession } from '../../../src/types';

const mkSession = (id: string, title: string): ChatSession => ({
  id, title, messages: [], createdAt: 0, updatedAt: 0, messageCount: 0,
});

describe('computeChatToasts', () => {
  it('emits a success toast when a non-active session stops streaming', () => {
    const seeds = computeChatToasts(
      new Set(['a']), new Set(),
      new Set(), new Set(),
      [mkSession('a', 'Chat A')],
      'other',
      1000,
    );
    expect(seeds).toHaveLength(1);
    expect(seeds[0].tone).toBe('success');
    expect(seeds[0].message).toContain('Chat A');
  });

  it('does not emit when the finishing session is active', () => {
    const seeds = computeChatToasts(
      new Set(['a']), new Set(),
      new Set(), new Set(),
      [mkSession('a', 'Chat A')],
      'a',
      1000,
    );
    expect(seeds).toHaveLength(0);
  });

  it('emits an attention toast for a newly awaiting non-active session', () => {
    const seeds = computeChatToasts(
      new Set(), new Set(),
      new Set(), new Set(['b']),
      [mkSession('b', 'Chat B')],
      'other',
      2000,
    );
    expect(seeds).toHaveLength(1);
    expect(seeds[0].tone).toBe('attention');
    expect(seeds[0].message).toContain('Chat B');
  });

  it('does not re-emit when the awaiting set is unchanged', () => {
    const seeds = computeChatToasts(
      new Set(), new Set(),
      new Set(['b']), new Set(['b']),
      [mkSession('b', 'Chat B')],
      'other',
      2000,
    );
    expect(seeds).toHaveLength(0);
  });
});
