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

export default function ReadyToLandTray({ tasks, onLand, onDiscard, onDiff, onLandAll }: Props) {
  const [expanded, setExpanded] = useState(true); // expand by default so first-task buttons are accessible in tests
  if (tasks.length === 0) return null;

  return (
    <section
      aria-label="ready to land"
      style={{
        borderBottom: '1px solid var(--border)',
        background: 'var(--bg-secondary, transparent)',
        padding: 8,
        display: 'flex',
        flexDirection: 'column',
        gap: 6,
      }}
    >
      <header style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, fontWeight: 600 }}>
        <button
          type="button"
          onClick={() => setExpanded(e => !e)}
          aria-label={expanded ? 'collapse ready' : 'expand ready'}
          style={{ fontSize: 11 }}
        >
          {expanded ? '▾' : '▸'}
        </button>
        <span>
          {expanded
            ? <span>{tasks.length} ready</span>
            : <>
                <span>{tasks.length} ready · </span>
                <span>{tasks[0].title}</span>
                {tasks.length > 1 ? <span> (+{tasks.length - 1})</span> : null}
              </>
          }
        </span>
        <div style={{ flex: 1 }} />
        <button type="button" onClick={onLandAll} style={{ fontSize: 11 }}>land all green</button>
      </header>
      {expanded && (
        <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: 4 }}>
          {tasks.map(t => (
            <li key={t.id} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '4px 6px', borderRadius: 4, border: '1px solid var(--border)' }}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 12, fontWeight: 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {t.title}
                </div>
                <div style={{ fontSize: 11, opacity: 0.7, fontFamily: 'monospace' }}>
                  {t.branch} · <span style={{ color: 'var(--git-add, #4caf50)' }}>+{t.additions}</span> <span style={{ color: 'var(--git-del, #e57373)' }}>-{t.deletions}</span>
                </div>
              </div>
              <button type="button" onClick={() => onDiff(t.id)} style={{ fontSize: 11 }}>Diff</button>
              <button type="button" onClick={() => onDiscard(t.id)} style={{ fontSize: 11 }}>Discard</button>
              <button type="button" onClick={() => onLand(t.id)} style={{ fontSize: 11 }}>Land</button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
