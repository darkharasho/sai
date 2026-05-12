import React from 'react';
import type { ToolCall } from '../../../types';
import { cardBase, cardHeader, SWARM_RED, monoBox, safeJsonParse } from './cardStyles';

interface Input {
  taskId?: string;
  title?: string;
  branch?: string;
  reason?: string;
}

interface Props {
  toolCall: ToolCall;
}

export default function TaskFailedCard({ toolCall }: Props) {
  const input = safeJsonParse<Input>(toolCall.input) ?? {};
  return (
    <div
      data-testid="swarm-task-failed-card"
      style={{
        ...cardBase,
        borderColor: SWARM_RED,
        background: 'rgba(180,68,68,0.05)',
      }}
    >
      <div style={{ ...cardHeader, color: SWARM_RED }}>
        <span>✗ Task failed</span>
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
      </div>
      {input.reason && (
        <div style={{ ...monoBox, marginTop: 6, padding: '6px 8px', background: 'var(--bg-secondary)', borderRadius: 4 }}>
          {input.reason}
        </div>
      )}
    </div>
  );
}
