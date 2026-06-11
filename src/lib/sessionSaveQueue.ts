import { dbSaveSession } from '../chatDb';
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

export const queueSaveSession = createSaveQueue();
