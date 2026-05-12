import React, { useState } from 'react';

export interface ReadyTaskRow {
  id: string;
  title: string;
  branch: string;
  additions: number;
  deletions: number;
}

interface Props {
  tasks: ReadyTaskRow[];
  onLand: (id: string) => void;
  onDiscard: (id: string) => void;
  onDiff: (id: string) => void;
  onLandAll: () => void;
}

const linkBtn: React.CSSProperties = {
  background: 'transparent',
  border: 'none',
  color: 'inherit',
  opacity: 0.75,
  cursor: 'pointer',
  fontSize: 10,
  letterSpacing: 1,
  padding: 0,
  textTransform: 'lowercase',
};

const ghostBtn: React.CSSProperties = {
  background: '#1c1c1c',
  border: '1px solid #444',
  borderRadius: 4,
  padding: '3px 8px',
  fontSize: 10,
  color: 'inherit',
  cursor: 'pointer',
};

const discardBtn: React.CSSProperties = {
  background: '#222',
  border: '1px solid #555',
  borderRadius: 4,
  padding: '3px 8px',
  fontSize: 10,
  color: 'inherit',
  cursor: 'pointer',
};

const landBtn: React.CSSProperties = {
  background: 'var(--accent)',
  color: '#111',
  border: 'none',
  borderRadius: 4,
  padding: '3px 8px',
  fontSize: 10,
  fontWeight: 600,
  cursor: 'pointer',
};

export default function ReadyToLandTray({ tasks, onLand, onDiscard, onDiff, onLandAll }: Props) {
  // Default expanded so callback buttons (Land/Discard/Diff) are reachable; collapse logic is purely visual.
  const [expanded, setExpanded] = useState(true);
  if (tasks.length === 0) return null;

  const first = tasks[0];
  const summary = `${first.title} · +${first.additions} −${first.deletions}`;

  return (
    <section
      aria-label="ready to land"
      style={{
        borderTop: '1px solid #3a8',
        background: 'rgba(58,168,108,0.04)',
        flexShrink: 0,
      }}
    >
      <header
        style={{
          background: '#162218',
          padding: '6px 12px',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          fontSize: 10,
          letterSpacing: 1,
        }}
      >
        <div style={{ color: '#7e8', textTransform: 'uppercase' }}>
          ✓ Ready to Land · {tasks.length}
          {tasks.length === 1 && !expanded && (
            <span style={{ opacity: 0.55, textTransform: 'none', letterSpacing: 'normal', marginLeft: 8 }}>
              {summary}
            </span>
          )}
        </div>
        <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
          <button type="button" onClick={onLandAll} style={linkBtn}>land all green</button>
          <span style={{ opacity: 0.4 }}>·</span>
          <button
            type="button"
            onClick={() => setExpanded(e => !e)}
            aria-label={expanded ? 'collapse ready' : 'expand ready'}
            style={linkBtn}
          >
            {expanded ? 'collapse' : 'expand'}
          </button>
        </div>
      </header>
      {expanded && (
        <ul style={{ listStyle: 'none', margin: 0, padding: 0 }}>
          {tasks.map(t => (
            <li
              key={t.id}
              style={{
                padding: '8px 12px',
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                gap: 8,
                fontSize: 11,
              }}
            >
              <div style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                <b>{t.title}</b>
                <span style={{ opacity: 0.6, marginLeft: 8, fontFamily: 'monospace' }}>
                  {t.branch}
                </span>
                <span style={{ marginLeft: 8 }}>
                  <span style={{ color: '#3a8' }}>+{t.additions}</span>{' '}
                  <span style={{ color: '#e88' }}>−{t.deletions}</span>
                </span>
              </div>
              <div style={{ display: 'flex', gap: 6, flexShrink: 0 }}>
                <button type="button" style={ghostBtn} onClick={() => onDiff(t.id)}>Diff</button>
                <button type="button" style={discardBtn} onClick={() => onDiscard(t.id)}>Discard</button>
                <button type="button" style={landBtn} onClick={() => onLand(t.id)}>Land</button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
