import React from 'react';
import { isReadTool } from '../../lib/swarmToolTaxonomy';

export interface ApprovalRow {
  id: string;
  taskId: string;
  taskTitle: string;
  toolName: string;
  command?: string;
  createdAt: number;
}

interface Props {
  approvals: ApprovalRow[];
  onApprove: (id: string) => void;
  onDeny: (id: string) => void;
  onApproveAllReads: () => void;
  onDenyAll: () => void;
}

function relativeTime(ts: number): string {
  const diff = Math.max(0, Date.now() - ts);
  const m = Math.floor(diff / 60000);
  if (m < 1) return 'just now';
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  return `${d}d ago`;
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

const denyBtn: React.CSSProperties = {
  background: '#222',
  border: '1px solid #555',
  borderRadius: 4,
  padding: '3px 8px',
  fontSize: 10,
  color: 'inherit',
  cursor: 'pointer',
};

const approveBtn: React.CSSProperties = {
  background: '#3a8',
  color: '#111',
  border: 'none',
  borderRadius: 4,
  padding: '3px 8px',
  fontSize: 10,
  fontWeight: 600,
  cursor: 'pointer',
};

export default function ApprovalTray({ approvals, onApprove, onDeny, onApproveAllReads, onDenyAll }: Props) {
  if (approvals.length === 0) return null;
  const hasReads = approvals.some(a => isReadTool(a.toolName));

  return (
    <section
      aria-label="pending approvals"
      style={{
        borderTop: '1px solid #b44',
        background: 'rgba(180,68,68,0.05)',
        flexShrink: 0,
      }}
    >
      <header
        style={{
          background: '#221616',
          padding: '6px 12px',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          fontSize: 10,
          letterSpacing: 1,
        }}
      >
        <div style={{ color: '#e88', textTransform: 'uppercase' }}>
          ⚠ Approvals · {approvals.length}
        </div>
        <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
          {hasReads && (
            <button type="button" onClick={onApproveAllReads} style={linkBtn}>
              approve all reads
            </button>
          )}
          <span style={{ opacity: 0.4 }}>·</span>
          <button type="button" onClick={onDenyAll} style={linkBtn}>
            deny all
          </button>
        </div>
      </header>
      <ul style={{ listStyle: 'none', margin: 0, padding: 0 }}>
        {approvals.map(a => (
          <li
            key={a.id}
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
              <b>{a.taskTitle}</b>
              {' · '}
              <code style={{ background: '#222', padding: '1px 4px', borderRadius: 3 }}>
                {a.toolName}{a.command ? `: ${a.command}` : ''}
              </code>
              <small style={{ opacity: 0.5, marginLeft: 8 }}>{relativeTime(a.createdAt)}</small>
            </div>
            <div style={{ display: 'flex', gap: 6, flexShrink: 0 }}>
              <button type="button" style={ghostBtn} onClick={() => { /* view: no-op */ }}>View</button>
              <button type="button" style={denyBtn} onClick={() => onDeny(a.id)}>Deny</button>
              <button type="button" style={approveBtn} onClick={() => onApprove(a.id)}>Approve</button>
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}
