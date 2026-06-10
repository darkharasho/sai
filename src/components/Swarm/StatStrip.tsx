import React from 'react';
import Sparkline from './Sparkline';

interface Props {
  active: number;
  approvals: number;
  ready: number;
  queued: number;
  cap: number;
  cost?: number;
  runtimeSec?: number;
  /** Workspace-wide active count history (12-element ring buffer, ~60s). */
  activeHistory?: number[];
}

function formatRuntime(sec?: number): string | null {
  if (typeof sec !== 'number' || !isFinite(sec)) return null;
  const s = Math.max(0, Math.round(sec));
  const mm = Math.floor(s / 60).toString().padStart(2, '0');
  const ss = (s % 60).toString().padStart(2, '0');
  return `${mm}:${ss}`;
}

const labelStyle: React.CSSProperties = {
  fontSize: 10,
  opacity: 0.55,
  letterSpacing: 1,
  textTransform: 'uppercase',
};

const cardBase: React.CSSProperties = {
  borderRadius: 6,
  padding: 10,
  background: 'var(--surface-3)',
  border: '1px solid var(--border-subtle)',
  minWidth: 0,
};

export default function StatStrip({ active, approvals, ready, queued, cap, cost, runtimeSec, activeHistory }: Props) {
  const runtime = formatRuntime(runtimeSec);
  const approvalsMuted = approvals <= 0;
  const showActiveSpark = !!activeHistory && activeHistory.some(v => v > 0);
  return (
    <div
      data-testid="orch-stat-strip"
      style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(5, 1fr)',
        gap: 10,
        padding: '12px 18px',
        borderBottom: '1px solid var(--border-hairline)',
        flexShrink: 0,
      }}
    >
      <div
        data-testid="stat-active"
        style={{
          ...cardBase,
          borderColor: 'var(--accent)',
          background: 'color-mix(in srgb, var(--accent) 8%, var(--surface-3))',
          position: 'relative',
          overflow: 'hidden',
        }}
      >
        {showActiveSpark && activeHistory && (
          <div
            data-testid="stat-active-sparkline"
            aria-hidden="true"
            style={{
              position: 'absolute',
              inset: 0,
              opacity: 0.25,
              color: 'var(--accent)',
              pointerEvents: 'none',
              padding: 4,
              display: 'flex',
              alignItems: 'flex-end',
            }}
          >
            <Sparkline data={activeHistory} width={120} height={40} fillOpacity={0.4} strokeWidth={1} />
          </div>
        )}
        <div style={{ position: 'relative' }}>
          <div style={labelStyle}>Active</div>
          <div style={{ fontSize: 22, fontWeight: 600, color: 'var(--accent)' }}>{active}</div>
        </div>
      </div>

      <div
        data-testid="stat-approvals"
        style={{
          ...cardBase,
          borderColor: approvalsMuted ? 'var(--border-subtle)' : '#b44',
          background: approvalsMuted
            ? 'var(--surface-3)'
            : 'rgba(180,68,68,0.08)',
          opacity: approvalsMuted ? 0.7 : 1,
        }}
      >
        <div style={labelStyle}>Approvals</div>
        <div
          style={{
            fontSize: 22,
            fontWeight: 600,
            color: approvalsMuted ? 'var(--text-muted)' : '#b44',
          }}
        >
          {approvals}
        </div>
      </div>

      <div
        data-testid="stat-ready"
        style={{
          ...cardBase,
          borderColor: '#3a8',
          background: 'rgba(58,168,108,0.08)',
        }}
      >
        <div style={labelStyle}>Ready to Land</div>
        <div style={{ fontSize: 22, fontWeight: 600, color: '#3a8' }}>{ready}</div>
      </div>

      <div data-testid="stat-queued" style={cardBase}>
        <div style={labelStyle}>Queued</div>
        <div style={{ fontSize: 22, fontWeight: 600, opacity: 0.85 }}>{queued}</div>
        <div style={{ fontSize: 9, opacity: 0.5, marginTop: 1 }}>cap: {cap}</div>
      </div>

      <div data-testid="stat-cost-runtime" style={cardBase}>
        <div style={labelStyle}>Cost · Runtime</div>
        <div style={{ fontSize: 14, fontWeight: 600 }}>
          {typeof cost === 'number' ? `$${cost.toFixed(2)}` : '—'}
        </div>
        <div style={{ fontSize: 10, opacity: 0.55 }}>
          {runtime ? `${runtime} running` : 'idle'}
        </div>
      </div>
    </div>
  );
}
