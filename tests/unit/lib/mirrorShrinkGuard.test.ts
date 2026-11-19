import { describe, it, expect, beforeEach } from 'vitest';
import 'fake-indexeddb/auto';
import { clearDb, dbGetMessages, dbSaveSession } from '@/chatDb';
import { queueSaveSession, mirrorWouldShrink } from '@/lib/sessionSaveQueue';
import { MIGRATED_FLAG, _resetMigrateStateForTests, ensureChatInLog } from '@/lib/chat/migrateToLog';
import type { ChatMessage, ChatSession } from '@/types';
import { createMockChatlog } from '../../helpers/chatlogMock';

const m = (id: string): ChatMessage => ({ id, role: 'user', content: id, timestamp: 1 });
const session = (messages: ChatMessage[]): ChatSession =>
  ({ id: 'c1', title: 't', messages, messageCount: messages.length, createdAt: 1, updatedAt: 2, projectPath: '/p' });

beforeEach(async () => {
  await clearDb();
  localStorage.clear();
  _resetMigrateStateForTests();
  (window as any).sai = { chatlog: createMockChatlog() };
});

describe('IndexedDB mirror never shrinks a chat whose history may not be in the log yet', () => {
  it('skips a shorter full save while the migration has not finished', async () => {
    await dbSaveSession('/p', session([m('a'), m('b'), m('c')]));
    expect(await mirrorWouldShrink(session([m('x')]))).toBe(true);
    await queueSaveSession('/p', session([m('x')]), 0);
    expect((await dbGetMessages('c1')).map(x => x.id)).toEqual(['a', 'b', 'c']);
    // Growing (or equal) writes still go through.
    await queueSaveSession('/p', session([m('a'), m('b'), m('c'), m('d')]), 0);
    expect(await dbGetMessages('c1')).toHaveLength(4);
  });

  it('skips it when migrated but this chat is not known imported; allows it once imported', async () => {
    await dbSaveSession('/p', session([m('a'), m('b')]));
    localStorage.setItem(MIGRATED_FLAG, '1');
    expect(await mirrorWouldShrink(session([m('a')]))).toBe(true);
    await ensureChatInLog('c1'); // imports a, b into the log
    expect(await mirrorWouldShrink(session([m('a')]))).toBe(false);
  });
});
