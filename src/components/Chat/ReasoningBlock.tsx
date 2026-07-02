import { useEffect, useRef, useState } from 'react';
import { Sparkles } from 'lucide-react';

interface Props {
  text: string;
  /** Still streaming: shimmer header, live timer, auto-following peek window. */
  live?: boolean;
  /** Live but yielding: a running tool card is the working signal, so the
   *  shimmer/spark animations rest while the card keeps its live layout. */
  quiet?: boolean;
  /** When the reasoning row was created — drives the live elapsed timer so it
   *  survives remounts (workspace/chat swaps) without resetting to zero. */
  startedAt?: number;
  /** How long the model thought, captured at finalize. Absent for pre-existing
   *  history rows, which fall back to the plain "Reasoning" label. */
  durationMs?: number;
  /** Estimated thinking-token count (SDK thinking_tokens signal). */
  tokens?: number;
}

function formatDuration(ms: number): string {
  const sec = Math.round(ms / 1000);
  if (sec < 60) return `${Math.max(sec, 1)}s`;
  return `${Math.floor(sec / 60)}m ${sec % 60}s`;
}

function formatTokens(n: number): string {
  return n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n);
}

/**
 * The reasoning transcript row. While the model thinks it renders as a live
 * card: shimmering "Reasoning" label (the same working signal as a running
 * tool card — no bespoke spinner), running timer and a three-line "peek"
 * window where new words fade in and older lines scroll up
 * under a gradient mask. Once finalized it settles into a quiet one-line
 * "Thought for Ns" card whose header toggles an expandable panel.
 */
export default function ReasoningBlock({ text, live, quiet, startedAt, durationMs, tokens }: Props) {
  const [open, setOpen] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [peekOverflows, setPeekOverflows] = useState(false);
  const peekRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!live) return;
    const base = startedAt ?? Date.now();
    const tick = () => setElapsed(Date.now() - base);
    tick();
    const t = setInterval(tick, 100);
    return () => clearInterval(t);
  }, [live, startedAt]);

  // Keep the peek window pinned to the newest thought as text streams in, and
  // only mask the top edge once older lines actually scroll under it — while
  // the peek is still growing the first lines should read at full strength.
  useEffect(() => {
    if (!live) return;
    const el = peekRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
    setPeekOverflows(el.scrollHeight > el.clientHeight + 1);
  }, [live, text]);

  const label = live
    ? 'Reasoning'
    : typeof durationMs === 'number'
      ? `Thought for ${formatDuration(durationMs)}`
      : 'Reasoning';

  return (
    <div
      className={`rsn${live ? ' rsn--live' : ''}${live && quiet ? ' rsn--quiet' : ''}${open ? ' rsn--open' : ''}`}
      data-testid={live ? 'msg-reasoning-live' : 'msg-reasoning'}
      data-quiet={live && quiet ? 'true' : undefined}
    >
      <div
        className="rsn-head"
        role={live ? undefined : 'button'}
        tabIndex={live ? undefined : 0}
        onClick={live ? undefined : () => setOpen(o => !o)}
        onKeyDown={live ? undefined : (e) => {
          if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setOpen(o => !o); }
        }}
      >
        <Sparkles size={14} className="rsn-spark" />
        <span className={`rsn-label${live && !quiet ? ' sai-shimmer' : ''}`}>{label}</span>
        {live ? (
          <span className="rsn-time">
            {typeof tokens === 'number' && tokens > 0 ? `${formatTokens(tokens)} tokens · ` : ''}
            {(elapsed / 1000).toFixed(1)}s
          </span>
        ) : (
          <>
            {typeof tokens === 'number' && tokens > 0 && (
              <span className="rsn-tokens">{formatTokens(tokens)} tokens</span>
            )}
            <span className="rsn-chev">›</span>
          </>
        )}
      </div>
      {live && (
        <div className={`rsn-peek${peekOverflows ? ' rsn-peek--masked' : ''}`} ref={peekRef}>
          <div className="rsn-peek-text">
            {text.split(/(\s+)/).map((part, i) =>
              /^\s+$/.test(part) ? part : <span key={i} className="rsn-w">{part}</span>
            )}
          </div>
        </div>
      )}
      {!live && open && (
        <div className="rsn-body">{text}</div>
      )}
      <style>{`
        .rsn {
          /* Full width to line up flush with the tool-call cards below it. */
          margin: 0 0 10px;
          border: 1px solid var(--border-hairline);
          border-radius: 8px;
          background: var(--surface-2);
          overflow: hidden;
          transition: border-color .25s ease;
        }
        .rsn--live { border-color: color-mix(in srgb, var(--accent) 22%, transparent); }
        .rsn-head {
          display: flex;
          align-items: center;
          gap: 8px;
          padding: 8px 14px;
          user-select: none;
        }
        .rsn:not(.rsn--live) .rsn-head { cursor: pointer; }
        .rsn:not(.rsn--live) .rsn-head:hover { background: var(--surface-3); }
        .rsn-spark { color: var(--text-muted); flex-shrink: 0; }
        .rsn--live .rsn-spark { color: var(--accent); }
        /* Quiet: a running tool card owns the working signal, so the spark
           dims while the card keeps its live layout. */
        .rsn--quiet .rsn-spark { color: var(--text-muted); }
        .rsn-label { font-size: 13px; font-weight: 600; }
        /* Only color the label when the shimmer isn't driving it — this style
           tag loads after globals.css, so an unconditional color here would
           override .sai-shimmer's transparent text and hide the gradient. */
        .rsn-label:not(.sai-shimmer) { color: var(--text-secondary); }
        .rsn-time {
          margin-left: auto;
          font-family: 'Geist Mono', monospace;
          font-size: 11px;
          color: color-mix(in srgb, var(--accent) 75%, transparent);
        }
        .rsn-tokens {
          margin-left: auto;
          font-family: 'Geist Mono', monospace;
          font-size: 11px;
          color: var(--text-muted);
        }
        .rsn-tokens + .rsn-chev { margin-left: 8px; }
        .rsn-chev {
          margin-left: auto;
          color: var(--text-muted);
          font-size: 13px;
          line-height: 1;
          transition: transform .25s var(--ease-out-soft);
        }
        .rsn--open .rsn-chev { transform: rotate(90deg); }
        .rsn-peek {
          position: relative;
          /* Grows naturally with the streamed text up to ~10 lines, then the
             newest lines stay pinned (auto-scroll) under the gradient mask. */
          max-height: 220px;
          overflow: hidden;
          padding: 0 14px 10px 34px;
        }
        .rsn-peek--masked {
          -webkit-mask-image: linear-gradient(180deg, transparent 0, #000 30px);
          mask-image: linear-gradient(180deg, transparent 0, #000 30px);
        }
        .rsn-peek-text {
          font-size: 13px;
          line-height: 1.6;
          color: var(--text-muted);
          white-space: pre-wrap;
          word-break: break-word;
        }
        .rsn-w {
          display: inline-block;
          animation: rsn-w-in .35s var(--ease-out-soft) both;
        }
        @keyframes rsn-w-in {
          from { opacity: 0; filter: blur(2px); transform: translateY(3px); }
          to { opacity: 1; filter: blur(0); transform: none; }
        }
        .rsn-body {
          position: relative;
          padding: 2px 16px 14px 34px;
          font-size: 13px;
          line-height: 1.6;
          color: var(--text-secondary);
          white-space: pre-wrap;
          word-break: break-word;
          animation: rsn-body-in .28s var(--ease-out-soft);
        }
        .rsn-body::before {
          content: '';
          position: absolute;
          left: 17px;
          top: 6px;
          bottom: 12px;
          width: 2px;
          border-radius: 2px;
          background: linear-gradient(
            180deg,
            color-mix(in srgb, var(--accent) 50%, transparent),
            color-mix(in srgb, var(--accent) 6%, transparent)
          );
        }
        @keyframes rsn-body-in {
          from { opacity: 0; transform: translateY(-4px); }
          to { opacity: 1; transform: none; }
        }
        @media (prefers-reduced-motion: reduce) {
          .rsn-w { animation: none; }
          .rsn-body { animation: none; }
          .rsn-chev { transition: none; }
        }
      `}</style>
    </div>
  );
}
