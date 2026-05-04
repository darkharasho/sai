import { useEffect, useState } from 'react';

export type ToastTone = 'success' | 'error';

interface WorkspaceToastProps {
  message: string;
  onDismiss: () => void;
  tone?: ToastTone;
}

export default function WorkspaceToast({ message, onDismiss, tone = 'success' }: WorkspaceToastProps) {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    requestAnimationFrame(() => setVisible(true));
    const timer = setTimeout(() => {
      setVisible(false);
      setTimeout(onDismiss, 300);
    }, 4000);
    return () => clearTimeout(timer);
  }, [onDismiss]);

  const accentVar = tone === 'error' ? 'var(--red)' : 'var(--accent)';
  const glyph = tone === 'error' ? '⚠' : '✓';

  return (
    <div
      style={{
        position: 'fixed',
        bottom: 16,
        right: 16,
        background: 'var(--bg-elevated)',
        border: '1px solid var(--border)',
        borderRadius: 8,
        padding: '10px 16px',
        boxShadow: '0 8px 24px rgba(0,0,0,0.4)',
        zIndex: 900,
        display: 'flex',
        alignItems: 'center',
        gap: 8,
        fontSize: 12,
        color: 'var(--text)',
        transform: visible ? 'translateY(0)' : 'translateY(20px)',
        opacity: visible ? 1 : 0,
        transition: 'transform 0.3s ease, opacity 0.3s ease',
        pointerEvents: 'auto',
      }}
    >
      <span style={{ color: accentVar, fontSize: 14 }}>{glyph}</span>
      {message}
    </div>
  );
}
