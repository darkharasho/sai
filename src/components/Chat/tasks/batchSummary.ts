import type { TaskBoard } from './types';
import { formatElapsed } from './TaskCardView';

/**
 * One-line recap of a finished batch, e.g. `3 tasks done · 1m 20s` or
 * `2 done · 1 failed`. Shared by the rail's and the tabs' collapsed state.
 * Returns '' for an empty board.
 */
export function batchSummary(board: TaskBoard): string {
  const n = board?.cards?.length ?? 0;
  if (n === 0) return '';
  const ends = board.cards.map((c) => c.endedAt).filter((x): x is number => typeof x === 'number');
  const dur = ends.length && board.batchStartedAt != null
    ? ` · ${formatElapsed(Math.max(...ends) - board.batchStartedAt)}`
    : '';
  const failed = board.cards.filter((c) => c.status === 'failed').length;
  return failed > 0
    ? `${n - failed} done · ${failed} failed${dur}`
    : `${n} task${n === 1 ? '' : 's'} done${dur}`;
}
