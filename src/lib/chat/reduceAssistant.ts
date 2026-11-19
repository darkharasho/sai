// Assistant-side branches of the chat reducer: streamed text, tool cards, tool
// results, reasoning rows and the result frame. Extracted from ChatPanel's
// onMessage handler. Pure: times come from entry.ts, ids from entry.seq.
import type { ChatMessage, ToolCall, ToolResultImage } from '../../types';
import { classifyToolType } from '../../components/Chat/tasks/toolType';
import { parseAiError, looksLikeApiError } from '../../components/Chat/parseAiError';
import { parseToolResultBlocks } from '../toolResultContent';
import type { ChatLogEntry, ChatState } from './types';

function replaceAt(messages: ChatMessage[], i: number, m: ChatMessage): ChatMessage[] {
  const next = [...messages];
  next[i] = m;
  return next;
}

/** Pure-text assistant bubble that later text may merge into (no tools, not a reasoning row). */
function isMergeableText(m: ChatMessage | undefined): m is ChatMessage {
  return m?.role === 'assistant' && !m.toolCalls && !m.reasoning && !m.reasoningLive;
}

/**
 * The reasoning segment is over (reply text/tools arrived, or the turn ended):
 * collapse the live row into its expandable disclosure.
 */
export function finalizeReasoning(s: ChatState, ts: number): ChatState {
  let messages = s.messages;
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i];
    if (m.reasoningLive) {
      const { reasoningLive: _live, ...rest } = m;
      messages = replaceAt(messages, i, { ...rest, reasoningDurationMs: ts - (m.timestamp ?? ts) });
      break;
    }
    if (m.role === 'user') break;
  }
  if (messages === s.messages && !s.turn.reasoningActive) return s;
  return { ...s, messages, turn: s.turn.reasoningActive ? { ...s.turn, reasoningActive: false } : s.turn };
}

/** reasoning_delta: grow the live reasoning row, opening it on the first delta. */
export function reduceReasoningDelta(s: ChatState, entry: ChatLogEntry): ChatState {
  const text = (entry.ev as any).text;
  if (typeof text !== 'string' || !text) return s;
  const last = s.messages[s.messages.length - 1];
  const messages = last?.role === 'assistant' && last.reasoningLive
    ? replaceAt(s.messages, s.messages.length - 1, { ...last, reasoning: (last.reasoning || '') + text })
    : [...s.messages, {
        id: `m${entry.seq}`,
        role: 'assistant' as const,
        content: '',
        reasoning: text,
        reasoningLive: true,
        timestamp: entry.ts,
      }];
  return { ...s, messages, turn: s.turn.reasoningActive ? s.turn : { ...s.turn, reasoningActive: true } };
}

/** thinking_tokens: the live reasoning row owns the count; otherwise it becomes the hint. */
export function reduceThinkingTokens(s: ChatState, n: number): ChatState {
  if (!s.turn.reasoningActive) {
    const label = n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n);
    return { ...s, streamHint: `thinking · ${label} tokens` };
  }
  let messages = s.messages;
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i];
    if (m.reasoningLive) {
      messages = replaceAt(messages, i, { ...m, reasoningTokens: n });
      break;
    }
    if (m.role === 'user') break;
  }
  return { ...s, messages, streamHint: null };
}

/** Assistant frame: text deltas, full/final text frames and tool_use blocks. */
export function reduceAssistant(s: ChatState, entry: ChatLogEntry): ChatState {
  const ev = entry.ev as any;
  const content = ev.message?.content;
  if (!Array.isArray(content)) return s;
  const { ts, seq } = entry;
  const toolTurnSeq: number | null = ev.turnSeq ?? s.turn.turnSeq;

  const textParts: string[] = [];
  const tools: ToolCall[] = [];
  for (const block of content) {
    if (block?.type === 'text' && block.text) textParts.push(block.text);
    if (block?.type === 'tool_use') {
      tools.push({
        id: block.id,
        ...(toolTurnSeq != null ? { turnSeq: toolTurnSeq } : {}),
        type: classifyToolType(block.name),
        name: block.name || 'tool',
        input: typeof block.input === 'string' ? block.input
          : typeof block.input === 'object' ? JSON.stringify(block.input, null, 2) : '',
        startedAt: ts,
      });
    }
  }
  const text = textParts.join('');
  // SDK reconcile frame: the complete text re-sent after its deltas with a
  // `final` tag. Authoritative — it REPLACES the accumulated delta text.
  const isFinalText = content.some((b: any) => b?.type === 'text' && b.final);
  // Real output is flowing — any silent-pause hint is stale.
  if (text && s.streamHint != null) s = { ...s, streamHint: null };

  if (text && tools.length === 0 && looksLikeApiError(text)) {
    const error = parseAiError(text);
    const messages = [...s.messages];
    const last = messages[messages.length - 1];
    if (last?.role === 'assistant' && !last.toolCalls) messages.pop();
    messages.push({ id: `e${seq}`, role: 'system', content: error.message, timestamp: ts, error });
    return { ...s, messages };
  }

  if (!text && tools.length === 0) return s;

  // Real output starts: the open reasoning segment collapses into its row.
  s = finalizeReasoning(s, ts);

  // Codex restarts item ids (item_0…) every turn, so tool upserts are scoped
  // to the turn: same id + turnSeq updates in place, a later turn adds a card.
  const toolKey = (t: ToolCall) => `${t.turnSeq ?? ''}:${t.id ?? ''}`;
  const existingToolKeys = new Set<string>();
  for (const m of s.messages) {
    if (m.toolCalls) for (const tc of m.toolCalls) if (tc.id) existingToolKeys.add(toolKey(tc));
  }
  const updateTools = tools.filter(t => t.id && existingToolKeys.has(toolKey(t)));
  const newTools = tools.filter(t => !t.id || !existingToolKeys.has(toolKey(t)));
  if (updateTools.length > 0) {
    s = {
      ...s,
      messages: s.messages.map(m => {
        if (m.role !== 'assistant' || !m.toolCalls) return m;
        let touched = false;
        const toolCalls = m.toolCalls.map(tc => {
          const update = updateTools.find(u => u.id === tc.id && u.turnSeq === tc.turnSeq);
          if (!update) return tc;
          touched = true;
          return { ...tc, input: update.input };
        });
        return touched ? { ...m, toolCalls } : m;
      }),
    };
  }
  if (!text && newTools.length === 0) return s;

  const prev = s.messages;
  const last = prev[prev.length - 1];
  // Merge into the last pure-text bubble only when:
  //  - delta text APPENDS, unless a turn boundary forces a new bubble;
  //  - non-delta full text REPLACES for snapshot transports (non-claude), or
  //    for claude's final-tagged reconcile frame. Other claude full frames are
  //    distinct segments and never clobber the previous reply.
  const shouldAppend = content.some((b: any) => b?.type === 'text' && b.delta);
  if (isMergeableText(last) && text && tools.length === 0
      && (shouldAppend ? !s.turn.forceNewBubble : (s.settings.provider !== 'claude' || isFinalText))) {
    const merged = shouldAppend ? (last.content || '') + text : text;
    return { ...s, messages: replaceAt(prev, prev.length - 1, { ...last, content: merged }) };
  }

  // Opening a new bubble: stamp the most recent unstamped text bubble so each
  // bubble records its own (cumulative from turn start) duration.
  const turnStart = s.turn.startedAt ?? ts;
  let stamped = prev;
  for (let i = prev.length - 1; i >= 0; i--) {
    const m = prev[i];
    if (m.role === 'assistant' && m.content && m.content.length > 0 && typeof m.durationMs !== 'number') {
      stamped = replaceAt(prev, i, { ...m, durationMs: ts - turnStart, completedAt: ts });
      break;
    }
  }
  const bubble: ChatMessage = {
    id: `m${seq}`,
    role: 'assistant',
    content: text,
    timestamp: ts,
    startedAt: s.turn.nextSegmentStart ?? ts,
    ...(newTools.length > 0 ? { toolCalls: newTools } : {}),
  };
  return {
    ...s,
    messages: [...stamped, bubble],
    turn: { ...s.turn, nextSegmentStart: null, forceNewBubble: false },
  };
}

/** Tool results arrive as user frames with tool_result blocks. */
export function reduceToolResults(s: ChatState, entry: ChatLogEntry): ChatState {
  const ev = entry.ev as any;
  const content = ev.message?.content;
  if (!Array.isArray(content)) return s;
  const resultTurnSeq: number | null = ev.turnSeq ?? s.turn.turnSeq;
  const results: Array<{ id: string; output: string; images?: ToolResultImage[]; partial: boolean }> = [];
  for (const block of content) {
    if (block?.type === 'tool_result' && block.tool_use_id) {
      const { text, images } = parseToolResultBlocks(block.content);
      results.push({ id: block.tool_use_id, output: text, images, partial: block.partial === true });
    }
  }
  if (results.length === 0) return s;

  const ts = entry.ts;
  const messages = s.messages.map(m => {
    if (m.role !== 'assistant' || !m.toolCalls) return m;
    let updated = false;
    const toolCalls = m.toolCalls.map(tc => {
      const result = tc.turnSeq === (resultTurnSeq ?? undefined) ? results.find(r => r.id === tc.id) : undefined;
      if (!result) return tc;
      // A delayed progress notification never reopens a settled card.
      if (result.partial && tc.liveOutput === false) return tc;
      updated = true;
      if (result.partial) {
        // Providers send either a fresh chunk or the cumulative output so far;
        // accept both without duplicating content.
        const previous = tc.output ?? '';
        const output = result.output.startsWith(previous) ? result.output
          : previous.endsWith(result.output) ? previous
          : previous + result.output;
        return { ...tc, output, liveOutput: true };
      }
      return {
        ...tc,
        output: result.output,
        liveOutput: false,
        ...(result.images ? { resultImages: result.images } : {}),
        ...(typeof tc.startedAt === 'number' ? { durationMs: ts - tc.startedAt } : {}),
      };
    });
    return updated ? { ...m, toolCalls } : m;
  });
  return { ...s, messages, pendingApproval: null, turn: { ...s.turn, nextSegmentStart: ts } };
}

/** result frame's final text replaces the last assistant content, or opens a bubble. */
export function reduceResultText(s: ChatState, entry: ChatLogEntry): ChatState {
  const result = (entry.ev as any).result;
  const text = typeof result === 'string' ? result : '';
  if (!text) return s;
  const last = s.messages[s.messages.length - 1];
  if (last?.role === 'assistant') {
    return { ...s, messages: replaceAt(s.messages, s.messages.length - 1, { ...last, content: text }) };
  }
  return {
    ...s,
    messages: [...s.messages, {
      id: `m${entry.seq}`,
      role: 'assistant',
      content: text,
      timestamp: entry.ts,
      startedAt: s.turn.nextSegmentStart ?? entry.ts,
    }],
    turn: { ...s.turn, nextSegmentStart: null },
  };
}
