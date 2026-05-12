import React from 'react';
import type { ToolCall } from '../../../types';
import { safeJsonParse } from './cardStyles';

interface Input {
  taskId?: string;
  title?: string;
  branch?: string;
  prompt?: string;
}

interface Props {
  toolCall: ToolCall;
}

export default function TaskStartedCard({ toolCall }: Props) {
  const input = safeJsonParse<Input>(toolCall.input) ?? {};
  return (
    <div
      data-testid="swarm-task-started-card"
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 8,
        border: '1px solid var(--accent)',
        background: 'color-mix(in srgb, var(--accent) 6%, var(--bg-elevated))',
        borderRadius: 6,
        padding: '6px 10px',
        margin: '4px 0',
        fontSize: 11,
        color: 'var(--text)',
      }}
    >
      <span style={{ color: 'var(--accent)', fontWeight: 600 }}>▶</span>
      <span style={{ opacity: 0.7 }}>Task started</span>
      <span style={{ fontWeight: 600 }}>{input.title || 'task'}</span>
      {input.branch && (
        <span
          style={{
            fontFamily: "'Geist Mono', 'JetBrains Mono', ui-monospace, monospace",
            fontSize: 10,
            color: 'var(--text-muted)',
          }}
        >
          {input.branch}
        </span>
      )}
    </div>
  );
}
