import { useMemo, useState, useEffect, useRef } from 'react';
import type { ChatMessage } from '../../types';
import { ListChecks, X } from 'lucide-react';
import { motion } from 'motion/react';
import { SPRING, useReducedMotionTransition } from './motion';

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
  // Only search messages belonging to the current turn (after the last user
  // message). This prevents stale todos from a previous turn from showing up
  // at the start of a new turn, and ensures status updates in the current turn
  // are always reflected.
  let turnStart = -1;
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i].role === 'user') { turnStart = i; break; }
  }

  // Find the most recent assistant message in the current turn that has any
  // TodoWrite calls. Within that message, return the last write with the
  // maximum todo count — this avoids jumping to a transient sub-task write
  // that was emitted in the same content block as the main plan write.
  for (let i = messages.length - 1; i > turnStart; i--) {
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
  const [dismissed, setDismissed] = useState(false);
  const fillTransition = useReducedMotionTransition(SPRING.gentle);

  // Reset dismissed state when a new streaming turn begins.
  const prevStreamingRef = useRef(isStreaming);
  useEffect(() => {
    if (!prevStreamingRef.current && isStreaming) {
      setDismissed(false);
    }
    prevStreamingRef.current = isStreaming;
  }, [isStreaming]);

  const completed = todos ? todos.filter((t) => t.status === 'completed').length : 0;
  const total = todos ? todos.length : 0;

  // Hide when: not streaming, no todos, dismissed, or all tasks complete.
  if (!isStreaming || !todos || total === 0 || dismissed || completed === total) return null;

  const inProgress = todos.find((t) => t.status === 'in_progress');
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
        <motion.div
          data-testid="todo-progress-fill"
          data-transition={JSON.stringify(fillTransition)}
          className={`todo-progress-fill${inProgress ? ' todo-progress-fill--active' : ''}`}
          animate={{ width: `${percent}%` }}
          transition={fillTransition}
        />
      </div>
      <span className="todo-progress-active-text" title={activeLabel}>{activeLabel}</span>
      <button
        className="todo-progress-dismiss"
        onClick={() => setDismissed(true)}
        aria-label="Dismiss todo progress"
      >
        <X size={10} />
      </button>
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
        .todo-progress-dismiss {
          display: flex;
          align-items: center;
          justify-content: center;
          flex-shrink: 0;
          width: 14px;
          height: 14px;
          padding: 0;
          margin-left: 2px;
          background: none;
          border: none;
          border-radius: 3px;
          color: var(--text-muted);
          opacity: 0.4;
          cursor: pointer;
          transition: opacity 0.15s, background 0.15s;
        }
        .todo-progress-dismiss:hover {
          opacity: 0.8;
          background: rgba(255, 255, 255, 0.08);
        }
      `}</style>
    </div>
  );
}
