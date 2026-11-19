import type { ChatSession } from '../types';

// Merge a fresh dbGetSessions read into the in-memory sessions list.
//
// The DB read races in-flight meta patches (dbPatchSessionMeta stamping
// lastViewedAt on select/view) and the in-memory list can hold rows the DB
// doesn't have yet (a brand-new chat is only persisted on its first user
// message). Taking the fresh rows wholesale therefore (a) rolled lastViewedAt
// back, re-flagging a just-viewed session as unread, and (b) dropped the
// active session's row from the sidebar until its first persist.
export function mergeSessionRefresh(
  fresh: ChatSession[],
  current: ChatSession[],
  activeSession?: ChatSession | null,
): ChatSession[] {
  const currentById = new Map(current.map(s => [s.id, s]));
  const merged = fresh.map(row => {
    const mem = currentById.get(row.id);
    if (!mem) return row;
    const memViewed = mem.lastViewedAt ?? 0;
    const dbViewed = row.lastViewedAt ?? 0;
    return memViewed > dbViewed ? { ...row, lastViewedAt: mem.lastViewedAt } : row;
  });
  if (activeSession && !merged.some(s => s.id === activeSession.id)) {
    // Keep the sidebar row for the not-yet-persisted active chat. Strip the
    // live message buffer — list rows are messageless by convention.
    merged.unshift({ ...activeSession, messages: [] });
  }
  return merged;
}

/** Every chat id the desktop holds in memory: listed rows plus each workspace's active (maybe unpersisted) chat. */
export function inMemorySessionIds(
  workspaces: ReadonlyMap<string, { sessions: ChatSession[]; activeSession?: ChatSession | null }>,
): Set<string> {
  const ids = new Set<string>();
  for (const ws of workspaces.values()) {
    for (const s of ws.sessions) ids.add(s.id);
    if (ws.activeSession) ids.add(ws.activeSession.id);
  }
  return ids;
}
