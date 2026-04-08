import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  createSession,
  loadSessions,
  saveSessions,
  loadSessionMessages,
  saveSessionMessages,
  upsertSession,
  formatSessionDate,
  formatSessionTime,
  migrateLegacySessions,
  generateSmartTitle,
  toggleSessionPin,
  deleteSession,
  exportSessionAsMarkdown,
} from '@/sessions';
import type { ChatSession, ChatMessage } from '@/types';

// Helper to build minimal ChatMessage objects
function makeMessage(overrides: Partial<ChatMessage> = {}): ChatMessage {
  return {
    id: crypto.randomUUID(),
    role: 'user',
    content: 'Hello',
    timestamp: Date.now(),
    ...overrides,
  };
}

// Helper to build ChatSession objects for testing
function makeSession(overrides: Partial<ChatSession> = {}): ChatSession {
  const now = Date.now();
  return {
    id: crypto.randomUUID(),
    title: 'Test session',
    messages: [makeMessage()],
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

beforeEach(() => {
  localStorage.clear();
});

// ---------------------------------------------------------------------------
// createSession
// ---------------------------------------------------------------------------

describe('createSession', () => {
  it('creates a session with a non-empty unique id', () => {
    const session = createSession();
    expect(typeof session.id).toBe('string');
    expect(session.id.length).toBeGreaterThan(0);
  });

  it('creates a session with an empty messages array', () => {
    const session = createSession();
    expect(session.messages).toEqual([]);
  });

  it('creates a session with createdAt and updatedAt timestamps', () => {
    const before = Date.now();
    const session = createSession();
    const after = Date.now();

    expect(session.createdAt).toBeGreaterThanOrEqual(before);
    expect(session.createdAt).toBeLessThanOrEqual(after);
    expect(session.updatedAt).toBeGreaterThanOrEqual(before);
    expect(session.updatedAt).toBeLessThanOrEqual(after);
  });

  it('generates a different id for each call', () => {
    const ids = new Set(Array.from({ length: 10 }, () => createSession().id));
    expect(ids.size).toBe(10);
  });
});

// ---------------------------------------------------------------------------
// saveSessions / loadSessions
// ---------------------------------------------------------------------------

describe('saveSessions / loadSessions', () => {
  it('round-trips session index through localStorage', () => {
    const sessions = [makeSession(), makeSession()];
    saveSessions('/home/user/project', sessions);
    const loaded = loadSessions('/home/user/project');
    expect(loaded).toHaveLength(2);
    expect(loaded[0].id).toBe(sessions[0].id);
    expect(loaded[1].id).toBe(sessions[1].id);
  });

  it('stores sessions under a project-specific key (separate namespaces)', () => {
    const sessA = makeSession({ title: 'Project A session' });
    const sessB = makeSession({ title: 'Project B session' });

    saveSessions('/project/alpha', [sessA]);
    saveSessions('/project/beta', [sessB]);

    const loadedA = loadSessions('/project/alpha');
    const loadedB = loadSessions('/project/beta');

    expect(loadedA).toHaveLength(1);
    expect(loadedA[0].id).toBe(sessA.id);
    expect(loadedB).toHaveLength(1);
    expect(loadedB[0].id).toBe(sessB.id);
  });

  it('returns empty array for an unknown project', () => {
    const result = loadSessions('/non/existent/path');
    expect(result).toEqual([]);
  });

  it('strips messages from index entries when saving', () => {
    const session = makeSession({ messages: [makeMessage(), makeMessage()] });
    saveSessions('/project', [session]);
    const loaded = loadSessions('/project');
    // Index entries should have empty messages arrays
    expect(loaded[0].messages).toEqual([]);
  });

  it('preserves session metadata (id, title, createdAt, updatedAt)', () => {
    const session = makeSession({ title: 'My Title', createdAt: 1000, updatedAt: 2000 });
    saveSessions('/project', [session]);
    const [loaded] = loadSessions('/project');
    expect(loaded.id).toBe(session.id);
    expect(loaded.title).toBe('My Title');
    expect(loaded.createdAt).toBe(1000);
    expect(loaded.updatedAt).toBe(2000);
  });
});

// ---------------------------------------------------------------------------
// saveSessionMessages / loadSessionMessages
// ---------------------------------------------------------------------------

describe('saveSessionMessages / loadSessionMessages', () => {
  it('round-trips messages through localStorage', () => {
    const messages = [
      makeMessage({ content: 'Hello' }),
      makeMessage({ role: 'assistant', content: 'World' }),
    ];
    saveSessionMessages('session-abc', messages);
    const loaded = loadSessionMessages('session-abc');
    expect(loaded).toHaveLength(2);
    expect(loaded[0].content).toBe('Hello');
    expect(loaded[1].content).toBe('World');
  });

  it('returns empty array for an unknown session id', () => {
    const result = loadSessionMessages('unknown-session-id');
    expect(result).toEqual([]);
  });

  it('overwrites previously saved messages for the same session', () => {
    const first = [makeMessage({ content: 'First' })];
    const second = [makeMessage({ content: 'Second' }), makeMessage({ content: 'Third' })];

    saveSessionMessages('session-overwrite', first);
    saveSessionMessages('session-overwrite', second);

    const loaded = loadSessionMessages('session-overwrite');
    expect(loaded).toHaveLength(2);
    expect(loaded[0].content).toBe('Second');
  });

  it('stores messages under session-specific keys (separate sessions do not collide)', () => {
    const msgsA = [makeMessage({ content: 'Session A' })];
    const msgsB = [makeMessage({ content: 'Session B' })];

    saveSessionMessages('session-1', msgsA);
    saveSessionMessages('session-2', msgsB);

    expect(loadSessionMessages('session-1')[0].content).toBe('Session A');
    expect(loadSessionMessages('session-2')[0].content).toBe('Session B');
  });
});

// ---------------------------------------------------------------------------
// upsertSession
// ---------------------------------------------------------------------------

describe('upsertSession', () => {
  it('adds a new session to an empty list', () => {
    const session = makeSession();
    const result = upsertSession([], session);
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe(session.id);
  });

  it('adds a new session to an existing list', () => {
    const existing = makeSession();
    const newSession = makeSession();
    const result = upsertSession([existing], newSession);
    expect(result).toHaveLength(2);
    const ids = result.map(s => s.id);
    expect(ids).toContain(existing.id);
    expect(ids).toContain(newSession.id);
  });

  it('updates an existing session by id (replaces in place)', () => {
    const session = makeSession({ title: 'Original' });
    const list = upsertSession([], session);

    const updated = { ...session, title: 'Updated', messages: [makeMessage({ content: 'msg' })] };
    const result = upsertSession(list, updated);

    expect(result).toHaveLength(1);
    expect(result[0].id).toBe(session.id);
    expect(result[0].title).toBe('Updated');
  });

  it('preserves existing session when called with empty messages', () => {
    const session = makeSession();
    const list = upsertSession([], session);
    expect(list).toHaveLength(1);

    const emptied = { ...session, messages: [] };
    const result = upsertSession(list, emptied);
    expect(result).toHaveLength(1);
  });

  it('does not add a session with empty messages', () => {
    const session = makeSession({ messages: [] });
    const result = upsertSession([], session);
    expect(result).toHaveLength(0);
  });

  it('sorts sessions by updatedAt descending', () => {
    // Build an existing index list with known updatedAt values (no messages
    // so they bypass upsertSession's empty-check) and upsert a new session
    // on top. Then verify the final list is sorted descending by updatedAt.
    //
    // upsertSession sets session.updatedAt = Date.now() before inserting, so
    // the new session will always land at the top. We verify relative order of
    // the pre-existing entries too.
    const idA = 'sort-a';
    const idB = 'sort-b';
    const idC = 'sort-c';

    // Pre-built index entries (messages already stripped, different updatedAt)
    const preList: ChatSession[] = [
      { id: idA, title: 'A', messages: [], createdAt: 100, updatedAt: 5000 },
      { id: idB, title: 'B', messages: [], createdAt: 200, updatedAt: 1000 },
      { id: idC, title: 'C', messages: [], createdAt: 300, updatedAt: 3000 },
    ];

    // Insert a brand-new session with messages to trigger a real upsert
    const newSession = makeSession({ messages: [makeMessage()] });
    const result = upsertSession(preList, newSession);

    // The new session gets updatedAt = Date.now() (> all pre-existing), so it
    // should be first. The rest should be ordered by their original updatedAt:
    // A(5000) > C(3000) > B(1000).
    expect(result[0].id).toBe(newSession.id);
    expect(result[1].id).toBe(idA);
    expect(result[2].id).toBe(idC);
    expect(result[3].id).toBe(idB);

    // Confirm strictly descending order
    for (let i = 1; i < result.length; i++) {
      expect(result[i - 1].updatedAt).toBeGreaterThanOrEqual(result[i].updatedAt);
    }
  });

  it('caps the list at 200 sessions', () => {
    // Build 200 existing index-entry sessions (no messages needed, they're already in the list)
    const existing: ChatSession[] = Array.from({ length: 199 }, (_, i) =>
      makeSession({ updatedAt: i + 1, messages: [] }),
    );
    // Bypass the empty-messages filter by treating them as pre-saved index entries
    // We'll save them directly and then upsert a 201st
    // Manually build a list of 199 mock sessions (already in index form)
    const indexList: ChatSession[] = Array.from({ length: 199 }, (_, i) => ({
      id: `session-${i}`,
      title: `Session ${i}`,
      messages: [],
      createdAt: i,
      updatedAt: i,
    }));

    // Upsert a new session with messages to push to 200
    const newSession = makeSession({ messages: [makeMessage()] });
    const result200 = upsertSession(indexList, newSession);
    expect(result200).toHaveLength(200);

    // Build a 200-entry list and add one more
    const list200: ChatSession[] = Array.from({ length: 200 }, (_, i) => ({
      id: `capped-${i}`,
      title: `Capped ${i}`,
      messages: [],
      createdAt: i,
      updatedAt: i,
    }));

    const overflow = makeSession({ messages: [makeMessage()] });
    const result = upsertSession(list200, overflow);
    expect(result).toHaveLength(200);
  });

  it('auto-sets title from first user message when title is empty', () => {
    const session = makeSession({
      title: '',
      messages: [makeMessage({ role: 'user', content: 'What is the meaning of life?' })],
    });
    const result = upsertSession([], session);
    expect(result[0].title).toBe('What is the meaning of life?');
  });

  it('truncates auto-generated title to 40 characters', () => {
    const longContent = 'A'.repeat(60);
    const session = makeSession({
      title: '',
      messages: [makeMessage({ role: 'user', content: longContent })],
    });
    const result = upsertSession([], session);
    expect(result[0].title).toBe('A'.repeat(40));
  });

  it('keeps existing title when already set', () => {
    const session = makeSession({
      title: 'My Custom Title',
      messages: [makeMessage({ role: 'user', content: 'Some message that should not override' })],
    });
    const result = upsertSession([], session);
    expect(result[0].title).toBe('My Custom Title');
  });

  it('saves messages separately via saveSessionMessages', () => {
    const messages = [makeMessage({ content: 'Persisted message' })];
    const session = makeSession({ messages });
    upsertSession([], session);

    const saved = loadSessionMessages(session.id);
    expect(saved).toHaveLength(1);
    expect(saved[0].content).toBe('Persisted message');
  });

  it('stores index entries with empty messages arrays', () => {
    const session = makeSession({ messages: [makeMessage()] });
    const result = upsertSession([], session);
    expect(result[0].messages).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// formatSessionDate
// ---------------------------------------------------------------------------

describe('formatSessionDate', () => {
  it('formats a timestamp from today as "Today"', () => {
    const now = Date.now();
    expect(formatSessionDate(now)).toBe('Today');
  });

  it('formats a timestamp from earlier today as "Today"', () => {
    const startOfDay = new Date();
    startOfDay.setHours(0, 0, 0, 0);
    expect(formatSessionDate(startOfDay.getTime())).toBe('Today');
  });

  it('formats a timestamp from yesterday as "Yesterday"', () => {
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    yesterday.setHours(12, 0, 0, 0);
    expect(formatSessionDate(yesterday.getTime())).toBe('Yesterday');
  });

  it('formats older dates with a short month/day format', () => {
    // A date well in the past (Jan 15, 2020)
    const old = new Date(2020, 0, 15).getTime();
    const result = formatSessionDate(old);
    // Should NOT be "Today" or "Yesterday"
    expect(result).not.toBe('Today');
    expect(result).not.toBe('Yesterday');
    // Should contain "Jan" and "15"
    expect(result).toContain('Jan');
    expect(result).toContain('15');
  });

  it('formats a date two days ago with month/day format', () => {
    const twoDaysAgo = new Date();
    twoDaysAgo.setDate(twoDaysAgo.getDate() - 2);
    twoDaysAgo.setHours(12, 0, 0, 0);
    const result = formatSessionDate(twoDaysAgo.getTime());
    expect(result).not.toBe('Today');
    expect(result).not.toBe('Yesterday');
    expect(typeof result).toBe('string');
    expect(result.length).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// formatSessionTime
// ---------------------------------------------------------------------------

describe('formatSessionTime', () => {
  it('formats a timestamp as a localized 12-hour time string', () => {
    // Use a known timestamp: noon on an arbitrary date
    const noon = new Date(2024, 5, 15, 12, 30, 0).getTime();
    const result = formatSessionTime(noon);
    // Should include AM/PM indicator
    expect(result).toMatch(/AM|PM/i);
  });

  it('includes hour and two-digit minutes', () => {
    const time = new Date(2024, 0, 1, 9, 5, 0).getTime();
    const result = formatSessionTime(time);
    // Should include minutes with leading zero: "05"
    expect(result).toMatch(/\d+:\d{2}/);
  });

  it('returns a non-empty string for any valid timestamp', () => {
    const timestamps = [0, Date.now(), new Date(2025, 11, 31, 23, 59).getTime()];
    for (const ts of timestamps) {
      expect(formatSessionTime(ts).length).toBeGreaterThan(0);
    }
  });
});

// ---------------------------------------------------------------------------
// migrateLegacySessions
// ---------------------------------------------------------------------------

describe('migrateLegacySessions', () => {
  it('migrates sessions from legacy sai-chat-sessions key', () => {
    const legacySessions: ChatSession[] = [
      makeSession({ id: 'legacy-1', messages: [makeMessage({ content: 'Legacy msg' })] }),
    ];
    localStorage.setItem('sai-chat-sessions', JSON.stringify(legacySessions));

    migrateLegacySessions('/project/path');

    const loaded = loadSessions('/project/path');
    expect(loaded).toHaveLength(1);
    expect(loaded[0].id).toBe('legacy-1');
  });

  it('removes the legacy key after migration', () => {
    const legacySessions: ChatSession[] = [makeSession()];
    localStorage.setItem('sai-chat-sessions', JSON.stringify(legacySessions));

    migrateLegacySessions('/project/path');

    expect(localStorage.getItem('sai-chat-sessions')).toBeNull();
  });

  it('migrates messages into separate session message keys', () => {
    const msg = makeMessage({ content: 'Migrated message' });
    const legacySessions: ChatSession[] = [makeSession({ id: 'legacy-msgs', messages: [msg] })];
    localStorage.setItem('sai-chat-sessions', JSON.stringify(legacySessions));

    migrateLegacySessions('/project/path');

    const messages = loadSessionMessages('legacy-msgs');
    expect(messages).toHaveLength(1);
    expect(messages[0].content).toBe('Migrated message');
  });

  it('does not overwrite existing sessions when migrating legacy key', () => {
    const existing = makeSession({ id: 'existing-session' });
    saveSessions('/project/path', [existing]);

    const legacySessions: ChatSession[] = [makeSession({ id: 'would-override' })];
    localStorage.setItem('sai-chat-sessions', JSON.stringify(legacySessions));

    migrateLegacySessions('/project/path');

    const loaded = loadSessions('/project/path');
    expect(loaded).toHaveLength(1);
    expect(loaded[0].id).toBe('existing-session');
  });

  it('migrates sessions from old sai-chat-sessions-<path> format', () => {
    const oldKey = 'sai-chat-sessions-/old/project';
    const oldSessions: ChatSession[] = [
      makeSession({ id: 'old-format-1', messages: [makeMessage()] }),
    ];
    localStorage.setItem(oldKey, JSON.stringify(oldSessions));

    migrateLegacySessions('/old/project');

    const loaded = loadSessions('/old/project');
    expect(loaded).toHaveLength(1);
    expect(loaded[0].id).toBe('old-format-1');
    expect(localStorage.getItem(oldKey)).toBeNull();
  });

  it('does nothing when no legacy data exists', () => {
    // Should not throw
    expect(() => migrateLegacySessions('/clean/project')).not.toThrow();
    expect(loadSessions('/clean/project')).toEqual([]);
  });
});

describe('generateSmartTitle', () => {
  it('strips "can you" prefix', () => {
    expect(generateSmartTitle('Can you fix the border?')).toBe('Fix the border?');
  });
  it('strips "could you" prefix', () => {
    expect(generateSmartTitle('Could you help me debug this?')).toBe('Debug this?');
  });
  it('strips "would you" prefix', () => {
    expect(generateSmartTitle('Would you refactor this function?')).toBe('Refactor this function?');
  });
  it('strips "please" prefix', () => {
    expect(generateSmartTitle('Please update the config')).toBe('Update the config');
  });
  it('strips "help me" prefix', () => {
    expect(generateSmartTitle('help me fix the auth bug')).toBe('Fix the auth bug');
  });
  it('strips "I need to" prefix', () => {
    expect(generateSmartTitle('I need to implement a sidebar')).toBe('Implement a sidebar');
  });
  it('strips "I want to" prefix', () => {
    expect(generateSmartTitle('I want to add dark mode')).toBe('Add dark mode');
  });
  it('strips "let\'s" prefix', () => {
    expect(generateSmartTitle("let's build a command palette")).toBe('Build a command palette');
  });
  it('strips "let me" prefix', () => {
    expect(generateSmartTitle('let me see the logs')).toBe('See the logs');
  });
  it('strips "we need to" prefix', () => {
    expect(generateSmartTitle('we need to fix the tests')).toBe('Fix the tests');
  });
  it('strips "we should" prefix', () => {
    expect(generateSmartTitle('we should refactor this')).toBe('Refactor this');
  });
  it('strips multiple chained prefixes', () => {
    expect(generateSmartTitle('Can you please help me fix this?')).toBe('Fix this?');
  });
  it('capitalizes first letter after stripping', () => {
    expect(generateSmartTitle('can you fix it')).toBe('Fix it');
  });
  it('truncates to 40 characters', () => {
    const long = 'Fix ' + 'a'.repeat(50);
    expect(generateSmartTitle(long).length).toBeLessThanOrEqual(40);
  });
  it('returns original text when no prefix matches', () => {
    expect(generateSmartTitle('Fix the border on code blocks')).toBe('Fix the border on code blocks');
  });
  it('returns empty string for empty input', () => {
    expect(generateSmartTitle('')).toBe('');
  });
  it('handles whitespace-only input', () => {
    expect(generateSmartTitle('   ')).toBe('');
  });
});

describe('toggleSessionPin', () => {
  it('pins an unpinned session', () => {
    const session = makeSession({ pinned: false });
    const result = toggleSessionPin([session], session.id);
    expect(result.find(s => s.id === session.id)?.pinned).toBe(true);
  });

  it('unpins a pinned session', () => {
    const session = makeSession({ pinned: true });
    const result = toggleSessionPin([session], session.id);
    expect(result.find(s => s.id === session.id)?.pinned).toBe(false);
  });

  it('returns unmodified list when session id not found', () => {
    const session = makeSession();
    const result = toggleSessionPin([session], 'nonexistent');
    expect(result).toEqual([session]);
  });
});

describe('deleteSession', () => {
  it('removes a session from the list', () => {
    const s1 = makeSession();
    const s2 = makeSession();
    const result = deleteSession([s1, s2], s1.id);
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe(s2.id);
  });

  it('removes session messages from localStorage', () => {
    const session = makeSession();
    saveSessionMessages(session.id, [makeMessage()]);
    deleteSession([session], session.id);
    expect(loadSessionMessages(session.id)).toEqual([]);
  });

  it('returns unmodified list when session id not found', () => {
    const session = makeSession();
    const result = deleteSession([session], 'nonexistent');
    expect(result).toHaveLength(1);
  });
});

describe('exportSessionAsMarkdown', () => {
  it('formats messages as markdown with role headers', () => {
    const messages: ChatMessage[] = [
      makeMessage({ role: 'user', content: 'Hello' }),
      makeMessage({ role: 'assistant', content: 'Hi there' }),
    ];
    const md = exportSessionAsMarkdown('Test Chat', messages);
    expect(md).toContain('# Test Chat');
    expect(md).toContain('## User');
    expect(md).toContain('Hello');
    expect(md).toContain('## Assistant');
    expect(md).toContain('Hi there');
  });

  it('skips system messages', () => {
    const messages: ChatMessage[] = [
      makeMessage({ role: 'system', content: 'System prompt' }),
      makeMessage({ role: 'user', content: 'Hello' }),
    ];
    const md = exportSessionAsMarkdown('Test', messages);
    expect(md).not.toContain('System prompt');
    expect(md).toContain('Hello');
  });

  it('handles empty messages array', () => {
    const md = exportSessionAsMarkdown('Empty', []);
    expect(md).toContain('# Empty');
  });
});
