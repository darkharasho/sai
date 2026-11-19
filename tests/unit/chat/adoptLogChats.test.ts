import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const order: string[] = [];
const rows = new Map<string, unknown>();
const dbGetSession = vi.fn(async (id: string) => rows.get(id));
const dbSaveSession = vi.fn(async (projectPath: string, s: { id: string }) => { order.push(`save:${s.id}`); rows.set(s.id, { ...s, projectPath }); });
vi.mock('../../../src/chatDb', () => ({
  dbGetSession: (id: string) => dbGetSession(id),
  dbSaveSession: (p: string, s: { id: string }) => dbSaveSession(p, s),
}));
const ensureChatInLog = vi.fn(async (id: string) => { order.push(`ensure:${id}`); });
vi.mock('../../../src/lib/chat/migrateToLog', () => ({ ensureChatInLog: (id: string) => ensureChatInLog(id) }));
const logMessages = new Map<string, unknown[]>();
vi.mock('../../../src/lib/chat/readChat', () => ({ readChatMessages: async (id: string) => logMessages.get(id) ?? [] }));
let phone = false;
vi.mock('../../../src/lib/platform', () => ({ isPhone: () => phone }));

import { adoptLogChats } from '../../../src/lib/chat/adoptLogChats';

const meta = (chatId: string, extra: Record<string, unknown> = {}) =>
  ({ chatId, projectPath: '/var/home/me/proj', createdAt: 10, updatedAt: 20, headSeq: 3, snapshotSeq: 0, provider: 'codex', openTurn: false, ...extra });
const user = (content: string) => ({ id: 'u', role: 'user', content, timestamp: 1 });

describe('adoptLogChats', () => {
  let list: ReturnType<typeof vi.fn>;
  beforeEach(() => {
    order.length = 0; rows.clear(); logMessages.clear(); phone = false;
    dbGetSession.mockClear(); dbSaveSession.mockClear(); ensureChatInLog.mockClear();
    list = vi.fn(async () => [meta('phone-chat'), meta('desk-chat')]);
    (window as any).sai = { chatlog: { list } };
    rows.set('desk-chat', { id: 'desk-chat' });
    logMessages.set('phone-chat', [user('can you fix the login bug'), { id: 'a', role: 'assistant', content: 'done', timestamp: 2 }]);
  });
  afterEach(() => { delete (window as any).sai; });

  it('writes an IndexedDB row for a chat only the log has, under the desktop workspace path', async () => {
    expect(await adoptLogChats('/home/me/proj')).toBe(1);
    expect(list).toHaveBeenCalledWith('/home/me/proj');
    expect(dbSaveSession).toHaveBeenCalledTimes(1);
    const [path, s] = dbSaveSession.mock.calls[0] as [string, any];
    expect(path).toBe('/home/me/proj');
    expect(s).toMatchObject({ id: 'phone-chat', title: 'Fix the login bug', messageCount: 2, createdAt: 10, updatedAt: 20, aiProvider: 'codex' });
    expect(s.lastViewedAt).toBeUndefined(); // arrives unread
  });

  it('settles the log before the row exists, so the mirror is never folded in front of itself', async () => {
    await adoptLogChats('/home/me/proj');
    expect(order).toEqual(['ensure:phone-chat', 'save:phone-chat']);
  });

  it('keeps the log title when it has one', async () => {
    list.mockResolvedValue([meta('phone-chat', { title: 'Named on phone' })]);
    await adoptLogChats('/home/me/proj');
    expect((dbSaveSession.mock.calls[0] as any)[1].title).toBe('Named on phone');
  });

  it('skips chats the desktop holds in memory, chats with no messages, and the phone itself', async () => {
    expect(await adoptLogChats('/home/me/proj', new Set(['phone-chat']))).toBe(0);
    logMessages.set('phone-chat', []);
    expect(await adoptLogChats('/home/me/proj')).toBe(0);
    logMessages.set('phone-chat', [user('hi')]);
    phone = true;
    expect(await adoptLogChats('/home/me/proj')).toBe(0);
    expect(dbSaveSession).not.toHaveBeenCalled();
  });

  it('does not overwrite a row the desktop persisted while the log was being read', async () => {
    ensureChatInLog.mockImplementationOnce(async (id: string) => { rows.set(id, { id }); });
    expect(await adoptLogChats('/home/me/proj')).toBe(0);
    expect(dbSaveSession).not.toHaveBeenCalled();
  });
});
