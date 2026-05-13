import { useEffect } from 'react';

interface QuitSwarmConfirmModalProps {
  tasks: { id: string; title: string }[];
  onCancel: () => void;
  onConfirm: () => void;
}

const MAX_VISIBLE = 8;

export default function QuitSwarmConfirmModal({ tasks, onCancel, onConfirm }: QuitSwarmConfirmModalProps) {
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onCancel();
      if (e.key === 'Enter') onConfirm();
    };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [onCancel, onConfirm]);

  const visible = tasks.slice(0, MAX_VISIBLE);
  const remaining = tasks.length - visible.length;

  return (
    <div
      className="sai-overlay-in"
      onClick={onCancel}
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 1000,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: 'rgba(0, 0, 0, 0.6)',
        backdropFilter: 'blur(2px)',
      }}
    >
      <div
        className="sai-modal-in"
        onClick={(e) => e.stopPropagation()}
        style={{
          background: 'var(--bg-elevated)',
          border: '1px solid var(--border)',
          borderRadius: 8,
          padding: '24px 28px',
          width: 420,
          maxWidth: '90vw',
          boxShadow: '0 8px 32px rgba(0,0,0,0.6)',
          display: 'flex',
          flexDirection: 'column',
          gap: 20,
        }}
      >
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--text)' }}>
            Tasks still running
          </span>
          <span style={{ fontSize: 12, color: 'var(--text-muted)', lineHeight: 1.5 }}>
            {tasks.length === 1 ? '1 swarm task is' : `${tasks.length} swarm tasks are`} still streaming.
            These tasks will be paused if you quit now.
          </span>
        </div>

        <ul
          style={{
            listStyle: 'none',
            margin: 0,
            padding: 0,
            display: 'flex',
            flexDirection: 'column',
            gap: 4,
            maxHeight: 220,
            overflowY: 'auto',
            borderTop: '1px solid var(--border)',
            borderBottom: '1px solid var(--border)',
            paddingTop: 8,
            paddingBottom: 8,
          }}
        >
          {visible.map((t) => (
            <li
              key={t.id}
              style={{
                fontSize: 12,
                color: 'var(--text-secondary)',
                fontFamily: "'JetBrains Mono', monospace",
                whiteSpace: 'nowrap',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
              }}
            >
              {t.title}
            </li>
          ))}
          {remaining > 0 && (
            <li style={{ fontSize: 11, color: 'var(--text-muted)', fontStyle: 'italic' }}>
              +{remaining} more
            </li>
          )}
        </ul>

        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
          <button
            onClick={onCancel}
            style={{
              background: 'none',
              border: '1px solid var(--border)',
              color: 'var(--text-muted)',
              borderRadius: 5,
              padding: '6px 14px',
              fontSize: 12,
              cursor: 'pointer',
            }}
            onMouseEnter={(e) => {
              (e.currentTarget as HTMLElement).style.color = 'var(--text)';
              (e.currentTarget as HTMLElement).style.borderColor = 'var(--text-muted)';
            }}
            onMouseLeave={(e) => {
              (e.currentTarget as HTMLElement).style.color = 'var(--text-muted)';
              (e.currentTarget as HTMLElement).style.borderColor = 'var(--border)';
            }}
          >
            Cancel
          </button>
          <button
            onClick={onConfirm}
            style={{
              background: 'var(--accent)',
              border: '1px solid transparent',
              color: '#000',
              borderRadius: 5,
              padding: '6px 14px',
              fontSize: 12,
              fontWeight: 600,
              cursor: 'pointer',
            }}
            onMouseEnter={(e) => {
              (e.currentTarget as HTMLElement).style.background = 'var(--accent-hover)';
            }}
            onMouseLeave={(e) => {
              (e.currentTarget as HTMLElement).style.background = 'var(--accent)';
            }}
          >
            Quit anyway
          </button>
        </div>
      </div>
    </div>
  );
}
