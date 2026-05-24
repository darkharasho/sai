import { useEffect, useRef, useState } from 'react';

export type ToastTone = 'success' | 'error' | 'attention';

interface WorkspaceToastProps {
  message: string;
  onDismiss: () => void;
  tone?: ToastTone;
  onClick?: () => void;
  inline?: boolean;
}

export default function WorkspaceToast({ message, onDismiss, tone = 'success', onClick, inline = false }: WorkspaceToastProps) {
  const [visible, setVisible] = useState(false);
  const clickDismissTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    requestAnimationFrame(() => setVisible(true));
    const timer = setTimeout(() => {
      setVisible(false);
      setTimeout(onDismiss, 300);
    }, 4000);
    return () => {
      clearTimeout(timer);
      if (clickDismissTimerRef.current !== null) {
        clearTimeout(clickDismissTimerRef.current);
      }
    };
  }, [onDismiss]);

  const accentVar =
    tone === 'error' ? 'var(--red)' :
    tone === 'attention' ? 'var(--orange)' :
    'var(--accent)';
  const glyph =
    tone === 'error' ? '⚠' :
    tone === 'attention' ? '!' :
    '✓';

  const handleClick = onClick
    ? () => { onClick(); setVisible(false); clickDismissTimerRef.current = setTimeout(onDismiss, 100); }
    : undefined;

  return (
    <div
      onClick={handleClick}
      style={{
        position: inline ? 'relative' : 'fixed',
        bottom: inline ? 'auto' : 16,
        right: inline ? 'auto' : 16,
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
        cursor: onClick ? 'pointer' : 'default',
      }}
    >
      <span style={{ color: accentVar, fontSize: 14 }}>{glyph}</span>
      {message}
    </div>
  );
}
