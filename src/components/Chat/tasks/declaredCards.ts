import type { ChatMessage, ToolCall } from '../../../types';
import type { TaskCard } from './types';
import { isSaiTaskToolName, validateSaiTaskInput } from '../../../lib/saiTaskTool';

export interface DeclaredCards {
  cards: TaskCard[];
  batchStartedAt: number | null;
  /**
   * The current batch's card the active tag points at (derived from activeTag):
   * later items are filed under it until it finishes or another task is
   * updated. null = untagged output.
   */
  activeCardId: string | null;
  /**
   * Task tag per taggable item in history, keyed by itemKey(): every
   * assistant message (its text/reasoning), every tool call, user messages and
   * system rows. string = taskTag(); null = belongs to no task.
   */
  tags: Map<string, string | null>;
  /** The tag the next arriving item would get. */
  activeTag: string | null;
}

/** Batch-scoped stored task tag, so a later batch reusing an id can't capture old items. */
export function taskTag(batchStartedAt: number, id: string): string {
  return `${batchStartedAt}:${id}`;
}

/**
 * Key of a taggable item: the message id for message-level text/reasoning,
 * `${messageId}#${toolCallId}` for a tool call. A tool call without an id falls
 * back to `${messageId}#${index}` (index = position in message.toolCalls).
 * The fold and the arrival stamper must both key items through this function.
 */
export function itemKey(messageId: string, toolCallId?: string, index?: number): string {
  if (typeof toolCallId === 'string' && toolCallId) return `${messageId}#${toolCallId}`;
  if (typeof index === 'number') return `${messageId}#${index}`;
  return messageId;
}

/** Tool calls that wait on the user: a reply to one stays on its task. */
const isPendingPromptTool = (name: unknown) => name === 'AskUserQuestion' || name === 'ExitPlanMode';

const isFinished = (c: TaskCard) => c.status === 'done' || c.status === 'failed';

function parseInput(raw: unknown): Record<string, any> | null {
  try {
    const v = typeof raw === 'string' ? JSON.parse(raw) : raw;
    if (!validateSaiTaskInput(v).ok) return null;
    return v as Record<string, any>;
  } catch {
    return null;
  }
}

/**
 * Fold the model's `sai_task` calls (in chat history order) into task cards,
 * and compute a batch-scoped task tag for every item. Never throws.
 *
 * Tagging: an update that is not done/failed (running, or a bare update)
 * makes that task active, and its own call is tagged to it; done/failed tags
 * its call to the finished task and clears active if it was active; create
 * leaves active alone. Assistant text/reasoning (tagged as of the start of its
 * message) and other tool calls take the active tag. A stored `taskId` (string
 * or null) wins for its item. A user message clears active, unless it replies
 * to a still-pending AskUserQuestion/ExitPlanMode that was tagged (then it
 * takes that tag); a stored string tag on a user message makes it active.
 * System rows are null and never change active. A new batch clears active.
 *
 * Display-only: nothing here may feed turn completion, notifications or
 * streaming state.
 */
export function deriveDeclaredCards(messages: ChatMessage[]): DeclaredCards {
  let cards: TaskCard[] = [];
  let batchStartedAt: number | null = null;
  let active: string | null = null;
  const tags = new Map<string, string | null>();
  // (message id, tag) pairs that attribute a message to a card (messageIds).
  const attributions: Array<[string, string | null]> = [];
  // Latest question/plan-review call not yet replied to by a user message.
  let prompt: { call: ToolCall; tag: string | null } | null = null;
  // A user message arrived since the last sai_task call: an unfinished batch the
  // model never closed out may be abandoned (see the create branch).
  let userSinceTaskCall = false;

  const tagOf = (id: string) => taskTag(batchStartedAt ?? 0, id);

  /** Apply one sai_task call; returns the tag its own item gets. */
  const applyTaskCall = (call: ToolCall, ts: number): string | null => {
    const input = parseInput(call.input);
    if (!input) return active;
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
        active = null;
      }
      for (const t of input.tasks as any[]) {
        if (!t || typeof t.id !== 'string' || typeof t.title !== 'string') continue;
        if (cards.some((c) => c.id === t.id)) continue;
        // steps are still accepted from the model but no longer displayed.
        cards.push({
          id: t.id, source: 'declared', title: t.title, tag: tagOf(t.id), status: 'queued', now: null,
          startedAt: null, endedAt: null, result: null,
          agent: typeof t.agent === 'string' && t.agent ? { description: t.agent, toolUseId: null, taskId: null } : null,
          messageIds: [], question: null,
        });
      }
      return active;
    }

    const card = cards.find((c) => c.id === input.id);
    if (!card) return active;
    const note = typeof input.note === 'string' ? input.note : null;

    if (typeof input.agent === 'string' && input.agent) {
      card.agent = { description: input.agent, toolUseId: null, taskId: null };
    }

    if (input.status === 'running') {
      card.status = 'running';
      card.endedAt = null;
      if (card.startedAt == null) card.startedAt = ts;
    } else if (input.status === 'done') {
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
    // Agent-backed cards are tagged too: their feed merges these items with
    // the subagent transcript by timestamp.
    const tag = card.tag;
    if (input.status === 'done' || input.status === 'failed') {
      if (active === tag) active = null;
    } else {
      active = tag;
    }
    return tag;
  };

  try {
    for (const m of messages ?? []) {
      if (!m || typeof m.id !== 'string') continue;
      if (m.role === 'system') { tags.set(itemKey(m.id), null); continue; }

      if (m.role === 'user') {
        userSinceTaskCall = true;
        let tag: string | null;
        if (m.taskId !== undefined) {
          tag = m.taskId;
          active = tag;
        } else if (prompt && prompt.call.output === undefined && prompt.tag !== null) {
          tag = prompt.tag; // a reply to the task's pending question; active stays
        } else {
          tag = null;
          active = null;
        }
        prompt = null;
        tags.set(itemKey(m.id), tag);
        continue;
      }
      if (m.role !== 'assistant') continue;

      const calls = Array.isArray(m.toolCalls) ? m.toolCalls : [];
      // Message-level text/reasoning is tagged as of the start of the message.
      const msgTag = m.taskId !== undefined ? m.taskId : active;
      tags.set(itemKey(m.id), msgTag);
      const empty = typeof m.content !== 'string' || m.content.trim() === '';
      if (!(empty && calls.length > 0)) attributions.push([m.id, msgTag]);

      for (let i = 0; i < calls.length; i++) {
        const call = calls[i];
        const key = itemKey(m.id, call?.id, i);
        if (!call) { tags.set(key, active); continue; }
        const isTask = isSaiTaskToolName(call.name);
        const computed = isTask ? applyTaskCall(call, m.timestamp) : active;
        const tag = call.taskId !== undefined ? call.taskId : computed;
        tags.set(key, tag);
        if (!isTask) attributions.push([m.id, tag]);
        if (isPendingPromptTool(call.name)) prompt = { call, tag };
      }
    }
  } catch {
    // display-only fold: never throw into render
  }

  let activeCardId: string | null = null;
  try {
    if (batchStartedAt !== null) {
      for (const card of cards) {
        const tag = card.tag;
        const ids = new Set<string>();
        for (const [id, t] of attributions) if (t === tag) ids.add(id);
        card.messageIds = [...ids];
        if (active === tag) activeCardId = card.id;
      }
    }
  } catch {
    // display-only fold: never throw into render
  }

  return { cards, batchStartedAt, activeCardId, tags, activeTag: active };
}
