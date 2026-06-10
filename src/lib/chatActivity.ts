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
 * Subset of ChatSession we need to evaluate per-workspace "needs attention"
 * roll-up. Kept narrow so the helper isn't coupled to the full type.
 */
export interface WorkspaceUnreadSessionShape {
  id: string;
  updatedAt: number;
  lastViewedAt?: number;
  lastTurnErrored?: boolean;
}

/**
 * Workspace context shape the roll-up reads. Just the projectPath + sessions
 * list — the App passes its `workspaces` Map values straight through.
 */
export interface WorkspaceUnreadShape {
  projectPath: string;
  sessions: ReadonlyArray<WorkspaceUnreadSessionShape>;
}

/**
 * Compute the union of (already-known completed workspaces) with workspaces
 * that contain at least one session needing attention (unread or errored).
 *
 * The currently focused workspace is exempt entirely — the titlebar must never
 * badge its own status. You're already looking at that workspace, so any of its
 * sessions completing is visible in the chat list, not the workspace switcher.
 * This also means visiting a workspace clears its green notice: switching makes
 * it the focused workspace, which drops it from the result.
 *
 * Used to drive the green '!' indicator in the TitleBar workspace switcher
 * so it reflects per-session state, not just whole-workspace busy/idle.
 */
export function computeCompletedWorkspaces(opts: {
  completedWorkspaces: ReadonlySet<string>;
  workspaces: ReadonlyArray<WorkspaceUnreadShape>;
  focusedProjectPath?: string;
}): Set<string> {
  const { completedWorkspaces, workspaces, focusedProjectPath } = opts;
  const next = new Set(completedWorkspaces);
  // Visiting a workspace clears its notice: never badge the one you're on.
  if (focusedProjectPath) next.delete(focusedProjectPath);
  for (const ws of workspaces) {
    if (ws.projectPath === focusedProjectPath) continue;
    for (const s of ws.sessions) {
      if (s.lastTurnErrored) { next.add(ws.projectPath); break; }
      if (s.updatedAt > (s.lastViewedAt ?? s.updatedAt)) { next.add(ws.projectPath); break; }
    }
  }
  return next;
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
