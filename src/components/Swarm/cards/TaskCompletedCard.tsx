import React from 'react';
import type { ToolCall } from '../../../types';
import { cardBase, cardHeader, SWARM_GREEN, SWARM_RED, safeJsonParse, btnBase, btnPrimary, btnDanger } from './cardStyles';

interface Input {
  taskId?: string;
  title?: string;
  branch?: string;
  toolCallCount?: number;
  durationMs?: number;
  additions?: number;
  deletions?: number;
}

interface Props {
  toolCall: ToolCall;
  /**
   * Live diff stats keyed by task id. Falls back to additions/deletions on the
   * card input when the live map doesn't have an entry yet (e.g. on reload
   * from history).
   */
  diffStats?: Map<string, { additions: number; deletions: number }>;
  onLand?: (taskId: string) => void;
  onDiscard?: (taskId: string) => void;
  onDiff?: (taskId: string) => void;
}

function formatDuration(ms: number | undefined): string {
  if (!ms || ms <= 0) return '';
  const sec = Math.round(ms / 1000);
  if (sec < 60) return `${sec}s`;
  const min = Math.floor(sec / 60);
  const rem = sec % 60;
  return rem > 0 ? `${min}m ${rem}s` : `${min}m`;
}

export default function TaskCompletedCard({ toolCall, diffStats, onLand, onDiscard, onDiff }: Props) {
  const input = safeJsonParse<Input>(toolCall.input) ?? {};
  const liveStats = input.taskId ? diffStats?.get(input.taskId) : undefined;
  const adds = liveStats?.additions ?? input.additions ?? 0;
  const dels = liveStats?.deletions ?? input.deletions ?? 0;
  const taskId = input.taskId;
  return (
    <div
      data-testid="swarm-task-completed-card"
      style={{
        ...cardBase,
        borderColor: SWARM_GREEN,
        background: 'rgba(58,168,108,0.06)',
      }}
    >
      <div style={{ ...cardHeader, color: SWARM_GREEN }}>
        <span>✓ Task completed</span>
        {formatDuration(input.durationMs) && (
          <span style={{ opacity: 0.65, fontWeight: 400, textTransform: 'none', letterSpacing: 0 }}>
            {formatDuration(input.durationMs)}
          </span>
        )}
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, flexWrap: 'wrap', flex: 1, minWidth: 0 }}>
          <span style={{ fontWeight: 600 }}>{input.title || 'task'}</span>
          {input.branch && (
            <span
              style={{
                fontFamily: "'Geist Mono', 'JetBrains Mono', ui-monospace, monospace",
                fontSize: 11,
                color: 'var(--text-muted)',
              }}
            >
              {input.branch}
            </span>
          )}
          {typeof input.toolCallCount === 'number' && (
            <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>· {input.toolCallCount} tools</span>
          )}
          {(adds > 0 || dels > 0) && (
            <span style={{ fontSize: 11 }}>
              <span style={{ color: SWARM_GREEN }}>+{adds}</span>{' '}
              <span style={{ color: SWARM_RED }}>−{dels}</span>
            </span>
          )}
        </div>
        {taskId && (onDiff || onDiscard || onLand) && (
          <div style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
            {onDiff && (
              <button type="button" style={btnBase} onClick={() => onDiff(taskId)}>Diff</button>
            )}
            {onDiscard && (
              <button type="button" style={btnDanger} onClick={() => onDiscard(taskId)}>Discard</button>
            )}
            {onLand && (
              <button type="button" style={btnPrimary} onClick={() => onLand(taskId)}>Land</button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
