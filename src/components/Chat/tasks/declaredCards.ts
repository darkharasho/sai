import type { ChatMessage } from '../../../types';
import type { TaskCard, TaskStep } from './types';
import { isSaiTaskToolName, validateSaiTaskInput } from '../../../lib/saiTaskTool';

export interface DeclaredCards {
  cards: TaskCard[];
  batchStartedAt: number | null;
  /**
   * The card the model last tagged: every later assistant message is attributed
   * to it until it finishes or another task is updated. null = untagged output.
   */
  activeCardId: string | null;
}

const isFinished = (c: TaskCard) => c.status === 'done' || c.status === 'failed';
const strings = (v: unknown): string[] => (Array.isArray(v) ? v.filter((s): s is string => typeof s === 'string') : []);

function parseInput(raw: unknown): Record<string, any> | null {
  try {
    const v = typeof raw === 'string' ? JSON.parse(raw) : raw;
    if (!validateSaiTaskInput(v).ok) return null;
    return v as Record<string, any>;
  } catch {
    return null;
  }
}

function recount(c: TaskCard): void {
  c.totalCount = c.steps.length;
  c.doneCount = c.steps.filter((s) => s.state === 'done').length;
  c.currentLabel = c.steps.find((s) => s.state === 'current')?.label ?? null;
}

/**
 * Fold the model's `sai_task` calls (in chat history order) into task cards. Never throws.
 *
 * Updating a task also tags the output that follows it: assistant messages are
 * attributed to the last-updated card until that card finishes or another is
 * updated, which is what gives a non-subagent card a stream of its own.
 */
export function deriveDeclaredCards(messages: ChatMessage[]): DeclaredCards {
  let cards: TaskCard[] = [];
  let batchStartedAt: number | null = null;
  let activeCardId: string | null = null;
  // A user message arrived since the last sai_task call: an unfinished batch the
  // model never closed out may be abandoned (see the create branch).
  let userSinceTaskCall = false;

  try {
    for (const m of messages ?? []) {
      if (m?.role === 'user') { userSinceTaskCall = true; continue; }
      if (m?.role !== 'assistant') continue;
      const calls = Array.isArray(m.toolCalls) ? m.toolCalls : [];

      // Attribute this message to the card that was tagged before it.
      if (activeCardId) {
        const onlyTask = calls.length > 0 && calls.every((c) => isSaiTaskToolName(c?.name));
        const empty = typeof m.content !== 'string' || m.content.trim() === '';
        if (!(onlyTask && empty)) {
          cards.find((c) => c.id === activeCardId)?.messageIds.push(m.id);
        }
      }

      for (const call of calls) {
        if (!call || !isSaiTaskToolName(call.name)) continue;
        const input = parseInput(call.input);
        if (!input) continue;
        const ts = m.timestamp;
        const userTurnSince = userSinceTaskCall;
        userSinceTaskCall = false;

        if (input.action === 'create') {
          // New batch when the old one is finished, or when the user moved on and
          // no agent-backed card may still be working. Approximation: the fold
          // can't see runtime state, so an agent card counts as possibly live
          // until the model marks it finished.
          const abandoned = userTurnSince && !cards.some((c) => c.agent !== null && !isFinished(c));
          if (cards.length === 0 || cards.every(isFinished) || abandoned) {
            cards = [];
            batchStartedAt = ts;
            activeCardId = null;
          }
          for (const t of input.tasks as any[]) {
            if (!t || typeof t.id !== 'string' || typeof t.title !== 'string') continue;
            if (cards.some((c) => c.id === t.id)) continue;
            const steps: TaskStep[] = strings(t.steps).map((label) => ({ label, state: 'pending' }));
            const card: TaskCard = {
              id: t.id, source: 'declared', title: t.title, status: 'queued', steps,
              doneCount: 0, totalCount: 0, currentLabel: null, startedAt: null, endedAt: null,
              result: null,
              agent: typeof t.agent === 'string' && t.agent ? { description: t.agent, toolUseId: null, taskId: null } : null,
              messageIds: [], question: null,
            };
            recount(card);
            cards.push(card);
          }
          continue;
        }

        const card = cards.find((c) => c.id === input.id);
        if (!card) continue;
        const note = typeof input.note === 'string' ? input.note : null;

        if (typeof input.agent === 'string' && input.agent) {
          card.agent = { description: input.agent, toolUseId: null, taskId: null };
        }
        const extra = strings(input.add_steps);
        for (const label of extra) card.steps.push({ label, state: 'pending' });

        if (input.status === 'running') {
          const curIdx = card.steps.findIndex((s) => s.state === 'current');
          const want = typeof input.step === 'number' ? Math.trunc(input.step) : Math.max(curIdx, 0);
          const k = Math.min(Math.max(want, 0), Math.max(card.steps.length - 1, 0));
          card.steps.forEach((s, i) => { s.state = i < k ? 'done' : i === k ? 'current' : 'pending'; });
          card.status = 'running';
          card.endedAt = null;
          if (card.startedAt == null) card.startedAt = ts;
        } else if (input.status === 'done') {
          card.steps.forEach((s) => { s.state = 'done'; });
          card.status = 'done';
          card.endedAt = ts;
          card.result = note;
        } else if (input.status === 'failed') {
          card.status = 'failed';
          card.endedAt = ts;
          card.result = note ?? 'Failed';
        }

        // Any update tags the card: the model touching a task is the signal that
        // what it does next belongs to that task. Finishing it untags.
        // Agent-backed cards are tagged too — the renderer prefers the subagent
        // transcript when there is one, so this only surfaces on cards that
        // never got an agent (an unresolved agent string, a failed spawn).
        activeCardId = input.status === 'done' || input.status === 'failed'
          ? (activeCardId === card.id ? null : activeCardId)
          : card.id;
        recount(card);
      }
    }
  } catch {
    // display-only fold: never throw into render
  }

  return { cards, batchStartedAt, activeCardId };
}
