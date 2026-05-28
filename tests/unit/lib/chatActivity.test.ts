import { describe, it, expect } from 'vitest';
import { computeChatNotificationCount, computeCompletedWorkspaces, isTurnErrored } from '../../../src/lib/chatActivity';

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

describe('computeCompletedWorkspaces', () => {
  const ws = (projectPath: string, sessions: Array<{
    id: string;
    updatedAt: number;
    lastViewedAt?: number;
    lastTurnErrored?: boolean;
  }>) => ({ projectPath, sessions });

  it('starts from the input completedWorkspaces set', () => {
    const out = computeCompletedWorkspaces({
      completedWorkspaces: new Set(['/already-done']),
      workspaces: [],
    });
    expect([...out]).toEqual(['/already-done']);
  });

  it('adds a workspace whose session has updatedAt > lastViewedAt', () => {
    const out = computeCompletedWorkspaces({
      completedWorkspaces: new Set(),
      workspaces: [ws('/p', [{ id: 's', updatedAt: 2000, lastViewedAt: 1000 }])],
    });
    expect(out.has('/p')).toBe(true);
  });

  it('adds a workspace whose session has lastTurnErrored', () => {
    const out = computeCompletedWorkspaces({
      completedWorkspaces: new Set(),
      workspaces: [ws('/p', [{ id: 's', updatedAt: 1000, lastViewedAt: 1000, lastTurnErrored: true }])],
    });
    expect(out.has('/p')).toBe(true);
  });

  it('does NOT add a workspace whose only triggering session is the focused one', () => {
    // The user is looking at session 's' right now, so we don't badge its
    // workspace even though updatedAt > lastViewedAt.
    const out = computeCompletedWorkspaces({
      completedWorkspaces: new Set(),
      workspaces: [ws('/p', [{ id: 's', updatedAt: 2000, lastViewedAt: 1000 }])],
      focusedProjectPath: '/p',
      focusedSessionId: 's',
    });
    expect(out.has('/p')).toBe(false);
  });

  it('exempts only the focused session, not other sessions in the same workspace', () => {
    // Focused session is exempt; the OTHER session in /p triggers the badge.
    const out = computeCompletedWorkspaces({
      completedWorkspaces: new Set(),
      workspaces: [ws('/p', [
        { id: 'focused', updatedAt: 2000, lastViewedAt: 1000 },
        { id: 'other',   updatedAt: 5000, lastViewedAt: 4000 },
      ])],
      focusedProjectPath: '/p',
      focusedSessionId: 'focused',
    });
    expect(out.has('/p')).toBe(true);
  });

  it('treats a never-viewed session (lastViewedAt undefined) as viewed', () => {
    // The fallback `lastViewedAt ?? updatedAt` means a freshly-created
    // session with no view stamp shouldn't show the unread dot — otherwise
    // every existing chat would light up on app load.
    const out = computeCompletedWorkspaces({
      completedWorkspaces: new Set(),
      workspaces: [ws('/p', [{ id: 's', updatedAt: 2000 }])],
    });
    expect(out.has('/p')).toBe(false);
  });

  it('does not mutate the input completedWorkspaces set', () => {
    const input = new Set(['/x']);
    const out = computeCompletedWorkspaces({
      completedWorkspaces: input,
      workspaces: [ws('/p', [{ id: 's', updatedAt: 2000, lastViewedAt: 1000 }])],
    });
    expect(input.has('/p')).toBe(false);
    expect(out.has('/p')).toBe(true);
    expect(out).not.toBe(input);
  });

  it('handles multiple workspaces independently', () => {
    const out = computeCompletedWorkspaces({
      completedWorkspaces: new Set(),
      workspaces: [
        ws('/a', [{ id: '1', updatedAt: 2000, lastViewedAt: 1000 }]),     // unread → in
        ws('/b', [{ id: '2', updatedAt: 1000, lastViewedAt: 1000 }]),     // viewed → out
        ws('/c', [{ id: '3', updatedAt: 1000, lastViewedAt: 1000, lastTurnErrored: true }]), // errored → in
      ],
    });
    expect([...out].sort()).toEqual(['/a', '/c']);
  });
});
