// src/components/Chat/WaitingIndicator.tsx
import { useEffect, useState } from 'react';
import type { WaitMeta } from '../../../electron/services/waitClassifier';
import { formatCountdown, formatWakeTime } from './formatCountdown';

interface Props {
  wait: WaitMeta;
  /** Absolute ms when the wait began; the countdown derives from this + resumeInSeconds. */
  startedAtMs: number;
  onCancel: () => void;
}

export default function WaitingIndicator({ wait, startedAtMs, onCancel }: Props) {
  const [nowMs, setNowMs] = useState(() => Date.now());
  const isScheduled = wait.kind === 'scheduled' && typeof wait.resumeInSeconds === 'number';

  useEffect(() => {
    if (!isScheduled) return;
    const id = setInterval(() => setNowMs(Date.now()), 1000);
    return () => clearInterval(id);
  }, [isScheduled]);

  if (wait.kind === 'none') return null;

  const remaining = isScheduled
    ? (wait.resumeInSeconds as number) - Math.floor((nowMs - startedAtMs) / 1000)
    : 0;

  const label = wait.kind === 'scheduled' ? 'Waiting to resume' : 'Waiting on background work';

  return (
    <div className="sai-waiting" role="status" aria-live="polite">
      {wait.kind === 'scheduled'
        ? <span className="sai-waiting-icon sai-waiting-ring" aria-hidden>⏰</span>
        : <span className="sai-waiting-icon" aria-hidden><span className="sai-waiting-orbit" /></span>}
      <span className="sai-waiting-label">{label}</span>
      {isScheduled && (
        <span className="sai-waiting-count" title={formatWakeTime(startedAtMs, wait.resumeInSeconds as number)}>
          {formatCountdown(remaining)}
        </span>
      )}
      {!isScheduled && typeof wait.taskCount === 'number' && wait.taskCount > 0 && (
        <span className="sai-waiting-tasks">{wait.taskCount} task{wait.taskCount === 1 ? '' : 's'} running</span>
      )}
      <button className="sai-waiting-cancel" onClick={onCancel}>Cancel</button>
      <style>{`
        .sai-waiting { display:inline-flex; align-items:center; gap:10px; margin-top:7px;
          padding:7px 10px 7px 11px; border:1px solid var(--edge,#39301f); border-radius:10px;
          background:linear-gradient(180deg,#211c14,#1b1710); }
        .sai-waiting-icon { width:15px; height:15px; flex-shrink:0; color:var(--accent,#c7913b);
          display:grid; place-items:center; }
        .sai-waiting-ring { position:relative; }
        .sai-waiting-ring::after { content:''; position:absolute; inset:-4px; border-radius:50%;
          border:1.5px solid rgba(199,145,59,.4); animation:sai-wait-pulse 2s ease-out infinite; }
        @keyframes sai-wait-pulse { 0%{transform:scale(.7);opacity:.9} 100%{transform:scale(1.5);opacity:0} }
        .sai-waiting-orbit { width:14px; height:14px; border-radius:50%; border:2px solid var(--line,#2a2418);
          border-top-color:var(--accent,#c7913b); animation:sai-wait-spin 1s linear infinite; }
        @keyframes sai-wait-spin { to { transform:rotate(360deg); } }
        .sai-waiting-label { font-size:12.5px; color:var(--text,#e9e2d2); font-weight:500; }
        .sai-waiting-count { font-family:'Departure Mono','Geist Mono','JetBrains Mono',ui-monospace,monospace;
          font-size:12px; color:var(--accent,#c7913b); background:rgba(199,145,59,.10);
          border:1px solid rgba(199,145,59,.22); padding:2px 7px; border-radius:6px; font-variant-numeric:tabular-nums; }
        .sai-waiting-tasks { font-family:'Departure Mono','Geist Mono','JetBrains Mono',ui-monospace,monospace;
          font-size:12px; color:var(--text-muted,#8b8071); }
        .sai-waiting-cancel { margin-left:2px; font-size:11.5px; color:var(--text-muted,#8b8071);
          border:1px solid var(--line,#2a2418); background:transparent; border-radius:6px; padding:3px 9px;
          cursor:pointer; font-weight:500; transition:.15s; }
        .sai-waiting-cancel:hover { color:var(--text,#e9e2d2); border-color:var(--edge,#39301f);
          background:rgba(255,255,255,.03); }
        @media (prefers-reduced-motion: reduce) {
          .sai-waiting-ring::after, .sai-waiting-orbit { animation:none; }
        }
      `}</style>
    </div>
  );
}
