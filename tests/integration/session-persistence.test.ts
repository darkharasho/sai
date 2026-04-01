// @vitest-environment node
/**
 * Integration tests for session persistence (src/sessions.ts).
 *
 * sessions.ts uses localStorage which is browser-only. In the node environment
 * we provide an in-memory localStorage mock and inject it globally before loading
 * the module under test.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { vi } from 'vitest';

// ---------------------------------------------------------------------------
// In-memory localStorage mock for node environment
// ---------------------------------------------------------------------------

class LocalStorageMock {
  private store = new Map<string, string>();

  getItem(key: string): string | null {
    return this.store.get(key) ?? null;
  }

  setItem(key: string, value: string): void {
    this.store.set(key, value);
  }

  removeItem(key: string): void {
    this.store.delete(key);
  }

  clear(): void {
    this.store.clear();
  }

  get length(): number {
    return this.store.size;
  }

  key(index: number): string | null {
    return Array.from(this.store.keys())[index] ?? null;
  }

  /** Test helper: snapshot all stored data */
  _snapshot(): Record<string, string> {
    return Object.fromEntries(this.store);
  }
}

// Inject before imports so sessions.ts sees it
const mockLocalStorage = new LocalStorageMock();
(globalThis as any).localStorage = mockLocalStorage;
// crypto.randomUUID is available natively in Node 19+; only polyfill if missing
if (typeof crypto === 'undefined') {
  try {
    Object.defineProperty(globalThis, 'crypto', {
      value: { randomUUID: () => `${Math.random().toString(36).slice(2)}-${Date.now()}` },
      configurable: true,
    });
  } catch { /* crypto already defined */ }
}

// ---------------------------------------------------------------------------
// Imports (after global setup)
// ---------------------------------------------------------------------------
import {
  loadSessions,
  loadSessionMessages,
  saveSessionMessages,
  saveSessions,
  upsertSession,
  createSession,
  migrateLegacySessions,
  formatSessionDate,
  formatSessionTime,
} from '../../src/sessions';
import type { ChatSession, ChatMessage } from '../../src/types';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function makeMessage(role: 'user' | 'assistant' | 'system', content: string): ChatMessage {
  return {
    id: `msg-${Math.random().toString(36).slice(2)}`,
    role,
    content,
    timestamp: Date.now(),
  };
}

function makeSession(title = 'Test Session'): ChatSession {
  return {
    ...createSession(),
    title,
    messages: [makeMessage('user', 'Hello')],
  };
}

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------
const PROJECT = '/test/sessions-project';

beforeEach(() => {
  mockLocalStorage.clear();
});

// ===========================================================================
// Tests
// ===========================================================================

describe('session persistence — loadSessions / saveSessions', () => {
  it('returns empty array for unknown project', () => {
    const sessions = loadSessions('/no/such/project');
    expect(sessions).toEqual([]);
  });

  it('save → reload preserves session index', () => {
    const session = makeSession('My Session');
    saveSessions(PROJECT, [session]);

    const loaded = loadSessions(PROJECT);
    expect(loaded).toHaveLength(1);
    expect(loaded[0].id).toBe(session.id);
    expect(loaded[0].title).toBe('My Session');
  });

  it('saved index strips messages (on-demand loading pattern)', () => {
    const session = makeSession();
    session.messages = [makeMessage('user', 'Hello'), makeMessage('assistant', 'Hi')];
    saveSessions(PROJECT, [session]);

    const loaded = loadSessions(PROJECT);
    // Index entries should have empty messages — messages stored separately
    expect(loaded[0].messages).toEqual([]);
  });

  it('multiple sessions are all preserved in the index', () => {
    const s1 = makeSession('First');
    const s2 = makeSession('Second');
    const s3 = makeSession('Third');
    saveSessions(PROJECT, [s1, s2, s3]);

    const loaded = loadSessions(PROJECT);
    expect(loaded).toHaveLength(3);
    const titles = loaded.map(s => s.title);
    expect(titles).toContain('First');
    expect(titles).toContain('Second');
    expect(titles).toContain('Third');
  });
});

describe('session persistence — saveSessionMessages / loadSessionMessages', () => {
  it('returns empty array for unknown session id', () => {
    const msgs = loadSessionMessages('non-existent-id');
    expect(msgs).toEqual([]);
  });

  it('save → reload preserves messages', () => {
    const sessionId = 'sess-abc';
    const messages: ChatMessage[] = [
      makeMessage('user', 'Question'),
      makeMessage('assistant', 'Answer'),
    ];

    saveSessionMessages(sessionId, messages);
    const loaded = loadSessionMessages(sessionId);

    expect(loaded).toHaveLength(2);
    expect(loaded[0].content).toBe('Question');
    expect(loaded[1].content).toBe('Answer');
  });

  it('overwrites previous messages on resave', () => {
    const sessionId = 'sess-overwrite';
    saveSessionMessages(sessionId, [makeMessage('user', 'Old')]);
    saveSessionMessages(sessionId, [makeMessage('user', 'New'), makeMessage('assistant', 'Response')]);

    const loaded = loadSessionMessages(sessionId);
    expect(loaded).toHaveLength(2);
    expect(loaded[0].content).toBe('New');
  });

  it('preserves all message fields', () => {
    const sessionId = 'sess-fields';
    const msg: ChatMessage = {
      id: 'msg-unique-1',
      role: 'user',
      content: 'Test message',
      timestamp: 1700000000000,
      images: ['/path/to/image.png'],
    };

    saveSessionMessages(sessionId, [msg]);
    const loaded = loadSessionMessages(sessionId);

    expect(loaded[0]).toEqual(msg);
  });
});

describe('session persistence — upsertSession', () => {
  it('adds a new session to an empty list', () => {
    const session = makeSession('New');
    const result = upsertSession([], session);

    expect(result).toHaveLength(1);
    expect(result[0].id).toBe(session.id);
  });

  it('updates an existing session', () => {
    const session = makeSession('Original');
    let sessions = upsertSession([], session);

    const updated = { ...session, title: 'Updated', messages: [makeMessage('user', 'Updated msg')] };
    sessions = upsertSession(sessions, updated);

    expect(sessions).toHaveLength(1);
    expect(sessions[0].title).toBe('Updated');
  });

  it('does not save empty sessions (no messages)', () => {
    const emptySession = { ...createSession(), messages: [] };
    const result = upsertSession([], emptySession);

    expect(result).toHaveLength(0);
  });

  it('removes existing empty session', () => {
    const session = makeSession('ToRemove');
    let sessions = upsertSession([], session);
    expect(sessions).toHaveLength(1);

    // Remove messages — should be removed from list
    const emptied = { ...session, messages: [] };
    sessions = upsertSession(sessions, emptied);
    expect(sessions).toHaveLength(0);
  });

  it('sets title from first user message when title is empty', () => {
    // sessions.ts slices content to first 40 chars
    const longContent = 'This is a very long question about something interesting and detailed';
    const session: ChatSession = {
      ...createSession(),
      title: '',
      messages: [makeMessage('user', longContent)],
    };

    const result = upsertSession([], session);
    // Title should be set from the message, truncated to 40 chars
    expect(result[0].title).toBe(longContent.slice(0, 40));
  });

  it('sorts sessions by updatedAt descending', () => {
    const s1: ChatSession = { ...makeSession('Old'), updatedAt: 1000 };
    const s2: ChatSession = { ...makeSession('New'), updatedAt: 3000 };
    const s3: ChatSession = { ...makeSession('Mid'), updatedAt: 2000 };

    let sessions = upsertSession([], s1);
    sessions = upsertSession(sessions, s2);
    sessions = upsertSession(sessions, s3);

    // Most recent first
    expect(sessions[0].updatedAt).toBeGreaterThanOrEqual(sessions[1].updatedAt);
    expect(sessions[1].updatedAt).toBeGreaterThanOrEqual(sessions[2].updatedAt);
  });

  it('saves messages separately via saveSessionMessages', () => {
    const session: ChatSession = {
      ...createSession(),
      title: 'With messages',
      messages: [makeMessage('user', 'Hello'), makeMessage('assistant', 'World')],
    };

    upsertSession([], session);

    // Messages should be retrievable separately
    const msgs = loadSessionMessages(session.id);
    expect(msgs).toHaveLength(2);
    expect(msgs[0].content).toBe('Hello');
    expect(msgs[1].content).toBe('World');
  });

  it('large session: messages are stored and retrieved correctly', () => {
    const sessionId = 'large-session';
    const messages: ChatMessage[] = Array.from({ length: 100 }, (_, i) =>
      makeMessage(i % 2 === 0 ? 'user' : 'assistant', `Message ${i}: ${'x'.repeat(200)}`),
    );

    saveSessionMessages(sessionId, messages);
    const loaded = loadSessionMessages(sessionId);

    expect(loaded).toHaveLength(100);
    expect(loaded[0].content).toBe(messages[0].content);
    expect(loaded[99].content).toBe(messages[99].content);
  });
});

describe('session persistence — createSession', () => {
  it('creates a session with unique id', () => {
    const s1 = createSession();
    const s2 = createSession();

    expect(s1.id).not.toBe(s2.id);
  });

  it('creates a session with empty messages and title', () => {
    const session = createSession();

    expect(session.messages).toEqual([]);
    expect(session.title).toBe('');
    expect(session.createdAt).toBeGreaterThan(0);
    expect(session.updatedAt).toBeGreaterThan(0);
  });
});

describe('session persistence — migrateLegacySessions', () => {
  it('migrates from legacy sai-chat-sessions key', () => {
    const legacySessions: ChatSession[] = [
      { ...makeSession('Legacy 1'), id: 'legacy-1', messages: [makeMessage('user', 'Hi')] },
    ];
    mockLocalStorage.setItem('sai-chat-sessions', JSON.stringify(legacySessions));

    migrateLegacySessions(PROJECT);

    // Legacy key should be removed
    expect(mockLocalStorage.getItem('sai-chat-sessions')).toBeNull();

    // Data should be migrated
    const loaded = loadSessions(PROJECT);
    expect(loaded).toHaveLength(1);
    expect(loaded[0].id).toBe('legacy-1');
  });

  it('migrates from old combined format key', () => {
    const oldSessions: ChatSession[] = [
      { ...makeSession('Old Format'), id: 'old-1', messages: [makeMessage('user', 'Test')] },
    ];
    const oldKey = `sai-chat-sessions-${PROJECT}`;
    mockLocalStorage.setItem(oldKey, JSON.stringify(oldSessions));

    migrateLegacySessions(PROJECT);

    expect(mockLocalStorage.getItem(oldKey)).toBeNull();

    const loaded = loadSessions(PROJECT);
    expect(loaded).toHaveLength(1);
    expect(loaded[0].id).toBe('old-1');
  });

  it('does not overwrite existing sessions during migration', () => {
    // Existing sessions
    const existing = makeSession('Existing');
    saveSessions(PROJECT, [existing]);

    // Legacy key also has data
    const legacy: ChatSession[] = [makeSession('Legacy')];
    mockLocalStorage.setItem('sai-chat-sessions', JSON.stringify(legacy));

    migrateLegacySessions(PROJECT);

    // Should still have only the existing session (not overwritten)
    const loaded = loadSessions(PROJECT);
    expect(loaded).toHaveLength(1);
    expect(loaded[0].id).toBe(existing.id);
  });

  it('is safe to call multiple times (idempotent)', () => {
    migrateLegacySessions(PROJECT);
    migrateLegacySessions(PROJECT);
    // Should not throw or corrupt data
    const sessions = loadSessions(PROJECT);
    expect(Array.isArray(sessions)).toBe(true);
  });
});

describe('session persistence — concurrent save safety', () => {
  it('sequential saves do not corrupt the index', () => {
    const sessions: ChatSession[] = [];
    for (let i = 0; i < 10; i++) {
      const s = makeSession(`Session ${i}`);
      sessions.push(s);
    }

    // Simulate sequential saves (as if rapid updates happened)
    for (let i = 1; i <= sessions.length; i++) {
      saveSessions(PROJECT, sessions.slice(0, i));
    }

    const loaded = loadSessions(PROJECT);
    expect(loaded).toHaveLength(10);
  });

  it('upsert accumulates sessions from multiple calls', () => {
    let state: ChatSession[] = [];

    for (let i = 0; i < 5; i++) {
      const s = makeSession(`Session ${i}`);
      state = upsertSession(state, s);
    }

    expect(state).toHaveLength(5);
  });
});

describe('session persistence — format helpers', () => {
  it('formatSessionDate returns Today for today', () => {
    const result = formatSessionDate(Date.now());
    expect(result).toBe('Today');
  });

  it('formatSessionDate returns Yesterday for yesterday', () => {
    const yesterday = Date.now() - 24 * 60 * 60 * 1000;
    const result = formatSessionDate(yesterday);
    expect(result).toBe('Yesterday');
  });

  it('formatSessionDate returns formatted date for older dates', () => {
    const old = new Date(2024, 0, 15).getTime(); // Jan 15, 2024
    const result = formatSessionDate(old);
    expect(result).toMatch(/Jan/);
  });

  it('formatSessionTime returns a time string', () => {
    const result = formatSessionTime(Date.now());
    expect(typeof result).toBe('string');
    expect(result.length).toBeGreaterThan(0);
    // Should contain AM or PM
    expect(result.toUpperCase()).toMatch(/AM|PM/);
  });
});
