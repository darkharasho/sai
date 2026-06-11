import type { IndicatorState } from './workspaceStatus';

export interface OverlayRow {
  path: string;
  name: string;
  kind: 'project' | 'meta';
  state: IndicatorState;
  /** Last assistant text, pre-truncated by the caller. */
  snippet?: string;
  /** Current tool call line while streaming. */
  toolLine?: string;
}

export interface OverlayPayload {
  hasReportable: boolean;
  /** Every reportable workspace, tails included — the overlay lets the user
   *  pick any of them as the focused conversation. */
  rows: OverlayRow[];
  /** Default focus: the most interesting row. */
  focusPath: string | null;
}

const REPORTABLE: ReadonlySet<IndicatorState> = new Set(['busy', 'busy-done', 'done', 'approval', 'question']);
const FOCUS_PRIORITY: IndicatorState[] = ['question', 'approval', 'busy', 'done'];

/** Pure: derive the focus overlay's content from per-workspace indicator rows.
 *  Strip = every reportable workspace; focus = the single most interesting one
 *  (question > approval > busy > done; busy-done ranks with busy). */
export function buildOverlayPayload(rows: OverlayRow[]): OverlayPayload {
  const reportable = rows.filter(r => REPORTABLE.has(r.state));
  let focus: OverlayRow | null = null;
  for (const want of FOCUS_PRIORITY) {
    const hit = reportable.find(r =>
      r.state === want || (want === 'busy' && r.state === 'busy-done'));
    if (hit) { focus = hit; break; }
  }
  return {
    hasReportable: reportable.length > 0,
    rows: reportable,
    focusPath: focus?.path ?? null,
  };
}
