import type { IndicatorState } from './workspaceStatus';

export interface OverlayRow {
  path: string;
  name: string;
  kind: 'project' | 'meta';
  state: IndicatorState;
  /** Chronological tail of the conversation: text segments interleaved with
   *  tool calls exactly as they happened (latest last). */
  tail?: OverlayTailItem[];
  /** Task-list progress when the conversation has an active plan. */
  todos?: { done: number; total: number };
}

export type OverlayTailItem =
  | { kind: 'text'; text: string }
  | { kind: 'user'; text: string }
  | { kind: 'tool'; name: string; done: boolean; detail?: string }
  | { kind: 'elided'; count: number };

export interface OverlayPayload {
  hasReportable: boolean;
  /** Every reportable workspace, tails included — the overlay lets the user
   *  pick any of them as the focused conversation. */
  rows: OverlayRow[];
  /** Default focus: the most interesting row. */
  focusPath: string | null;
}

/** Trim a chat snippet to `max` chars for the overlay tail, cutting at the
 *  last word/line break so markdown tokens aren't split mid-word (a raw
 *  "**Re" tail renders as literal asterisks). Falls back to a hard cut when
 *  the only break sits in the first half of the budget (one giant token). */
export function truncateSnippet(text: string, max: number): string {
  if (text.length <= max) return text;
  const cut = text.slice(0, max);
  const lastBreak = Math.max(cut.lastIndexOf(' '), cut.lastIndexOf('\n'));
  const kept = lastBreak > max / 2 ? cut.slice(0, lastBreak) : cut;
  return `${kept.trimEnd()}…`;
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
  inAppCompleted: ReadonlySet<string> = new Set(),
): Set<string> {
  for (const path of prevBusy) {
    if (!currentBusy.has(path)) recentDone.add(path);
  }
  for (const path of currentBusy) {
    recentDone.delete(path);
  }
  // Hand off to in-app unread tracking: once completedWorkspaces has a path
  // (background workspaces, ~300ms after the turn ends), the in-app clear —
  // the user reading it on desktop — must clear the overlay too. recentDone
  // only needs to cover what in-app tracking never will: the focused
  // workspace (cleared by the caller on window focus).
  for (const path of inAppCompleted) {
    recentDone.delete(path);
  }
  return recentDone;
}
