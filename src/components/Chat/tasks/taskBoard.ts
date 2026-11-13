// Merge the model's declared task cards with runtime truth (background task
// snapshots, streaming flag, pending question, subagent transcript info), plus
// a TodoWrite/TaskCreate fallback card. Display-only: nothing here may feed
// turn completion, notifications, or wait state.

import type { ChatMessage } from '../../../types';
import type { BackgroundTaskDetail } from '../../../../electron/services/claudeBackend/backgroundTasks';
import type { CardStatus, TaskBoard, TaskCard } from './types';
import { deriveDeclaredCards, itemKey, type DeclaredCards } from './declaredCards';
import { effectiveTag } from './taskFeed';
import { findLatestTodos } from '../TodoProgress';

export interface BoardRuntime {
  backgroundTasks: BackgroundTaskDetail[];
  isStreaming: boolean;
  /** The pending AskUserQuestion: its call's tag picks the waiting card. */
  pendingQuestion: { toolUseId: string; text: string; options: string[] } | null;
  /** tool_use id of the call awaiting approval: its tag picks the waiting card. */
  pendingApprovalToolUseId: string | null;
  /** Keyed by the Agent call's tool_use id. */
  agentInfo: Map<string, { finished: boolean }>;
}

const EMPTY_BOARD: TaskBoard = { cards: [], batchStartedAt: null, allDone: false };

const text = (v: unknown): string => (typeof v === 'string' ? v : '');
const isFinished = (s: CardStatus) => s === 'done' || s === 'failed';

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

/** Effective tag of the tool call with this tool_use id, or null when absent/untagged. */
function callTag(messages: ChatMessage[], tags: Map<string, string | null>, toolUseId: string | null): string | null {
  if (!toolUseId) return null;
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i];
    if (!m || typeof m.id !== 'string' || !Array.isArray(m.toolCalls)) continue;
    const idx = m.toolCalls.findIndex((c) => c?.id === toolUseId);
    if (idx >= 0) return effectiveTag(m.toolCalls[idx].taskId, tags.get(itemKey(m.id, toolUseId, idx)));
  }
  return null;
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
  const list = Array.isArray(todos) ? todos.filter(Boolean) : [];
  if (list.length === 0) return null;
  const allComplete = list.every((t) => t.status === 'completed');
  if (allComplete && !isStreaming) return null;
  return {
    id: 'current-work', source: 'fallback', title: 'Current work', tag: 'current-work',
    status: allComplete ? 'done' : isStreaming ? 'running' : 'paused', now: null,
    startedAt: null, endedAt: null, result: null, agent: null, messageIds: [], question: null,
  };
}

/**
 * `folded` lets a caller that already folded `messages` (useTaskBoard, which
 * also needs the fold's tags) skip a second fold; it is never mutated.
 */
export function deriveTaskBoard(messages: ChatMessage[], rt: BoardRuntime, folded?: DeclaredCards): TaskBoard {
  try {
    const msgs = Array.isArray(messages) ? messages : [];
    const isStreaming = rt?.isStreaming === true;
    const pendingQuestion = rt?.pendingQuestion ?? null;
    const agentInfo: BoardRuntime['agentInfo'] = rt?.agentInfo ?? new Map();
    const tasks = (Array.isArray(rt?.backgroundTasks) ? rt.backgroundTasks : []).filter(
      (t): t is BackgroundTaskDetail => !!t && typeof t.id === 'string',
    );

    const declared = folded ?? deriveDeclaredCards(msgs);
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
      const card: TaskCard = { ...orig, messageIds: [...orig.messageIds] };

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
        const info = toolUseId ? agentInfo.get?.(toolUseId) : undefined;
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
      } else if (card.status === 'running') {
        // Rule 3: inline card (including an agent string we couldn't resolve).
        if (!isStreaming) card.status = 'paused';
      }

      if (!isFinished(card.status)) card.result = null;
      return card;
    });

    // Rule 3 (waiting): the unfinished card the pending question's / approval's call is tagged to.
    const waitOn = (toolUseId: string | null | undefined) => {
      const tag = callTag(msgs, declared.tags, typeof toolUseId === 'string' ? toolUseId : null);
      return tag === null ? undefined : cards.find((c) => c.tag === tag && !isFinished(c.status));
    };
    const asked = pendingQuestion ? waitOn(pendingQuestion.toolUseId) : undefined;
    if (asked) {
      asked.status = 'waiting';
      asked.question = { text: text(pendingQuestion!.text), options: Array.isArray(pendingQuestion!.options) ? pendingQuestion!.options.filter((o) => typeof o === 'string') : [] };
    }
    const approving = waitOn(rt?.pendingApprovalToolUseId);
    if (approving) approving.status = 'waiting';

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
        const id = 'bg:' + t.id;
        return {
          id, source: 'runtime', title: description || text(t.kind) || 'task', tag: id, status, now: null,
          startedAt: typeof t.startedAt === 'number' ? t.startedAt : null,
          endedAt: typeof t.endedAt === 'number' ? t.endedAt : null,
          result: isFinished(status) ? runtimeResult(t, null) : null,
          agent: { description, toolUseId, taskId: t.id }, messageIds: [], question: null,
        };
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
