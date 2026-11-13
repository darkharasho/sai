// A task's feed: the chat filtered to the items filed under one task tag,
// plus (for agent-backed tasks) the subagent transcript. Display-only.

import type { ChatMessage } from '../../../types';
import type { TaskCard } from './types';
import { itemKey } from './declaredCards';
import { buildTailLines } from './tailLines';
import { isSaiTaskToolName } from '../../../lib/saiTaskTool';

/** Stored tag wins (null included); undefined = legacy, use the fold's computed tag. */
export function effectiveTag(
  stored: string | null | undefined,
  computed: string | null | undefined,
): string | null {
  if (stored !== undefined) return stored;
  return computed ?? null;
}

/**
 * Messages filed under `tag`. A message is kept when its own (text/reasoning)
 * tag matches or any of its tool calls does; a kept message keeps only its
 * matching tool calls, and loses its text and reasoning when only its tool
 * calls match. Returns new objects; never mutates `messages`.
 */
export function filterMessagesForTask(
  messages: ChatMessage[],
  tag: string,
  computed: Map<string, string | null>,
): ChatMessage[] {
  const out: ChatMessage[] = [];
  for (const m of messages ?? []) {
    if (!m || typeof m.id !== 'string') continue;
    const ownMatch = effectiveTag(m.taskId, computed.get(itemKey(m.id))) === tag;
    const calls = Array.isArray(m.toolCalls)
      ? m.toolCalls.filter((c, i) => !!c && effectiveTag(c.taskId, computed.get(itemKey(m.id, c.id, i))) === tag)
      : undefined;
    if (!ownMatch && !calls?.length) continue;
    const kept: ChatMessage = { ...m };
    if (calls) kept.toolCalls = calls;
    if (!ownMatch) {
      kept.content = '';
      if (kept.reasoning !== undefined) kept.reasoning = '';
    }
    out.push(kept);
  }
  return out;
}

/** Stable merge by timestamp: on a tie, tagged chat items come before transcript items. */
export function mergeFeed(tagged: ChatMessage[], transcript: ChatMessage[] | null): ChatMessage[] {
  if (!transcript || transcript.length === 0) return tagged;
  const ts = (m: ChatMessage) => Number(m?.timestamp) || 0;
  const out: ChatMessage[] = [];
  let i = 0;
  let j = 0;
  while (i < tagged.length && j < transcript.length) {
    if (ts(transcript[j]) < ts(tagged[i])) out.push(transcript[j++]);
    else out.push(tagged[i++]);
  }
  while (i < tagged.length) out.push(tagged[i++]);
  while (j < transcript.length) out.push(transcript[j++]);
  return out;
}

/**
 * One-line "now" label: the feed's latest activity line, with `…` while that
 * tool is still running. sai_task bookkeeping calls (hidden by the renderer)
 * are skipped, so the label never reads "sai_task".
 */
export function nowLabel(feed: ChatMessage[]): string | null {
  const visible = (feed ?? []).map((m) =>
    Array.isArray(m?.toolCalls) && m.toolCalls.some((c) => isSaiTaskToolName(String(c?.name ?? '')))
      ? { ...m, toolCalls: m.toolCalls.filter((c) => !isSaiTaskToolName(String(c?.name ?? ''))) }
      : m);
  const line = buildTailLines(visible, 1)[0];
  if (!line) return null;
  return line.tone === 'live' ? `${line.text}…` : line.text;
}

export interface TaskChipInfo { title: string; colorIndex: number }

const hasText = (v: unknown) => (typeof v === 'string' ? v.trim() !== '' : !!v);

/**
 * Where All shows a task chip: keyed by message id. A message gets one when
 * its first tagged item (non-null effective tag) belongs to a current-batch
 * card and differs from the previous tagged item's tag. Only items All shows
 * count: message text/reasoning when non-empty, and tool calls other than
 * sai_task (the renderer hides those). colorIndex = the card's index.
 */
export function taskChips(
  messages: ChatMessage[],
  cards: TaskCard[],
  computed: Map<string, string | null>,
): Map<string, TaskChipInfo> {
  const out = new Map<string, TaskChipInfo>();
  if (cards.length === 0) return out;
  const byTag = new Map<string, TaskChipInfo>();
  cards.forEach((c, i) => byTag.set(c.tag, { title: c.title, colorIndex: i }));
  let prev: string | null = null;
  for (const m of messages ?? []) {
    if (!m || typeof m.id !== 'string') continue;
    const itemTags: Array<string | null> = [];
    if (m.role === 'user' || hasText(m.content) || hasText(m.reasoning)) {
      itemTags.push(effectiveTag(m.taskId, computed.get(itemKey(m.id))));
    }
    (Array.isArray(m.toolCalls) ? m.toolCalls : []).forEach((c, i) => {
      if (!c || isSaiTaskToolName(String(c.name ?? ''))) return;
      itemTags.push(effectiveTag(c.taskId, computed.get(itemKey(m.id, c.id, i))));
    });
    let first = true;
    for (const t of itemTags) {
      if (t === null) continue;
      if (first) {
        first = false;
        const chip = t !== prev ? byTag.get(t) : undefined;
        if (chip) out.set(m.id, chip);
      }
      prev = t;
    }
  }
  return out;
}
