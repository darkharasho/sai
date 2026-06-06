import React from 'react';
import type { ToolCall } from '../../../types';
import { cardBase, safeJsonParse } from './cardStyles';

interface Props {
  toolCall: ToolCall;
}

export default function DiscardCard({ toolCall }: Props) {
  const input = safeJsonParse<any>(toolCall.input) ?? {};
  const branch: string = input.branch ?? input.taskRef ?? 'branch';
  return (
    <div
      data-testid="swarm-discard-card"
      style={{ ...cardBase, padding: '6px 10px', display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, opacity: 0.9 }}
    >
      <span>🗑</span>
      <span>
        Discarded{' '}
        <code style={{ fontFamily: "'Geist Mono', monospace", background: 'var(--surface-2)', padding: '1px 4px', borderRadius: 3 }}>
          {branch}
        </code>
      </span>
    </div>
  );
}
