import { dbGetMessages } from '../../chatDb';
import type { ChatMessage } from '../../types';
import { ensureChatInLog } from './migrateToLog';
import { emptyChatState, persistableState, reduceMany } from './reducer';

/**
 * A chat's messages as persisted history, read from the durable log (the
 * source of truth). Falls back to the IndexedDB mirror only when there is no
 * log API or the chat can't be placed in the log (no project).
 */
export async function readChatMessages(chatId: string): Promise<ChatMessage[]> {
  const api = window.sai?.chatlog;
  if (!api) return dbGetMessages(chatId);
  let res = await api.open(chatId, 0);
  if (!res.meta) {
    // Not imported yet (the one-shot migration may still be running).
    try { await ensureChatInLog(chatId); } catch { /* read what the log has */ }
    res = await api.open(chatId, 0);
  }
  if (!res.meta && !res.snapshot && res.entries.length === 0) return dbGetMessages(chatId);
  const base = res.snapshot ? res.snapshot.state : emptyChatState({ provider: res.meta?.provider ?? 'claude' });
  return persistableState(reduceMany(base, res.entries)).messages;
}
