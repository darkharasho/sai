// Decides when a paired phone gets a push: watches every chat-log append in
// main and turns four moments into a sealed push (sender.ts):
//
//   done      a turn ended naturally: a current-turn `result` (not an empty
//             continuation, not a background/scheduled wait) then the `done`
//             that closed the reduced turn. A user Stop and the pre-emptive
//             done of a superseded turn carry no result, and a superseded
//             turn's late result/done is stale for the reducer (turnSeq guard),
//             so neither pushes.
//   approval  approval_needed that the reducer accepted as the pending approval.
//   question  question_needed / plan_review_needed / a Codex user_input_needed.
//   error     a turn closed by `done` whose last word was an error row (or an
//             error result) rather than a successful result.
//
// At most one push per (chatId, kind, turn, approval/question id). Nothing is
// sent while the desktop is focused on the chat's workspace (the user is at
// the desk), nor to a phone that has the chat in the foreground.
import path from 'node:path';
import type { ChatLogEntry, ChatMeta, ChatState } from '../../../src/lib/chat/types';
import type { PushKind, PushPlain } from '../../../src/lib/push/types';
import { clampPlain } from '../../../src/lib/push/seal';
import type { AppendTurnEdge } from '../chatlog/service';
import { realPath } from '../chatlog/service';
import type { PushTarget } from './sender';

export interface PushChatLog {
  onEntry(cb: (entry: ChatLogEntry, turn: AppendTurnEdge) => void): () => void;
  state(chatId: string): ChatState | null;
  meta(chatId: string): ChatMeta | null;
}

export interface PushTriggersOpts {
  chatlog: PushChatLog;
  registry: { all(): PushTarget[] };
  presence: { isViewing(deviceId: string, chatId: string): boolean };
  /** The desktop window's focus and active workspace (notify.ts). */
  desktopPresence: () => { focused: boolean; activeWorkspace: string };
  /** Fire-and-forget; its result is never awaited. */
  send: (target: PushTarget, plain: PushPlain) => unknown;
  /** The pushNotifications setting (read only when a push is about to go out). */
  enabled?: () => boolean;
  /**
   * A finished turn is pushed this long after its done, unless the chat
   * streams again meanwhile (the user sent again, or the runtime resumed).
   */
  doneDelayMs?: number;
  now?: () => number;
  samePath?: (a: string, b: string) => boolean;
}

export const PUSH_DONE_DELAY_MS = 1000;
const DEDUPE_CAP = 4096;

/** What the open turn has shown so far. */
interface TurnTrack {
  /** Log seq of the turn's streaming_start (tells null-turnSeq turns apart). */
  startSeq: number;
  turnSeq: number | null;
  /** messages.length at the turn start: the turn's own text comes after it. */
  startLen: number;
  /** The last current-turn result. */
  result: { ok: boolean; finished: boolean; text: string } | null;
  /** The last error row the turn appended (cleared by a later successful result). */
  error: string | null;
}

const str = (v: unknown): string => (typeof v === 'string' ? v : '');
const isStale = (turnSeq: unknown, s: ChatState): boolean => turnSeq != null && turnSeq !== s.turn.turnSeq;
const waits = (ev: Record<string, unknown>): boolean => {
  const kind = (ev.wait as { kind?: unknown } | undefined)?.kind;
  return kind === 'background' || kind === 'scheduled';
};

export function createPushTriggers(opts: PushTriggersOpts): { dispose(): void } {
  const { chatlog } = opts;
  const now = opts.now ?? Date.now;
  const delay = opts.doneDelayMs ?? PUSH_DONE_DELAY_MS;
  const samePath = opts.samePath ?? ((a: string, b: string) => realPath(a) === realPath(b));
  const tracks = new Map<string, TurnTrack>();
  const pendingDone = new Map<string, NodeJS.Timeout>();
  const sentKeys = new Set<string>();

  const remember = (key: string): void => {
    sentKeys.add(key);
    if (sentKeys.size > DEDUPE_CAP) {
      const oldest = sentKeys.values().next().value;
      if (oldest !== undefined) sentKeys.delete(oldest);
    }
  };

  const turnKey = (chatId: string): string => {
    const t = tracks.get(chatId);
    if (t) return `${t.turnSeq}@${t.startSeq}`;
    return `${chatlog.state(chatId)?.turn.turnSeq ?? null}@?`;
  };

  function fire(chatId: string, kind: PushKind, id: string, body: string, turn: string): void {
    const key = `${chatId}\0${kind}\0${turn}\0${id}`;
    if (sentKeys.has(key)) return;
    const targets = opts.registry.all();
    if (targets.length === 0) return;
    if (opts.enabled && !opts.enabled()) return;
    const meta = chatlog.meta(chatId);
    if (!meta) return;
    remember(key);
    const desk = opts.desktopPresence();
    if (desk.focused && desk.activeWorkspace && samePath(desk.activeWorkspace, meta.projectPath)) return;
    // Title ≤ 80 and body ≤ 180 code points (the done body is the first 180 of the final text).
    const plain: PushPlain = clampPlain({
      v: 1, kind, chatId, projectPath: meta.projectPath,
      title: meta.title?.trim() || path.basename(meta.projectPath) || 'SAI',
      body: body.trim() || fallbackBody(kind),
      ts: now(),
    });
    for (const target of targets) {
      if (opts.presence.isViewing(target.deviceId, chatId)) continue;
      try {
        const p = opts.send(target, plain);
        if (p && typeof (p as Promise<unknown>).catch === 'function') (p as Promise<unknown>).catch(() => {});
      } catch { /* a send never fails the chat */ }
    }
  }

  /** The turn's final assistant text (its last non-empty assistant bubble). */
  function finalText(chatId: string, t: TurnTrack): string {
    const msgs = chatlog.state(chatId)?.messages ?? [];
    for (let i = msgs.length - 1; i >= t.startLen && i >= 0; i--) {
      const m = msgs[i];
      if (m.role === 'assistant' && typeof m.content === 'string' && m.content.trim()) return m.content;
    }
    return t.result?.text ?? '';
  }

  function turnEnded(chatId: string, ev: Record<string, unknown>): void {
    const t = tracks.get(chatId);
    tracks.delete(chatId);
    // No track: the turn opened before we were watching (e.g. startup repair
    // closing a previous run's turn). Never guess.
    if (!t || ev.reason === 'app_restart') return;
    const turn = `${t.turnSeq}@${t.startSeq}`;
    if (t.result && !t.result.ok) return fire(chatId, 'error', '', t.result.text || 'The turn failed.', turn);
    if (t.error && !t.result) return fire(chatId, 'error', '', t.error, turn);
    if (!t.result?.finished || waits(ev)) return; // stopped, superseded, waiting or a continuation
    const body = finalText(chatId, t);
    if (delay <= 0) return fire(chatId, 'done', '', body, turn);
    const timer = setTimeout(() => {
      pendingDone.delete(chatId);
      // Streaming again (a quick re-send, or the runtime resumed): not finished.
      if (chatlog.state(chatId)?.turn.streaming) return;
      fire(chatId, 'done', '', body, turn);
    }, delay);
    timer.unref?.();
    pendingDone.set(chatId, timer);
  }

  function onEntry(entry: ChatLogEntry, edge: AppendTurnEdge): void {
    const ev = entry.ev as Record<string, unknown>;
    const chatId = entry.chatId;
    switch (ev.type) {
      case 'streaming_start': {
        const pending = pendingDone.get(chatId);
        if (pending) { clearTimeout(pending); pendingDone.delete(chatId); }
        const s = chatlog.state(chatId);
        tracks.set(chatId, {
          startSeq: entry.seq,
          turnSeq: s?.turn.turnSeq ?? null,
          startLen: s?.turn.startIndex ?? s?.messages.length ?? 0,
          result: null,
          error: null,
        });
        return;
      }
      case 'result': {
        const t = tracks.get(chatId);
        const s = chatlog.state(chatId);
        if (!t || !s || !edge.wasStreaming || isStale(ev.turnSeq, s)) return;
        const failed = ev.is_error === true;
        const errors = Array.isArray(ev.errors) ? ev.errors.filter((e) => typeof e === 'string') : [];
        t.result = {
          ok: !failed,
          finished: !failed && ev.continuation !== true && !waits(ev),
          text: str(ev.result) || (failed ? String(errors[0] ?? '') : ''),
        };
        if (!failed) t.error = null;
        return;
      }
      case 'error': {
        const t = tracks.get(chatId);
        if (!t || !edge.isStreaming) return;
        // Only an error the reducer kept as a row (load-guard noise is swallowed).
        const last = chatlog.state(chatId)?.messages.at(-1);
        if (last?.id === `e${entry.seq}`) { t.error = str(last.content) || 'The turn failed.'; t.result = null; }
        return;
      }
      case 'done':
      case 'process_exit':
        if (edge.wasStreaming && !edge.isStreaming) turnEnded(chatId, ev);
        return;
      case 'approval_needed': {
        const pa = chatlog.state(chatId)?.pendingApproval;
        if (!pa || pa.toolUseId !== ev.toolUseId) return; // rejected by the reducer (wrong provider)
        return fire(chatId, 'approval', str(ev.toolUseId) || `s${entry.seq}`, `Approve ${str(ev.toolName) || 'tool'}?`, turnKey(chatId));
      }
      case 'question_needed':
        return fire(chatId, 'question', str(ev.toolUseId) || `s${entry.seq}`, str(ev.question), turnKey(chatId));
      case 'plan_review_needed':
        return fire(chatId, 'question', str(ev.toolUseId) || `s${entry.seq}`, 'A plan is ready for your review.', turnKey(chatId));
      case 'user_input_needed': {
        const pending = chatlog.state(chatId)?.pendingCodexUserInput;
        if (!pending || pending.requestHandle !== ev.requestHandle) return;
        const q = pending.questions[0];
        return fire(chatId, 'question', pending.requestHandle, str(q?.prompt) || str(q?.header), turnKey(chatId));
      }
      default:
        return;
    }
  }

  const unsub = chatlog.onEntry(onEntry);
  return {
    dispose() {
      unsub();
      for (const t of pendingDone.values()) clearTimeout(t);
      pendingDone.clear();
      tracks.clear();
    },
  };
}

function fallbackBody(kind: PushKind): string {
  switch (kind) {
    case 'done': return 'Finished.';
    case 'approval': return 'Approval needed.';
    case 'question': return 'The agent is waiting for your answer.';
    case 'error': return 'The turn failed.';
  }
}
