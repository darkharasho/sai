import { describe, it, expect } from 'vitest';
import { inferSessionProvider } from '../../../src/lib/sessionProvider';
import type { ChatSession } from '../../../src/types';

function makeSession(overrides: Partial<ChatSession> = {}): ChatSession {
  return {
    id: 'test-id',
    title: 'Test',
    messages: [],
    createdAt: 0,
    updatedAt: 0,
    messageCount: 0,
    ...overrides,
  };
}

describe('inferSessionProvider', () => {
  it('returns aiProvider if set', () => {
    expect(inferSessionProvider(makeSession({ aiProvider: 'gemini' }))).toBe('gemini');
  });

  it('infers claude from claudeSessionId', () => {
    expect(inferSessionProvider(makeSession({ claudeSessionId: 'abc' }))).toBe('claude');
  });

  it('infers gemini from geminiSessionId', () => {
    expect(inferSessionProvider(makeSession({ geminiSessionId: 'abc' }))).toBe('gemini');
  });

  it('infers codex from codexSessionId', () => {
    expect(inferSessionProvider(makeSession({ codexSessionId: 'abc' }))).toBe('codex');
  });

  it('defaults to claude when no session IDs are set', () => {
    expect(inferSessionProvider(makeSession())).toBe('claude');
  });

  it('aiProvider takes precedence over session IDs', () => {
    expect(inferSessionProvider(makeSession({ aiProvider: 'gemini', claudeSessionId: 'abc' }))).toBe('gemini');
  });
});
