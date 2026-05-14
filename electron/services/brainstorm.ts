import { randomUUID } from 'node:crypto';

export interface TranscriptTurn {
  role: 'user' | 'assistant';
  content: string;
}

export interface BrainstormSession {
  sessionId: string;
  claudeSessionId?: string;
  transcript: TranscriptTurn[];
  createdAt: number;
}

const sessions = new Map<string, BrainstormSession>();

export function createSession(): { sessionId: string } {
  const sessionId = randomUUID();
  sessions.set(sessionId, { sessionId, transcript: [], createdAt: Date.now() });
  return { sessionId };
}

export function getSession(sessionId: string): BrainstormSession | undefined {
  return sessions.get(sessionId);
}

export function deleteSession(sessionId: string): void {
  sessions.delete(sessionId);
}

/** Test-only — clears in-memory state between tests. */
export function __resetSessions(): void {
  sessions.clear();
}
