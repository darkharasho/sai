import React from 'react';

export interface RecentTaskRow {
  id: string;
  title: string;
  status: 'landed' | 'discarded' | 'failed';
  lastActivityAt: number;
}

interface Props {
  items: RecentTaskRow[];
}

function formatRelative(ts: number, now: number = Date.now()): string {
  const d = Math.max(0, now - ts);
  const sec = Math.floor(d / 1000);
  if (sec < 60) return `${sec}s ago`;
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min}m ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h ago`;
  const day = Math.floor(hr / 24);
  return `${day}d ago`;
}

export default function RecentActivity({ items }: Props) {
  if (items.length === 0) return null;
  return (
    <section
      aria-label="recent activity"
      style={{
        borderBottom: '1px solid var(--border)',
        padding: 8,
        display: 'flex',
        flexDirection: 'column',
        gap: 4,
      }}
    >
      <header style={{ fontSize: 11, fontWeight: 600, opacity: 0.7, letterSpacing: 0.5 }}>RECENT</header>
      <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: 2 }}>
        {items.map(t => (
          <li key={t.id} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '2px 4px', fontSize: 12 }}>
            <span style={{
              fontSize: 10,
              padding: '1px 6px',
              borderRadius: 3,
              textTransform: 'uppercase',
              opacity: 0.8,
              border: '1px solid var(--border)',
            }}>{t.status}</span>
            <span style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {t.title}
            </span>
            <time style={{ fontSize: 11, opacity: 0.6 }} dateTime={new Date(t.lastActivityAt).toISOString()}>
              {formatRelative(t.lastActivityAt)}
            </time>
          </li>
        ))}
      </ul>
    </section>
  );
}
