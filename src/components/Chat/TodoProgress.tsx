import { useMemo } from 'react';
import type { ChatMessage } from '../../types';
import { ListChecks } from 'lucide-react';

interface Todo {
  id: string;
  content: string;
  activeForm?: string;
  status: 'pending' | 'in_progress' | 'completed';
  priority?: string;
}

interface TodoProgressProps {
  messages: ChatMessage[];
  isStreaming: boolean;
}

function findLatestTodos(messages: ChatMessage[]): Todo[] | null {
  // Find the most recent assistant message that has any TodoWrite calls, then
  // within that message return the last write with the maximum todo count.
  // Scoping to the most recent message prevents the bar from getting stuck
  // showing a stale plan from a previous turn when the current turn writes a
  // smaller (or updated) list. Within a single message, preferring the largest
  // write avoids jumping to a transient sub-task write mid-turn.
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i];
    if (m.role !== 'assistant' || !m.toolCalls?.length) continue;
    let best: Todo[] | null = null;
    for (const tc of m.toolCalls) {
      if (tc.name !== 'TodoWrite') continue;
      try {
        const parsed = JSON.parse(tc.input);
        if (Array.isArray(parsed.todos) && parsed.todos.length > 0) {
          const todos = parsed.todos as Todo[];
          // Use >= so we always advance to the last write of the same size,
          // ensuring the most recent update wins when the plan is rewritten.
          if (!best || todos.length >= best.length) {
            best = todos;
          }
        }
      } catch { /* ignore malformed input */ }
    }
    if (best) return best;
  }
  return null;
}

export default function TodoProgress({ messages, isStreaming }: TodoProgressProps) {
  const todos = useMemo(() => findLatestTodos(messages), [messages]);

  if (!isStreaming || !todos || todos.length === 0) return null;

  const completed = todos.filter((t) => t.status === 'completed').length;
  const inProgress = todos.find((t) => t.status === 'in_progress');
  const total = todos.length;
  const percent = total > 0 ? (completed / total) * 100 : 0;
  const activeLabel = inProgress ? (inProgress.activeForm || inProgress.content) : 'Planning…';

  return (
    <div className="todo-progress" role="progressbar" aria-valuemin={0} aria-valuemax={total} aria-valuenow={completed}>
      <span className="todo-progress-icon">
        <ListChecks size={11} />
      </span>
      <span className="todo-progress-count">
        <span className="todo-progress-count-done">{completed}</span>
        <span className="todo-progress-count-sep">/</span>
        <span className="todo-progress-count-total">{total}</span>
      </span>
      <div className="todo-progress-track">
        <div
          className={`todo-progress-fill${inProgress ? ' todo-progress-fill--active' : ''}`}
          style={{ width: `${percent}%` }}
        />
      </div>
      <span className="todo-progress-active-text" title={activeLabel}>{activeLabel}</span>
      <style>{`
        @keyframes todo-progress-slide-in {
          from { opacity: 0; transform: translateY(3px); }
          to { opacity: 1; transform: translateY(0); }
        }
        @keyframes todo-progress-shimmer {
          0% { transform: translateX(-100%); }
          100% { transform: translateX(250%); }
        }
        .todo-progress {
          display: flex;
          align-items: center;
          gap: 8px;
          padding: 4px 10px;
          margin: 0 15% 4px;
          background: rgba(199, 145, 12, 0.04);
          border: 1px solid rgba(199, 145, 12, 0.1);
          border-radius: 7px;
          animation: todo-progress-slide-in 0.2s ease-out both;
          flex-shrink: 0;
          font-size: 11px;
          height: 22px;
        }
        .todo-progress-icon {
          display: flex;
          align-items: center;
          color: var(--accent);
          opacity: 0.7;
          flex-shrink: 0;
        }
        .todo-progress-count {
          display: inline-flex;
          align-items: baseline;
          font-variant-numeric: tabular-nums;
          font-weight: 600;
          font-size: 10.5px;
          flex-shrink: 0;
        }
        .todo-progress-count-done {
          color: var(--accent);
        }
        .todo-progress-count-sep {
          color: var(--text-muted);
          opacity: 0.35;
          margin: 0 1px;
        }
        .todo-progress-count-total {
          color: var(--text-muted);
          opacity: 0.65;
        }
        .todo-progress-track {
          position: relative;
          flex: 0 0 80px;
          height: 3px;
          background: rgba(199, 145, 12, 0.08);
          border-radius: 2px;
          overflow: hidden;
        }
        .todo-progress-fill {
          position: relative;
          height: 100%;
          background: linear-gradient(90deg, var(--accent) 0%, var(--accent-hover, var(--accent)) 100%);
          border-radius: 2px;
          transition: width 0.5s cubic-bezier(0.4, 0, 0.2, 1);
          box-shadow: 0 0 4px rgba(199, 145, 12, 0.3);
        }
        .todo-progress-fill--active::after {
          content: '';
          position: absolute;
          top: 0;
          left: 0;
          width: 40%;
          height: 100%;
          background: linear-gradient(90deg, transparent, rgba(255, 255, 255, 0.35), transparent);
          animation: todo-progress-shimmer 1.6s ease-in-out infinite;
        }
        .todo-progress-active-text {
          flex: 1;
          min-width: 0;
          overflow: hidden;
          white-space: nowrap;
          text-overflow: ellipsis;
          color: var(--text-muted);
          opacity: 0.8;
          letter-spacing: 0.01em;
          font-size: 11px;
        }
      `}</style>
    </div>
  );
}
