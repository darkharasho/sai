import { dbGetAllSessions, dbGetMessages, dbGetSession } from '../../chatDb';
import type { ChatSession } from '../../types';

export const MIGRATED_FLAG = 'sai.chatlog.migrated.v1';
const FLAG = MIGRATED_FLAG;

/** Chat ids whose IndexedDB history is known to be in the log (so repeat checks are free). */
const knownInLog = new Set<string>();

/** True once every IndexedDB chat has been imported (the one-shot migration finished). */
export function isMigrationDone(): boolean {
  try { return !!localStorage.getItem(FLAG); } catch { return false; }
}

/** True when this chat's IndexedDB history is known to be in the log. */
export function isChatImported(chatId: string): boolean {
  return knownInLog.has(chatId);
}

async function importSession(s: ChatSession): Promise<boolean> {
  const chatlog = (window as any).sai?.chatlog;
  if (!chatlog || !s.projectPath) return false;
  // Messages pass through untouched (including any inline base64 images).
  const messages = await dbGetMessages(s.id);
  return chatlog.importMessages(
    s.id,
    { projectPath: s.projectPath, provider: s.aiProvider ?? 'claude', title: s.title, createdAt: s.createdAt, updatedAt: s.updatedAt },
    messages,
  ).then((result: 'created' | 'folded' | 'marked' | false) => { knownInLog.add(s.id); return !!result; });
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

/**
 * Makes sure a chat's IndexedDB history is in the log: imports it when the log
 * is missing, and FOLDS it in when a log exists that was never imported (a
 * backend event created it first — e.g. a start-up `ready` racing this check).
 * Cheap once known: no message load, no IPC payload.
 */
export async function ensureChatInLog(chatId: string): Promise<void> {
  if (knownInLog.has(chatId)) return;
  const chatlog = (window as any).sai?.chatlog;
  if (!chatlog) return;
  const s = await dbGetSession(chatId);
  if (s?.projectPath) {
    const listed: Array<{ chatId: string; imported?: boolean }> = await chatlog.list(s.projectPath);
    if (listed.some(m => m.chatId === chatId && m.imported)) { knownInLog.add(chatId); return; }
    await importSession(s);
    return;
  }
  // No IndexedDB history: nothing to fold. An existing log is settled as-is
  // (any IndexedDB row written from now on is a mirror of the log).
  await chatlog.importMessages(chatId, { projectPath: '', provider: 'claude', createdAt: 0, updatedAt: 0 }, []);
  // Nothing in IndexedDB can be lost: mirror writes (including a /clear's
  // empty one) may go through from now on.
  knownInLog.add(chatId);
}

/** Test hook. */
export function _resetMigrateStateForTests(): void {
  knownInLog.clear();
  inFlight = null;
}
