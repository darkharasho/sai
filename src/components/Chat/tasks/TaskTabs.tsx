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

/** Tabs the user closed, scoped to the batch they were closed in. */
interface ClosedTabs { batch: number | null; ids: ReadonlySet<string> }
const NONE_CLOSED: ClosedTabs = { batch: null, ids: new Set() };

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
  const [closed, setClosed] = useState<ClosedTabs>(NONE_CLOSED);
  const closedIds = closed.batch === board.batchStartedAt ? closed.ids : NONE_CLOSED.ids;

  if (board.cards.length === 0) return null;
  const cards = board.cards.filter((c) => !closedIds.has(c.id));
  // Every tab closed: nothing left to show for this batch.
  if (cards.length === 0) return null;
  const active = activeId ? cards.find((c) => c.id === activeId) ?? null : null;

  const closeTab = (id: string) => {
    if (activeId === id) onSelect(null);
    setClosed({ batch: board.batchStartedAt, ids: new Set([...closedIds, id]) });
  };

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
        {cards.map((c) => {
          const isActive = active?.id === c.id;
          const finished = c.status === 'done' || c.status === 'failed';
          // A finished tab shows its outcome note instead of its last activity line.
          const sub = finished && c.result ? c.result : c.now;
          return (
            <span
              key={c.id}
              className={`task-tabs__item task-status--${c.status}${isActive ? ' task-tabs__item--active' : ''}`}
            >
              <button
                type="button" role="tab" aria-selected={isActive}
                className={`task-tabs__tab${isActive ? ' task-tabs__tab--active' : ''}`}
                title={finished && c.result ? `${c.title} — ${c.result}` : c.title}
                onClick={() => onSelect(c.id)}
              >
                <span className="task-card__dot" aria-hidden="true" />
                <span className="task-tabs__title">{c.title}</span>
                {sub && <span className="task-tabs__now">{sub}</span>}
              </button>
              <button
                type="button"
                className="task-tabs__close"
                aria-label={`Close ${c.title}`}
                title="Close tab"
                onClick={() => closeTab(c.id)}
              >
                ×
              </button>
            </span>
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
