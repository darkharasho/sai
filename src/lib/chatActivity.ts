// Pure helpers backing the chat-activity sidebar/NavBar — extracted from
// App.tsx so the math is testable without spinning up the full app.

/**
 * Result envelope from the Claude CLI. We only care about a few fields;
 * the rest pass through opaquely.
 */
export interface ResultEnvelopeShape {
  type?: string;
  is_error?: boolean;
  subtype?: string;
}

/**
 * True when a `result`-typed claude:message indicates the turn ended in an
 * error state. Used to stamp `lastTurnErrored` on the session row so the
 * sidebar can light up the red `!` indicator for background sessions.
 *
 * Kept defensive: anything that isn't a `result` envelope returns false.
 */
export function isTurnErrored(msg: ResultEnvelopeShape | null | undefined): boolean {
  if (!msg || msg.type !== 'result') return false;
  if (msg.is_error === true) return true;
  if (msg.subtype === 'error_during_execution') return true;
  if (msg.subtype === 'error_max_turns') return true;
  return false;
}

/**
 * Count of distinct sessions that need user attention from outside the
 * currently focused session. Surfaced as the NavBar `Chats` badge.
 *
 * Each session is counted at most once even if it appears in multiple
 * input sets (e.g. both unread and awaiting). The active session is
 * excluded — the user is already looking at it, so it isn't "elsewhere
 * activity."
 */
export function computeChatNotificationCount(opts: {
  unread: ReadonlySet<string>;
  awaiting: ReadonlySet<string>;
  error: ReadonlySet<string>;
  activeSessionId?: string;
}): number {
  const { unread, awaiting, error, activeSessionId } = opts;
  const ids = new Set<string>();
  for (const id of unread) if (id !== activeSessionId) ids.add(id);
  for (const id of awaiting) if (id !== activeSessionId) ids.add(id);
  for (const id of error) if (id !== activeSessionId) ids.add(id);
  return ids.size;
}
