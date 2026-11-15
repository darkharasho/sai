import type { ChatMessage } from '../../../types';
import type { TaskCard } from './types';
import { formatElapsed } from './formatElapsed';
import { isSaiTaskToolName } from '../../../lib/saiTaskTool';

export interface TaskSummary {
  status: 'done' | 'failed';
  /** The model's done/failed note (card.result); null when it left none. */
  note: string | null;
  elapsed: string | null;
  toolCalls: number;
  commands: number;
  /** Distinct files edited/written, in first-touched order. */
  files: string[];
}

const EDIT_TOOLS = new Set(['Edit', 'Write', 'MultiEdit', 'NotebookEdit']);

function filePathOf(input: unknown): string | null {
  try {
    const v = typeof input === 'string' ? JSON.parse(input || '{}') : input;
    const p = v?.file_path ?? v?.notebook_path ?? v?.path;
    return typeof p === 'string' && p ? p : null;
  } catch { return null; }
}

/**
 * Recap of a finished task: its note plus what its feed shows it did.
 * null while the task is still in flight.
 */
export function taskSummary(card: TaskCard, feed: ChatMessage[] | null): TaskSummary | null {
  if (card.status !== 'done' && card.status !== 'failed') return null;
  let toolCalls = 0;
  let commands = 0;
  const files: string[] = [];
  const seen = new Set<string>();
  for (const m of feed ?? []) {
    if (!Array.isArray(m?.toolCalls)) continue;
    for (const tc of m.toolCalls) {
      if (!tc || isSaiTaskToolName(String(tc.name ?? ''))) continue;
      toolCalls++;
      if (tc.type === 'terminal_command' || tc.name === 'Bash') commands++;
      if (EDIT_TOOLS.has(tc.name) || tc.type === 'file_edit') {
        const p = filePathOf(tc.input);
        if (p && !seen.has(p)) { seen.add(p); files.push(p); }
      }
    }
  }
  const elapsed = card.startedAt != null && card.endedAt != null && card.endedAt >= card.startedAt
    ? formatElapsed(card.endedAt - card.startedAt)
    : null;
  return { status: card.status, note: card.result, elapsed, toolCalls, commands, files };
}

export const baseName = (p: string): string => p.split(/[\\/]/).filter(Boolean).pop() ?? p;
