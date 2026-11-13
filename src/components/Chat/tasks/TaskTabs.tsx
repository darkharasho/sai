import { useState } from 'react';
import type { TaskBoard } from './types';
import { batchSummary } from './batchSummary';
import './tasks.css';

/** Host-provided mount point inside the Chat accordion bar. */
export const TASK_TABS_SLOT_ID = 'chat-task-tabs-slot';

export interface TaskTabsProps {
  board: TaskBoard;
  /** null = All */
  activeId: string | null;
  onSelect(id: string | null): void;
}

/** Per-batch collapse state: `batch` is the board's batchStartedAt it applies to. */
interface BatchView { batch: number | null; open: boolean; dismissed: boolean }

const CLOSED: BatchView = { batch: null, open: false, dismissed: false };

/**
 * A row of task tabs. Rendered into the Chat accordion bar (ChatPanel portals
 * it there) so running tasks never cost the conversation a second bar. Each
 * tab carries its status dot, title and one-line "now" label.
 */
export function TaskTabs({ board, activeId, onSelect }: TaskTabsProps) {
  // Derived against batchStartedAt so a new batch starts fresh without an effect.
  const [view, setView] = useState<BatchView>(CLOSED);
  const sameBatch = view.batch === board.batchStartedAt;
  const expanded = sameBatch && view.open;
  const dismissed = sameBatch && view.dismissed;

  if (board.cards.length === 0) return null;
  const active = activeId ? board.cards.find((c) => c.id === activeId) ?? null : null;

  // Finished work collapses to one line, then out of the way entirely, so
  // stale tabs stop crowding the bar's label and actions.
  // Never while a tab is open: that would pull the tabs out from under the user.
  if (board.allDone && active === null && !expanded) {
    if (dismissed) return null;
    return (
      <div className="task-tabs task-tabs--collapsed">
        <button
          type="button"
          className="task-tabs__summary"
          aria-expanded={false}
          onClick={() => setView({ batch: board.batchStartedAt, open: true, dismissed: false })}
        >
          {batchSummary(board)}
        </button>
        <button
          type="button"
          className="task-tabs__dismiss"
          aria-label="Dismiss finished tasks"
          title="Dismiss finished tasks"
          onClick={() => setView({ batch: board.batchStartedAt, open: false, dismissed: true })}
        >
          ×
        </button>
      </div>
    );
  }
  return (
    <div className="task-tabs">
      <div className="task-tabs__list" role="tablist">
        <button
          type="button" role="tab" aria-selected={active === null}
          className={`task-tabs__tab${active === null ? ' task-tabs__tab--active' : ''}`}
          onClick={() => onSelect(null)}
        >
          All
        </button>
        {board.cards.map((c) => {
          const isActive = active?.id === c.id;
          return (
            <button
              key={c.id} type="button" role="tab" aria-selected={isActive}
              className={`task-tabs__tab task-status--${c.status}${isActive ? ' task-tabs__tab--active' : ''}`}
              onClick={() => onSelect(c.id)}
            >
              <span className="task-card__dot" aria-hidden="true" />
              <span className="task-tabs__title">{c.title}</span>
              {c.now && <span className="task-tabs__now">{c.now}</span>}
            </button>
          );
        })}
        {board.allDone && (
          <button
            type="button"
            className="task-tabs__collapse"
            aria-label="Collapse finished tasks"
            title="Collapse finished tasks"
            onClick={() => {
              onSelect(null); // an open tab would keep the strip expanded
              setView({ batch: board.batchStartedAt, open: false, dismissed: false });
            }}
          >
            ⌃
          </button>
        )}
      </div>
    </div>
  );
}
