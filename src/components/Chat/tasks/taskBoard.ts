// Merge the model's declared task cards with runtime truth (background task
// snapshots, streaming flag, pending question, subagent transcript info), plus
// a TodoWrite/TaskCreate fallback card. Display-only: nothing here may feed
// turn completion, notifications, or wait state.

import type { ChatMessage } from '../../../types';
import type { BackgroundTaskDetail } from '../../../../electron/services/claudeBackend/backgroundTasks';
import type { CardStatus, TaskBoard, TaskCard, TaskStep } from './types';
import { deriveDeclaredCards } from './declaredCards';
import { findLatestTodos } from '../TodoProgress';

export interface BoardRuntime {
  backgroundTasks: BackgroundTaskDetail[];
  isStreaming: boolean;
  pendingQuestion: { text: string; options: string[] } | null;
  /** Keyed by the Agent call's tool_use id. */
  agentInfo: Map<string, { finished: boolean; steps: TaskStep[] }>;
}

const EMPTY_BOARD: TaskBoard = { cards: [], batchStartedAt: null, allDone: false };

const text = (v: unknown): string => (typeof v === 'string' ? v : '');
const isFinished = (s: CardStatus) => s === 'done' || s === 'failed';

function recount(c: TaskCard): void {
  c.totalCount = c.steps.length;
  c.doneCount = c.steps.filter((s) => s.state === 'done').length;
  c.currentLabel = c.steps.find((s) => s.state === 'current')?.label ?? null;
}

/** Map a background task's status to a card status (rule 2). */
function runtimeStatus(t: BackgroundTaskDetail): CardStatus {
  switch (t.status) {
    case 'completed': return 'done';
    case 'failed':
    case 'stopped': return 'failed';
    default: return 'running';
  }
}

function runtimeResult(t: BackgroundTaskDetail, fallback: string | null): string | null {
  if (t.status === 'stopped') return 'Stopped';
  if (t.status === 'failed') return text(t.error) || fallback || text(t.summary) || 'Failed';
  if (t.status === 'completed') return fallback ?? (text(t.summary) || null);
  return null;
}

function agentSteps(rt: BoardRuntime, toolUseId: string | null): TaskStep[] {
  if (!toolUseId) return [];
  const steps = rt.agentInfo?.get?.(toolUseId)?.steps;
  return Array.isArray(steps) ? steps.filter((s) => s && typeof s.label === 'string').map((s) => ({ ...s })) : [];
}

/** description → tool_use id of the latest Agent/Task tool call carrying it. */
function agentCallIds(messages: ChatMessage[]): Map<string, string> {
  const out = new Map<string, string>();
  for (const m of messages) {
    if (m?.role !== 'assistant' || !Array.isArray(m.toolCalls)) continue;
    for (const c of m.toolCalls) {
      if (!c || (c.name !== 'Agent' && c.name !== 'Task') || typeof c.id !== 'string' || !c.id) continue;
      try {
        const input = typeof c.input === 'string' ? JSON.parse(c.input) : c.input;
        const desc = text(input?.description);
        if (desc) out.set(desc, c.id);
      } catch { /* malformed input */ }
    }
  }
  return out;
}

function fallbackCard(messages: ChatMessage[], isStreaming: boolean): TaskCard | null {
  let todos: ReturnType<typeof findLatestTodos> = null;
  try { todos = findLatestTodos(messages); } catch { return null; }
  if (!Array.isArray(todos) || todos.length === 0) return null;
  const steps: TaskStep[] = todos.filter(Boolean).map((t) => ({
    label: text(t.content) || text(t.activeForm),
    state: t.status === 'completed' ? 'done' : t.status === 'in_progress' ? 'current' : 'pending',
  }));
  if (steps.length === 0) return null;
  const allComplete = steps.every((s) => s.state === 'done');
  const card: TaskCard = {
    id: 'current-work', source: 'fallback', title: 'Current work',
    status: allComplete ? 'done' : isStreaming ? 'running' : 'paused',
    steps, doneCount: 0, totalCount: 0, currentLabel: null, startedAt: null, endedAt: null,
    result: null, agent: null, messageIds: [], question: null,
  };
  recount(card);
  return card;
}

export function deriveTaskBoard(messages: ChatMessage[], rt: BoardRuntime): TaskBoard {
  try {
    const msgs = Array.isArray(messages) ? messages : [];
    const isStreaming = rt?.isStreaming === true;
    const pendingQuestion = rt?.pendingQuestion ?? null;
    const tasks = (Array.isArray(rt?.backgroundTasks) ? rt.backgroundTasks : []).filter(
      (t): t is BackgroundTaskDetail => !!t && typeof t.id === 'string',
    );
    const runtime: BoardRuntime = { backgroundTasks: tasks, isStreaming, pendingQuestion, agentInfo: rt?.agentInfo ?? new Map() };

    const declared = deriveDeclaredCards(msgs);
    const callIds = agentCallIds(msgs);
    const matched = new Set<string>(); // background task ids claimed by a declared card

    const cards: TaskCard[] = declared.cards.map((orig) => {
      const card: TaskCard = { ...orig, steps: orig.steps.map((s) => ({ ...s })), messageIds: [...orig.messageIds] };

      // Rule 1: resolve the agent's tool_use id (and background task).
      let detail: BackgroundTaskDetail | undefined;
      if (card.agent) {
        const desc = card.agent.description;
        let toolUseId = callIds.get(desc) ?? null;
        const free = (t: BackgroundTaskDetail) => !t.hidden && !matched.has(t.id);
        if (toolUseId) {
          // tool_use_id is optional on task frames: fall back to a description
          // match among tasks that don't carry a conflicting id.
          detail = tasks.find((t) => t.toolUseId === toolUseId) ??
            tasks.find((t) => free(t) && (t.toolUseId == null || t.toolUseId === toolUseId) && text(t.description) === desc);
        } else {
          detail = tasks.find((t) => free(t) && text(t.description) === desc);
          toolUseId = detail ? (detail.toolUseId ?? null) : null;
        }
        if (detail) matched.add(detail.id);
        card.agent = { description: desc, toolUseId, taskId: detail?.id ?? null };
      }

      const backed = !!card.agent && (card.agent.toolUseId !== null || card.agent.taskId !== null);
      if (backed) {
        // Rule 2: runtime overrides the model's claim.
        const toolUseId = card.agent!.toolUseId;
        const info = toolUseId ? runtime.agentInfo.get?.(toolUseId) : undefined;
        if (detail) {
          card.status = runtimeStatus(detail);
          if (isFinished(card.status)) {
            card.result = runtimeResult(detail, card.result);
            card.endedAt = detail.endedAt ?? card.endedAt;
          }
          card.startedAt = card.startedAt ?? detail.startedAt;
        } else if (info?.finished === true && card.status !== 'failed') {
          card.status = 'done';
        } else if (info?.finished !== true && card.status === 'running' && !isStreaming) {
          card.status = 'paused';
        }
        if (card.steps.length === 0) card.steps = agentSteps(runtime, toolUseId);
        if (card.status === 'done') card.steps.forEach((s) => { s.state = 'done'; });
      } else if (card.status === 'running') {
        // Rule 3: inline card (including an agent string we couldn't resolve).
        if (!isStreaming) card.status = 'paused';
      }

      if (!isFinished(card.status)) card.result = null;
      recount(card);
      return card;
    });

    // Rule 3 (question): the active inline card, else the first running inline card.
    if (pendingQuestion) {
      // An inline card here is running or (not streaming) paused; both were declared `running`.
      const inlineRunning = (c: TaskCard) =>
        (c.status === 'running' || c.status === 'paused') &&
        (!c.agent || (c.agent.toolUseId === null && c.agent.taskId === null));
      const card = declared.activeInlineId
        ? cards.find((c) => c.id === declared.activeInlineId && inlineRunning(c))
        : cards.find(inlineRunning);
      if (card) {
        card.status = 'waiting';
        card.question = { text: text(pendingQuestion.text), options: Array.isArray(pendingQuestion.options) ? pendingQuestion.options.filter((o) => typeof o === 'string') : [] };
      }
    }

    // Rule 5: fallback card when the model declared nothing.
    if (cards.length === 0) {
      const fb = fallbackCard(msgs, isStreaming);
      if (fb) cards.push(fb);
    }

    // Rule 4: unmatched, non-hidden background tasks become runtime cards.
    const runtimeCards = tasks
      .filter((t) => !t.hidden && !matched.has(t.id))
      .sort((a, b) => (Number(a.startedAt) || 0) - (Number(b.startedAt) || 0))
      .map((t): TaskCard => {
        const description = text(t.description);
        const toolUseId = typeof t.toolUseId === 'string' ? t.toolUseId : null;
        const status = runtimeStatus(t);
        const card: TaskCard = {
          id: 'bg:' + t.id, source: 'runtime', title: description || text(t.kind) || 'task', status,
          steps: agentSteps(runtime, toolUseId), doneCount: 0, totalCount: 0, currentLabel: null,
          startedAt: typeof t.startedAt === 'number' ? t.startedAt : null,
          endedAt: typeof t.endedAt === 'number' ? t.endedAt : null,
          result: isFinished(status) ? runtimeResult(t, null) : null,
          agent: { description, toolUseId, taskId: t.id }, messageIds: [], question: null,
        };
        recount(card);
        return card;
      });
    cards.push(...runtimeCards);

    return {
      cards,
      batchStartedAt: declared.batchStartedAt,
      allDone: cards.length > 0 && cards.every((c) => isFinished(c.status)),
    };
  } catch {
    return { ...EMPTY_BOARD, cards: [] };
  }
}

/** tool_use ids of agent-backed cards, for loading subagent transcripts. */
export function agentToolUseIds(board: TaskBoard): string[] {
  const ids = new Set<string>();
  for (const c of board?.cards ?? []) {
    const id = c?.agent?.toolUseId;
    if (typeof id === 'string' && id) ids.add(id);
  }
  return [...ids];
}
