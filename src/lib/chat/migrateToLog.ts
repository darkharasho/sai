import { dbGetAllSessions, dbGetMessages } from '../../chatDb';
import type { ChatSession } from '../../types';

const FLAG = 'sai.chatlog.migrated.v1';

async function importSession(s: ChatSession): Promise<boolean> {
  const chatlog = (window as any).sai?.chatlog;
  if (!chatlog || !s.projectPath) return false;
  // Messages pass through untouched (including any inline base64 images).
  const messages = await dbGetMessages(s.id);
  return chatlog.importMessages(
    s.id,
    { projectPath: s.projectPath, provider: s.aiProvider ?? 'claude', title: s.title, createdAt: s.createdAt, updatedAt: s.updatedAt },
    messages,
  );
}

/** One-shot, idempotent copy of every IndexedDB chat into the main-process log. */
export async function migrateChatsToLog(opts: { batch?: number } = {}): Promise<{ imported: number; skipped: number }> {
  const result = { imported: 0, skipped: 0 };
  if (localStorage.getItem(FLAG)) return result;
  const batch = opts.batch ?? 20;
  const sessions = await dbGetAllSessions();
  let failed = false;
  for (let i = 0; i < sessions.length; i += batch) {
    for (const s of sessions.slice(i, i + batch)) {
      try {
        if (await importSession(s)) result.imported++;
        else result.skipped++;
      } catch (e) {
        failed = true;
        console.warn('[chatlog] import failed for chat', s.id, e);
      }
    }
    await new Promise(r => setTimeout(r, 0));
  }
  if (!failed) localStorage.setItem(FLAG, '1');
  return result;
}

/** Imports one chat if its log is missing (no-op when it exists or isn't in IndexedDB). */
export async function ensureChatInLog(chatId: string): Promise<void> {
  const s = (await dbGetAllSessions()).find(x => x.id === chatId);
  if (s) await importSession(s);
}
