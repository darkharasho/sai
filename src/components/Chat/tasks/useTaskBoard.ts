// ChatPanel's task-board derivation: board, subagent transcripts, per-card
// feeds and "now" labels, the composer todo override. Display-only; nothing here feeds turn completion,
// notifications, wait state or isStreaming.

import { useMemo } from 'react';
import type { ChatMessage } from '../../../types';
import type { BackgroundTaskDetail } from '../../../../electron/services/claudeBackend/backgroundTasks';
import type { CardStatus, TaskBoard, TaskCard } from './types';
import { agentToolUseIds, deriveTaskBoard, type BoardRuntime } from './taskBoard';
import { deriveDeclaredCards } from './declaredCards';
import { filterMessagesForTask, mergeFeed, nowLabel } from './taskFeed';
import { useAgentTranscripts, type AgentTranscript } from './useAgentTranscripts';
import type { Todo } from '../TodoProgress';

export interface PendingTaskQuestion {
  toolUseId: string;
  /** The question's text (also the answers key); '' unless exactly one question. */
  text: string;
  /** Quick-answer labels; [] unless exactly one question (then the card offers Reply… only). */
  options: string[];
  multiSelect: boolean;
  /** Exactly one question: a quick-answer option fully answers the call. */
  answerable: boolean;
}

export interface UseTaskBoardArgs {
  enabled: boolean;
  messages: ChatMessage[];
  /** Claude CLI session id: subagent transcripts live under it. */
  claudeSessionId: string | null | undefined;
  backgroundTasks: BackgroundTaskDetail[] | undefined;
  isStreaming: boolean;
  awaitingQuestion: boolean;
  /** tool_use id of the call awaiting approval: the card it is tagged to shows waiting. */
  pendingApprovalToolUseId: string | null;
}

/**
 * Why a card has no transcript to show, plus the runtime task behind it so the
 * stream view can fall back to status rather than a dead end.
 *
 * - `shell`: a backgrounded shell command. Only Agent subagents write a
 *   transcript; a shell task's output lands in the chat when it reports back.
 * - `no-agent`: a background task with no Agent tool_use id to read (a workflow
 *   or other runtime task), so there is no sidecar transcript to find.
 * - `missing`: an Agent-backed card that finished without a transcript on disk.
 */
export type StreamFallbackReason = 'shell' | 'no-agent' | 'missing';

export interface StreamFallback {
  reason: StreamFallbackReason;
  /** The background task behind the card, when one is bound. */
  detail: BackgroundTaskDetail | null;
}

export interface TaskBoardState {
  /** Cards carry their `now` label. */
  board: TaskBoard;
  /** One todo per card for the composer ring; undefined = no declared cards, keep the composer's own todo derivation. */
  todos: Todo[] | null | undefined;
  /** The fold's computed tag per item (itemKey); pair with effectiveTag() for stored tags. Empty when disabled. */
  tags: Map<string, string | null>;
  /** A card's feed (the chat filtered to its tag, plus its agent transcript); null = see streamFallback. */
  feed(card: TaskCard): ChatMessage[] | null;
  /** Why feed returned null, for the feed view's empty state. */
  streamFallback(card: TaskCard): StreamFallback | null;
}

const EMPTY_BOARD: TaskBoard = { cards: [], batchStartedAt: null, allDone: false };
const EMPTY_TASKS: BackgroundTaskDetail[] = [];
const EMPTY_IDS: string[] = [];
const EMPTY_SET: ReadonlySet<string> = new Set();
const EMPTY_INFO: BoardRuntime['agentInfo'] = new Map();
const NO_TAGS = new Map<string, string | null>();

const str = (v: unknown): string => (typeof v === 'string' ? v : '');

/** Latest unanswered AskUserQuestion call. Text and options only for a single-question call. */
export function findPendingTaskQuestion(messages: ChatMessage[]): PendingTaskQuestion | null {
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i];
    if (m?.role !== 'assistant' || !Array.isArray(m.toolCalls)) continue;
    for (let j = m.toolCalls.length - 1; j >= 0; j--) {
      const tc = m.toolCalls[j];
      if (tc?.name !== 'AskUserQuestion' || typeof tc.id !== 'string' || !tc.id) continue;
      try {
        const input = typeof tc.input === 'string' ? JSON.parse(tc.input || '{}') : tc.input;
        if (input?.answers && typeof input.answers === 'object' && Object.keys(input.answers).length > 0) continue;
        const questions = Array.isArray(input?.questions) ? input.questions : [];
        if (questions.length === 0) continue;
        if (questions.length !== 1) return { toolUseId: tc.id, text: '', options: [], multiSelect: false, answerable: false };
        const q = questions[0];
        const text = str(q?.question);
        if (!text) continue;
        const options = (Array.isArray(q.options) ? q.options : [])
          .map((o: unknown) => (typeof o === 'string' ? o : str((o as { label?: unknown })?.label)))
          .filter(Boolean);
        return { toolUseId: tc.id, text, options, multiSelect: q.multiSelect === true, answerable: true };
      } catch { /* malformed input */ }
    }
  }
  return null;
}

/** Agent-backed cards read a subagent transcript too; others only the chat items filed under their tag. */
const transcriptId = (card: TaskCard): string | null => card.agent?.toolUseId ?? null;
const isAgentBacked = (card: TaskCard) => !!card.agent && (card.agent.toolUseId !== null || card.agent.taskId !== null);

/**
 * A card's feed: its tagged chat items, merged by timestamp with its subagent
 * transcript when it has one. null = nothing to show (the feed view shows task
 * status instead): an agent-backed card with no readable transcript and no
 * tagged items.
 */
function cardFeed(
  card: TaskCard,
  transcripts: Map<string, AgentTranscript>,
  messages: ChatMessage[],
  tags: Map<string, string | null>,
): ChatMessage[] | null {
  let tagged: ChatMessage[];
  try { tagged = filterMessagesForTask(messages, card.tag, tags); } catch { tagged = []; }
  const tid = transcriptId(card);
  if (tid) {
    const t = transcripts.get(tid);
    if (!t) return tagged; // transcript not loaded yet
    if (!t.unavailable) return mergeFeed(tagged, t.messages);
  } else if (!isAgentBacked(card)) {
    return tagged;
  }
  return tagged.length > 0 ? tagged : null;
}

const TODO_STATUS: Record<CardStatus, Todo['status']> = {
  done: 'completed', failed: 'completed', running: 'in_progress', waiting: 'in_progress', queued: 'pending', paused: 'pending',
};

export function useTaskBoard({
  enabled, messages, claudeSessionId, backgroundTasks, isStreaming, awaitingQuestion, pendingApprovalToolUseId,
}: UseTaskBoardArgs): TaskBoardState {
  const tasks = backgroundTasks ?? EMPTY_TASKS;
  const approvalId = enabled ? pendingApprovalToolUseId ?? null : null;

  const pendingQuestion = useMemo(
    () => (enabled && awaitingQuestion ? findPendingTaskQuestion(messages) : null),
    [enabled, awaitingQuestion, messages],
  );
  const runtimeQuestion = useMemo(
    () => (pendingQuestion ? { toolUseId: pendingQuestion.toolUseId, text: pendingQuestion.text, options: pendingQuestion.options } : null),
    [pendingQuestion],
  );

  // One fold per messages change: the board passes and the feeds share it.
  const declared = useMemo(() => (enabled ? deriveDeclaredCards(messages) : null), [enabled, messages]);
  const tags = declared?.tags ?? NO_TAGS;

  // First pass without transcript info: which agent transcripts to load, and which are live.
  const baseBoard = useMemo(
    () => (declared
      ? deriveTaskBoard(messages, { backgroundTasks: tasks, isStreaming, pendingQuestion: runtimeQuestion, pendingApprovalToolUseId: approvalId, agentInfo: EMPTY_INFO }, declared)
      : EMPTY_BOARD),
    [declared, messages, tasks, isStreaming, runtimeQuestion, approvalId],
  );
  const ids = useMemo(() => (enabled ? agentToolUseIds(baseBoard) : EMPTY_IDS), [enabled, baseBoard]);
  const liveKey = baseBoard.cards
    .filter((c) => c.status === 'running' && c.agent?.toolUseId)
    .map((c) => c.agent!.toolUseId!)
    .join('\u0000');
  const liveIds = useMemo<ReadonlySet<string>>(() => (liveKey ? new Set(liveKey.split('\u0000')) : EMPTY_SET), [liveKey]);
  const finishedKey = baseBoard.cards
    .filter((c) => (c.status === 'done' || c.status === 'failed') && c.agent?.toolUseId)
    .map((c) => c.agent!.toolUseId!)
    .join('\u0000');
  const finishedIds = useMemo<ReadonlySet<string>>(
    () => (finishedKey ? new Set(finishedKey.split('\u0000')) : EMPTY_SET), [finishedKey]);

  const transcripts = useAgentTranscripts(enabled ? claudeSessionId : null, ids, liveIds, finishedIds);

  const agentInfo = useMemo(() => {
    if (transcripts.size === 0) return EMPTY_INFO;
    const info: BoardRuntime['agentInfo'] = new Map();
    for (const [id, t] of transcripts) info.set(id, { finished: t.finished });
    return info;
  }, [transcripts]);

  const runtimeBoard = useMemo(
    () => (!declared ? EMPTY_BOARD
      : agentInfo === EMPTY_INFO ? baseBoard
      : deriveTaskBoard(messages, { backgroundTasks: tasks, isStreaming, pendingQuestion: runtimeQuestion, pendingApprovalToolUseId: approvalId, agentInfo }, declared)),
    [declared, baseBoard, agentInfo, messages, tasks, isStreaming, runtimeQuestion, approvalId],
  );

  // Feeds per card id, and the board with each card's "now" label filled in.
  const { board, feeds } = useMemo(() => {
    const feeds = new Map<string, ChatMessage[] | null>();
    if (runtimeBoard.cards.length === 0) return { board: runtimeBoard, feeds };
    const cards = runtimeBoard.cards.map((card) => {
      const feed = cardFeed(card, transcripts, messages, tags);
      feeds.set(card.id, feed);
      let now: string | null = null;
      try { now = nowLabel(feed ?? []); } catch { /* display-only: never throw into render */ }
      return { ...card, now };
    });
    return { board: { ...runtimeBoard, cards }, feeds };
  }, [runtimeBoard, transcripts, messages, tags]);

  const todos = useMemo(() => {
    // No declared cards: keep the composer's own TodoWrite ring (runtime and fallback cards never override it).
    const declaredCards = board.cards.filter((c) => c.source === 'declared');
    if (declaredCards.length === 0) return undefined;
    return declaredCards.map((c): Todo => ({ id: c.id, content: c.title, status: TODO_STATUS[c.status] ?? 'pending' }));
  }, [board]);

  const feed = (card: TaskCard): ChatMessage[] | null =>
    (feeds.has(card.id) ? feeds.get(card.id)! : cardFeed(card, transcripts, messages, tags));

  const streamFallback = (card: TaskCard): StreamFallback | null => {
    if (feed(card) !== null) return null;
    const taskId = card.agent?.taskId ?? null;
    const detail = taskId ? tasks.find((t) => t.id === taskId) ?? null : null;
    const reason: StreamFallbackReason = detail?.isShell
      ? 'shell'
      : card.agent?.toolUseId ? 'missing' : 'no-agent';
    return { reason, detail };
  };

  return { board, todos, tags, feed, streamFallback };
}
