// ChatPanel's task-board derivation: board, subagent transcripts, card tails,
// the composer todo override and the pending AskUserQuestion. Display-only;
// nothing here feeds turn completion, notifications or wait state.

import { useMemo } from 'react';
import type { ChatMessage } from '../../../types';
import type { BackgroundTaskDetail } from '../../../../electron/services/claudeBackend/backgroundTasks';
import type { TailLine, TaskBoard, TaskCard, TaskStep } from './types';
import { agentToolUseIds, deriveTaskBoard, type BoardRuntime } from './taskBoard';
import { useAgentTranscripts, type AgentTranscript } from './useAgentTranscripts';
import { buildTailLines } from './tailLines';
import { findLatestTodos, type Todo } from '../TodoProgress';

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
  /** Card whose steps drive the composer todo ring (selected or open). */
  focusId: string | null;
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
  board: TaskBoard;
  tails: Map<string, TailLine[]>;
  /** undefined = no cards, keep the composer's own todo derivation. */
  todos: Todo[] | null | undefined;
  pendingQuestion: PendingTaskQuestion | null;
  /** Stream view messages for a card; null = nothing to stream (see streamFallback). */
  streamMessages(card: TaskCard): ChatMessage[] | null;
  /** Why streamMessages returned null, for the stream view's empty state. */
  streamFallback(card: TaskCard): StreamFallback | null;
}

const EMPTY_BOARD: TaskBoard = { cards: [], batchStartedAt: null, allDone: false };
const EMPTY_TASKS: BackgroundTaskDetail[] = [];
const EMPTY_IDS: string[] = [];
const EMPTY_SET: ReadonlySet<string> = new Set();
const EMPTY_INFO: BoardRuntime['agentInfo'] = new Map();
const EMPTY_TAILS = new Map<string, TailLine[]>();
const NO_MESSAGES: ChatMessage[] = [];

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

function stepsFromTranscript(t: AgentTranscript): TaskStep[] {
  let todos: Todo[] | null = null;
  try { todos = findLatestTodos(t.messages); } catch { return []; }
  if (!Array.isArray(todos)) return [];
  return todos.filter(Boolean).map((td) => ({
    label: str(td.content) || str(td.activeForm),
    state: td.status === 'completed' ? 'done' : td.status === 'in_progress' ? 'current' : 'pending',
  }));
}

function stepsToTodos(card: TaskCard): Todo[] {
  return card.steps.map((s, i) => ({
    id: `${card.id}:${i}`,
    content: s.label,
    status: s.state === 'done' ? 'completed' : s.state === 'current' ? 'in_progress' : 'pending',
  }));
}

/** Agent-backed cards read a subagent transcript; others use the chat's attributed messages. */
const transcriptId = (card: TaskCard): string | null => card.agent?.toolUseId ?? null;
const isAgentBacked = (card: TaskCard) => !!card.agent && (card.agent.toolUseId !== null || card.agent.taskId !== null);

/**
 * What a card's stream and tail read from, in order: its subagent transcript,
 * then the chat messages the model tagged onto it, then nothing (null — the
 * stream view shows task status instead).
 */
function cardSource(
  card: TaskCard,
  transcripts: Map<string, AgentTranscript>,
  messages: ChatMessage[],
): ChatMessage[] | null {
  const tagged = () => (card.messageIds.length === 0 ? NO_MESSAGES : messages.filter((m) => card.messageIds.includes(m.id)));
  const tid = transcriptId(card);
  if (tid) {
    const t = transcripts.get(tid);
    if (!t) return NO_MESSAGES; // not loaded yet
    if (!t.unavailable) return t.messages;
  } else if (!isAgentBacked(card)) {
    return tagged();
  }
  const fallback = tagged();
  return fallback.length > 0 ? fallback : null;
}

export function useTaskBoard({
  enabled, messages, claudeSessionId, backgroundTasks, isStreaming, awaitingQuestion, focusId,
}: UseTaskBoardArgs): TaskBoardState {
  const tasks = backgroundTasks ?? EMPTY_TASKS;

  const pendingQuestion = useMemo(
    () => (enabled && awaitingQuestion ? findPendingTaskQuestion(messages) : null),
    [enabled, awaitingQuestion, messages],
  );
  const runtimeQuestion = useMemo(
    () => (pendingQuestion ? { text: pendingQuestion.text, options: pendingQuestion.options } : null),
    [pendingQuestion],
  );

  // First pass without transcript info: which agent transcripts to load, and which are live.
  const baseBoard = useMemo(
    () => (enabled
      ? deriveTaskBoard(messages, { backgroundTasks: tasks, isStreaming, pendingQuestion: runtimeQuestion, agentInfo: EMPTY_INFO })
      : EMPTY_BOARD),
    [enabled, messages, tasks, isStreaming, runtimeQuestion],
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
    for (const [id, t] of transcripts) info.set(id, { finished: t.finished, steps: stepsFromTranscript(t) });
    return info;
  }, [transcripts]);

  const board = useMemo(
    () => (!enabled ? EMPTY_BOARD
      : agentInfo === EMPTY_INFO ? baseBoard
      : deriveTaskBoard(messages, { backgroundTasks: tasks, isStreaming, pendingQuestion: runtimeQuestion, agentInfo })),
    [enabled, baseBoard, agentInfo, messages, tasks, isStreaming, runtimeQuestion],
  );

  const tails = useMemo(() => {
    if (board.cards.length === 0) return EMPTY_TAILS;
    const out = new Map<string, TailLine[]>();
    for (const card of board.cards) {
      const source = cardSource(card, transcripts, messages) ?? NO_MESSAGES;
      let lines: TailLine[] = [];
      try { lines = buildTailLines(source); } catch { /* display-only: never throw into render */ }
      out.set(card.id, lines);
    }
    return out;
  }, [board, transcripts, messages]);

  const todos = useMemo(() => {
    if (board.cards.length === 0) return undefined;
    const focus = (focusId ? board.cards.find((c) => c.id === focusId) : undefined)
      ?? board.cards.find((c) => c.status === 'running');
    return focus ? stepsToTodos(focus) : null;
  }, [board, focusId]);

  const streamMessages = (card: TaskCard): ChatMessage[] | null => cardSource(card, transcripts, messages);

  const streamFallback = (card: TaskCard): StreamFallback | null => {
    if (streamMessages(card) !== null) return null;
    const taskId = card.agent?.taskId ?? null;
    const detail = taskId ? tasks.find((t) => t.id === taskId) ?? null : null;
    const reason: StreamFallbackReason = detail?.isShell
      ? 'shell'
      : card.agent?.toolUseId ? 'missing' : 'no-agent';
    return { reason, detail };
  };

  return { board, tails, todos, pendingQuestion, streamMessages, streamFallback };
}
