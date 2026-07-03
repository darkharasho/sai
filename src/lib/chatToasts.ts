import type { ChatSession } from '../types';
import type { ToastTone } from '../components/WorkspaceToast';

export interface ChatToastSeed {
  id: string;          // stable per emit (e.g. `done-${sid}-${ts}`)
  sessionId: string;
  message: string;
  tone: ToastTone;
}

export function computeChatToasts(
  prevStreaming: Set<string>,
  nextStreaming: Set<string>,
  prevAwaiting: Set<string>,
  nextAwaiting: Set<string>,
  sessions: ChatSession[],
  activeSessionId: string | undefined,
  now: number,
  /** Sessions currently in a wait (scheduled wakeup / background work).
   *  Leaving the streaming set for a wait is NOT a finished reply. */
  waiting: Set<string> = new Set(),
  /** Sessions blocked on an AskUserQuestion / plan review, previous tick. */
  prevQuestion: Set<string> = new Set(),
  /** Same, current tick — a new entry toasts like an approval. */
  nextQuestion: Set<string> = new Set(),
): ChatToastSeed[] {
  const seeds: ChatToastSeed[] = [];
  // Turn finished: was streaming, no longer is, not the active session.
  for (const sid of prevStreaming) {
    if (nextStreaming.has(sid)) continue;
    if (sid === activeSessionId) continue;
    if (waiting.has(sid)) continue;
    const s = sessions.find(x => x.id === sid);
    if (!s) continue;
    seeds.push({
      id: `done-${sid}-${now}`,
      sessionId: sid,
      message: `Reply ready in '${s.title || 'Untitled'}'`,
      tone: 'success',
    });
  }
  // Approval pending: newly in awaiting, not the active session.
  for (const sid of nextAwaiting) {
    if (prevAwaiting.has(sid)) continue;
    if (sid === activeSessionId) continue;
    const s = sessions.find(x => x.id === sid);
    if (!s) continue;
    seeds.push({
      id: `approval-${sid}-${now}`,
      sessionId: sid,
      message: `Approval needed in '${s.title || 'Untitled'}'`,
      tone: 'attention',
    });
  }
  // Question pending: newly blocked on an answer, not the active session.
  for (const sid of nextQuestion) {
    if (prevQuestion.has(sid)) continue;
    if (sid === activeSessionId) continue;
    const s = sessions.find(x => x.id === sid);
    if (!s) continue;
    seeds.push({
      id: `question-${sid}-${now}`,
      sessionId: sid,
      message: `Waiting for your answer in '${s.title || 'Untitled'}'`,
      tone: 'attention',
    });
  }
  return seeds;
}
