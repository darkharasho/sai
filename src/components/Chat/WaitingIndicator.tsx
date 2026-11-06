// src/components/Chat/WaitingIndicator.tsx
import { useEffect, useState } from 'react';
import { AlarmClock } from 'lucide-react';
import type { WaitMeta } from '../../../electron/services/waitClassifier';
import { formatCountdown, formatWakeTime, formatElapsed } from './formatCountdown';

interface Props {
  wait: WaitMeta;
  /** Absolute ms when the wait began; the countdown derives from this + resumeInSeconds. */
  startedAtMs: number;
  onCancel: () => void;
  /** Live running count from the background-task store (display only). Used
   *  only when per-task data exists, i.e. when onToggleTasks is set. */
  liveTaskCount?: number;
  /** Set when per-task data exists: the pill toggles the background-work sidebar. */
  onToggleTasks?: () => void;
  tasksOpen?: boolean;
}

export default function WaitingIndicator({ wait, startedAtMs, onCancel, liveTaskCount, onToggleTasks, tasksOpen = false }: Props) {
  const [nowMs, setNowMs] = useState(() => Date.now());
  const isScheduled = wait.kind === 'scheduled' && typeof wait.resumeInSeconds === 'number';

  // Both kinds tick: scheduled counts down to its wake time, background counts
  // UP — an open-ended wait with no visible clock reads exactly like a hang.
  useEffect(() => {
    if (wait.kind === 'none') return;
    const id = setInterval(() => setNowMs(Date.now()), 1000);
    return () => clearInterval(id);
  }, [wait.kind]);

  if (wait.kind === 'none') return null;

  const remaining = isScheduled
    ? (wait.resumeInSeconds as number) - Math.floor((nowMs - startedAtMs) / 1000)
    : 0;

  const label = wait.kind === 'scheduled' ? 'Waiting to resume' : 'Waiting on background work';
  const toggleable = !isScheduled && !!onToggleTasks;
  const taskCount = toggleable && typeof liveTaskCount === 'number' ? liveTaskCount : wait.taskCount;

  const icon = wait.kind === 'scheduled'
    ? <span className="sai-waiting-icon sai-waiting-ring" aria-hidden><AlarmClock size={14} /></span>
    : <span className="sai-waiting-icon" aria-hidden><span className="sai-waiting-orbit" /></span>;
  const body = (
    <>
      {icon}
      <span className="sai-waiting-label sai-shimmer">{label}</span>
      {isScheduled && (
        <span className="sai-waiting-count" title={formatWakeTime(startedAtMs, wait.resumeInSeconds as number)}>
          {formatCountdown(remaining)}
        </span>
      )}
      {!isScheduled && typeof taskCount === 'number' && taskCount > 0 && (
        <span className="sai-waiting-tasks">{taskCount} task{taskCount === 1 ? '' : 's'} running</span>
      )}
      {!isScheduled && (
        <span className="sai-waiting-count" title="Time spent waiting on background work">
          {formatElapsed((nowMs - startedAtMs) / 1000)}
        </span>
      )}
      {toggleable && <span className="sai-waiting-chevron" aria-hidden>{tasksOpen ? '◂' : '▸'}</span>}
    </>
  );

  return (
    <div className="sai-waiting" role="status" aria-live="polite">
      {toggleable ? (
        <button
          type="button"
          className="sai-waiting-toggle"
          aria-expanded={tasksOpen}
          title={tasksOpen ? 'Hide background tasks' : 'Show background tasks'}
          onClick={onToggleTasks}
        >
          {body}
        </button>
      ) : body}
      <button className="sai-waiting-cancel" onClick={onCancel}>Cancel</button>
      <style>{`
        .sai-waiting { display:inline-flex; align-items:center; gap:9px; margin-top:7px;
          padding:7px 12px; border:1px solid color-mix(in srgb, var(--accent) 22%, transparent);
          border-radius:8px; background:var(--surface-2); }
        .sai-waiting-icon { width:15px; height:15px; flex-shrink:0; color:var(--accent);
          display:grid; place-items:center; }
        .sai-waiting-ring { position:relative; }
        .sai-waiting-ring::after { content:''; position:absolute; inset:-4px; border-radius:50%;
          border:1.5px solid rgba(var(--accent-rgb),.4); animation:sai-wait-pulse 2s ease-out infinite; }
        @keyframes sai-wait-pulse { 0%{transform:scale(.7);opacity:.9} 100%{transform:scale(1.5);opacity:0} }
        .sai-waiting-orbit { width:13px; height:13px; border-radius:50%; border:1.5px solid var(--border-strong);
          border-top-color:var(--accent); animation:sai-wait-spin 1s linear infinite; }
        @keyframes sai-wait-spin { to { transform:rotate(360deg); } }
        .sai-waiting-toggle { display:inline-flex; align-items:center; gap:9px; margin:-4px -6px;
          padding:4px 6px; border:1px solid transparent; border-radius:6px; background:transparent;
          color:inherit; font:inherit; cursor:pointer; transition:border-color .15s, background .15s; }
        .sai-waiting-toggle:hover { border-color:rgba(var(--accent-rgb),.55); background:var(--surface-3); }
        .sai-waiting-toggle:focus-visible { outline:none; border-color:rgba(var(--accent-rgb),.55); }
        .sai-waiting-chevron { font-size:10px; color:var(--text-muted); }
        .sai-waiting-toggle:hover .sai-waiting-chevron { color:var(--accent); }
        .sai-waiting-label { font-size:12.5px; font-weight:600; }
        .sai-waiting-count { font-family:'Geist Mono','JetBrains Mono',ui-monospace,monospace;
          font-size:11px; color:color-mix(in srgb, var(--accent) 75%, transparent);
          background:var(--surface-3); border:1px solid var(--border-hairline);
          padding:2px 7px; border-radius:5px; font-variant-numeric:tabular-nums; }
        .sai-waiting-tasks { font-family:'Geist Mono','JetBrains Mono',ui-monospace,monospace;
          font-size:11px; color:var(--text-muted); }
        .sai-waiting-cancel { margin-left:2px; font-size:11.5px; color:var(--text-muted);
          border:1px solid var(--border-hairline); background:transparent; border-radius:5px; padding:3px 9px;
          cursor:pointer; font-weight:500; transition:.15s; }
        .sai-waiting-cancel:hover { color:var(--text); border-color:var(--border-strong);
          background:var(--surface-3); }
        @media (prefers-reduced-motion: reduce) {
          .sai-waiting-ring::after, .sai-waiting-orbit { animation:none; }
        }
      `}</style>
    </div>
  );
}
