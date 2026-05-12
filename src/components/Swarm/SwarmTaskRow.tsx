import { Trash2 } from 'lucide-react';
import type { SwarmTaskStatus } from '../../types';

interface Props {
  id: string;
  title: string;
  status: SwarmTaskStatus;
  toolCallCount: number;
  hasApproval: boolean;
  selected: boolean;
  onClick: () => void;
  onDiscard?: () => void;
  /**
   * True when the task is mid-turn (live stream events flowing). Drives the
   * pulsing dot so users can see which tasks are actively thinking right
   * now, distinct from the coarser `status === 'streaming'` state.
   */
  isStreaming?: boolean;
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
      className={`swarm-row ${p.selected ? 'selected' : ''} ${p.isStreaming ? 'streaming-live' : ''}`}
      onClick={p.onClick}
      data-streaming={p.isStreaming ? 'true' : undefined}
      style={{ borderLeft: `3px solid ${STATUS_COLOR[p.status]}` }}
    >
      <div className="row-main">
        <div className="row-title">{p.title}</div>
        <div className="row-sub">{p.status} · {p.toolCallCount} tools</div>
      </div>
      <span
        className={`row-icon ${p.isStreaming ? 'pulsing' : ''}`}
        style={{ color: STATUS_COLOR[p.status] }}
        aria-label={p.isStreaming ? 'thinking' : undefined}
      >
        {STATUS_ICON[p.status]}
      </span>
      {p.onDiscard && (
        <button
          className="row-discard"
          aria-label={`Discard ${p.title}`}
          onClick={(e) => { e.stopPropagation(); p.onDiscard!(); }}
        >
          <Trash2 size={12} />
        </button>
      )}
      <style>{`
        .swarm-row .row-icon.pulsing {
          animation: swarm-row-pulse 1.5s ease-in-out infinite;
        }
        @keyframes swarm-row-pulse {
          0%, 100% { opacity: 0.3; }
          50% { opacity: 1; }
        }
      `}</style>
    </div>
  );
}
