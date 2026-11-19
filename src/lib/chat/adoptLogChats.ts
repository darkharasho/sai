import { dbGetSession, dbSaveSession } from '../../chatDb';
import { generateSmartTitle } from '../../sessions';
import type { ChatSession } from '../../types';
import { isPhone } from '../platform';
import { ensureChatInLog } from './migrateToLog';
import { readChatMessages } from './readChat';

/**
 * Chats that exist only in main's log (the phone started them) get an
 * IndexedDB row, so the desktop lists them like any other chat. IndexedDB is
 * the desktop's chat list; the log is the history, so the row is a mirror.
 *
 * Order matters: the log is settled (ensureChatInLog, while no IndexedDB row
 * exists) BEFORE the row is written. Otherwise the next ensureChatInLog would
 * see an IndexedDB row next to an unimported log and fold the mirrored
 * messages in front of themselves.
 *
 * `skip` holds chat ids the desktop already has in memory (an active chat not
 * yet persisted) — its own panel writes that row.
 * Returns the number of chats adopted.
 */
export async function adoptLogChats(projectPath: string, skip: ReadonlySet<string> = new Set()): Promise<number> {
  if (isPhone()) return 0;
  const chatlog = window.sai?.chatlog;
  if (!chatlog || !projectPath) return 0;
  const metas: Array<{ chatId: string; title?: string; createdAt: number; updatedAt: number; provider?: ChatSession['aiProvider'] }> =
    await chatlog.list(projectPath);
  let adopted = 0;
  for (const meta of metas) {
    if (skip.has(meta.chatId)) continue;
    try {
      // Any project: /home may be a symlink to /var/home, so the row's path string can differ.
      if (await dbGetSession(meta.chatId)) continue;
      await ensureChatInLog(meta.chatId);
      const messages = await readChatMessages(meta.chatId);
      if (messages.length === 0) continue;
      if (await dbGetSession(meta.chatId)) continue; // the desktop persisted it meanwhile
      const firstUser = messages.find(m => m.role === 'user' && m.content.trim());
      const session: ChatSession = {
        id: meta.chatId,
        title: meta.title || (firstUser ? generateSmartTitle(firstUser.content) : ''),
        messages,
        messageCount: messages.length,
        createdAt: meta.createdAt || Date.now(),
        updatedAt: meta.updatedAt || Date.now(),
        aiProvider: meta.provider ?? 'claude',
      };
      await dbSaveSession(projectPath, session);
      adopted++;
    } catch (e) {
      console.warn('[chatlog] could not list chat', meta.chatId, e);
    }
  }
  return adopted;
}
