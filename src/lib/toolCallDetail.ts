import type { ToolCall } from '../types';
import { truncateSnippet } from './overlayFeed';

const DETAIL_MAX = 80;

/** Shorten a path from the LEFT so the basename survives: …/Chat/ChatPanel.tsx */
export function shortenPathLeft(path: string, max: number): string {
  if (path.length <= max) return path;
  const tail = path.slice(-(max - 1));
  const slash = tail.indexOf('/');
  // Prefer cutting at a directory boundary; fall back to a hard cut.
  return `…${slash > 0 && slash < tail.length - 1 ? tail.slice(slash) : tail}`;
}

function parse(input: string): Record<string, unknown> | null {
  if (!input) return null;
  try {
    const v = JSON.parse(input);
    return v && typeof v === 'object' && !Array.isArray(v) ? v : null;
  } catch {
    return null;
  }
}

function str(v: unknown): string | null {
  return typeof v === 'string' && v.trim().length > 0 ? v : null;
}

/** Plain-text one-liner describing what a tool call is doing, for compact
 *  surfaces (the overlay). Returns null when there's nothing useful to say —
 *  including mid-stream, while `input` is still partial JSON. */
export function toolCallDetail(tc: Pick<ToolCall, 'name' | 'type' | 'input'>): string | null {
  const input = parse(tc.input || '');
  if (!input) return null;
  const name = tc.name || '';

  let detail: string | null = null;
  if (name === 'Bash') {
    detail = str(input.command)?.split('\n')[0] ?? null;
  } else if (name === 'Edit' || name === 'Write' || name === 'Read' || name === 'NotebookEdit') {
    const p = str(input.file_path);
    detail = p ? shortenPathLeft(p, 48) : null;
  } else if (name === 'Grep' || name === 'Glob') {
    detail = str(input.pattern);
  } else if (name === 'WebFetch') {
    const u = str(input.url);
    if (u) { try { detail = new URL(u).host; } catch { detail = null; } }
  } else if (name === 'WebSearch') {
    detail = str(input.query);
  } else if (name === 'Task' || name === 'Agent') {
    detail = str(input.description);
  } else if (name === 'Skill') {
    detail = str(input.skill);
  } else if (name.startsWith('mcp__')) {
    detail = Object.values(input).find((v): v is string => typeof v === 'string' && v.trim().length > 0) ?? null;
  }

  return detail ? truncateSnippet(detail, DETAIL_MAX) : null;
}
