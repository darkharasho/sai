import React from 'react';

interface Props {
  active: number;
  ready: number;
  approvals: number;
  cost?: number;
  tokRate?: number;
}

const sepStyle: React.CSSProperties = { opacity: 0.35, padding: '0 4px' };

export default function ActivityRibbon({ active, ready, approvals, cost, tokRate }: Props) {
  const segments: React.ReactNode[] = [];
  if (active > 0) {
    segments.push(
      <span key="active" data-testid="ribbon-active">
        <span style={{ color: 'var(--accent)' }}>⚡</span>{' '}
        <b>{active}</b> streaming
      </span>
    );
  }
  if (ready > 0) {
    segments.push(
      <span key="ready" data-testid="ribbon-ready">
        <span style={{ color: '#3a8' }}>✓</span>{' '}
        <b>{ready}</b> ready
      </span>
    );
  }
  if (approvals > 0) {
    segments.push(
      <span key="approvals" data-testid="ribbon-approvals">
        <span style={{ color: '#b44' }}>⚠</span>{' '}
        <b>{approvals}</b> approval{approvals === 1 ? '' : 's'}
      </span>
    );
  }
  if (typeof cost === 'number') {
    segments.push(
      <span key="cost" data-testid="ribbon-cost" style={{ opacity: 0.85 }}>
        ${cost.toFixed(2)}
      </span>
    );
  }
  if (typeof tokRate === 'number' && tokRate > 0) {
    segments.push(
      <span key="tok" data-testid="ribbon-tok" style={{ opacity: 0.85 }}>
        {Math.round(tokRate)} tok/s
      </span>
    );
  }

  // Render with separators interleaved
  const interleaved: React.ReactNode[] = [];
  segments.forEach((seg, i) => {
    if (i > 0) interleaved.push(<span key={`sep-${i}`} style={sepStyle}>·</span>);
    interleaved.push(seg);
  });

  return (
    <div
      data-testid="orch-activity-ribbon"
      style={{
        height: 24,
        display: 'flex',
        alignItems: 'center',
        gap: 0,
        padding: '0 18px',
        fontSize: 11,
        color: 'var(--text)',
        background: 'var(--surface-1)',
        borderBottom: '1px solid var(--border-hairline)',
        flexShrink: 0,
        opacity: segments.length === 0 ? 0.5 : 1,
      }}
    >
      {segments.length === 0 ? (
        <span style={{ opacity: 0.6 }}>idle</span>
      ) : (
        interleaved
      )}
    </div>
  );
}
