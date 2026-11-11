import { useState } from 'react';
import type { TaskBoard, TaskCard, TailLine } from './types';
import { batchSummary } from './batchSummary';
import './tasks.css';

export interface TaskTabsProps {
  board: TaskBoard;
  tails: Map<string, TailLine[]>;
  /** null = All */
  activeId: string | null;
  onSelect(id: string | null): void;
  /** Stop the active tab's background task (shown while it runs). */
  onStop?(card: TaskCard): void;
}

/** Per-batch collapse state: `batch` is the board's batchStartedAt it applies to. */
interface BatchView { batch: number | null; open: boolean; dismissed: boolean }

const CLOSED: BatchView = { batch: null, open: false, dismissed: false };

export function TaskTabs({ board, tails, activeId, onSelect, onStop }: TaskTabsProps) {
  // Derived against batchStartedAt so a new batch starts fresh without an effect.
  const [view, setView] = useState<BatchView>(CLOSED);
  const sameBatch = view.batch === board.batchStartedAt;
  const expanded = sameBatch && view.open;
  const dismissed = sameBatch && view.dismissed;

  if (board.cards.length === 0) return null;
  const active = activeId ? board.cards.find((c) => c.id === activeId) ?? null : null;

  // Finished work collapses to one line, then out of the way entirely — the
  // strip sits above the chat, so stale tabs cost the conversation space.
  // Never while a tab is open: that would pull the strip out from under the user.
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
  const tail = active ? (tails.get(active.id) ?? []).slice(-4) : [];
  const canStop = !!active && active.status === 'running' && !!active.agent?.taskId && !!onStop;

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
          const pct = c.totalCount > 0 ? Math.min(100, Math.max(0, (c.doneCount / c.totalCount) * 100)) : 0;
          const isActive = active?.id === c.id;
          return (
            <button
              key={c.id} type="button" role="tab" aria-selected={isActive}
              className={`task-tabs__tab task-status--${c.status}${isActive ? ' task-tabs__tab--active' : ''}`}
              onClick={() => onSelect(c.id)}
            >
              <span className="task-card__dot" aria-hidden="true" />
              <span className="task-tabs__title">{c.title}</span>
              {c.totalCount > 0 && <span className="task-tabs__meta">{c.doneCount}/{c.totalCount}</span>}
              <span className="task-tabs__underline" aria-hidden="true">
                <span className="task-tabs__underline-fill" style={{ width: `${pct}%` }} />
              </span>
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
      {active && (
        <div className="task-tabs__strip">
          {canStop && (
            <button type="button" className="task-card__link task-card__link--stop" onClick={() => onStop?.(active)}>Stop</button>
          )}
          {active.steps.length > 0 && (
            <div className="task-tabs__pills">
              {active.steps.map((s, i) => (
                <span key={i} className={`task-tabs__pill task-tabs__pill--${s.state}`}>{s.label}</span>
              ))}
            </div>
          )}
          {tail.length > 0 && (
            <div className="task-tabs__tail">
              {tail.map((l, i) => (
                <div key={i} className={`task-card__tail-line task-card__tail-line--${l.tone}`}>{l.text}</div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
