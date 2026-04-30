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
// workspace that was mounted, is no longer in the next set, and has at
// least one in-flight message in `wsMessages`.
//
// Pure: no side effects. Lives in its own module so it can be unit-tested
// without rendering the App component tree.
export function computeUnmountFlushes<W extends WorkspaceLike>(args: {
  prevMounted: Iterable<string>;
  nextMounted: Set<string>;
  workspaces: Map<string, W>;
  wsMessages: Map<string, ChatMessage[]>;
  wsFirstLoadedIdx: Map<string, number>;
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
    const session: ChatSession = {
      ...ws.activeSession,
      messages,
      updatedAt: now,
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
