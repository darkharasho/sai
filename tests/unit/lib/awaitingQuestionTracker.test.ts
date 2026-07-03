import { describe, it, expect } from 'vitest';
import {
  applyQuestionEvent,
  questionScopeKey,
  scopeKeyProjectPath,
  questionWorkspaces,
  questionSessionIdsFor,
} from '@/lib/awaitingQuestionTracker';

describe('questionScopeKey', () => {
  it('defaults scope to chat', () => {
    expect(questionScopeKey('/a')).toBe('/a:chat');
    expect(questionScopeKey('/a', 'sess-1')).toBe('/a:sess-1');
  });
});

describe('scopeKeyProjectPath', () => {
  it('returns the path half of a scope key', () => {
    expect(scopeKeyProjectPath('/a/b:sess-1')).toBe('/a/b');
  });

  it('survives a colon in the project path', () => {
    expect(scopeKeyProjectPath('/mnt/c:drive/proj:sess-1')).toBe('/mnt/c:drive/proj');
  });
});

describe('applyQuestionEvent (scope-keyed)', () => {
  it('adds the scope key on question_needed', () => {
    const out = applyQuestionEvent(new Set(), { type: 'question_needed', projectPath: '/a', scope: 's1' });
    expect(out.has('/a:s1')).toBe(true);
  });

  it('defaults to the chat scope when scope is missing', () => {
    const out = applyQuestionEvent(new Set(), { type: 'question_needed', projectPath: '/a' });
    expect(out.has('/a:chat')).toBe(true);
  });

  it('removes the scope key on question_answered', () => {
    const out = applyQuestionEvent(new Set(['/a:s1']), { type: 'question_answered', projectPath: '/a', scope: 's1' });
    expect(out.has('/a:s1')).toBe(false);
  });

  it('removes the scope key on result and done', () => {
    for (const type of ['result', 'done']) {
      const out = applyQuestionEvent(new Set(['/a:s1']), { type, projectPath: '/a', scope: 's1' });
      expect(out.has('/a:s1')).toBe(false);
    }
  });

  it("a sibling chat's turn ending does NOT clear another chat's question", () => {
    // The regression that motivated scope keys: chat A waits on a question,
    // chat B in the same workspace finishes a turn.
    const prev = new Set(['/a:chat-a']);
    const out = applyQuestionEvent(prev, { type: 'result', projectPath: '/a', scope: 'chat-b' });
    expect(out).toBe(prev);
    expect(out.has('/a:chat-a')).toBe(true);
  });

  it('returns the same instance for unrelated message types (no churn)', () => {
    const prev = new Set(['/a:s1']);
    const out = applyQuestionEvent(prev, { type: 'assistant', projectPath: '/a', scope: 's1' });
    expect(out).toBe(prev);
  });

  it('returns the same instance when answering a scope not in the set', () => {
    const prev = new Set<string>();
    const out = applyQuestionEvent(prev, { type: 'question_answered', projectPath: '/a', scope: 's1' });
    expect(out).toBe(prev);
  });

  it('returns the same instance when the scope is already waiting', () => {
    const prev = new Set(['/a:s1']);
    const out = applyQuestionEvent(prev, { type: 'question_needed', projectPath: '/a', scope: 's1' });
    expect(out).toBe(prev);
  });

  it('plan review events use the same lifecycle', () => {
    let set = applyQuestionEvent(new Set(), { type: 'plan_review_needed', projectPath: '/a', scope: 's1' });
    expect(set.has('/a:s1')).toBe(true);
    set = applyQuestionEvent(set, { type: 'plan_review_answered', projectPath: '/a', scope: 's1' });
    expect(set.has('/a:s1')).toBe(false);
  });

  it('does not touch other workspaces', () => {
    const prev = new Set(['/a:s1', '/b:s1']);
    const out = applyQuestionEvent(prev, { type: 'question_answered', projectPath: '/a', scope: 's1' });
    expect(out.has('/a:s1')).toBe(false);
    expect(out.has('/b:s1')).toBe(true);
  });
});

describe('questionWorkspaces', () => {
  it('rolls scope keys up to their workspaces', () => {
    const out = questionWorkspaces(new Set(['/a:s1', '/a:s2', '/b:chat']));
    expect(out).toEqual(new Set(['/a', '/b']));
  });

  it('is empty for an empty input', () => {
    expect(questionWorkspaces(new Set()).size).toBe(0);
  });
});

describe('questionSessionIdsFor', () => {
  it('extracts session ids for one workspace only', () => {
    const keys = new Set(['/a:s1', '/a:chat', '/b:s9']);
    expect(questionSessionIdsFor(keys, '/a')).toEqual(new Set(['s1', 'chat']));
  });

  it('does not match a workspace whose path is a prefix of another', () => {
    const keys = new Set(['/a/sub:s1']);
    expect(questionSessionIdsFor(keys, '/a').size).toBe(0);
  });
});
