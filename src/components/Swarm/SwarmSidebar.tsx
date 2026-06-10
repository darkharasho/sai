import SwarmTaskRow from './SwarmTaskRow';
import { Zap, Plus } from 'lucide-react';
import type { SwarmTask } from '../../types';

interface Props {
  tasks: SwarmTask[];
  selectedId: 'overview' | string;
  onSelect: (id: 'overview' | string) => void;
  onNewTask: () => void;
  onDiscard?: (task: SwarmTask) => void;
  /**
   * Set of task ids currently mid-turn (live streaming events flowing).
   * Used to render a per-row pulsing indicator independent of the coarser
   * `task.status === 'streaming'` flag.
   */
  streamingTaskIds?: Set<string>;
}

export default function SwarmSidebar({ tasks, selectedId, onSelect, onNewTask, onDiscard, streamingTaskIds }: Props) {
  const activeCount = tasks.filter(t => t.status === 'streaming').length;
  const apprCount = tasks.filter(t => t.status === 'awaiting_approval').length;
  const readyCount = tasks.filter(t => t.status === 'done').length;
  return (
    <aside className="swarm-sidebar">
      <header>
        <span className="label">SWARM</span>
        <button className="new-task" onClick={onNewTask}><Plus size={12}/> NEW</button>
      </header>
      <div
        className={`swarm-overview-row ${selectedId === 'overview' ? 'selected' : ''}`}
        onClick={() => onSelect('overview')}
      >
        <Zap size={16}/>
        <div>
          <div className="overview-title">Swarm Overview</div>
          <div className="overview-sub">{activeCount} active · {apprCount} approval · {readyCount} ready</div>
        </div>
      </div>
      <div className="section-label">TASKS</div>
      <div className="task-list">
        {tasks.map(t => (
          <SwarmTaskRow
            key={t.id} id={t.id} title={t.title} status={t.status}
            toolCallCount={t.toolCallCount} hasApproval={t.status === 'awaiting_approval'}
            selected={selectedId === t.id}
            onClick={() => onSelect(t.id)}
            onDiscard={onDiscard ? () => onDiscard(t) : undefined}
            isStreaming={streamingTaskIds?.has(t.id) ?? false}
            projectLinkName={t.projectLinkName}
          />
        ))}
      </div>
      <style>{`
        .swarm-sidebar {
          width: 260px;
          flex-shrink: 0;
          background: var(--surface-1);
          color: var(--text);
          border-right: 1px solid var(--border-subtle);
          display: flex;
          flex-direction: column;
          overflow-y: auto;
          font-size: 13px;
        }
        .swarm-sidebar header {
          display: flex;
          align-items: center;
          justify-content: space-between;
          padding: 12px 14px;
          border-bottom: 1px solid var(--border-hairline);
        }
        .swarm-sidebar header .label {
          font-size: var(--text-xs);
          font-weight: 600;
          letter-spacing: 0.06em;
          color: var(--text-secondary);
        }
        .swarm-sidebar .new-task {
          display: inline-flex;
          align-items: center;
          gap: 4px;
          background: transparent;
          color: var(--accent);
          border: 1px solid var(--border-hairline);
          border-radius: 4px;
          padding: 3px 8px;
          font-size: 10px;
          letter-spacing: 0.08em;
          cursor: pointer;
        }
        .swarm-sidebar .new-task:hover {
          background: var(--surface-4);
        }
        .swarm-overview-row {
          display: flex;
          align-items: center;
          gap: 10px;
          padding: 10px 14px;
          cursor: pointer;
          border-bottom: 1px solid var(--border-hairline);
        }
        .swarm-overview-row:hover {
          background: var(--surface-4);
        }
        .swarm-overview-row.selected {
          background: var(--accent-dim);
          border-left: 3px solid var(--accent);
          padding-left: 11px;
        }
        .swarm-overview-row .overview-title {
          font-weight: 600;
          font-size: 13px;
        }
        .swarm-overview-row .overview-sub {
          font-size: 11px;
          opacity: 0.7;
          margin-top: 2px;
        }
        .section-label {
          padding: 10px 14px 6px;
          font-size: var(--text-xs);
          font-weight: 600;
          letter-spacing: 0.06em;
          color: var(--text-secondary);
          text-transform: uppercase;
        }
        .task-list {
          display: flex;
          flex-direction: column;
        }
        .swarm-row {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 8px;
          padding: 8px 14px 8px 11px;
          cursor: pointer;
          border-bottom: 1px solid var(--border-hairline);
        }
        .swarm-row:hover {
          background: var(--surface-4);
        }
        .swarm-row.selected {
          background: var(--accent-dim);
        }
        .swarm-row .row-title {
          font-size: 13px;
          font-weight: 500;
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
        }
        .swarm-row .row-sub {
          font-size: 11px;
          opacity: 0.65;
          margin-top: 2px;
        }
        .swarm-row .row-icon {
          font-size: 12px;
          flex-shrink: 0;
        }
        .swarm-row .row-main {
          min-width: 0;
          flex: 1;
        }
        .swarm-row .row-discard {
          opacity: 0;
          background: none;
          border: none;
          color: var(--text-muted);
          cursor: pointer;
          padding: 2px;
          border-radius: 3px;
          display: inline-flex;
          align-items: center;
          justify-content: center;
          flex-shrink: 0;
          transition: opacity 0.15s, color 0.15s, background 0.15s;
        }
        .swarm-row:hover .row-discard {
          opacity: 0.6;
        }
        .swarm-row .row-discard:hover {
          opacity: 1;
          color: var(--red, #b44);
          background: var(--surface-4);
        }
        .swarm-row .row-discard:focus-visible {
          opacity: 1;
          outline: 1px solid var(--accent);
        }
      `}</style>
    </aside>
  );
}
