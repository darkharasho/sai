import React from 'react';

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

const READ_TOOLS = new Set(['read', 'Read', 'view', 'View', 'cat']);

export default function ApprovalTray({ approvals, onApprove, onDeny, onApproveAllReads, onDenyAll }: Props) {
  if (approvals.length === 0) return null;
  const hasReads = approvals.some(a => READ_TOOLS.has(a.toolName));

  return (
    <section
      aria-label="pending approvals"
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
        <span>{approvals.length} pending approval{approvals.length === 1 ? '' : 's'}</span>
        <div style={{ flex: 1 }} />
        {hasReads && (
          <button type="button" onClick={onApproveAllReads} style={{ fontSize: 11 }}>
            approve all reads
          </button>
        )}
        <button type="button" onClick={onDenyAll} style={{ fontSize: 11 }}>
          deny all
        </button>
      </header>
      <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: 4 }}>
        {approvals.map(a => (
          <li key={a.id} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '4px 6px', borderRadius: 4, border: '1px solid var(--border)' }}>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 12, fontWeight: 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {a.taskTitle}
              </div>
              <div style={{ fontSize: 11, opacity: 0.7, fontFamily: 'monospace', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {a.toolName}{a.command ? ` · ${a.command}` : ''}
              </div>
            </div>
            <button type="button" onClick={() => onDeny(a.id)} style={{ fontSize: 11 }}>Deny</button>
            <button type="button" onClick={() => onApprove(a.id)} style={{ fontSize: 11 }}>Approve</button>
          </li>
        ))}
      </ul>
    </section>
  );
}
