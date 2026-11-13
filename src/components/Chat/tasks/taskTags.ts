import type { ChatMessage } from '../../../types';
import { deriveDeclaredCards, itemKey } from './declaredCards';

/**
 * Persist task tags onto items the first time they appear, so later history
 * can never change them. Stamps only messages / tool calls that are new
 * relative to `prev`, only where `taskId === undefined`, using the fold's tags
 * verbatim (`null` = stamped, no task). Returns `next` itself (same reference)
 * when nothing was stamped, when `prev`'s ids are not an in-order prefix of
 * `next`'s (session load / switch), or when the fold throws.
 */
export function stampTaskTags(prev: ChatMessage[], next: ChatMessage[]): ChatMessage[] {
  if (next.length < prev.length) return next;
  for (let i = 0; i < prev.length; i++) {
    if (prev[i].id !== next[i].id) return next;
  }
  const prevKeys = new Set<string>();
  for (const m of prev) {
    prevKeys.add(itemKey(m.id));
    m.toolCalls?.forEach((tc, i) => prevKeys.add(itemKey(m.id, tc.id, i)));
  }
  const isNew = (m: ChatMessage) => {
    if (!prevKeys.has(itemKey(m.id))) return true;
    return !!m.toolCalls?.some((tc, i) => !prevKeys.has(itemKey(m.id, tc.id, i)));
  };
  if (!next.some(isNew)) return next;

  let tags: Map<string, string | null>;
  try {
    tags = deriveDeclaredCards(next).tags;
  } catch {
    return next;
  }

  let changed = false;
  const out = next.map((m) => {
    let nm = m;
    if (!prevKeys.has(itemKey(m.id)) && m.taskId === undefined && tags.has(itemKey(m.id))) {
      nm = { ...nm, taskId: tags.get(itemKey(m.id)) as string | null };
    }
    if (m.toolCalls) {
      let calls = m.toolCalls;
      m.toolCalls.forEach((tc, i) => {
        const key = itemKey(m.id, tc.id, i);
        if (prevKeys.has(key) || tc.taskId !== undefined || !tags.has(key)) return;
        if (calls === m.toolCalls) calls = [...m.toolCalls];
        calls[i] = { ...tc, taskId: tags.get(key) as string | null };
      });
      if (calls !== m.toolCalls) nm = { ...nm, toolCalls: calls };
    }
    if (nm !== m) changed = true;
    return nm;
  });
  return changed ? out : next;
}
