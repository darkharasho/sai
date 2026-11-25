import type { ChatMessage, ToolCall } from '../types';
import { canvasName } from '../lib/canvasName';
import { canvasKey } from './canvasFiles';

const isCanvasTool = (name: string) => name === 'canvas' || name === 'sai_canvas' || name.endsWith('__sai_canvas');
const isFileWrite = (c: ToolCall) =>
  c.type === 'file_edit' || /write|edit|patch|create/i.test(c.name);

function parse(input: string): Record<string, unknown> | null {
  try {
    const v = JSON.parse(input);
    return v && typeof v === 'object' ? v as Record<string, unknown> : null;
  } catch { return null; }
}

/** Project canvas path named by a file-tool path value, or null. Relative paths resolve against the project. */
function canvasFromPath(root: string, raw: string): string | null {
  const p = canvasKey(raw.startsWith('/') ? raw : `${root}/${raw.replace(/^\.\//, '')}`);
  const m = /^(.*)\/\.sai\/canvas\/([^/]+\.md)$/.exec(p);
  return m && m[1] === root ? p : null;
}

/**
 * The canvases a chat created or opened, in first-touch order, as canvasKey paths: `sai_canvas`
 * write/open calls, plus plain file writes/edits of `<project>/.sai/canvas/*.md` (providers
 * without SAI's tools). Derived from the transcript, so it survives reloads. Never throws.
 */
export function deriveChatCanvases(messages: readonly ChatMessage[], projectPath: string): string[] {
  return deriveChatCanvasTouches(messages, projectPath).map((t) => t.path);
}

/** deriveChatCanvases with the timestamp of the message that first touched each canvas. */
export function deriveChatCanvasTouches(messages: readonly ChatMessage[], projectPath: string): { path: string; at: number }[] {
  const root = canvasKey(projectPath);
  const out: { path: string; at: number }[] = [];
  let at = 0;
  const add = (p: string | null) => { if (p && !out.some((t) => t.path === p)) out.push({ path: p, at }); };
  for (const m of messages) {
    at = m.timestamp;
    if (m.role !== 'assistant' || !m.toolCalls) continue;
    for (const c of m.toolCalls) {
      if (isCanvasTool(c.name)) {
        const i = parse(c.input);
        if (!i || (i.action !== 'write' && i.action !== 'open')) continue;
        const n = canvasName(i.name);
        if (n.ok) add(`${root}/.sai/canvas/${n.name}.md`);
      } else if (isFileWrite(c)) {
        const i = parse(c.input);
        if (!i) continue;
        for (const k of ['file_path', 'path', 'filePath', 'filename']) {
          if (typeof i[k] === 'string') add(canvasFromPath(root, i[k] as string));
        }
      }
    }
  }
  return out;
}
