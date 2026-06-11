import type { ChatMessage, ChatSession } from './types';
import { generateSmartTitle } from './sessions';

export interface WorkspaceLike {
  activeSession: ChatSession;
}

export interface FlushPlan {
  wsPath: string;
  session: ChatSession;
  fromIdx: number;
}

// Given a transition from `prevMounted` to `nextMounted`, return a list of
// workspace flushes that should be persisted. A flush is needed for any
// workspace that was mounted, is no longer in the next set, and has new
// in-flight messages since its last persist.
//
// Skips when message count hasn't changed — bumping updatedAt without real
// activity left every previously-active workspace looking unread on next
// launch (see b039f15 for the matching periodic-save fix).
//
// Pure: no side effects. Lives in its own module so it can be unit-tested
// without rendering the App component tree.
export function computeUnmountFlushes<W extends WorkspaceLike>(args: {
  prevMounted: Iterable<string>;
  nextMounted: Set<string>;
  workspaces: Map<string, W>;
  wsMessages: Map<string, ChatMessage[]>;
  wsFirstLoadedIdx: Map<string, number>;
  focusedPath?: string;
  now?: number;
}): FlushPlan[] {
  const now = args.now ?? Date.now();
  const out: FlushPlan[] = [];
  for (const wsPath of args.prevMounted) {
    if (args.nextMounted.has(wsPath)) continue;
    const messages = args.wsMessages.get(wsPath);
    if (!messages || messages.length === 0) continue;
    const ws = args.workspaces.get(wsPath);
    if (!ws) continue;
    if (messages.length === ws.activeSession.messageCount) continue;
    const session: ChatSession = {
      ...ws.activeSession,
      messages,
      updatedAt: now,
      // Only stamp lastViewedAt when the user is actually looking at this
      // workspace as it unmounts. Background workspaces keep their prior
      // lastViewedAt so the unread indicator persists.
      ...(wsPath === args.focusedPath ? { lastViewedAt: now } : {}),
      messageCount: messages.length,
    };
    if (!session.title) {
      const firstUserMsg = messages.find(m => m.role === 'user');
      if (firstUserMsg) session.title = generateSmartTitle(firstUserMsg.content);
    }
    out.push({
      wsPath,
      session,
      fromIdx: args.wsFirstLoadedIdx.get(wsPath) ?? 0,
    });
  }
  return out;
}

// Compute the saves needed to persist every workspace's live chat state at
// shutdown. Mirrors the (previously inline) beforeunload logic: skip
// workspaces with nothing new, only bump lastViewedAt on the focused one,
// and fall back to the activeSession snapshot when no live buffer exists.
export function computeQuitFlushes<W extends WorkspaceLike>(args: {
  workspaces: Map<string, W>;
  wsMessages: Map<string, ChatMessage[]>;
  wsFirstLoadedIdx: Map<string, number>;
  focusedPath?: string | null;
  now?: number;
}): FlushPlan[] {
  const now = args.now ?? Date.now();
  const out: FlushPlan[] = [];
  for (const [wsPath, ws] of args.workspaces) {
    const fromIdx = args.wsFirstLoadedIdx.get(wsPath) ?? 0;
    const latest = args.wsMessages.get(wsPath);
    if (!latest || latest.length === 0) {
      if (ws.activeSession.messages.length > 0) {
        out.push({ wsPath, session: ws.activeSession, fromIdx });
      }
      continue;
    }
    if (latest.length === ws.activeSession.messageCount) continue;
    out.push({
      wsPath,
      fromIdx,
      session: {
        ...ws.activeSession,
        messages: latest,
        updatedAt: now,
        ...(wsPath === args.focusedPath ? { lastViewedAt: now } : {}),
        messageCount: latest.length,
      },
    });
  }
  return out;
}
