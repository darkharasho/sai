import type { ChatMessage, ToolCall } from '../../../types';
import { classifyToolType } from './toolType';

function stringifyInput(input: unknown): string {
  return typeof input === 'string' ? input :
         input && typeof input === 'object' ? JSON.stringify(input, null, 2) : '';
}

function resultText(content: unknown): string {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return content
      .map((b: any) => (b && typeof b === 'object' && typeof b.text === 'string' ? b.text : ''))
      .filter(Boolean)
      .join('\n');
  }
  return '';
}

/** Convert SDK SessionMessages (a subagent transcript) into ChatMessages. */
export function transcriptToChatMessages(
  msgs: Array<{ type: string; uuid: string; message: unknown }>,
): ChatMessage[] {
  const out: ChatMessage[] = [];
  const toolById = new Map<string, ToolCall>();

  for (const m of msgs ?? []) {
    const body = m?.message as { content?: unknown } | null | undefined;
    if (!body || typeof body !== 'object') continue;
    const content = body.content;

    if (m.type === 'assistant') {
      const blocks = Array.isArray(content) ? content : typeof content === 'string' ? [{ type: 'text', text: content }] : [];
      const texts: string[] = [];
      const toolCalls: ToolCall[] = [];
      for (const b of blocks as any[]) {
        if (!b || typeof b !== 'object') continue;
        if (b.type === 'text' && typeof b.text === 'string') texts.push(b.text);
        else if (b.type === 'tool_use') {
          const name = typeof b.name === 'string' ? b.name : undefined;
          const tc: ToolCall = {
            id: typeof b.id === 'string' ? b.id : undefined,
            type: classifyToolType(name),
            name: name || 'tool',
            input: stringifyInput(b.input),
          };
          toolCalls.push(tc);
          if (tc.id) toolById.set(tc.id, tc);
        }
      }
      const msg: ChatMessage = { id: m.uuid, role: 'assistant', content: texts.join(''), timestamp: 0 } as ChatMessage;
      if (toolCalls.length) msg.toolCalls = toolCalls;
      out.push(msg);
    } else if (m.type === 'user') {
      if (typeof content === 'string') {
        out.push({ id: m.uuid, role: 'user', content, timestamp: 0 } as ChatMessage);
      } else if (Array.isArray(content)) {
        const texts: string[] = [];
        for (const b of content as any[]) {
          if (!b || typeof b !== 'object') continue;
          if (b.type === 'tool_result' && typeof b.tool_use_id === 'string') {
            const tc = toolById.get(b.tool_use_id);
            if (tc) tc.output = resultText(b.content);
          } else if (b.type === 'text' && typeof b.text === 'string') texts.push(b.text);
        }
        if (texts.length) out.push({ id: m.uuid, role: 'user', content: texts.join(''), timestamp: 0 } as ChatMessage);
      }
    }
  }
  return out;
}
