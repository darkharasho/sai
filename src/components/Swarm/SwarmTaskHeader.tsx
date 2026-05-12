import type { SwarmTask } from '../../types';
import { Pause, Trash2, GitMerge, Diff } from 'lucide-react';

interface Props {
  task: SwarmTask;
  onPause: () => void;
  onDiscard: () => void;
  onLand: () => void;
  onOpenDiff: () => void;
}

export default function SwarmTaskHeader({ task, onPause, onDiscard, onLand, onOpenDiff }: Props) {
  const landDisabled = task.status !== 'done';
  return (
    <div className="swarm-task-header">
      <div className="title">{task.title}</div>
      <div className="meta">
        <span className="branch">{task.branch}</span>
        <span className="dot">·</span>
        <span className="muted">{task.provider}/{task.model}</span>
      </div>
      <div className="actions">
        <button aria-label="Pause" title="Pause" onClick={onPause}><Pause size={12}/></button>
        <button aria-label="Open diff" title="Open diff" onClick={onOpenDiff}><Diff size={12}/></button>
        <button aria-label="Discard" title="Discard" onClick={onDiscard}><Trash2 size={12}/></button>
        <button aria-label="Land" title="Land" onClick={onLand} disabled={landDisabled}>
          <GitMerge size={12}/> Land
        </button>
      </div>
      <style>{`
        .swarm-task-header {
          display: flex; align-items: center; gap: 12px;
          height: 28px; padding: 0 10px;
          background: var(--bg-secondary); border-bottom: 1px solid var(--border);
          font-size: 11px;
        }
        .swarm-task-header .title { font-weight: 600; color: var(--text); }
        .swarm-task-header .meta { display: flex; align-items: center; gap: 6px; color: var(--text-muted); }
        .swarm-task-header .branch { font-family: 'Geist Mono', monospace; }
        .swarm-task-header .dot { opacity: 0.5; }
        .swarm-task-header .actions { margin-left: auto; display: flex; gap: 4px; }
        .swarm-task-header .actions button {
          display: inline-flex; align-items: center; gap: 4px;
          background: none; border: 1px solid var(--border); color: var(--text-muted);
          padding: 2px 6px; border-radius: 4px; cursor: pointer; font-size: 11px;
        }
        .swarm-task-header .actions button:hover:not(:disabled) { color: var(--text); background: var(--bg-hover); }
        .swarm-task-header .actions button:disabled { opacity: 0.4; cursor: not-allowed; }
      `}</style>
    </div>
  );
}
