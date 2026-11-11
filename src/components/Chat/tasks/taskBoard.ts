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

interface AgentCall { id: string; description: string; timestamp: number }

/** Agent/Task tool calls in message order. */
function agentCalls(messages: ChatMessage[]): AgentCall[] {
  const out: AgentCall[] = [];
  for (const m of messages) {
    if (m?.role !== 'assistant' || !Array.isArray(m.toolCalls)) continue;
    for (const c of m.toolCalls) {
      if (!c || (c.name !== 'Agent' && c.name !== 'Task') || typeof c.id !== 'string' || !c.id) continue;
      try {
        const input = typeof c.input === 'string' ? JSON.parse(c.input) : c.input;
        out.push({ id: c.id, description: text(input?.description), timestamp: Number(m.timestamp) || 0 });
      } catch { /* malformed input */ }
    }
  }
  return out;
}

const TODO_TOOLS = new Set(['TodoWrite', 'TaskCreate', 'TaskUpdate']);

/** A todo-tracking call happened after the last user message (the current turn). */
function todosInLatestTurn(messages: ChatMessage[]): boolean {
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i];
    if (m?.role === 'user') return false;
    if (m?.role === 'assistant' && Array.isArray(m.toolCalls) && m.toolCalls.some((c) => TODO_TOOLS.has(c?.name))) return true;
  }
  return false;
}

/**
 * Fallback card, shown only while its todo list is current: the chat is
 * streaming, or the todo call is in the latest user turn. A finished list is
 * dropped once streaming stops.
 */
function fallbackCard(messages: ChatMessage[], isStreaming: boolean): TaskCard | null {
  if (!isStreaming && !todosInLatestTurn(messages)) return null;
  let todos: ReturnType<typeof findLatestTodos> = null;
  try { todos = findLatestTodos(messages); } catch { return null; }
  if (!Array.isArray(todos) || todos.length === 0) return null;
  const steps: TaskStep[] = todos.filter(Boolean).map((t) => ({
    label: text(t.content) || text(t.activeForm),
    state: t.status === 'completed' ? 'done' : t.status === 'in_progress' ? 'current' : 'pending',
  }));
  if (steps.length === 0) return null;
  const allComplete = steps.every((s) => s.state === 'done');
  if (allComplete && !isStreaming) return null;
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
    const calls = agentCalls(msgs);
    // description → tool_use id of the latest Agent/Task call carrying it.
    const callIds = new Map<string, string>();
    for (const c of calls) if (c.description) callIds.set(c.description, c.id);
    const matched = new Set<string>(); // background task ids claimed by a declared card
    const free = (t: BackgroundTaskDetail) => !t.hidden && !matched.has(t.id);

    // Rule 1: resolve agent bindings for every declared card up front.
    const bindings = new Map<string, { toolUseId: string | null; detail?: BackgroundTaskDetail }>();
    // Pass 1: exact description match.
    for (const d of declared.cards) {
      if (!d.agent) continue;
      const desc = d.agent.description;
      let detail: BackgroundTaskDetail | undefined;
      let toolUseId = callIds.get(desc) ?? null;
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
      bindings.set(d.id, { toolUseId, detail });
    }
    // Pass 2 (positional heuristic): binds call order to declaration order, so
    // it can mis-pair when several agents drift. An agent declared under a different description than the Agent
    // call the model actually made binds to the earliest unclaimed call that
    // started within the batch.
    if (declared.batchStartedAt !== null) {
      const declaredDescs = new Set(declared.cards.map((d) => d.agent?.description).filter((x): x is string => !!x));
      const bound = new Set<string>();
      for (const b of bindings.values()) if (b.toolUseId) bound.add(b.toolUseId);
      for (const d of declared.cards) {
        const b = bindings.get(d.id);
        if (!d.agent || !b || b.toolUseId || b.detail) continue;
        const call = calls.find((c) =>
          c.timestamp >= declared.batchStartedAt! && !bound.has(c.id) && !declaredDescs.has(c.description));
        if (!call) continue;
        bound.add(call.id);
        const detail = tasks.find((t) => t.toolUseId === call.id) ??
          tasks.find((t) => free(t) && t.toolUseId == null && call.description !== '' && text(t.description) === call.description);
        if (detail) matched.add(detail.id);
        bindings.set(d.id, { toolUseId: call.id, detail });
      }
    }

    const cards: TaskCard[] = declared.cards.map((orig) => {
      const card: TaskCard = { ...orig, steps: orig.steps.map((s) => ({ ...s })), messageIds: [...orig.messageIds] };

      let detail: BackgroundTaskDetail | undefined;
      if (card.agent) {
        const b = bindings.get(card.id);
        detail = b?.detail;
        card.agent = { description: card.agent.description, toolUseId: b?.toolUseId ?? null, taskId: detail?.id ?? null };
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
      const card = declared.activeCardId
        ? cards.find((c) => c.id === declared.activeCardId && inlineRunning(c))
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
