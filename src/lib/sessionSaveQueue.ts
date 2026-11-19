import { dbGetMessages, dbSaveSession } from '../chatDb';
import { isChatImported, isMigrationDone } from './chat/migrateToLog';
import { externalizeSessionImages } from './externalizeImages';
import type { ChatSession } from '../types';

type SaveFn = (projectPath: string, session: ChatSession, fromIdx?: number) => Promise<void>;

const ERROR_EVENT_THROTTLE_MS = 30_000;

/**
 * Serialize session saves per session id so concurrent dbSaveSession calls
 * can't interleave their read-merge (fromIdx) transactions, and surface
 * failures (console + throttled `sai-persist-error` window event) instead of
 * silently dropping them. The returned promise rejects on failure so callers
 * chaining `.then()` only proceed on success.
 */
export function createSaveQueue(saveFn: SaveFn = dbSaveSession): SaveFn {
  const tails = new Map<string, Promise<void>>();
  let lastErrorEventAt = 0;

  const report = (err: unknown) => {
    console.error('[persist] session save failed:', err);
    const now = Date.now();
    if (now - lastErrorEventAt < ERROR_EVENT_THROTTLE_MS) return;
    lastErrorEventAt = now;
    const quota = err instanceof DOMException && err.name === 'QuotaExceededError';
    window.dispatchEvent(new CustomEvent('sai-persist-error', {
      detail: { quota, message: err instanceof Error ? err.message : String(err) },
    }));
  };

  return (projectPath, session, fromIdx) => {
    const prev = tails.get(session.id) ?? Promise.resolve();
    const run = prev.catch(() => {}).then(() => saveFn(projectPath, session, fromIdx));
    const tail = run.catch(report);
    tails.set(session.id, tail);
    void tail.finally(() => {
      if (tails.get(session.id) === tail) tails.delete(session.id);
    });
    return run;
  };
}

/**
 * IndexedDB is a mirror of the chat log. Until a chat's IndexedDB history is
 * known to be in the log (migration done AND this chat imported), a mirror
 * write that would leave fewer messages than IndexedDB holds is skipped: the
 * log copy may still be missing that history, and replacing the stored list
 * with it would lose the only copy.
 */
export async function mirrorWouldShrink(session: ChatSession, fromIdx?: number): Promise<boolean> {
  if (isMigrationDone() && isChatImported(session.id)) return false;
  let stored: number;
  try { stored = (await dbGetMessages(session.id)).length; } catch { return false; }
  const next = Math.max(0, fromIdx ?? 0) + session.messages.length;
  if (next >= stored) return false;
  window.sai?.devlog?.('chatlog.mirrorShrinkSkipped', { chatId: session.id, stored, next });
  return true;
}

export const queueSaveSession = createSaveQueue(async (projectPath, session, fromIdx) => {
  if (await mirrorWouldShrink(session, fromIdx)) return;
  return dbSaveSession(projectPath, await externalizeSessionImages(session), fromIdx);
});
