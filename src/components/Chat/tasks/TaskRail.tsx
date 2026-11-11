import { useEffect, useState } from 'react';
import type { TaskBoard, TaskCard, TailLine } from './types';
import { TaskCardView } from './TaskCardView';
import { batchSummary } from './batchSummary';
import './tasks.css';

export interface TaskRailProps {
  board: TaskBoard;
  tails: Map<string, TailLine[]>;
  selectedId: string | null;
  onSelect(id: string): void;
  onOpenStream(id: string): void;
  onStop(card: TaskCard): void;
  onAnswer(option: string): void;
  onReply(): void;
}

const NO_TAIL: TailLine[] = [];

export function TaskRail({ board, tails, selectedId, onSelect, onOpenStream, onStop, onAnswer, onReply }: TaskRailProps) {
  const [now, setNow] = useState(() => Date.now());
  const [exp, setExp] = useState<{ batch: number | null; open: boolean }>({ batch: null, open: false });
  // Derived so a new batch is collapsed again without an effect.
  const expanded = exp.batch === board.batchStartedAt && exp.open;
  const anyRunning = board.cards.some((c) => c.status === 'running');

  useEffect(() => {
    if (!anyRunning) return;
    setNow(Date.now());
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [anyRunning]);

  const n = board.cards.length;
  if (n === 0) return null;

  const doneCount = board.cards.filter((c) => c.status === 'done').length;
  const collapsed = board.allDone && !expanded;

  const summary = board.allDone ? batchSummary(board) : '';

  return (
    <aside className="task-rail" aria-label="Tasks">
      {board.allDone ? (
        <button type="button" className="task-rail__summary" aria-expanded={!collapsed} onClick={() => setExp({ batch: board.batchStartedAt, open: !expanded })}>
          {summary}
        </button>
      ) : (
        <div className="task-rail__header">
          <span className="task-rail__title">Tasks</span>
          <span className="task-rail__count">{doneCount} of {n} done</span>
        </div>
      )}
      {!collapsed && (
        <div className="task-rail__cards">
          {board.cards.map((c) => (
            <TaskCardView
              key={c.id}
              card={c}
              tail={tails.get(c.id) ?? NO_TAIL}
              selected={c.id === selectedId}
              now={now}
              onSelect={onSelect}
              onOpenStream={onOpenStream}
              onStop={onStop}
              onAnswer={onAnswer}
              onReply={onReply}
            />
          ))}
        </div>
      )}
    </aside>
  );
}
