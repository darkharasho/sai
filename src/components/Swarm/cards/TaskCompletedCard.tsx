import React from 'react';
import type { ToolCall } from '../../../types';
import { cardBase, cardHeader, SWARM_GREEN, safeJsonParse } from './cardStyles';

interface Input {
  taskId?: string;
  title?: string;
  branch?: string;
  toolCallCount?: number;
  durationMs?: number;
}

interface Props {
  toolCall: ToolCall;
}

function formatDuration(ms: number | undefined): string {
  if (!ms || ms <= 0) return '';
  const sec = Math.round(ms / 1000);
  if (sec < 60) return `${sec}s`;
  const min = Math.floor(sec / 60);
  const rem = sec % 60;
  return rem > 0 ? `${min}m ${rem}s` : `${min}m`;
}

export default function TaskCompletedCard({ toolCall }: Props) {
  const input = safeJsonParse<Input>(toolCall.input) ?? {};
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
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, flexWrap: 'wrap' }}>
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
      </div>
    </div>
  );
}
