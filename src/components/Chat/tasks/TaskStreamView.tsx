import { useEffect, useLayoutEffect, useRef } from 'react';
import type { ReactNode } from 'react';
import type { ChatMessage } from '../../../types';
import type { TaskCard } from './types';
import type { StreamFallback } from './useTaskBoard';
import { formatElapsed } from './TaskCardView';
import './tasks.css';

export interface TaskStreamViewProps {
  card: TaskCard;
  /** null = nothing to stream; `fallback` says why. */
  messages: ChatMessage[] | null;
  /** Shown in place of the stream when `messages` is null. */
  fallback?: StreamFallback | null;
  onBack(): void;
  renderMessage(m: ChatMessage): ReactNode;
  /** Stop this card's background task (shown while it runs). */
  onStop?(card: TaskCard): void;
}

const STICK_THRESHOLD_PX = 48;

const REASON_TEXT: Record<StreamFallback['reason'], string> = {
  shell: 'This is a shell command running in the background — it has no transcript. Its output arrives in the chat when it reports back.',
  'no-agent': 'This task does not write a transcript. Only Agent subagents keep one.',
  missing: 'This task finished without leaving a transcript on disk.',
};

/** Status panel shown instead of a stream: better than a dead end when there is no transcript. */
function StreamFallbackView({ card, fallback }: { card: TaskCard; fallback: StreamFallback }) {
  const d = fallback.detail;
  const started = card.startedAt ?? d?.startedAt ?? null;
  const ended = card.endedAt ?? d?.endedAt ?? null;
  const rows: Array<[string, string]> = [];
  if (d?.kind) rows.push(['Kind', d.kind]);
  rows.push(['Status', d?.status ?? card.status]);
  if (started != null) rows.push(['Elapsed', formatElapsed((ended ?? Date.now()) - started)]);
  if (typeof d?.toolUses === 'number') rows.push(['Tool uses', String(d.toolUses)]);
  if (d?.lastToolName) rows.push(['Last tool', d.lastToolName]);
  if (typeof d?.totalTokens === 'number') rows.push(['Tokens', d.totalTokens.toLocaleString()]);
  const note = d?.error || d?.summary || card.result;

  return (
    <div className="task-stream__fallback" data-testid="task-stream-fallback" data-reason={fallback.reason}>
      <div className="task-stream__fallback-why">{REASON_TEXT[fallback.reason]}</div>
      <dl className="task-stream__facts">
        {rows.map(([k, v]) => (
          <div key={k} className="task-stream__fact">
            <dt>{k}</dt>
            <dd>{v}</dd>
          </div>
        ))}
      </dl>
      {note && <div className={`task-stream__fallback-note${d?.error ? ' task-stream__fallback-note--error' : ''}`}>{note}</div>}
    </div>
  );
}

export function TaskStreamView({ card, messages, fallback, onBack, renderMessage, onStop }: TaskStreamViewProps) {
  const bodyRef = useRef<HTMLDivElement>(null);
  const stickRef = useRef(true);
  const count = messages?.length ?? 0;
  const last = messages && messages.length > 0 ? messages[messages.length - 1] : null;
  const lastLen = last && typeof last.content === 'string' ? last.content.length : 0;
  const lastCardId = useRef(card.id);

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
    if (lastCardId.current !== card.id) {
      lastCardId.current = card.id;
      stickRef.current = true;
    }
    if (el && stickRef.current) el.scrollTop = el.scrollHeight;
  }, [card.id, count, lastLen]);

  return (
    <div className={`task-stream task-status--${card.status}`} data-testid="task-stream">
      <div className="task-stream__header">
        <button type="button" className="task-stream__back" onClick={onBack}>← All</button>
        <span className="task-card__dot" aria-hidden="true" />
        <span className="task-stream__title">{card.title}</span>
        {card.totalCount > 0 && (
          <span className="task-stream__meta">{card.doneCount}/{card.totalCount}</span>
        )}
        {onStop && card.status === 'running' && !!card.agent?.taskId && (
          <button type="button" className="task-card__link task-card__link--stop" onClick={() => onStop(card)}>Stop</button>
        )}
      </div>
      <div className="task-stream__body" ref={bodyRef}>
        {messages === null ? (
          fallback
            ? <StreamFallbackView card={card} fallback={fallback} />
            : <div className="task-stream__empty">Transcript unavailable</div>
        ) : messages.length === 0 ? (
          <div className="task-stream__empty">
            {card.status === 'running' ? 'Waiting for the first activity…' : 'No activity yet'}
          </div>
        ) : (
          messages.map((m) => <div key={m.id} className="task-stream__message">{renderMessage(m)}</div>)
        )}
      </div>
    </div>
  );
}
