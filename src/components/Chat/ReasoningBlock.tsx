import { useEffect, useRef, useState } from 'react';
import { Sparkles } from 'lucide-react';

interface Props {
  text: string;
  /** Still streaming: shimmer header, live timer, auto-following peek window. */
  live?: boolean;
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
 * card: slow-spinning spark, shimmering "Reasoning" label, running timer and a
 * three-line "peek" window where new words fade in and older lines scroll up
 * under a gradient mask. Once finalized it settles into a quiet one-line
 * "Thought for Ns" card whose header toggles an expandable panel.
 */
export default function ReasoningBlock({ text, live, startedAt, durationMs, tokens }: Props) {
  const [open, setOpen] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const peekRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!live) return;
    const base = startedAt ?? Date.now();
    const tick = () => setElapsed(Date.now() - base);
    tick();
    const t = setInterval(tick, 100);
    return () => clearInterval(t);
  }, [live, startedAt]);

  // Keep the peek window pinned to the newest thought as text streams in.
  useEffect(() => {
    if (!live) return;
    const el = peekRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [live, text]);

  const label = live
    ? 'Reasoning'
    : typeof durationMs === 'number'
      ? `Thought for ${formatDuration(durationMs)}`
      : 'Reasoning';

  return (
    <div
      className={`rsn${live ? ' rsn--live' : ''}${open ? ' rsn--open' : ''}`}
      data-testid={live ? 'msg-reasoning-live' : 'msg-reasoning'}
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
        <Sparkles size={12} className="rsn-spark" />
        <span className="rsn-label">{label}</span>
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
        <div className="rsn-peek" ref={peekRef}>
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
          max-width: 640px;
          margin: 0 8px 8px 24px;
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
          padding: 6px 12px;
          user-select: none;
        }
        .rsn:not(.rsn--live) .rsn-head { cursor: pointer; }
        .rsn:not(.rsn--live) .rsn-head:hover { background: var(--surface-3); }
        .rsn-spark { color: var(--text-muted); flex-shrink: 0; }
        .rsn--live .rsn-spark {
          color: var(--accent);
          animation: rsn-spark-spin 3.2s linear infinite;
        }
        @keyframes rsn-spark-spin { to { transform: rotate(360deg); } }
        .rsn-label { font-size: 12px; font-weight: 600; color: var(--text-secondary); }
        .rsn--live .rsn-label {
          background: linear-gradient(
            90deg,
            var(--text-muted) 20%,
            color-mix(in srgb, var(--accent) 75%, #fff) 50%,
            var(--text-muted) 80%
          );
          background-size: 200% 100%;
          -webkit-background-clip: text;
          background-clip: text;
          color: transparent;
          animation: rsn-shimmer 2.2s linear infinite;
        }
        @keyframes rsn-shimmer {
          from { background-position: 200% 0; }
          to { background-position: -200% 0; }
        }
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
          max-height: 66px;
          overflow: hidden;
          padding: 0 12px 8px 32px;
          -webkit-mask-image: linear-gradient(180deg, transparent 0, #000 26px);
          mask-image: linear-gradient(180deg, transparent 0, #000 26px);
        }
        .rsn-peek-text {
          font-size: 12px;
          line-height: 1.55;
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
          padding: 2px 14px 12px 32px;
          font-size: 12px;
          line-height: 1.55;
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
          .rsn--live .rsn-spark { animation: none; }
          .rsn--live .rsn-label { animation: none; color: var(--text-secondary); background: none; }
          .rsn-w { animation: none; }
          .rsn-body { animation: none; }
          .rsn-chev { transition: none; }
        }
      `}</style>
    </div>
  );
}
