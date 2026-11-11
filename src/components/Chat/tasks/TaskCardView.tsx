import type { TaskCard, TailLine } from './types';
import './tasks.css';

export interface TaskCardViewProps {
  card: TaskCard;
  tail: TailLine[];
  selected: boolean;
  /** Current time, used for elapsed while running. */
  now?: number;
  onSelect(id: string): void;
  onOpenStream(id: string): void;
  onStop?(card: TaskCard): void;
  onAnswer?(option: string): void;
  onReply?(): void;
}

export function formatElapsed(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return s % 60 ? `${m}m ${s % 60}s` : `${m}m`;
  const h = Math.floor(m / 60);
  return `${h}h ${m % 60}m`;
}

function elapsedOf(card: TaskCard, now: number): string | null {
  if (card.startedAt == null) return null;
  return formatElapsed((card.endedAt ?? now) - card.startedAt);
}

const STEP_GLYPH = { done: '✓', current: '●', pending: '○' } as const;

export function TaskCardView({
  card, tail, selected, now = Date.now(), onSelect, onOpenStream, onStop, onAnswer, onReply,
}: TaskCardViewProps) {
  const total = card.totalCount;
  const pct = total > 0 ? Math.min(100, Math.max(0, (card.doneCount / total) * 100)) : 0;
  const elapsed = elapsedOf(card, now);
  const meta = [total > 0 ? `${card.doneCount}/${total}` : null, elapsed].filter(Boolean).join(' · ');
  const status =
    card.status === 'waiting' ? 'Waiting on you'
    : card.status === 'paused' ? 'Paused'
    : card.status === 'done' ? `Done${card.result ? `: ${card.result}` : ''}`
    : card.status === 'failed' ? (card.result ? `Failed: ${card.result}` : 'Failed')
    : card.currentLabel;
  const tailLines = card.status === 'running' ? tail.slice(-4) : card.status === 'done' ? tail.slice(-1) : [];
  const canStop = selected && card.status === 'running' && !!card.agent?.taskId && !!onStop;

  return (
    <div
      className={`task-card task-card--${card.status} task-status--${card.status}${selected ? ' task-card--selected' : ''}`}
      data-testid={`task-card-${card.id}`}
    >
      <div
        className="task-card__main"
        role="button"
        tabIndex={0}
        aria-pressed={selected}
        onClick={() => onSelect(card.id)}
        onKeyDown={(e) => {
          if (e.target !== e.currentTarget) return;
          if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onSelect(card.id); }
        }}
      >
        <div className="task-card__header">
          <span className="task-card__dot" aria-hidden="true" />
          <span className="task-card__title">{card.title}</span>
          {meta && <span className="task-card__meta">{meta}</span>}
        </div>
        {status && <div className="task-card__status">{status}</div>}
        <div className={`task-card__bar${total === 0 ? ' task-card__bar--indeterminate' : ''}`}>
          <div className="task-card__bar-fill" style={total > 0 ? { width: `${pct}%` } : undefined} />
        </div>
        {selected && card.steps.length > 0 && (
          <ul className="task-card__steps">
            {card.steps.map((s, i) => (
              <li key={i} className={`task-card__step task-card__step--${s.state}`}>
                <span className="task-card__step-glyph" aria-hidden="true">{STEP_GLYPH[s.state]}</span>
                {s.label}
              </li>
            ))}
          </ul>
        )}
        {tailLines.length > 0 && (
          <div className="task-card__tail">
            {tailLines.map((l, i) => (
              <div key={i} className={`task-card__tail-line task-card__tail-line--${l.tone}`}>{l.text}</div>
            ))}
          </div>
        )}
      </div>
      {card.status === 'waiting' && card.question && (
        <div className="task-card__question">
          {card.question.text && <div className="task-card__question-text">{card.question.text}</div>}
          <div className="task-card__options">
            {card.question.options.map((o) => (
              <button key={o} type="button" className="task-card__btn" onClick={() => onAnswer?.(o)}>{o}</button>
            ))}
            <button type="button" className="task-card__btn" onClick={() => onReply?.()}>Reply…</button>
          </div>
        </div>
      )}
      {selected && (
        <div className="task-card__footer">
          <button type="button" className="task-card__link" onClick={() => onOpenStream(card.id)}>Open stream →</button>
          {canStop && (
            <button type="button" className="task-card__link task-card__link--stop" onClick={() => onStop?.(card)}>Stop</button>
          )}
        </div>
      )}
    </div>
  );
}
