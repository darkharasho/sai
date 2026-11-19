import type { ChatEvent, ChatLogEntry } from '../../../src/lib/chat/types';

/** Builds a log entry for chat 'c1'; ts defaults to 1000 + seq. */
export function e(seq: number, ev: ChatEvent, ts = 1000 + seq): ChatLogEntry {
  return { chatId: 'c1', seq, ts, ev };
}

export const text = (t: string, extra: Record<string, unknown> = {}) => ({ type: 'text', text: t, ...extra });
export const delta = (t: string) => text(t, { delta: true });
export const assistant = (turnSeq: number | null, ...content: unknown[]): ChatEvent =>
  ({ type: 'assistant', ...(turnSeq != null ? { turnSeq } : {}), message: { content } });
export const toolUse = (id: string, name: string, input: unknown) => ({ type: 'tool_use', id, name, input });
export const toolResult = (turnSeq: number | null, id: string, content: unknown, partial = false): ChatEvent => ({
  type: 'user',
  ...(turnSeq != null ? { turnSeq } : {}),
  message: { content: [{ type: 'tool_result', tool_use_id: id, content, ...(partial ? { partial: true } : {}) }] },
});
