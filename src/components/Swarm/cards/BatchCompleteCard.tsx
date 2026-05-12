import React from 'react';
import type { ToolCall } from '../../../types';
import { cardBase, cardHeader, SWARM_GREEN, SWARM_RED, safeJsonParse, btnBase, btnPrimary } from './cardStyles';
import Sparkline from '../Sparkline';

interface Input {
  totalTasks?: number;
  landed?: number;
  discarded?: number;
  failed?: number;
  totalCost?: number;
  durationMs?: number;
  completionBuckets?: number[];
}

interface Props {
  toolCall: ToolCall;
  /** When provided, hooked up to "Land all green" — only fires for `done` task ids. */
  onLandAll?: () => void;
  /** Best-effort focus to chat history (no-op default for now). */
  onFocusChat?: () => void;
  /** True if there are still tasks in `done` state we could land. */
  hasLandable?: boolean;
}

function formatDuration(ms: number | undefined): string {
  if (!ms || ms <= 0) return '—';
  const sec = Math.max(0, Math.round(ms / 1000));
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = sec % 60;
  const parts: string[] = [];
  if (h > 0) parts.push(`${h}h`);
  if (m > 0 || h > 0) parts.push(`${m}m`);
  parts.push(`${s}s`);
  return parts.join(' ');
}

const statStyle: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'flex-start',
  gap: 2,
  minWidth: 0,
};
const statLabel: React.CSSProperties = {
  fontSize: 9,
  letterSpacing: 0.6,
  textTransform: 'uppercase',
  opacity: 0.55,
};

export default function BatchCompleteCard({ toolCall, onLandAll, onFocusChat, hasLandable }: Props) {
  const input = safeJsonParse<Input>(toolCall.input) ?? {};
  const total = input.totalTasks ?? 0;
  const landed = input.landed ?? 0;
  const discarded = input.discarded ?? 0;
  const failed = input.failed ?? 0;
  const buckets = Array.isArray(input.completionBuckets) ? input.completionBuckets : [];
  const hasBuckets = buckets.some(v => v > 0);

  return (
    <div data-testid="swarm-batch-complete-card" style={{ ...cardBase }}>
      <div style={cardHeader}>
        <span>🎯 Batch complete</span>
        <span style={{ opacity: 0.65, fontWeight: 400, textTransform: 'none', letterSpacing: 0 }}>
          {formatDuration(input.durationMs)}
        </span>
      </div>

      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 14,
          flexWrap: 'wrap',
        }}
      >
        <div style={statStyle}>
          <span style={statLabel}>Total</span>
          <span style={{ fontSize: 14, fontWeight: 600 }}>{total}</span>
        </div>
        <div style={statStyle}>
          <span style={statLabel}>Landed</span>
          <span style={{ fontSize: 14, fontWeight: 600, color: SWARM_GREEN }}>{landed}</span>
        </div>
        <div style={statStyle}>
          <span style={statLabel}>Discarded</span>
          <span style={{ fontSize: 14, fontWeight: 600, color: 'var(--text-muted)' }}>{discarded}</span>
        </div>
        <div style={statStyle}>
          <span style={statLabel}>Failed</span>
          <span style={{ fontSize: 14, fontWeight: 600, color: SWARM_RED }}>{failed}</span>
        </div>
        {typeof input.totalCost === 'number' && (
          <div style={statStyle}>
            <span style={statLabel}>Cost</span>
            <span style={{ fontSize: 14, fontWeight: 600 }}>${input.totalCost.toFixed(2)}</span>
          </div>
        )}
      </div>

      {hasBuckets && (
        <div data-testid="swarm-batch-complete-sparkline" style={{ marginTop: 8, color: 'var(--accent)' }}>
          <Sparkline data={buckets} width={220} height={24} fillOpacity={0.18} />
        </div>
      )}

      <div style={{ display: 'flex', gap: 6, marginTop: 8, flexWrap: 'wrap' }}>
        {onLandAll && hasLandable && landed >= 0 && (
          <button type="button" style={btnPrimary} onClick={onLandAll}>
            Land all green
          </button>
        )}
        {onFocusChat && (
          <button type="button" style={btnBase} onClick={onFocusChat}>
            View summary in chat history
          </button>
        )}
      </div>
    </div>
  );
}
