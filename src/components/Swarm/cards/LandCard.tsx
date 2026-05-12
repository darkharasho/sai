import React from 'react';
import type { ToolCall } from '../../../types';
import { cardBase, safeJsonParse, SWARM_GREEN, SWARM_RED, btnPrimary } from './cardStyles';

interface Props {
  toolCall: ToolCall;
  onRebaseRetry?: (taskRef: string) => void;
}

interface LandResult {
  ok?: boolean;
  reason?: string;
  branch?: string;
  baseBranch?: string;
  additions?: number;
  deletions?: number;
}

export default function LandCard({ toolCall, onRebaseRetry }: Props) {
  const input = safeJsonParse<any>(toolCall.input) ?? {};
  const taskRef: string = input.taskRef ?? '';
  const result = safeJsonParse<LandResult>(toolCall.output);
  const ok = result?.ok !== false; // optimistic on missing output
  const branch = result?.branch ?? input.branch ?? taskRef ?? 'branch';
  const baseBranch = result?.baseBranch ?? 'main';
  const adds = result?.additions ?? 0;
  const dels = result?.deletions ?? 0;

  if (result && result.ok === false) {
    return (
      <div data-testid="swarm-land-card" style={{ ...cardBase, borderColor: SWARM_RED }}>
        <div style={{ color: SWARM_RED, fontWeight: 600, marginBottom: 4 }}>
          ✗ Rebase needed: {result.reason ?? 'unknown reason'}
        </div>
        <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
          <button
            type="button"
            style={btnPrimary}
            onClick={() => onRebaseRetry?.(taskRef)}
          >
            Rebase + retry
          </button>
        </div>
      </div>
    );
  }

  return (
    <div data-testid="swarm-land-card" style={{ ...cardBase, borderColor: SWARM_GREEN }}>
      <div style={{ color: SWARM_GREEN, fontWeight: 600 }}>
        → Landed{' '}
        <code style={{ fontFamily: "'Geist Mono', monospace", background: 'var(--bg-secondary)', padding: '1px 4px', borderRadius: 3 }}>
          {branch}
        </code>{' '}
        into{' '}
        <code style={{ fontFamily: "'Geist Mono', monospace", background: 'var(--bg-secondary)', padding: '1px 4px', borderRadius: 3 }}>
          {baseBranch}
        </code>
      </div>
      {(adds > 0 || dels > 0) && (
        <div style={{ marginTop: 4, fontSize: 11, opacity: 0.85 }}>
          <span style={{ color: SWARM_GREEN }}>+{adds}</span>{' '}
          <span style={{ color: SWARM_RED }}>−{dels}</span>
        </div>
      )}
    </div>
  );
}
