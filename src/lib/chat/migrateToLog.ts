import { dbGetAllSessions, dbGetMessages, dbGetSession } from '../../chatDb';
import type { ChatSession } from '../../types';

const FLAG = 'sai.chatlog.migrated.v1';

/** Chat ids known to already be in the log (so repeat checks are free). */
const knownInLog = new Set<string>();

async function importSession(s: ChatSession): Promise<boolean> {
  const chatlog = (window as any).sai?.chatlog;
  if (!chatlog || !s.projectPath) return false;
  // Messages pass through untouched (including any inline base64 images).
  const messages = await dbGetMessages(s.id);
  return chatlog.importMessages(
    s.id,
    { projectPath: s.projectPath, provider: s.aiProvider ?? 'claude', title: s.title, createdAt: s.createdAt, updatedAt: s.updatedAt },
    messages,
  ).then((imported: boolean) => { knownInLog.add(s.id); return imported; });
}

/** One-shot, idempotent copy of every IndexedDB chat into the main-process log. */
let inFlight: Promise<{ imported: number; skipped: number }> | null = null;

export function migrateChatsToLog(opts: { batch?: number } = {}): Promise<{ imported: number; skipped: number }> {
  if (!inFlight) inFlight = runMigration(opts).finally(() => { inFlight = null; });
  return inFlight;
}

async function runMigration(opts: { batch?: number }): Promise<{ imported: number; skipped: number }> {
  const result = { imported: 0, skipped: 0 };
  if (localStorage.getItem(FLAG)) return result;
  if (!(window as any).sai?.chatlog) return result; // can't import yet; leave the flag unset
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

/** Imports one chat if its log is missing. Cheap when already present: no message load, no IPC payload. */
export async function ensureChatInLog(chatId: string): Promise<void> {
  if (knownInLog.has(chatId)) return;
  const chatlog = (window as any).sai?.chatlog;
  if (!chatlog) return;
  const s = await dbGetSession(chatId);
  if (!s?.projectPath) return;
  const listed = await chatlog.list(s.projectPath);
  if (listed.some((m: { chatId: string }) => m.chatId === chatId)) { knownInLog.add(chatId); return; }
  await importSession(s);
}

/** Test hook. */
export function _resetMigrateStateForTests(): void {
  knownInLog.clear();
  inFlight = null;
}
