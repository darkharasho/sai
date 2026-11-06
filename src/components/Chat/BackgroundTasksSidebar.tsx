// Full-height right column listing the active chat's background tasks.
import { useCallback, useEffect, useRef, useState } from 'react';
import { LayoutGroup, useReducedMotion } from 'motion/react';
import { X } from 'lucide-react';
import { isTerminalDetail, type BackgroundTaskDetail } from '../../../electron/services/claudeBackend/backgroundTasks';
import BackgroundTaskCard from './BackgroundTaskCard';
import { DONE_HOLD_MS, partitionTasks } from './backgroundTaskView';

interface Props {
  tasks: BackgroundTaskDetail[];
  onClose: () => void;
  onStopTask: (taskId: string) => Promise<boolean>;
}

export default function BackgroundTasksSidebar({ tasks, onClose, onStopTask }: Props) {
  const reducedMotion = !!useReducedMotion();
  const [nowMs, setNowMs] = useState(() => Date.now());
  const [settlingIds, setSettlingIds] = useState<ReadonlySet<string>>(() => new Set());
  const [stopping, setStopping] = useState<ReadonlySet<string>>(() => new Set());
  const [stopFailed, setStopFailed] = useState<ReadonlySet<string>>(() => new Set());
  /** Last status seen per id — detects the running→terminal edge. */
  const prevStatus = useRef(new Map<string, BackgroundTaskDetail['status']>());
  const timers = useRef(new Map<string, ReturnType<typeof setTimeout>>());
  const mounted = useRef(true);

  const anyLive = tasks.some((t) => !isTerminalDetail(t));
  useEffect(() => {
    if (!anyLive) return;
    setNowMs(Date.now());
    const id = setInterval(() => setNowMs(Date.now()), 1000);
    return () => clearInterval(id);
  }, [anyLive]);

  // Ids that turned terminal since the last commit. Folded into `settling`
  // during render so the card never flashes into Finished for one frame
  // before the effect below catches up.
  const justFinished = tasks.filter((t) => {
    const prev = prevStatus.current.get(t.id);
    return isTerminalDetail(t) && prev !== undefined && prev !== 'completed' && prev !== 'failed' && prev !== 'stopped';
  }).map((t) => t.id);

  useEffect(() => {
    if (justFinished.length > 0) {
      setSettlingIds((prev) => new Set([...prev, ...justFinished]));
      setStopping((prev) => (justFinished.some((id) => prev.has(id)) ? new Set([...prev].filter((id) => !justFinished.includes(id))) : prev));
      for (const id of justFinished) {
        if (timers.current.has(id)) continue;
        timers.current.set(id, setTimeout(() => {
          timers.current.delete(id);
          setSettlingIds((prev) => {
            const next = new Set(prev);
            next.delete(id);
            return next;
          });
        }, reducedMotion ? 0 : DONE_HOLD_MS));
      }
    }
    const next = new Map<string, BackgroundTaskDetail['status']>();
    for (const t of tasks) next.set(t.id, t.status);
    prevStatus.current = next;
  });

  useEffect(() => {
    // Re-armed on (StrictMode re-)mount; the cleanup alone would leave it false.
    mounted.current = true;
    return () => {
    mounted.current = false;
    for (const t of timers.current.values()) clearTimeout(t);
    timers.current.clear();
    };
  }, []);

  const handleStop = useCallback((id: string) => {
    setStopping((prev) => new Set(prev).add(id));
    setStopFailed((prev) => {
      if (!prev.has(id)) return prev;
      const next = new Set(prev);
      next.delete(id);
      return next;
    });
    onStopTask(id).then((ok) => {
      if (ok || !mounted.current) return;
      setStopping((prev) => {
        const next = new Set(prev);
        next.delete(id);
        return next;
      });
      setStopFailed((prev) => new Set(prev).add(id));
    }, () => {
      if (!mounted.current) return;
      setStopping((prev) => {
        const next = new Set(prev);
        next.delete(id);
        return next;
      });
      setStopFailed((prev) => new Set(prev).add(id));
    });
  }, [onStopTask]);

  const settling = new Set([...settlingIds, ...justFinished]);
  const { running, finished } = partitionTasks(tasks, settling);
  const runningCount = tasks.filter((t) => !isTerminalDetail(t)).length;
  const doneCount = tasks.length - runningCount;

  const renderCard = (t: BackgroundTaskDetail) => (
    <BackgroundTaskCard
      key={t.id}
      task={t}
      nowMs={nowMs}
      settling={settling.has(t.id)}
      stopping={stopping.has(t.id)}
      stopFailed={stopFailed.has(t.id)}
      onStop={handleStop}
      reducedMotion={reducedMotion}
    />
  );

  return (
    <aside className="sai-bgtasks" aria-label="Background work">
      <header className="sai-bgtasks-head">
        <div>
          <div className="sai-bgtasks-title">Background work</div>
          <div className="sai-bgtasks-sub">{runningCount} running · {doneCount} done</div>
        </div>
        <button type="button" className="sai-bgtasks-close" aria-label="Close background work" onClick={onClose}>
          <X size={14} />
        </button>
      </header>
      <div className="sai-bgtasks-list">
        <LayoutGroup id="sai-bgtasks">
          <div className="sai-bgtasks-section" data-section="running">{running.map(renderCard)}</div>
          {finished.length > 0 && (
            <div className="sai-bgtasks-section" data-section="finished">
              <div className="sai-bgtasks-label">Finished</div>
              {finished.map(renderCard)}
            </div>
          )}
        </LayoutGroup>
      </div>
      <style>{SIDEBAR_CSS}</style>
    </aside>
  );
}

const MONO = "'Geist Mono','JetBrains Mono',ui-monospace,monospace";

const SIDEBAR_CSS = `
  .sai-bgtasks { width:380px; flex-shrink:0; height:100%; min-height:0; display:flex; flex-direction:column;
    background:var(--surface-0); border-left:1px solid var(--border-strong); color:var(--text); }
  .sai-bgtasks-head { display:flex; align-items:flex-start; justify-content:space-between; gap:8px;
    padding:14px 14px 12px; border-bottom:1px solid var(--border-hairline); flex-shrink:0; }
  .sai-bgtasks-title { font-size:13px; font-weight:600; }
  .sai-bgtasks-sub { margin-top:3px; font-family:${MONO}; font-size:11px; color:var(--text-muted);
    font-variant-numeric:tabular-nums; }
  .sai-bgtasks-close { display:grid; place-items:center; width:24px; height:24px; border-radius:6px;
    border:1px solid transparent; background:transparent; color:var(--text-muted); cursor:pointer; }
  .sai-bgtasks-close:hover { color:var(--text); border-color:var(--border-strong); background:var(--surface-3); }
  .sai-bgtasks-list { flex:1; min-height:0; overflow-y:auto; padding:10px 12px 16px; }
  .sai-bgtasks-section { display:flex; flex-direction:column; gap:8px; }
  .sai-bgtasks-section + .sai-bgtasks-section { margin-top:16px; }
  .sai-bgtasks-label { font-family:${MONO}; font-size:10px; letter-spacing:.08em; text-transform:uppercase;
    color:var(--text-muted); padding:0 2px; }

  .sai-bgtask { position:relative; background:var(--surface-2); border:1px solid var(--border-hairline);
    border-radius:9px; padding:10px 11px; display:flex; flex-direction:column; gap:6px; }
  .sai-bgtask[data-stuck="true"] { border-color:rgba(224,108,117,.45); }
  .sai-bgtask[data-state="finished"] { opacity:.62; }
  .sai-bgtask-head { display:flex; align-items:center; gap:8px; min-width:0; }
  .sai-bgtask-dot { width:12px; height:12px; flex-shrink:0; border-radius:50%; display:grid; place-items:center;
    font-size:8px; font-weight:700; line-height:1; color:var(--surface-0);
    background:var(--accent); box-shadow:0 0 0 3px rgba(var(--accent-rgb),.14); }
  .sai-bgtask[data-stuck="true"] .sai-bgtask-dot { background:#e06c75; box-shadow:0 0 0 3px rgba(224,108,117,.16); }
  .sai-bgtask[data-status="completed"] .sai-bgtask-dot { background:#98c379; box-shadow:none; }
  .sai-bgtask[data-status="failed"] .sai-bgtask-dot { background:#e06c75; box-shadow:none; }
  .sai-bgtask[data-status="stopped"] .sai-bgtask-dot { background:var(--text-muted); box-shadow:none; }
  .sai-bgtask-name { flex:1; min-width:0; font-size:12.5px; font-weight:600; white-space:nowrap;
    overflow:hidden; text-overflow:ellipsis; }
  .sai-bgtask-kind { flex-shrink:0; font-family:${MONO}; font-size:10px; color:var(--text-muted);
    background:var(--surface-3); border:1px solid var(--border-hairline); border-radius:4px; padding:1px 6px; }
  .sai-bgtask-now { font-size:12px; color:color-mix(in srgb, var(--text) 82%, transparent);
    white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
  .sai-bgtask[data-stuck="true"] .sai-bgtask-now { color:#e06c75; }
  .sai-bgtask-foot { display:flex; align-items:center; gap:8px; flex-wrap:wrap; }
  .sai-bgtask-stats { flex:1; min-width:0; display:flex; flex-wrap:wrap; gap:4px 10px; font-family:${MONO};
    font-size:10.5px; color:var(--text-muted); font-variant-numeric:tabular-nums; }
  .sai-bgtask-stuck { flex-basis:100%; order:3; font-size:11px; color:#e06c75; }
  .sai-bgtask-stop { margin-left:auto; font-size:11px; color:var(--text-muted); background:transparent;
    border:1px solid var(--border-hairline); border-radius:5px; padding:2px 9px; cursor:pointer; transition:.15s; }
  .sai-bgtask-stop:hover:not(:disabled) { color:var(--text); border-color:var(--border-strong); background:var(--surface-3); }
  .sai-bgtask-stop:disabled { cursor:default; opacity:.7; }
  .sai-bgtask[data-stuck="true"] .sai-bgtask-stop { color:#e06c75; border-color:rgba(224,108,117,.45); }

  /* One-shot done effect: dot pops to its result glyph, card flashes once. */
  .sai-bgtask[data-state="done"] { animation:sai-bgtask-flash 500ms ease-out 1; }
  .sai-bgtask[data-state="done"] .sai-bgtask-dot { animation:sai-bgtask-pop 320ms cubic-bezier(.3,1.6,.5,1) 1; }
  @keyframes sai-bgtask-flash { from { background:rgba(var(--accent-rgb),.12); } to { background:var(--surface-2); } }
  @keyframes sai-bgtask-pop { 0% { transform:scale(.5); } 100% { transform:scale(1); } }
  @media (prefers-reduced-motion: reduce) {
    .sai-bgtask[data-state="done"], .sai-bgtask[data-state="done"] .sai-bgtask-dot { animation:none; }
  }
`;
