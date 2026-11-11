import type { TaskBoard, TailLine } from './types';
import './tasks.css';

export interface TaskTabsProps {
  board: TaskBoard;
  tails: Map<string, TailLine[]>;
  /** null = All */
  activeId: string | null;
  onSelect(id: string | null): void;
}

export function TaskTabs({ board, tails, activeId, onSelect }: TaskTabsProps) {
  if (board.cards.length === 0) return null;
  const active = activeId ? board.cards.find((c) => c.id === activeId) ?? null : null;
  const tail = active ? (tails.get(active.id) ?? []).slice(-4) : [];

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
              className={`task-tabs__tab task-card--${c.status}${isActive ? ' task-tabs__tab--active' : ''}`}
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
      </div>
      {active && (
        <div className="task-tabs__strip">
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
