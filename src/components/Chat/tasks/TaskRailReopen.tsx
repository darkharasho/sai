import type { TaskCard } from './types';
import './tasks.css';

export interface TaskRailReopenProps {
  /** Cards on the board — the point of the chip is that work is still there. */
  count: number;
  /** Worst-first board status, so a hidden rail still signals "waiting on you". */
  status: TaskCard['status'];
  onShow(): void;
}

/**
 * Shown in the Chat bar while the rail is hidden. Without it, dismissing the
 * rail would be one-way: the tasks keep running with nothing left to click.
 */
export function TaskRailReopen({ count, status, onShow }: TaskRailReopenProps) {
  return (
    <div className={`task-tabs task-status--${status}`}>
      <button type="button" className="task-rail-reopen" onClick={onShow} title="Show the task rail">
        <span className="task-card__dot" aria-hidden="true" />
        {count} {count === 1 ? 'task' : 'tasks'}
        <span className="task-rail-reopen__icon" aria-hidden="true">⟨</span>
      </button>
    </div>
  );
}
