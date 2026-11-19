import { describe, it, expect, beforeEach, vi } from 'vitest';
import 'fake-indexeddb/auto';
import { dbSaveSession, clearDb } from '@/chatDb';
import { migrateChatsToLog, ensureChatInLog, _resetMigrateStateForTests } from '@/lib/chat/migrateToLog';
import type { ChatSession, ChatMessage } from '@/types';

const FLAG = 'sai.chatlog.migrated.v1';

function msg(id: string): ChatMessage {
  return { id, role: 'user', content: id, timestamp: 1 };
}
function session(id: string, over: Partial<ChatSession> = {}): ChatSession {
  return { id, title: `t-${id}`, messages: [msg(`${id}-m1`), msg(`${id}-m2`)], messageCount: 2, createdAt: 10, updatedAt: 20, projectPath: '/p', ...over };
}

let logged: Map<string, { init: any; messages: ChatMessage[] }>;
let importMessages: ReturnType<typeof vi.fn>;
let list: ReturnType<typeof vi.fn>;

beforeEach(async () => {
  await clearDb();
  localStorage.clear();
  logged = new Map();
  importMessages = vi.fn(async (id: string, init: any, messages: ChatMessage[]) => {
    if (logged.has(id)) return false;
    logged.set(id, { init, messages });
    return true;
  });
  (globalThis as any).window = (globalThis as any).window ?? globalThis;
  list = vi.fn(async () => [...logged.keys()].map(chatId => ({ chatId })));
  (window as any).sai = { chatlog: { importMessages, list } };
  _resetMigrateStateForTests();
});

describe('migrateChatsToLog', () => {
  it('imports every chat once, preserving message ids', async () => {
    await dbSaveSession('/p', session('a', { aiProvider: 'codex' }));
    await dbSaveSession('/p', session('b'));
    const r = await migrateChatsToLog({ batch: 1 });
    expect(r).toEqual({ imported: 2, skipped: 0 });
    expect(logged.get('a')!.messages.map(m => m.id)).toEqual(['a-m1', 'a-m2']);
    expect(logged.get('a')!.init).toMatchObject({ projectPath: '/p', provider: 'codex', title: 't-a', createdAt: 10, updatedAt: 20 });
    expect(logged.get('b')!.init.provider).toBe('claude');
    expect(localStorage.getItem(FLAG)).toBe('1');
  });

  it('re-running skips already-imported chats', async () => {
    await dbSaveSession('/p', session('a'));
    await migrateChatsToLog();
    localStorage.removeItem(FLAG);
    const r = await migrateChatsToLog();
    expect(r).toEqual({ imported: 0, skipped: 1 });
  });

  it('a failure mid-pass leaves the flag unset and continues with the rest', async () => {
    await dbSaveSession('/p', session('a'));
    await dbSaveSession('/p', session('b'));
    await dbSaveSession('/p', session('c'));
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    importMessages.mockImplementation(async (id: string, init: any, messages: ChatMessage[]) => {
      if (id === 'b') throw new Error('clone failed');
      logged.set(id, { init, messages });
      return true;
    });
    const r = await migrateChatsToLog();
    expect(r.imported).toBe(2);
    expect(logged.has('a') && logged.has('c')).toBe(true);
    expect(localStorage.getItem(FLAG)).toBeNull();
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });

  it('is a no-op once the flag is set', async () => {
    await dbSaveSession('/p', session('a'));
    localStorage.setItem(FLAG, '1');
    expect(await migrateChatsToLog()).toEqual({ imported: 0, skipped: 0 });
    expect(importMessages).not.toHaveBeenCalled();
  });
});

it('without window.sai.chatlog returns early and leaves the flag unset', async () => {
  await dbSaveSession('/p', session('a'));
  (window as any).sai = {};
  expect(await migrateChatsToLog()).toEqual({ imported: 0, skipped: 0 });
  expect(localStorage.getItem(FLAG)).toBeNull();
});

it('concurrent calls share one pass', async () => {
  await dbSaveSession('/p', session('a'));
  const [x, y] = await Promise.all([migrateChatsToLog(), migrateChatsToLog()]);
  expect(x).toBe(y);
  expect(importMessages).toHaveBeenCalledTimes(1);
});

describe('ensureChatInLog', () => {
  it('imports a missing chat; skips cheaply when listed or already known', async () => {
    await dbSaveSession('/p', session('a'));
    await dbSaveSession('/p', session('b'));
    await ensureChatInLog('a');
    expect(importMessages).toHaveBeenCalledTimes(1);
    await ensureChatInLog('a'); // known in-memory: no list, no import
    expect(list).toHaveBeenCalledTimes(1);
    expect(importMessages).toHaveBeenCalledTimes(1);
    logged.set('b', { init: {}, messages: [] }); // already in the log, unknown to the module
    await ensureChatInLog('b');
    expect(importMessages).toHaveBeenCalledTimes(1);
    await ensureChatInLog('b');
    expect(list).toHaveBeenCalledTimes(2);
    await expect(ensureChatInLog('nope')).resolves.toBeUndefined();
  });
});
