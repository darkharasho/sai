/**
 * A chat the desktop creates through a command must be settled (imported), so
 * a /clear can't be undone by a later history fold of the IndexedDB mirror.
 * Real ChatLogStore/Service/Commands (temp dir), real chatDb (fake IndexedDB),
 * real ensureChatInLog and mirror save queue.
 */
import 'fake-indexeddb/auto';
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { ChatLogStore } from '../../../electron/services/chatlog/store';
import { ChatLogService } from '../../../electron/services/chatlog/service';
import { ChatCommands } from '../../../electron/services/chatlog/commands';
import { clearDb, dbGetMessages } from '../../../src/chatDb';
import { queueSaveSession } from '../../../src/lib/sessionSaveQueue';
import { MIGRATED_FLAG, _resetMigrateStateForTests, ensureChatInLog } from '../../../src/lib/chat/migrateToLog';
import type { ChatMessage, ChatSession } from '../../../src/types';

const P = '/project';
let dir: string;
let store: ChatLogStore;
let svc: ChatLogService;
let cmds: ChatCommands;

beforeEach(async () => {
  await clearDb();
  localStorage.clear();
  localStorage.setItem(MIGRATED_FLAG, '1'); // a new chat after the one-shot migration
  _resetMigrateStateForTests();
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'chatlog-clear-'));
  store = new ChatLogStore({ dir });
  svc = new ChatLogService({ store, bus: () => null, liveChats: () => [], providerOf: () => 'claude', devlog: () => {}, sendToRenderer: () => {} });
  cmds = new ChatCommands({
    log: svc, store,
    dispatch: { send: () => {}, stop: () => {}, approve: async () => {}, answer: async () => {}, planReview: async () => {}, isBusy: () => false, isLoadPaused: () => false },
  });
  (window as any).sai = {
    chatlog: {
      open: async (id: string, after: number) => store.read(id, after),
      importMessages: async (id: string, init: any, msgs: ChatMessage[]) => svc.importMessages(id, init, msgs),
      list: async (pp: string) => store.list(pp),
    },
  };
});
afterEach(() => { store.close(); fs.rmSync(dir, { recursive: true, force: true }); delete (window as any).sai; });

const row = (messages: ChatMessage[]): ChatSession =>
  ({ id: 'c1', title: 't', messages, messageCount: messages.length, createdAt: 1, updatedAt: 2, projectPath: P });
const mirror = () => queueSaveSession(P, row(store.state('c1')!.messages), 0);

async function createChatWithTurn() {
  await ensureChatInLog('c1'); // the panel's open: no IndexedDB row yet
  const r = await cmds.run({ kind: 'send', chatId: 'c1', clientId: 'u1', text: 'hello', origin: 'desktop', projectPath: P });
  expect(r.ok).toBe(true);
  svc.record({ type: 'streaming_start', projectPath: P, scope: 'c1', turnSeq: 1 });
  svc.record({ type: 'assistant', projectPath: P, scope: 'c1', turnSeq: 1, message: { content: [{ type: 'text', text: 'hi' }] } });
  svc.record({ type: 'done', projectPath: P, scope: 'c1', turnSeq: 1 });
  await mirror();
  expect(await dbGetMessages('c1')).toHaveLength(2);
}

describe('a desktop-created chat is settled at creation', () => {
  it('a desktop send that creates the log marks it imported; a phone send does not', async () => {
    await cmds.run({ kind: 'send', chatId: 'd1', clientId: 'a', text: 'x', origin: 'desktop', projectPath: P });
    await cmds.run({ kind: 'send', chatId: 'r1', clientId: 'b', text: 'x', origin: 'remote', projectPath: P });
    await cmds.run({ kind: 'settings', chatId: 'd2', clientId: 'c', settings: { provider: 'codex' }, projectPath: P });
    await cmds.run({ kind: 'settings', chatId: 'r2', clientId: 'd', settings: { provider: 'codex' }, origin: 'remote', projectPath: P });
    expect(store.meta('d1')!.imported).toBe(true);
    expect(store.meta('d2')!.imported).toBe(true);
    expect(store.meta('r1')!.imported).toBeFalsy();
    expect(store.meta('r2')!.imported).toBeFalsy();
  });

  it('/clear then reopen: the mirror follows the clear and no history comes back', async () => {
    await createChatWithTurn();
    svc.appendClient('c1', { type: 'cleared' });
    expect(store.state('c1')!.messages).toEqual([]);
    await mirror();
    expect(await dbGetMessages('c1')).toEqual([]);
    _resetMigrateStateForTests(); // restart
    await ensureChatInLog('c1');
    expect(store.state('c1')!.messages).toEqual([]);
  });

  it('/clear, restart before the mirror write, reopen: still no history comes back', async () => {
    await createChatWithTurn();
    svc.appendClient('c1', { type: 'cleared' });
    _resetMigrateStateForTests(); // restart: the renderer forgot what it checked
    await mirror(); // may be skipped by the shrink guard; IndexedDB can keep the old 2
    await ensureChatInLog('c1');
    expect(store.state('c1')!.messages).toEqual([]);
  });
});
