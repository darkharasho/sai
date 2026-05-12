import React from 'react';
import type { ToolCall } from '../../../types';
import { safeJsonParse } from './cardStyles';

interface Input {
  taskTitle?: string;
  toolName?: string;
  branch?: string;
}

interface Props {
  toolCall: ToolCall;
}

export default function AutoApprovedCard({ toolCall }: Props) {
  const input = safeJsonParse<Input>(toolCall.input) ?? {};
  return (
    <div
      data-testid="swarm-auto-approved-card"
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 6,
        padding: '3px 10px',
        margin: '2px 0',
        fontSize: 10,
        color: 'var(--text-muted)',
        opacity: 0.65,
        fontFamily: "'Geist Mono', 'JetBrains Mono', ui-monospace, monospace",
      }}
    >
      <span style={{ color: '#3a8' }}>✓</span>
      <span>auto-approved</span>
      {input.toolName && (
        <span style={{ color: 'var(--text)' }}>{input.toolName}</span>
      )}
      {input.taskTitle && (
        <span style={{ opacity: 0.7 }}>· {input.taskTitle}</span>
      )}
      {input.branch && (
        <span style={{ opacity: 0.5 }}>· {input.branch}</span>
      )}
    </div>
  );
}
