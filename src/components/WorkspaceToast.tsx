import { useEffect, useState } from 'react';

interface WorkspaceToastProps {
  message: string;
  onDismiss: () => void;
}

export default function WorkspaceToast({ message, onDismiss }: WorkspaceToastProps) {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    requestAnimationFrame(() => setVisible(true));
    const timer = setTimeout(() => {
      setVisible(false);
      setTimeout(onDismiss, 300);
    }, 4000);
    return () => clearTimeout(timer);
  }, [onDismiss]);

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
      <span style={{ color: 'var(--accent)', fontSize: 14 }}>&#10003;</span>
      {message}
    </div>
  );
}
