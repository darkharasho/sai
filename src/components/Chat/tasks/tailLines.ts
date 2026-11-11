import type { ChatMessage, ToolCall } from '../../../types';
import type { TailLine } from './types';

const str = (v: unknown): string => (typeof v === 'string' ? v : v == null ? '' : String(v));
const firstLine = (s: string) => s.split('\n').find(l => l.trim()) ?? '';
const basename = (p: string) => p.split(/[\\/]/).filter(Boolean).pop() ?? p;
/** Strip simple markdown: leading #s, **, __ and backticks. */
const plain = (s: string) => s.replace(/^#+\s*/, '').replace(/\*\*|__|`/g, '');

function parseInput(input: string): Record<string, unknown> {
  try {
    const v = JSON.parse(input);
    return v && typeof v === 'object' ? v : {};
  } catch { return {}; }
}

function toolText(tc: ToolCall): string {
  const name = str(tc.name);
  const inp = parseInput(str(tc.input));
  if (name === 'Bash') return `$ ${firstLine(str(inp.command))}`;
  if (name === 'Read') return `read ${basename(str(inp.file_path))}`;
  if (name === 'Edit' || name === 'Write') return `edit ${basename(str(inp.file_path))}`;
  if (name === 'Grep' || name === 'Glob') return `search ${str(inp.pattern)}`;
  return name.replace(/^mcp__.*?__/, '') || 'tool';
}

/** Last `max` activity lines (oldest first) from a message list. */
export function buildTailLines(messages: ChatMessage[], max = 4): TailLine[] {
  const lines: TailLine[] = [];
  for (const m of messages ?? []) {
    if (m?.role !== 'assistant') continue;
    const text = plain(firstLine(str(m.content)).trim()).trim();
    if (text) lines.push({ text: text.slice(0, 80), tone: 'normal' });
    for (const tc of Array.isArray(m.toolCalls) ? m.toolCalls : []) {
      if (!tc) continue;
      const out = tc.output;
      const isErr = typeof out === 'string' && (out.startsWith('Error') || out.includes('<tool_use_error>'));
      lines.push({ text: toolText(tc), tone: isErr ? 'error' : out === undefined ? 'live' : 'normal' });
    }
  }
  const tail = lines.slice(-max);
  // 'live' only applies to the last line.
  return tail.map((l, i) => (l.tone === 'live' && i !== tail.length - 1 ? { ...l, tone: 'normal' as const } : l));
}
