import React from 'react';
import type { ToolCall } from '../../../types';
import { cardBase, cardHeader, SWARM_RED, monoBox, safeJsonParse, btnBase, btnPrimary, btnDanger } from './cardStyles';

interface Input {
  taskId?: string;
  title?: string;
  branch?: string;
  reason?: string;
  prompt?: string;
}

interface Props {
  toolCall: ToolCall;
  onRetry?: (prompt: string) => void;
  onDiscard?: (taskId: string) => void;
}

export default function TaskFailedCard({ toolCall, onRetry, onDiscard }: Props) {
  const input = safeJsonParse<Input>(toolCall.input) ?? {};
  const taskId = input.taskId;
  const prompt = input.prompt;
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
        </div>
        <div style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
          {taskId && onDiscard && (
            <button type="button" style={btnDanger} onClick={() => onDiscard(taskId)}>Discard</button>
          )}
          {prompt && onRetry && (
            <button type="button" style={btnPrimary} onClick={() => onRetry(prompt)}>Retry</button>
          )}
        </div>
      </div>
      {input.reason && (
        <div style={{ ...monoBox, marginTop: 6, padding: '6px 8px', background: 'var(--surface-2)', borderRadius: 4 }}>
          {input.reason}
        </div>
      )}
    </div>
  );
}
