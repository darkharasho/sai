import { describe, it, expect } from 'vitest';
import { computeChatNotificationCount, isTurnErrored } from '../../../src/lib/chatActivity';

describe('isTurnErrored', () => {
  it('returns false for non-result envelopes', () => {
    expect(isTurnErrored(null)).toBe(false);
    expect(isTurnErrored(undefined)).toBe(false);
    expect(isTurnErrored({ type: 'assistant' })).toBe(false);
    expect(isTurnErrored({ type: 'done' })).toBe(false);
    // A result-like envelope without an error field is not an error
    expect(isTurnErrored({ type: 'result' })).toBe(false);
    expect(isTurnErrored({ type: 'result', subtype: 'success' })).toBe(false);
  });

  it('returns true when is_error is explicitly set', () => {
    expect(isTurnErrored({ type: 'result', is_error: true })).toBe(true);
  });

  it('returns true for the known error subtypes', () => {
    expect(isTurnErrored({ type: 'result', subtype: 'error_during_execution' })).toBe(true);
    expect(isTurnErrored({ type: 'result', subtype: 'error_max_turns' })).toBe(true);
  });

  it('treats is_error: false as not errored even if other fields are present', () => {
    expect(isTurnErrored({ type: 'result', is_error: false, subtype: 'success' })).toBe(false);
  });
});

describe('computeChatNotificationCount', () => {
  it('returns 0 when all sets are empty', () => {
    expect(computeChatNotificationCount({
      unread: new Set(),
      awaiting: new Set(),
      error: new Set(),
    })).toBe(0);
  });

  it('counts distinct sessions across unread + awaiting + error', () => {
    expect(computeChatNotificationCount({
      unread: new Set(['a', 'b']),
      awaiting: new Set(['c']),
      error: new Set(['d']),
    })).toBe(4);
  });

  it('deduplicates sessions appearing in multiple sets', () => {
    // 'a' is both unread and awaiting — still counts once
    expect(computeChatNotificationCount({
      unread: new Set(['a', 'b']),
      awaiting: new Set(['a']),
      error: new Set(['b']),
    })).toBe(2);
  });

  it('excludes the active session even when it appears in input sets', () => {
    expect(computeChatNotificationCount({
      unread: new Set(['active', 'b']),
      awaiting: new Set(['active']),
      error: new Set(['active', 'c']),
      activeSessionId: 'active',
    })).toBe(2); // b + c
  });

  it('treats activeSessionId undefined as "no exclusion"', () => {
    expect(computeChatNotificationCount({
      unread: new Set(['a']),
      awaiting: new Set(['b']),
      error: new Set(['c']),
    })).toBe(3);
  });
});
