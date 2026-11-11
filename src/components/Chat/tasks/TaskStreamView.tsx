import { useEffect, useLayoutEffect, useRef } from 'react';
import type { ReactNode } from 'react';
import type { ChatMessage } from '../../../types';
import type { TaskCard } from './types';
import './tasks.css';

export interface TaskStreamViewProps {
  card: TaskCard;
  /** null = transcript unavailable */
  messages: ChatMessage[] | null;
  onBack(): void;
  renderMessage(m: ChatMessage): ReactNode;
}

const STICK_THRESHOLD_PX = 48;

export function TaskStreamView({ card, messages, onBack, renderMessage }: TaskStreamViewProps) {
  const bodyRef = useRef<HTMLDivElement>(null);
  const stickRef = useRef(true);
  const count = messages?.length ?? 0;

  useEffect(() => {
    const el = bodyRef.current;
    if (!el) return;
    const onScroll = () => {
      stickRef.current = el.scrollHeight - el.scrollTop - el.clientHeight <= STICK_THRESHOLD_PX;
    };
    el.addEventListener('scroll', onScroll);
    return () => el.removeEventListener('scroll', onScroll);
  }, []);

  useLayoutEffect(() => {
    const el = bodyRef.current;
    if (el && stickRef.current) el.scrollTop = el.scrollHeight;
  }, [count]);

  return (
    <div className={`task-stream task-card--${card.status}`} data-testid="task-stream">
      <div className="task-stream__header">
        <button type="button" className="task-stream__back" onClick={onBack}>← All</button>
        <span className="task-card__dot" aria-hidden="true" />
        <span className="task-stream__title">{card.title}</span>
        {card.totalCount > 0 && (
          <span className="task-stream__meta">{card.doneCount}/{card.totalCount}</span>
        )}
      </div>
      <div className="task-stream__body" ref={bodyRef}>
        {messages === null ? (
          <div className="task-stream__empty">Transcript unavailable</div>
        ) : messages.length === 0 ? (
          <div className="task-stream__empty">No activity yet</div>
        ) : (
          messages.map((m) => <div key={m.id} className="task-stream__message">{renderMessage(m)}</div>)
        )}
      </div>
    </div>
  );
}
