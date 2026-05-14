import { describe, it, expect, beforeEach } from 'vitest';
import { __resetSessions, createSession, getSession, deleteSession } from '../../electron/services/brainstorm';

describe('brainstorm session store', () => {
  beforeEach(() => __resetSessions());

  it('creates a session with a unique id and empty transcript', () => {
    const { sessionId } = createSession();
    const s = getSession(sessionId);
    expect(s).toBeDefined();
    expect(s!.transcript).toEqual([]);
    expect(s!.claudeSessionId).toBeUndefined();
  });

  it('creates distinct ids for separate sessions', () => {
    const a = createSession().sessionId;
    const b = createSession().sessionId;
    expect(a).not.toEqual(b);
  });

  it('deleteSession removes the session', () => {
    const { sessionId } = createSession();
    deleteSession(sessionId);
    expect(getSession(sessionId)).toBeUndefined();
  });
});
