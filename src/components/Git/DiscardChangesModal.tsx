import { useEffect } from 'react';
import { createPortal } from 'react-dom';

interface DiscardChangesModalProps {
  filePath: string;
  onConfirm: () => void;
  onCancel: () => void;
}

export default function DiscardChangesModal({ filePath, onConfirm, onCancel }: DiscardChangesModalProps) {
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onCancel();
      if (e.key === 'Enter') onConfirm();
    };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [onConfirm, onCancel]);

  // Portal to <body>: the modal is invoked from inside the git sidebar, whose
  // Framer-Motion `.sidebar-slot` wrapper applies a transform — that establishes a
  // containing block for `position: fixed`, trapping this overlay inside the narrow
  // sidebar ("wall to wall"). Rendering into <body> escapes it so it covers the window.
  return createPortal(
    <div
      data-discard-modal
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
        onClick={(e) => e.stopPropagation()}
        style={{
          background: 'var(--surface-3)',
          border: '1px solid var(--border-subtle)',
          borderRadius: 10,
          padding: '24px 28px',
          width: 360,
          boxShadow: '0 8px 32px rgba(0,0,0,0.6)',
          display: 'flex',
          flexDirection: 'column',
          gap: 20,
        }}
      >
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--text)' }}>
            Discard Changes
          </span>
          <span style={{ fontSize: 12, color: 'var(--text-muted)', lineHeight: 1.5 }}>
            Are you sure you want to discard changes to{' '}
            <span style={{ color: 'var(--text-secondary)', fontFamily: "'JetBrains Mono', monospace", fontSize: 11 }}>
              {filePath}
            </span>
            ? This cannot be undone.
          </span>
        </div>

        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
          <button
            onClick={onCancel}
            style={{
              background: 'var(--surface-3)',
              border: '1px solid var(--border-subtle)',
              color: 'var(--text-secondary)',
              borderRadius: 'var(--radius-sm)',
              padding: '5px var(--sp-2)',
              fontSize: 'var(--text-sm)',
              cursor: 'pointer',
            }}
            onMouseEnter={(e) => {
              (e.currentTarget as HTMLElement).style.color = 'var(--text)';
              (e.currentTarget as HTMLElement).style.borderColor = 'var(--border-strong)';
            }}
            onMouseLeave={(e) => {
              (e.currentTarget as HTMLElement).style.color = 'var(--text-secondary)';
              (e.currentTarget as HTMLElement).style.borderColor = 'var(--border-subtle)';
            }}
          >
            Cancel
          </button>
          <button
            onClick={onConfirm}
            style={{
              background: '#f87171',
              border: '1px solid transparent',
              color: '#000',
              borderRadius: 5,
              padding: '6px 14px',
              fontSize: 12,
              fontWeight: 600,
              cursor: 'pointer',
            }}
            onMouseEnter={(e) => {
              (e.currentTarget as HTMLElement).style.background = '#fca5a5';
            }}
            onMouseLeave={(e) => {
              (e.currentTarget as HTMLElement).style.background = '#f87171';
            }}
          >
            Discard
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
