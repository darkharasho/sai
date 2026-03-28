import type { ChatSession } from './types';

const STORAGE_KEY = 'vsai-chat-sessions';
const MAX_SESSIONS = 10;

export function loadSessions(): ChatSession[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

export function saveSessions(sessions: ChatSession[]): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(sessions));
  } catch {
    // localStorage quota exceeded — silently fail
  }
}

export function createSession(): ChatSession {
  return {
    id: crypto.randomUUID(),
    title: '',
    messages: [],
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };
}

export function upsertSession(sessions: ChatSession[], session: ChatSession): ChatSession[] {
  // Don't save empty sessions
  if (session.messages.length === 0) {
    return sessions.filter(s => s.id !== session.id);
  }

  // Set title from first user message if not set
  if (!session.title) {
    const firstUserMsg = session.messages.find(m => m.role === 'user');
    if (firstUserMsg) {
      session.title = firstUserMsg.content.slice(0, 40);
    }
  }

  session.updatedAt = Date.now();

  const existing = sessions.findIndex(s => s.id === session.id);
  let updated: ChatSession[];
  if (existing >= 0) {
    updated = [...sessions];
    updated[existing] = session;
  } else {
    updated = [session, ...sessions];
  }

  // Sort by updatedAt descending, keep max
  updated.sort((a, b) => b.updatedAt - a.updatedAt);
  return updated.slice(0, MAX_SESSIONS);
}

export function formatSessionDate(timestamp: number): string {
  const date = new Date(timestamp);
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const yesterday = new Date(today.getTime() - 86400000);
  const sessionDate = new Date(date.getFullYear(), date.getMonth(), date.getDate());

  if (sessionDate.getTime() === today.getTime()) return 'Today';
  if (sessionDate.getTime() === yesterday.getTime()) return 'Yesterday';
  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

export function formatSessionTime(timestamp: number): string {
  return new Date(timestamp).toLocaleTimeString('en-US', {
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  });
}
