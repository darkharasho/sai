import { describe, it, expect } from 'vitest';
import { mergeSessionRefresh } from '@/lib/sessionRefresh';
import type { ChatSession } from '@/types';

function makeSession(overrides: Partial<ChatSession> = {}): ChatSession {
  const now = 1_000;
  return {
    id: 'id',
    title: 'T',
    messages: [],
    createdAt: now,
    updatedAt: now,
    messageCount: 0,
    ...overrides,
  };
}

describe('mergeSessionRefresh', () => {
  it('takes fresh rows wholesale when memory has nothing newer', () => {
    const fresh = [makeSession({ id: 'a', title: 'fresh title', lastViewedAt: 500 })];
    const current = [makeSession({ id: 'a', title: 'stale title', lastViewedAt: 400 })];
    const out = mergeSessionRefresh(fresh, current);
    expect(out).toHaveLength(1);
    expect(out[0].title).toBe('fresh title');
    expect(out[0].lastViewedAt).toBe(500);
  });

  it('keeps the newer in-memory lastViewedAt over a stale DB read', () => {
    // A dbPatchSessionMeta stamping lastViewedAt can still be in flight when
    // the refresh reads — the merge must not roll the session back to unread.
    const fresh = [makeSession({ id: 'a', updatedAt: 900, lastViewedAt: 800 })];
    const current = [makeSession({ id: 'a', updatedAt: 900, lastViewedAt: 950 })];
    const out = mergeSessionRefresh(fresh, current);
    expect(out[0].lastViewedAt).toBe(950);
  });

  it('handles rows missing from memory and vice versa', () => {
    const fresh = [makeSession({ id: 'a' }), makeSession({ id: 'b' })];
    const current = [makeSession({ id: 'b', lastViewedAt: 2_000 })];
    const out = mergeSessionRefresh(fresh, current);
    expect(out.map(s => s.id)).toEqual(['a', 'b']);
    expect(out[1].lastViewedAt).toBe(2_000);
  });

  it('prepends the not-yet-persisted active session', () => {
    const active = makeSession({ id: 'new', messages: [{ id: 'm', role: 'user', content: 'x', timestamp: 1 }] });
    const out = mergeSessionRefresh([makeSession({ id: 'a' })], [], active);
    expect(out[0].id).toBe('new');
    // List rows are messageless by convention.
    expect(out[0].messages).toEqual([]);
  });

  it('does not duplicate an active session the DB already has', () => {
    const active = makeSession({ id: 'a' });
    const out = mergeSessionRefresh([makeSession({ id: 'a' })], [], active);
    expect(out).toHaveLength(1);
  });
});
