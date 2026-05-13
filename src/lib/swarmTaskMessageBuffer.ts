// Per-(workspace, taskSessionId) buffer of assistant messages produced by
// background swarm tasks. Background tasks have no ChatPanel mounted while
// they run, so streaming `claude:message` envelopes never get translated into
// ChatMessages and persisted. Without this buffer, clicking a completed task
// shows only the injected user prompt — the assistant reply is lost.
//
// This module is pure and synchronous; the App.tsx listener feeds it events
// and, on done/result, flushes the accumulated messages to chatDb merged with
// any messages already persisted (typically the injected user prompt).

import type { ChatMessage, ToolCall } from '../types';

export interface ConvertedAssistant {
  /** Plain text portion of the message (joined `text` blocks). */
  text: string;
  /** Tool calls extracted from `tool_use` blocks. */
  tools: ToolCall[];
  /** True when the streamed message contains `delta` text blocks (mid-stream). */
  isDelta: boolean;
}

/**
 * Convert a `claude:message` `assistant`-typed envelope into text + tool calls.
 * Returns null when the envelope has no useful content.
 */
export function convertAssistantEnvelope(msg: any): ConvertedAssistant | null {
  if (!msg || msg.type !== 'assistant') return null;
  const content = msg.message?.content;
  if (!content) return null;

  // Some providers/transports send a string content instead of blocks.
  if (typeof content === 'string') {
    return content.length > 0
      ? { text: content, tools: [], isDelta: false }
      : null;
  }

  if (!Array.isArray(content)) return null;

  const textParts: string[] = [];
  const tools: ToolCall[] = [];
  let isDelta = false;

  for (const block of content) {
    if (!block || typeof block !== 'object') continue;
    if (block.type === 'text' && typeof block.text === 'string' && block.text.length > 0) {
      textParts.push(block.text);
      if (block.delta) isDelta = true;
    } else if (block.type === 'tool_use') {
      const name: string = block.name || 'tool';
      const inputStr = typeof block.input === 'string'
        ? block.input
        : block.input != null
          ? JSON.stringify(block.input, null, 2)
          : '';
      tools.push({
        id: block.id,
        type: name.includes('Edit') || name.includes('Write') ? 'file_edit'
          : name.includes('Bash') ? 'terminal_command'
          : name.includes('Read') || name.includes('Glob') || name.includes('Grep') ? 'file_read'
          : name.includes('WebFetch') || name.includes('WebSearch') ? 'web_fetch'
          : 'other',
        name,
        input: inputStr,
      });
    }
  }

  if (textParts.length === 0 && tools.length === 0) return null;
  return { text: textParts.join(''), tools, isDelta };
}

/**
 * Append a converted assistant chunk to a running buffer of messages.
 *
 * Mirrors ChatPanel's logic at a coarse level:
 *  - If the last buffered message is a plain assistant text bubble (no tool
 *    calls) and this chunk is text-only, replace/append based on `isDelta`.
 *  - Otherwise push a new assistant message.
 *
 * Tool calls are attached to a fresh message so they sort above any follow-up
 * text response, matching the live ChatPanel rendering.
 */
export function appendAssistantChunk(
  buf: ChatMessage[],
  converted: ConvertedAssistant,
  now: number = Date.now(),
  newId: () => string = () => `${now}-${Math.random().toString(36).slice(2, 10)}`,
): ChatMessage[] {
  const { text, tools, isDelta } = converted;
  const last = buf[buf.length - 1];

  if (last && last.role === 'assistant' && text && tools.length === 0 && !last.toolCalls) {
    const newContent = isDelta ? last.content + text : text;
    const next = [...buf];
    next[next.length - 1] = { ...last, content: newContent, timestamp: now };
    return next;
  }

  const msg: ChatMessage = {
    id: newId(),
    role: 'assistant',
    content: text,
    timestamp: now,
  };
  if (tools.length > 0) msg.toolCalls = tools;
  return [...buf, msg];
}

/**
 * Merge a previously persisted message list (e.g. the injected user prompt)
 * with assistant messages we accumulated during a background run.
 *
 * Strategy: keep the persisted prefix as-is and append the buffered messages
 * after it. Buffered messages whose `id` already appears in `existing` are
 * skipped to make the merge idempotent across retries.
 */
export function mergePersistedWithBuffer(
  existing: ChatMessage[],
  buffered: ChatMessage[],
): ChatMessage[] {
  if (buffered.length === 0) return existing;
  const seen = new Set(existing.map(m => m.id));
  const fresh = buffered.filter(m => !seen.has(m.id));
  return [...existing, ...fresh];
}
