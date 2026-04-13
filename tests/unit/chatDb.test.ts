import { describe, it, expect, beforeEach } from 'vitest';
import 'fake-indexeddb/auto';
import {
  dbGetSessions,
  dbSaveSession,
  dbGetMessages,
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
