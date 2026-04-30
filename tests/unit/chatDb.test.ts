import { describe, it, expect, beforeEach } from 'vitest';
import 'fake-indexeddb/auto';
import {
  dbGetSessions,
  dbSaveSession,
  dbGetMessages,
  dbGetMessagesTail,
  dbGetMessagesRange,
  dbDeleteSession,
  dbPurgeExpired,
  clearDb,
  migrateFromLocalStorage,
  _resetMigrationFlag,
} from '@/chatDb';
import type { ChatSession, ChatMessage } from '@/types';

function makeMessage(overrides: Partial<ChatMessage> = {}): ChatMessage {
  return {
    id: crypto.randomUUID(),
    role: 'user',
    content: 'Hello',
    timestamp: Date.now(),
    ...overrides,
  };
}

function makeSession(overrides: Partial<ChatSession> = {}): ChatSession {
  const now = Date.now();
  return {
    id: crypto.randomUUID(),
    title: 'Test session',
    messages: [makeMessage()],
    messageCount: 1,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

beforeEach(async () => {
  await clearDb();
});

// ---------------------------------------------------------------------------
// dbSaveSession / dbGetSessions
// ---------------------------------------------------------------------------
describe('dbSaveSession / dbGetSessions', () => {
  it('saves a session and retrieves it by project path', async () => {
    const session = makeSession({ title: 'My Session' });
    await dbSaveSession('/project/a', session);

    const sessions = await dbGetSessions('/project/a');
    expect(sessions).toHaveLength(1);
    expect(sessions[0].id).toBe(session.id);
    expect(sessions[0].title).toBe('My Session');
  });

  it('returns empty array for unknown project path', async () => {
    const sessions = await dbGetSessions('/unknown/path');
    expect(sessions).toEqual([]);
  });

  it('isolates sessions by project path', async () => {
    const s1 = makeSession({ title: 'Session A' });
    const s2 = makeSession({ title: 'Session B' });
    await dbSaveSession('/project/a', s1);
    await dbSaveSession('/project/b', s2);

    const sessionsA = await dbGetSessions('/project/a');
    const sessionsB = await dbGetSessions('/project/b');
    expect(sessionsA).toHaveLength(1);
    expect(sessionsA[0].title).toBe('Session A');
    expect(sessionsB).toHaveLength(1);
    expect(sessionsB[0].title).toBe('Session B');
  });

  it('updates existing session on re-save', async () => {
    const session = makeSession({ title: 'Original' });
    await dbSaveSession('/project/a', session);

    const updated = { ...session, title: 'Updated', updatedAt: Date.now() + 1000 };
    await dbSaveSession('/project/a', updated);

    const sessions = await dbGetSessions('/project/a');
    expect(sessions).toHaveLength(1);
    expect(sessions[0].title).toBe('Updated');
  });

  it('returns sessions sorted by updatedAt descending', async () => {
    const s1 = makeSession({ title: 'Oldest', updatedAt: 1000 });
    const s2 = makeSession({ title: 'Middle', updatedAt: 2000 });
    const s3 = makeSession({ title: 'Newest', updatedAt: 3000 });

    await dbSaveSession('/project/a', s1);
    await dbSaveSession('/project/a', s2);
    await dbSaveSession('/project/a', s3);

    const sessions = await dbGetSessions('/project/a');
    expect(sessions.map((s) => s.title)).toEqual(['Newest', 'Middle', 'Oldest']);
  });

  it('returns sessions with messages=[] and computed messageCount', async () => {
    const msgs = [makeMessage(), makeMessage(), makeMessage()];
    const session = makeSession({ messages: msgs });
    await dbSaveSession('/project/a', session);

    const sessions = await dbGetSessions('/project/a');
    expect(sessions[0].messages).toEqual([]);
    expect(sessions[0].messageCount).toBe(3);
  });
});

// ---------------------------------------------------------------------------
// dbGetMessages
// ---------------------------------------------------------------------------
describe('dbGetMessages', () => {
  it('retrieves messages saved with a session', async () => {
    const msgs = [
      makeMessage({ content: 'First' }),
      makeMessage({ content: 'Second' }),
    ];
    const session = makeSession({ messages: msgs });
    await dbSaveSession('/project/a', session);

    const messages = await dbGetMessages(session.id);
    expect(messages).toHaveLength(2);
    expect(messages[0].content).toBe('First');
    expect(messages[1].content).toBe('Second');
  });

  it('returns empty array for unknown session id', async () => {
    const messages = await dbGetMessages('nonexistent-id');
    expect(messages).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// dbGetMessagesTail
// ---------------------------------------------------------------------------
describe('dbGetMessagesTail', () => {
  it('returns the last N messages and the total count', async () => {
    const msgs = Array.from({ length: 10 }, (_, i) =>
      makeMessage({ content: `m${i}` })
    );
    const session = makeSession({ messages: msgs });
    await dbSaveSession('/p', session);

    const { messages, totalCount } = await dbGetMessagesTail(session.id, 3);
    expect(totalCount).toBe(10);
    expect(messages).toHaveLength(3);
    expect(messages.map(m => m.content)).toEqual(['m7', 'm8', 'm9']);
  });

  it('returns the full session when count >= total', async () => {
    const msgs = [makeMessage({ content: 'a' }), makeMessage({ content: 'b' })];
    const session = makeSession({ messages: msgs });
    await dbSaveSession('/p', session);

    const { messages, totalCount } = await dbGetMessagesTail(session.id, 100);
    expect(totalCount).toBe(2);
    expect(messages).toHaveLength(2);
    expect(messages.map(m => m.content)).toEqual(['a', 'b']);
  });

  it('returns empty array and zero count for unknown session', async () => {
    const { messages, totalCount } = await dbGetMessagesTail('missing', 10);
    expect(messages).toEqual([]);
    expect(totalCount).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// dbGetMessagesRange
// ---------------------------------------------------------------------------
describe('dbGetMessagesRange', () => {
  it('returns the slice [fromIdx, fromIdx+count)', async () => {
    const msgs = Array.from({ length: 10 }, (_, i) =>
      makeMessage({ content: `m${i}` })
    );
    const session = makeSession({ messages: msgs });
    await dbSaveSession('/p', session);

    const slice = await dbGetMessagesRange(session.id, 3, 4);
    expect(slice.map(m => m.content)).toEqual(['m3', 'm4', 'm5', 'm6']);
  });

  it('clamps a negative fromIdx to 0', async () => {
    const msgs = [makeMessage({ content: 'a' }), makeMessage({ content: 'b' })];
    const session = makeSession({ messages: msgs });
    await dbSaveSession('/p', session);

    const slice = await dbGetMessagesRange(session.id, -5, 1);
    expect(slice.map(m => m.content)).toEqual(['a']);
  });

  it('returns empty array when fromIdx is past the end', async () => {
    const msgs = [makeMessage({ content: 'a' })];
    const session = makeSession({ messages: msgs });
    await dbSaveSession('/p', session);

    const slice = await dbGetMessagesRange(session.id, 10, 5);
    expect(slice).toEqual([]);
  });

  it('returns empty for an unknown session', async () => {
    const slice = await dbGetMessagesRange('missing', 0, 10);
    expect(slice).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// dbSaveSession with fromIdx (splice mode)
// ---------------------------------------------------------------------------
describe('dbSaveSession with fromIdx (splice)', () => {
  it('preserves the prefix [0, fromIdx) and replaces the rest', async () => {
    // Initial: 10 messages a-j in DB
    const initial = Array.from({ length: 10 }, (_, i) =>
      makeMessage({ content: String.fromCharCode(97 + i) }) // a..j
    );
    const session = makeSession({ messages: initial });
    await dbSaveSession('/p', session);

    // Simulate paginated state: app holds the last 3 (h, i, j) plus an
    // appended new message; firstLoadedIdx = 7. Save splices at idx 7.
    const tail = [
      ...initial.slice(7), // h, i, j
      makeMessage({ content: 'k' }),
    ];
    const tailSession = { ...session, messages: tail };
    await dbSaveSession('/p', tailSession, 7);

    const all = await dbGetMessages(session.id);
    expect(all.map(m => m.content)).toEqual(
      ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i', 'j', 'k']
    );
  });

  it('handles fromIdx larger than existing array by appending', async () => {
    const initial = [makeMessage({ content: 'a' }), makeMessage({ content: 'b' })];
    const session = makeSession({ messages: initial });
    await dbSaveSession('/p', session);

    // fromIdx = 5 but only 2 exist — prefix is the whole existing array.
    const newMessages = [makeMessage({ content: 'x' })];
    await dbSaveSession('/p', { ...session, messages: newMessages }, 5);

    const all = await dbGetMessages(session.id);
    expect(all.map(m => m.content)).toEqual(['a', 'b', 'x']);
  });

  it('full-replace path is used when fromIdx is 0', async () => {
    const session = makeSession({
      messages: [makeMessage({ content: 'old1' }), makeMessage({ content: 'old2' })],
    });
    await dbSaveSession('/p', session);

    await dbSaveSession('/p', { ...session, messages: [makeMessage({ content: 'new' })] }, 0);

    const all = await dbGetMessages(session.id);
    expect(all.map(m => m.content)).toEqual(['new']);
  });

  it('full-replace path is used when fromIdx is omitted (legacy callers)', async () => {
    const session = makeSession({
      messages: [makeMessage({ content: 'old' })],
    });
    await dbSaveSession('/p', session);

    await dbSaveSession('/p', { ...session, messages: [makeMessage({ content: 'replaced' })] });

    const all = await dbGetMessages(session.id);
    expect(all.map(m => m.content)).toEqual(['replaced']);
  });

  it('messageCount metadata reflects the merged total after splice', async () => {
    const initial = Array.from({ length: 5 }, (_, i) =>
      makeMessage({ content: `m${i}` })
    );
    const session = makeSession({ messages: initial });
    await dbSaveSession('/p', session);

    // Prefix [0,3) = 3 items, tail = 4 items → merged length = 7
    const tail = [...initial.slice(3), makeMessage(), makeMessage()];
    await dbSaveSession('/p', { ...session, messages: tail }, 3);

    const sessions = await dbGetSessions('/p');
    expect(sessions[0].messageCount).toBe(7);
  });
});

// ---------------------------------------------------------------------------
// dbDeleteSession
// ---------------------------------------------------------------------------
describe('dbDeleteSession', () => {
  it('removes session and its messages', async () => {
    const session = makeSession();
    await dbSaveSession('/project/a', session);

    await dbDeleteSession(session.id);

    const sessions = await dbGetSessions('/project/a');
    expect(sessions).toHaveLength(0);

    const messages = await dbGetMessages(session.id);
    expect(messages).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// dbPurgeExpired
// ---------------------------------------------------------------------------
describe('dbPurgeExpired', () => {
  it('deletes sessions older than retention days', async () => {
    const now = Date.now();
    const old = makeSession({
      title: 'Old',
      updatedAt: now - 31 * 24 * 60 * 60 * 1000, // 31 days ago
    });
    const recent = makeSession({
      title: 'Recent',
      updatedAt: now - 1 * 24 * 60 * 60 * 1000, // 1 day ago
    });

    await dbSaveSession('/project/a', old);
    await dbSaveSession('/project/a', recent);

    const count = await dbPurgeExpired(30);
    expect(count).toBe(1);

    const sessions = await dbGetSessions('/project/a');
    expect(sessions).toHaveLength(1);
    expect(sessions[0].title).toBe('Recent');
  });

  it('skips pinned sessions', async () => {
    const now = Date.now();
    const old = makeSession({
      title: 'Old Pinned',
      updatedAt: now - 31 * 24 * 60 * 60 * 1000,
      pinned: true,
    });

    await dbSaveSession('/project/a', old);

    const count = await dbPurgeExpired(30);
    expect(count).toBe(0);

    const sessions = await dbGetSessions('/project/a');
    expect(sessions).toHaveLength(1);
  });

  it('does nothing when retention is null (unlimited)', async () => {
    const now = Date.now();
    const old = makeSession({
      title: 'Very Old',
      updatedAt: now - 365 * 24 * 60 * 60 * 1000,
    });

    await dbSaveSession('/project/a', old);

    const count = await dbPurgeExpired(null);
    expect(count).toBe(0);

    const sessions = await dbGetSessions('/project/a');
    expect(sessions).toHaveLength(1);
  });

  it('purges messages along with session', async () => {
    const now = Date.now();
    const old = makeSession({
      updatedAt: now - 31 * 24 * 60 * 60 * 1000,
      messages: [makeMessage()],
    });

    await dbSaveSession('/project/a', old);
    await dbPurgeExpired(30);

    const messages = await dbGetMessages(old.id);
    expect(messages).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// migrateFromLocalStorage
// ---------------------------------------------------------------------------
describe('migrateFromLocalStorage', () => {
  beforeEach(() => {
    localStorage.clear();
    _resetMigrationFlag();
  });

  it('migrates sessions and messages from current localStorage format', async () => {
    const msg = makeMessage({ content: 'migrated message' });
    const session = makeSession({ title: 'Current Format', messages: [] });

    localStorage.setItem(
      'sai-sessions-index-/project/x',
      JSON.stringify([session]),
    );
    localStorage.setItem(
      `sai-session-msgs-${session.id}`,
      JSON.stringify([msg]),
    );

    await migrateFromLocalStorage();

    const sessions = await dbGetSessions('/project/x');
    expect(sessions).toHaveLength(1);
    expect(sessions[0].title).toBe('Current Format');

    const messages = await dbGetMessages(session.id);
    expect(messages).toHaveLength(1);
    expect(messages[0].content).toBe('migrated message');

    expect(localStorage.getItem('sai-sessions-index-/project/x')).toBeNull();
    expect(localStorage.getItem(`sai-session-msgs-${session.id}`)).toBeNull();
  });

  it('migrates legacy single-key format', async () => {
    const msg = makeMessage({ content: 'inline msg' });
    const session = makeSession({ title: 'Legacy Single', messages: [msg] });

    localStorage.setItem('sai-chat-sessions', JSON.stringify([session]));

    await migrateFromLocalStorage();

    const sessions = await dbGetSessions('');
    expect(sessions).toHaveLength(1);
    expect(sessions[0].title).toBe('Legacy Single');

    const messages = await dbGetMessages(session.id);
    expect(messages).toHaveLength(1);
    expect(messages[0].content).toBe('inline msg');

    expect(localStorage.getItem('sai-chat-sessions')).toBeNull();
  });

  it('migrates old per-path format', async () => {
    const msg = makeMessage({ content: 'per-path msg' });
    const session = makeSession({ title: 'Old Per-Path', messages: [msg] });

    localStorage.setItem(
      'sai-chat-sessions-/project/x',
      JSON.stringify([session]),
    );

    await migrateFromLocalStorage();

    const sessions = await dbGetSessions('/project/x');
    expect(sessions).toHaveLength(1);
    expect(sessions[0].title).toBe('Old Per-Path');

    const messages = await dbGetMessages(session.id);
    expect(messages).toHaveLength(1);
    expect(messages[0].content).toBe('per-path msg');

    expect(localStorage.getItem('sai-chat-sessions-/project/x')).toBeNull();
  });

  it('does nothing when no localStorage data exists', async () => {
    await migrateFromLocalStorage();

    const sessions = await dbGetSessions('');
    expect(sessions).toEqual([]);
    const sessions2 = await dbGetSessions('/project/x');
    expect(sessions2).toEqual([]);
  });
});
