import { PanelRight, AlertTriangle } from 'lucide-react';
import type { ToolCall } from '../../types';
import { canvasName, canvasTitle } from '../../lib/canvasName';
import { checklistTotals } from '../../canvas/canvasStats';
import './CanvasToolCard.css';

const firstLine = (t: string) => t.trim().split('\n')[0].replace(/^Error:\s*/i, '');

export const isCanvasToolName = (n: string) => n === 'canvas' || n === 'sai_canvas' || n.endsWith('__sai_canvas');

function parse(raw: string | undefined): Record<string, unknown> | null {
  if (!raw) return null;
  try {
    const v = JSON.parse(raw);
    return v && typeof v === 'object' ? v as Record<string, unknown> : null;
  } catch { return null; }
}

const VERB: Record<string, [running: string, done: string]> = {
  write: ['Writing', 'Updated'],
  read: ['Reading', 'Read'],
  list: ['Listing', 'Listed'],
  open: ['Opening', 'Opened'],
};

export interface CanvasToolSummary {
  action: string;
  verb: string;
  /** Canvas name (slug), when the call names one. */
  name: string | null;
  title: string | null;
  progress: string | null;
  error: string | null;
  running: boolean;
}

/** The tool's JSON result: bare, or MCP-wrapped (`[{type:'text',text:'{...}'}]` / `{content:[...]}`). */
function parseResult(raw: string | undefined): Record<string, unknown> | null {
  const v = parse(raw);
  const blocks = Array.isArray(v) ? v : Array.isArray(v?.content) ? v!.content as unknown[] : null;
  if (blocks) {
    const text = blocks.map((b) => (b && typeof b === 'object' && typeof (b as { text?: unknown }).text === 'string' ? (b as { text: string }).text : '')).join('');
    return parse(text) ?? (text ? { ok: !/^error\b/i.test(text.trim()), error: text } : null);
  }
  return v;
}

/** What a compact card says about one `sai_canvas` call. Never throws. */
export function summarizeCanvasCall(tc: ToolCall): CanvasToolSummary {
  const input = parse(tc.input) ?? {};
  const action = typeof input.action === 'string' ? input.action : '';
  const n = canvasName(input.name);
  const name = n.ok ? n.name : null;
  const running = tc.output == null;
  const out = parseResult(tc.output);
  const raw = (tc.output ?? '').trim();
  // Unparseable output: a truncated success still carries `"ok":true`; anything else is the
  // error text the tool threw.
  const error = running ? null
    : out ? (out.ok === false ? firstLine(String(out.error ?? 'failed')) : null)
    : /\\?"ok\\?"\s*:\s*true/.test(raw) ? null
    : firstLine(raw) || 'failed';
  const content = typeof input.content === 'string' ? input.content
    : out && typeof out.content === 'string' ? out.content : null;
  const title = content != null && name ? canvasTitle(content, name) : name;
  let progress: string | null = null;
  if (content != null) {
    const t = checklistTotals(content);
    if (t.total) progress = `${t.done} of ${t.total}${t.failed ? ` · ${t.failed} failed` : ''}`;
  } else if (action === 'list' && out && Array.isArray(out.canvases)) {
    progress = `${out.canvases.length} canvas${out.canvases.length === 1 ? '' : 'es'}`;
  }
  const v = VERB[action] ?? ['Using', 'Used'];
  const verb = running ? v[0] : action === 'write' && out?.created === true ? 'Created' : v[1];
  return { action, verb, name, title, progress, error, running };
}

/**
 * One-line chat card for a `sai_canvas` call. The canvas itself lives in the sidebar, so the
 * transcript only says what happened; clicking shows that canvas there.
 */
export function CanvasToolCard({ tc, onOpenCanvas }: { tc: ToolCall; onOpenCanvas?: (name: string) => void }) {
  const s = summarizeCanvasCall(tc);
  const clickable = !!onOpenCanvas && !!s.name && !s.error && s.action !== 'list';
  const body = (
    <>
      {s.error ? <AlertTriangle size={13} className="canvas-toolcard__icon canvas-toolcard__icon--err" /> : <PanelRight size={13} className="canvas-toolcard__icon" />}
      <span className="canvas-toolcard__verb">{s.verb} canvas</span>
      {s.title && <span className="canvas-toolcard__title">{s.title}</span>}
      {s.progress && <span className="canvas-toolcard__meta">{s.progress}</span>}
      {s.error && <span className="canvas-toolcard__err">{s.error}</span>}
    </>
  );
  const cls = `canvas-toolcard${s.running ? ' sai-shimmer' : ''}${s.error ? ' canvas-toolcard--err' : ''}`;
  return clickable ? (
    <button type="button" className={`${cls} canvas-toolcard--link`} data-testid="canvas-toolcard" title="Show in the canvas sidebar" onClick={() => onOpenCanvas!(s.name!)}>
      {body}
    </button>
  ) : (
    <div className={cls} data-testid="canvas-toolcard">{body}</div>
  );
}
