import type { SwarmTaskStatus } from '@/types';

interface Props {
  id: string;
  title: string;
  status: SwarmTaskStatus;
  toolCallCount: number;
  hasApproval: boolean;
  selected: boolean;
  onClick: () => void;
}

const STATUS_COLOR: Record<SwarmTaskStatus, string> = {
  queued: '#888', streaming: '#c8943e', awaiting_approval: '#b44',
  paused: '#888', done: '#3a8', failed: '#b44',
  landed: '#3a8', discarded: '#666',
};

const STATUS_ICON: Record<SwarmTaskStatus, string> = {
  queued: '●', streaming: '●', awaiting_approval: '⚠',
  paused: '⏸', done: '✓', failed: '✗', landed: '✓', discarded: '–',
};

export default function SwarmTaskRow(p: Props) {
  return (
    <div
      className={`swarm-row ${p.selected ? 'selected' : ''}`}
      onClick={p.onClick}
      style={{ borderLeft: `3px solid ${STATUS_COLOR[p.status]}` }}
    >
      <div className="row-main">
        <div className="row-title">{p.title}</div>
        <div className="row-sub">{p.status} · {p.toolCallCount} tools</div>
      </div>
      <span className="row-icon" style={{ color: STATUS_COLOR[p.status] }}>{STATUS_ICON[p.status]}</span>
    </div>
  );
}
