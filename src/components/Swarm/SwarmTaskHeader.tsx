import type { SwarmTask } from '../../types';
import { Pause, Play, Trash2, GitMerge, Diff } from 'lucide-react';

interface Props {
  task: SwarmTask;
  onPause: () => void;
  onDiscard: () => void;
  onLand: () => void;
  onOpenDiff: () => void;
  onResume?: () => void;
}

export default function SwarmTaskHeader({ task, onPause, onDiscard, onLand, onOpenDiff, onResume }: Props) {
  const landDisabled = task.status !== 'done';
  const isPaused = task.status === 'paused';
  return (
    <div className="swarm-task-header">
      <div className="title">{task.title}</div>
      <div className="meta">
        {task.projectLinkName && (
          <>
            <span className="project-chip" title={task.projectPath || undefined}>{task.projectLinkName}</span>
            <span className="dot">·</span>
          </>
        )}
        <span className="branch">{task.branch}</span>
        <span className="dot">·</span>
        <span className="muted">{task.provider}/{task.model}</span>
      </div>
      <div className="actions">
        {isPaused && onResume && (
          <button aria-label="Resume" title="Resume" onClick={onResume}>
            <Play size={12}/> Resume
          </button>
        )}
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
          background: var(--surface-2); border-bottom: 1px solid var(--border-hairline);
          font-size: 11px;
        }
        .swarm-task-header .title { font-weight: 600; color: var(--text); }
        .swarm-task-header .meta { display: flex; align-items: center; gap: 6px; color: var(--text-muted); }
        .swarm-task-header .branch { font-family: 'Geist Mono', monospace; }
        .swarm-task-header .project-chip {
          font-size: 10px;
          padding: 2px 7px;
          border-radius: 4px;
          background: color-mix(in srgb, var(--accent) 18%, transparent);
          border: 1px solid color-mix(in srgb, var(--accent) 55%, transparent);
          color: var(--accent);
          font-weight: 600;
          letter-spacing: 0.3px;
          text-transform: uppercase;
        }
        .swarm-task-header .dot { opacity: 0.5; }
        .swarm-task-header .actions { margin-left: auto; display: flex; gap: 4px; }
        .swarm-task-header .actions button {
          display: inline-flex; align-items: center; gap: 4px;
          background: none; border: 1px solid var(--border-subtle); color: var(--text-muted);
          padding: 2px 6px; border-radius: 4px; cursor: pointer; font-size: 11px;
        }
        .swarm-task-header .actions button:hover:not(:disabled) { color: var(--text); background: var(--surface-4); }
        .swarm-task-header .actions button:disabled { opacity: 0.4; cursor: not-allowed; }
      `}</style>
    </div>
  );
}
