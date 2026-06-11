import type { IndicatorState } from './workspaceStatus';

export interface OverlayRow {
  path: string;
  name: string;
  kind: 'project' | 'meta';
  state: IndicatorState;
  /** Chronological tail of the conversation: text segments interleaved with
   *  tool calls exactly as they happened (latest last). */
  tail?: OverlayTailItem[];
}

export type OverlayTailItem =
  | { kind: 'text'; text: string }
  | { kind: 'tool'; name: string; done: boolean }
  | { kind: 'elided'; count: number };

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

/** Overlay-local done tracking. In-app, `completedWorkspaces` deliberately
 *  excludes the focused workspace (you're looking at it) — but the overlay
 *  exists precisely while you are NOT looking, so it derives done itself: a
 *  workspace that was busy and stopped is done until it starts again (the
 *  caller clears the set when the main window regains focus). Mutates and
 *  returns `recentDone`. busyWorkspaces is turn-scoped (not the streamSettled
 *  debounce), so stop transitions here are real turn ends. */
export function updateRecentDone(
  recentDone: Set<string>,
  prevBusy: ReadonlySet<string>,
  currentBusy: ReadonlySet<string>,
): Set<string> {
  for (const path of prevBusy) {
    if (!currentBusy.has(path)) recentDone.add(path);
  }
  for (const path of currentBusy) {
    recentDone.delete(path);
  }
  return recentDone;
}
