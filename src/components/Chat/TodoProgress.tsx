import { useMemo, useState, useEffect, useRef, useCallback } from 'react';
import type { ChatMessage } from '../../types';
import { Check, X } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
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

const RADIUS = 8;
const CIRCUMFERENCE = 2 * Math.PI * RADIUS;

export default function TodoProgress({ messages, isStreaming }: TodoProgressProps) {
  const todos = useMemo(() => findLatestTodos(messages), [messages]);
  const [dismissed, setDismissed] = useState(false);
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLSpanElement | null>(null);
  const ringTransition = useReducedMotionTransition(SPRING.gentle);
  const popoverTransition = useReducedMotionTransition(SPRING.pop);

  const prevStreamingRef = useRef(isStreaming);
  useEffect(() => {
    if (!prevStreamingRef.current && isStreaming) {
      setDismissed(false);
    }
    prevStreamingRef.current = isStreaming;
  }, [isStreaming]);

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      const target = e.target as Node | null;
      if (target && wrapRef.current?.contains(target)) return;
      setOpen(false);
    };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, [open]);

  const completed = todos ? todos.filter((t) => t.status === 'completed').length : 0;
  const total = todos ? todos.length : 0;

  const handleDismiss = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    setDismissed(true);
    setOpen(false);
  }, []);

  if (!isStreaming || !todos || total === 0 || dismissed || completed === total) return null;

  const inProgress = todos.find((t) => t.status === 'in_progress');
  const activeLabel = inProgress ? (inProgress.activeForm || inProgress.content) : 'Planning…';
  const ratio = total > 0 ? completed / total : 0;
  const dashOffset = CIRCUMFERENCE - ratio * CIRCUMFERENCE;

  return (
    <span
      ref={wrapRef}
      className="todo-ring-wrap"
      data-testid="todo-ring"
      onClick={() => setOpen(o => !o)}
      title={open ? undefined : `${completed}/${total} · ${activeLabel}`}
    >
      <svg className="todo-ring-svg" width="22" height="22" viewBox="0 0 22 22">
        <circle cx="11" cy="11" r={RADIUS} fill="none" stroke="var(--border)" strokeWidth="2.5" />
        <motion.circle
          cx="11" cy="11" r={RADIUS}
          fill="none"
          stroke="var(--green)"
          strokeWidth="2.5"
          strokeDasharray={CIRCUMFERENCE}
          strokeLinecap="round"
          transform="rotate(-90 11 11)"
          animate={{ strokeDashoffset: dashOffset }}
          transition={ringTransition}
        />
      </svg>
      <span className="todo-ring-count">{completed}/{total}</span>

      <AnimatePresence>
        {open && (
          <motion.div
            data-testid="todo-ring-popover"
            className="todo-ring-popover"
            initial={{ opacity: 0, y: 4, scale: 0.96 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 4, scale: 0.96 }}
            transition={popoverTransition}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="todo-ring-popover-header">
              <span className="todo-ring-popover-title">Tasks</span>
              <span className="todo-ring-popover-count">{completed}/{total}</span>
              <button
                data-testid="todo-ring-dismiss"
                className="todo-ring-popover-dismiss"
                onClick={handleDismiss}
                aria-label="Dismiss task progress"
              >
                <X size={12} />
              </button>
            </div>
            <ul className="todo-ring-popover-list">
              {todos.map((t) => {
                const status = t.status === 'completed' ? 'done' : t.status === 'in_progress' ? 'active' : 'pending';
                return (
                  <li
                    key={t.id}
                    data-testid="todo-ring-item"
                    className={`todo-ring-item todo-ring-item--${status}`}
                  >
                    <span className={`todo-ring-status todo-ring-status--${status}`}>
                      {status === 'done' && <Check size={9} strokeWidth={3} />}
                    </span>
                    <span className="todo-ring-text">
                      {status === 'active' ? (t.activeForm || t.content) : t.content}
                    </span>
                  </li>
                );
              })}
            </ul>
          </motion.div>
        )}
      </AnimatePresence>

      <style>{`
        .todo-ring-wrap {
          position: relative;
          display: inline-flex;
          align-items: center;
          gap: 4px;
          padding: 2px 6px 2px 4px;
          border-radius: 5px;
          cursor: pointer;
          transition: background 0.15s;
          color: var(--green);
        }
        .todo-ring-wrap:hover { background: color-mix(in srgb, var(--green) 8%, transparent); }
        .todo-ring-svg { display: block; flex-shrink: 0; }
        .todo-ring-count {
          font-variant-numeric: tabular-nums;
          font-weight: 600;
          font-size: 10px;
          color: var(--green);
        }

        .todo-ring-popover {
          position: absolute;
          bottom: calc(100% + 8px);
          left: 0;
          width: 320px;
          background: var(--bg-secondary);
          border: 1px solid var(--border);
          border-radius: 8px;
          padding: 0;
          box-shadow: 0 6px 24px rgba(0, 0, 0, 0.4);
          z-index: 10;
          color: var(--text);
          cursor: default;
        }
        .todo-ring-popover-header {
          display: flex;
          align-items: center;
          gap: 8px;
          padding: 6px 10px 6px 12px;
          border-bottom: 1px solid var(--border);
          font-size: 11px;
        }
        .todo-ring-popover-title { font-weight: 600; color: var(--text); }
        .todo-ring-popover-count {
          color: var(--text-muted);
          margin-left: auto;
          font-variant-numeric: tabular-nums;
        }
        .todo-ring-popover-dismiss {
          background: none;
          border: none;
          color: var(--text-muted);
          cursor: pointer;
          width: 18px; height: 18px;
          display: flex;
          align-items: center;
          justify-content: center;
          border-radius: 4px;
          transition: color 0.15s, background 0.15s;
        }
        .todo-ring-popover-dismiss:hover {
          color: var(--text);
          background: rgba(255, 255, 255, 0.06);
        }
        .todo-ring-popover-list {
          list-style: none;
          padding: 6px 0;
          margin: 0;
          max-height: 240px;
          overflow-y: auto;
        }
        .todo-ring-item {
          display: flex;
          align-items: flex-start;
          gap: 8px;
          padding: 4px 12px;
          font-size: 12px;
          line-height: 1.45;
          font-family: inherit;
        }
        .todo-ring-status {
          width: 12px;
          height: 12px;
          flex-shrink: 0;
          margin-top: 3px;
          border-radius: 50%;
          border: 1.5px solid var(--text-muted);
          display: flex;
          align-items: center;
          justify-content: center;
        }
        .todo-ring-status--done {
          border-color: var(--green);
          background: color-mix(in srgb, var(--green) 15%, transparent);
          color: var(--green);
        }
        .todo-ring-status--active {
          border-color: var(--green);
          background: color-mix(in srgb, var(--green) 15%, transparent);
          position: relative;
        }
        @media (prefers-reduced-motion: no-preference) {
          @keyframes todo-ring-active-pulse {
            0%, 100% { transform: scale(1); opacity: 0.4; }
            50%      { transform: scale(1.35); opacity: 0; }
          }
          .todo-ring-status--active::after {
            content: '';
            position: absolute;
            inset: -3px;
            border-radius: 50%;
            border: 1.5px solid var(--green);
            animation: todo-ring-active-pulse 1.6s ease-in-out infinite;
          }
        }
        .todo-ring-text { color: var(--text); word-break: break-word; }
        .todo-ring-item--done .todo-ring-text {
          color: var(--text-muted);
          text-decoration: line-through;
          text-decoration-color: color-mix(in srgb, var(--text-muted) 50%, transparent);
        }
        .todo-ring-item--active .todo-ring-text {
          color: var(--text);
          font-weight: 500;
        }
      `}</style>
    </span>
  );
}
