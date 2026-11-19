// The one chat reducer: turns logged chat events into chat state for the
// desktop, the phone app and main-process log compaction. A behavior-preserving
// extraction of ChatPanel's onMessage handler.
//
// Pure: no clocks, randomness, DOM, React or Electron. Times come from
// entry.ts; generated ids from entry.seq (`m<seq>` messages, `e<seq>` error
// rows, `c<seq>` compaction notes) or a client-supplied id.
import type { ChatMessage, GitHubWatcherSnapshot, LoadGuardChatEvent, ToolCall } from '../../types';
import { parseAiError } from '../../components/Chat/parseAiError';
import type { ChatFollowUp, ChatWaiting, ChatLogEntry, ChatSettings, ChatState, QueuedItem, TurnState } from './types';
import {
  finalizeReasoning,
  reduceAssistant,
  reduceReasoningDelta,
  reduceResultText,
  reduceThinkingTokens,
  reduceToolResults,
} from './reduceAssistant';

/** After the load guard kills this chat's agent, its crash errors are swallowed this long. */
export const LOAD_GUARD_ERROR_QUIET_MS = 15_000;

function idleTurn(): TurnState {
  return {
    streaming: false,
    // ChatPanel retires the sequence on mount, so nothing tagged arrives "current".
    turnSeq: -1,
    startedAt: null,
    startIndex: null,
    forceNewBubble: true,
    nextSegmentStart: null,
    reasoningActive: false,
    loadGuardQuietUntil: null,
    loadGuardEnded: false,
  };
}

export function emptyChatState(settings: ChatSettings): ChatState {
  return stateFromMessages([], settings);
}

export function stateFromMessages(messages: ChatMessage[], settings: ChatSettings): ChatState {
  return {
    messages,
    turn: idleTurn(),
    pendingApproval: null,
    pendingSudo: null,
    pendingCodexUserInput: null,
    pendingCodexMcpElicitation: null,
    activeSubagents: {},
    streamHint: null,
    promptSuggestion: null,
    settings: { ...settings },
    queue: [],
    waiting: null,
    followUp: null,
    awaitingQuestion: false,
    lastSeq: 0,
  };
}

/** Fills fields that snapshots written before they existed lack. */
export function normalizeChatState(state: ChatState): ChatState {
  if (state.waiting !== undefined && state.followUp !== undefined && state.awaitingQuestion !== undefined) return state;
  return {
    ...state,
    waiting: state.waiting ?? null,
    followUp: state.followUp ?? null,
    awaitingQuestion: state.awaitingQuestion ?? false,
  };
}

/** The chat card for a `load_guard` event; null for an unknown kind. Keeps the emitted id. */
export function loadGuardCard(ev: unknown, ts: number, fallbackId: string): ChatMessage | null {
  const msg = ev as { type?: unknown; id?: unknown; loadGuard?: LoadGuardChatEvent } | null;
  if (!msg || msg.type !== 'load_guard') return null;
  const lg = msg.loadGuard;
  if (lg?.kind !== 'note' && lg?.kind !== 'killed') return null;
  const id = typeof msg.id === 'string' && msg.id ? msg.id : fallbackId;
  return { id, role: 'system', content: '', timestamp: ts, loadGuard: lg };
}

/** A turn-end frame tagged for a superseded turn must not touch the current one. */
function isStale(turnSeq: unknown, s: ChatState): boolean {
  return turnSeq != null && turnSeq !== s.turn.turnSeq;
}

/**
 * Stamp every unstamped text bubble of the turn with its cumulative duration
 * from turn start, then stop the turn clock (startedAt/startIndex reset). Runs
 * at the first turn end — `result` (App's busy flag falls there) or, failing
 * that, `done`/`process_exit`. With the clock stopped it is a no-op, so a done
 * after a result never re-stamps, and a later streaming_start (wait/resume)
 * starts a fresh clock.
 */
function stampTurnDurations(s: ChatState, ts: number): ChatState {
  if (!s.turn.streaming || s.turn.startIndex == null) return s;
  const startIdx = s.turn.startIndex;
  const turnStart = s.turn.startedAt;
  let changed = false;
  const next = s.messages.map((m, i) => {
    if (i >= startIdx && m.role === 'assistant' && m.content && m.content.length > 0 && typeof m.durationMs !== 'number') {
      changed = true;
      return { ...m, durationMs: ts - (turnStart ?? m.startedAt ?? m.timestamp), completedAt: ts };
    }
    return m;
  });
  return {
    ...s,
    messages: changed ? next : s.messages,
    turn: { ...s.turn, startIndex: null, startedAt: null },
  };
}

/** Turn end: collapse live reasoning, stamp durations (if not yet) and go idle. */
function closeTurn(s: ChatState, ts: number): ChatState {
  s = stampTurnDurations(finalizeReasoning(s, ts), ts);
  return {
    ...s,
    streamHint: null,
    pendingApproval: null,
    pendingCodexUserInput: null,
    pendingCodexMcpElicitation: null,
    turn: { ...s.turn, streaming: false, startIndex: null, startedAt: null },
  };
}

function reduceDone(s: ChatState, ev: Record<string, unknown>, ts: number): ChatState {
  if (isStale(ev.turnSeq, s)) return s;
  // A normal parent completion can precede child terminal activity; only a
  // forced termination or a physical EOF proves no child event can follow.
  const clearSubagents = ev.subagentsAborted === true || ev.subagentsSettled === true;
  s = closeTurn(s, ts);
  const wait = ev.wait as { kind?: unknown; resumeInSeconds?: unknown; taskCount?: unknown } | undefined;
  const waiting: ChatWaiting | null = wait && (wait.kind === 'background' || wait.kind === 'scheduled')
    ? {
        kind: wait.kind,
        ...(typeof wait.resumeInSeconds === 'number' ? { resumeInSeconds: wait.resumeInSeconds } : {}),
        ...(typeof wait.taskCount === 'number' ? { taskCount: wait.taskCount } : {}),
        since: ts,
      }
    : null;
  return {
    ...s,
    waiting,
    activeSubagents: clearSubagents ? {} : s.activeSubagents,
    turn: { ...s.turn, turnSeq: -1 },
  };
}

function appendMessage(s: ChatState, m: ChatMessage): ChatState {
  return { ...s, messages: [...s.messages, m] };
}

/** Drops a message by id, keeping the open turn's start index on the same message. */
function withoutMessage(s: ChatState, id: string): ChatState {
  const idx = s.messages.findIndex(m => m.id === id);
  if (idx < 0) return s;
  const startIndex = s.turn.startIndex;
  return {
    ...s,
    messages: [...s.messages.slice(0, idx), ...s.messages.slice(idx + 1)],
    turn: startIndex != null && idx < startIndex ? { ...s.turn, startIndex: startIndex - 1 } : s.turn,
  };
}

/** Rewrites the tool calls with this id; fn returning null leaves a call untouched. */
function mapToolCalls(s: ChatState, toolUseId: unknown, fn: (tc: ToolCall) => ToolCall | null): ChatState {
  let any = false;
  const messages = s.messages.map(m => {
    if (m.role !== 'assistant' || !m.toolCalls) return m;
    let touched = false;
    const toolCalls = m.toolCalls.map(tc => {
      if (tc.id !== toolUseId) return tc;
      const next = fn(tc);
      if (!next) return tc;
      touched = true;
      return next;
    });
    if (!touched) return m;
    any = true;
    return { ...m, toolCalls };
  });
  return any ? { ...s, messages } : s;
}

function reduceSystem(s: ChatState, entry: ChatLogEntry): ChatState {
  const ev = entry.ev as Record<string, any>;
  switch (ev.subtype) {
    case 'thinking_tokens': {
      const n = ev.estimated_tokens;
      return typeof n === 'number' && n > 0 ? reduceThinkingTokens(s, n) : s;
    }
    case 'task_progress': {
      const summary = (typeof ev.summary === 'string' && ev.summary) ? ev.summary
        : (typeof ev.description === 'string' && ev.description) ? ev.description : '';
      return summary ? { ...s, streamHint: `agent · ${summary}` } : s;
    }
    case 'api_retry': {
      const secs = Math.max(1, Math.ceil((ev.retry_delay_ms ?? 0) / 1000));
      const attempt = typeof ev.attempt === 'number' && typeof ev.max_retries === 'number'
        ? ` ${ev.attempt}/${ev.max_retries}` : '';
      return { ...s, streamHint: `api error · retrying${attempt} in ${secs}s` };
    }
    case 'status':
      return { ...s, streamHint: ev.status === 'compacting' ? 'compacting context…' : null };
    case 'context_compacted':
    case 'auto_compact':
    case 'compact': {
      const summary = typeof ev.summary === 'string' && ev.summary ? ` Summary: ${ev.summary.slice(0, 100)}` : '';
      return appendMessage(s, { id: `c${entry.seq}`, role: 'system', content: `Context auto-compacted.${summary}`, timestamp: entry.ts });
    }
    default:
      return s;
  }
}

function apply(s: ChatState, entry: ChatLogEntry): ChatState {
  const ev = entry.ev as Record<string, any>;
  const { ts, seq } = entry;
  const provider = s.settings.provider;

  switch (ev.type) {
    case 'load_guard': {
      // Main routes load-guard entries to the right chat; only the provider is checked.
      if (ev.provider !== provider) return s;
      const card = loadGuardCard(ev, ts, `m${seq}`);
      if (!card) return s;
      // A killed agent's crash error is expected noise: swallow errors for a
      // while and end the turn as a normal done.
      if (ev.loadGuard.kind === 'killed' && ev.loadGuard.unitKind === 'agent') {
        s = { ...s, turn: { ...s.turn, loadGuardQuietUntil: ts + LOAD_GUARD_ERROR_QUIET_MS, loadGuardEnded: false } };
      }
      return s.messages.some(m => m.id === card.id) ? s : appendMessage(s, card);
    }

    case 'streaming_start': {
      s = finalizeReasoning(s, ts);
      return {
        ...s,
        // A new stream boundary supersedes child state that never got a terminal event.
        activeSubagents: {},
        streamHint: null,
        promptSuggestion: null,
        waiting: null,
        followUp: null,
        awaitingQuestion: false,
        turn: {
          ...s.turn,
          streaming: true,
          turnSeq: ev.turnSeq != null ? ev.turnSeq : s.turn.turnSeq,
          // A new turn's errors are its own, never the killed agent's.
          loadGuardQuietUntil: null,
          loadGuardEnded: false,
          // Never merge a resumed turn's text into the previous segment's bubble.
          forceNewBubble: true,
          startIndex: s.messages.length,
          startedAt: s.turn.startedAt ?? ts,
          nextSegmentStart: ts,
        },
      };
    }

    case 'subagent_activity': {
      const agentId = ev.agentId;
      if (typeof agentId !== 'string') return s;
      const terminal = ev.status === 'completed' || ev.status === 'failed' || ev.status === 'cancelled';
      const tracked = s.activeSubagents[agentId];
      if (ev.turnSeq != null && ev.turnSeq !== s.turn.turnSeq
        && (!terminal || tracked?.turnSeq !== ev.turnSeq)) return s;
      const activeSubagents = { ...s.activeSubagents };
      if (terminal) {
        delete activeSubagents[agentId];
      } else {
        const summary = typeof ev.summary === 'string' && ev.summary.trim() ? ev.summary.trim() : 'Working';
        activeSubagents[agentId] = { summary, turnSeq: ev.turnSeq ?? null };
      }
      return { ...s, activeSubagents };
    }

    case 'user_message': {
      // Queued: no bubble and no new-turn reset yet — queue_removed{sent}
      // adds the bubble, and the drained turn's streaming_start clears the
      // load guard's quiet window.
      if (ev.queued === true) return s;
      const id = typeof ev.clientId === 'string' && ev.clientId ? ev.clientId : `m${seq}`;
      // A new send starts a fresh turn: its errors (even before streaming_start,
      // e.g. a failed resume) are real, not the killed agent's.
      if (s.turn.loadGuardQuietUntil != null) {
        s = { ...s, turn: { ...s.turn, loadGuardQuietUntil: null, loadGuardEnded: false } };
      }
      return appendMessage({ ...s, waiting: null }, {
        id,
        role: 'user',
        content: typeof ev.text === 'string' ? ev.text : '',
        timestamp: ts,
        ...(Array.isArray(ev.images) && ev.images.length > 0 ? { images: ev.images } : {}),
        ...(typeof ev.taskId === 'string' ? { taskId: ev.taskId } : {}),
      });
    }

    case 'result':
      if (isStale(ev.turnSeq, s)) return s;
      // App treats result as the turn end (busy clears here), so durations
      // are stamped now; done still ends streaming and retires turnSeq.
      return stampTurnDurations(reduceResultText({ ...s, pendingApproval: null, waiting: null }, entry), ts);

    case 'done':
      return reduceDone(s, ev, ts);

    case 'process_exit':
      // The process is gone: no done or trailing child event can follow.
      return { ...closeTurn(s, ts), activeSubagents: {} };

    case 'error': {
      const quietUntil = s.turn.loadGuardQuietUntil;
      if (quietUntil != null && ts < quietUntil) {
        // Deliberate load-guard stop, not a crash: end the turn once through
        // the normal done path (turnSeq null is never stale).
        if (s.turn.loadGuardEnded) return s;
        s = { ...s, turn: { ...s.turn, loadGuardEnded: true } };
        return reduceDone(s, { type: 'done', turnSeq: null, subagentsAborted: true }, ts);
      }
      const error = parseAiError(typeof ev.text === 'string' && ev.text ? ev.text : 'Unknown error');
      // Errors can be non-fatal stderr warnings; only done ends the turn.
      return appendMessage(s, { id: `e${seq}`, role: 'system', content: error.message, timestamp: ts, error });
    }

    case 'reasoning_delta':
      return reduceReasoningDelta(s, entry);

    case 'system':
      return reduceSystem(s, entry);

    case 'prompt_suggestion':
      return typeof ev.suggestion === 'string' && ev.suggestion.trim()
        ? { ...s, promptSuggestion: ev.suggestion.trim() } : s;

    case 'followup': {
      // Not turnSeq-guarded (like App): 'none' carries the judged, older turn's seq.
      if (ev.state === 'none') return s.followUp ? { ...s, followUp: null } : s;
      if (ev.state !== 'following' && ev.state !== 'resuming' && ev.state !== 'stalled') return s;
      const followUp: ChatFollowUp = {
        state: ev.state,
        ...(typeof ev.waitingFor === 'string' && ev.waitingFor ? { waitingFor: ev.waitingFor } : {}),
      };
      return { ...s, followUp };
    }

    case 'question_needed':
    case 'plan_review_needed':
      return { ...s, awaitingQuestion: true };

    case 'question_answered':
      s = { ...s, awaitingQuestion: false };
      return mapToolCalls(s, ev.toolUseId, tc => {
        try {
          const parsed = JSON.parse(tc.input || '{}');
          return { ...tc, input: JSON.stringify({ ...parsed, answers: ev.answers }, null, 2) };
        } catch {
          return null;
        }
      });

    case 'plan_review_answered':
      s = { ...s, awaitingQuestion: false };
      return mapToolCalls(s, ev.toolUseId, tc => ({ ...tc, output: ev.approved ? 'Plan approved' : 'Plan rejected' }));

    // Codex App Server requests are capability-gated to Codex chats.
    case 'user_input_needed':
      if (provider !== 'codex' || ev.provider !== 'codex'
        || typeof ev.requestHandle !== 'string' || !Array.isArray(ev.questions)) return s;
      return {
        ...s,
        pendingCodexUserInput: {
          provider: 'codex', requestHandle: ev.requestHandle, questions: ev.questions,
          ...(typeof ev.autoResolutionMs === 'number' ? { autoResolutionMs: ev.autoResolutionMs } : {}),
        },
      };

    case 'mcp_elicitation_needed': {
      if (provider !== 'codex' || ev.provider !== 'codex' || typeof ev.requestHandle !== 'string'
        || typeof ev.serverName !== 'string' || typeof ev.message !== 'string') return s;
      const base = { provider: 'codex' as const, requestHandle: ev.requestHandle, serverName: ev.serverName, message: ev.message };
      if (ev.mode === 'form' && ev.requestedSchema && typeof ev.requestedSchema === 'object') {
        return { ...s, pendingCodexMcpElicitation: { ...base, mode: 'form', requestedSchema: ev.requestedSchema } };
      }
      if (ev.mode === 'url' && typeof ev.url === 'string') {
        return {
          ...s,
          pendingCodexMcpElicitation: { ...base, mode: 'url', url: ev.url, ...(typeof ev.elicitationId === 'string' ? { elicitationId: ev.elicitationId } : {}) },
        };
      }
      return s;
    }

    case 'user_input_resolved':
      if (ev.provider !== 'codex' || typeof ev.requestHandle !== 'string') return s;
      return s.pendingCodexUserInput?.requestHandle === ev.requestHandle ? { ...s, pendingCodexUserInput: null } : s;

    case 'mcp_elicitation_resolved':
      if (ev.provider !== 'codex' || typeof ev.requestHandle !== 'string') return s;
      return s.pendingCodexMcpElicitation?.requestHandle === ev.requestHandle ? { ...s, pendingCodexMcpElicitation: null } : s;

    case 'approval_needed':
      // Only App Server approvals render in a Codex chat; never leak across providers.
      if ((provider === 'codex') !== (ev.provider === 'codex')) return s;
      return {
        ...s,
        pendingApproval: {
          toolName: ev.toolName,
          toolUseId: ev.toolUseId,
          command: ev.command,
          description: ev.description,
          input: ev.input,
          ...(ev.provider === 'codex' ? {
            provider: 'codex' as const,
            requestHandle: ev.requestHandle,
            kind: ev.kind,
            availableDecisions: ev.availableDecisions,
            reason: ev.reason,
            cwd: ev.cwd,
            network: ev.network,
            grantRoot: ev.grantRoot,
            permissionsSummary: ev.permissionsSummary,
            requestedPermissions: ev.requestedPermissions,
            proposedExecpolicyAmendment: ev.proposedExecpolicyAmendment,
          } : {}),
        },
      };

    case 'approval_resolved':
      return { ...s, pendingApproval: null };

    // A retry after a wrong password arrives as a fresh prompt and replaces the current one.
    case 'sudo-prompt':
      return { ...s, pendingSudo: { promptId: ev.promptId, toolUseId: ev.toolUseId, command: ev.command, error: ev.error } };

    case 'sudo-resolved':
      return { ...s, pendingSudo: null };

    case 'user':
      return reduceToolResults(s, entry);

    case 'assistant':
      return reduceAssistant(s, entry);

    // ── Client-side events ──
    case 'local_note':
      return appendMessage(s, {
        id: typeof ev.noteId === 'string' && ev.noteId ? ev.noteId : `m${seq}`,
        role: 'system',
        content: typeof ev.content === 'string' ? ev.content : '',
        timestamp: ts,
        ...(ev.error ? { error: ev.error } : {}),
      });

    case 'cleared':
      return { ...s, messages: [], waiting: null, awaitingQuestion: false };

    case 'watcher_snapshot': {
      const snapshot = ev.snapshot as GitHubWatcherSnapshot | undefined;
      if (!ev.messageId || !snapshot) return s;
      let changed = false;
      const messages = s.messages.map(m => {
        if (m.id !== ev.messageId) return m;
        const existing = m.githubWatchers ?? [];
        const prior = existing.find(w => w.url === snapshot.url);
        if (prior && prior.phase === snapshot.phase) return m;
        changed = true;
        return { ...m, githubWatchers: [...existing.filter(w => w.url !== snapshot.url), snapshot] };
      });
      return changed ? { ...s, messages } : s;
    }

    case 'settings_changed':
      return ev.settings && typeof ev.settings === 'object'
        ? { ...s, settings: { ...s.settings, ...(ev.settings as Partial<ChatSettings>) } } : s;

    case 'queue_added': {
      const item = ev.item as QueuedItem | undefined;
      if (!item || typeof item.clientId !== 'string') return s;
      if (s.queue.some(q => q.clientId === item.clientId)) return s;
      // Logs written before queued user_messages were marked hold the bubble
      // already: while queued it shows in the strip, not the transcript.
      return { ...withoutMessage(s, item.clientId), queue: [...s.queue, item] };
    }

    case 'queue_removed': {
      const item = s.queue.find(q => q.clientId === ev.clientId);
      if (!item) return s;
      const next = { ...s, queue: s.queue.filter(q => q !== item) };
      // A drain sent it: the bubble joins the transcript now, ahead of its turn's output.
      if (ev.sent !== true) return next;
      return appendMessage(next, {
        id: item.clientId,
        role: 'user',
        content: typeof item.text === 'string' ? item.text : '',
        timestamp: ts,
        ...(Array.isArray(item.images) && item.images.length > 0 ? { images: item.images } : {}),
        ...(typeof item.taskId === 'string' ? { taskId: item.taskId } : {}),
      });
    }

    case 'queue_promoted': {
      const idx = s.queue.findIndex(q => q.clientId === ev.clientId);
      if (idx <= 0) return s;
      return { ...s, queue: [s.queue[idx], ...s.queue.slice(0, idx), ...s.queue.slice(idx + 1)] };
    }

    case 'queue_cleared':
      return { ...s, queue: [] };

    default:
      return s;
  }
}

/** Applies one log entry. Entries at or below state.lastSeq were already applied and are ignored. */
export function reduceChat(state: ChatState, entry: ChatLogEntry): ChatState {
  if (entry.seq <= state.lastSeq) return state;
  return { ...apply(state, entry), lastSeq: entry.seq };
}

export function reduceMany(state: ChatState, entries: ChatLogEntry[]): ChatState {
  let s = state;
  for (const entry of entries) s = reduceChat(s, entry);
  return s;
}

/**
 * State fit for persisted history: transient live flags stripped (history
 * reloads collapsed and settled), pending prompts cleared, turn not streaming.
 */
export function persistableState(state: ChatState): ChatState {
  const messages = state.messages.map(m => {
    let out = m;
    if (out.reasoningLive) {
      const { reasoningLive: _live, ...rest } = out;
      out = rest;
    }
    if (out.toolCalls?.some(tc => tc.liveOutput)) {
      out = {
        ...out,
        toolCalls: out.toolCalls.map(tc => {
          if (!tc.liveOutput) return tc;
          const { liveOutput: _lo, ...rest } = tc;
          return rest;
        }),
      };
    }
    return out;
  });
  return {
    ...state,
    messages,
    pendingApproval: null,
    pendingSudo: null,
    pendingCodexUserInput: null,
    pendingCodexMcpElicitation: null,
    turn: { ...state.turn, streaming: false },
  };
}
