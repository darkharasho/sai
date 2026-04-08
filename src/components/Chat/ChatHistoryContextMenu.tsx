import { useEffect, useRef, useState } from 'react';
import { Pencil, Pin, PinOff, Download, Trash2 } from 'lucide-react';

interface ChatHistoryContextMenuProps {
  x: number;
  y: number;
  pinned: boolean;
  onAction: (action: 'rename' | 'pin' | 'export' | 'delete') => void;
  onClose: () => void;
}

export default function ChatHistoryContextMenu({ x, y, pinned, onAction, onClose }: ChatHistoryContextMenuProps) {
  const ref = useRef<HTMLDivElement>(null);
  const [confirmingDelete, setConfirmingDelete] = useState(false);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    };
    const keyHandler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('mousedown', handler);
    document.addEventListener('keydown', keyHandler);
    return () => {
      document.removeEventListener('mousedown', handler);
      document.removeEventListener('keydown', keyHandler);
    };
  }, [onClose]);

  useEffect(() => {
    if (!ref.current) return;
    const rect = ref.current.getBoundingClientRect();
    if (rect.right > window.innerWidth) {
      ref.current.style.left = `${window.innerWidth - rect.width - 8}px`;
    }
    if (rect.bottom > window.innerHeight) {
      ref.current.style.top = `${window.innerHeight - rect.height - 8}px`;
    }
  }, [confirmingDelete]);

  const menuStyle: React.CSSProperties = {
    position: 'fixed',
    left: x,
    top: y,
    background: 'var(--bg-elevated)',
    border: '1px solid var(--border)',
    borderRadius: 6,
    padding: '4px 0',
    minWidth: 200,
    boxShadow: '0 8px 24px rgba(0,0,0,0.4)',
    zIndex: 2000,
    fontSize: 13,
  };

  const itemStyle: React.CSSProperties = {
    padding: '6px 12px',
    cursor: 'pointer',
    display: 'flex',
    alignItems: 'center',
    gap: 8,
    color: 'var(--text)',
    background: 'transparent',
    border: 'none',
    width: '100%',
    textAlign: 'left',
    fontSize: 13,
  };

  return (
    <div ref={ref} style={menuStyle}>
      {confirmingDelete ? (
        <div style={{ padding: '8px 12px' }}>
          <div style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 8 }}>
            Delete this conversation?
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <button
              onClick={() => setConfirmingDelete(false)}
              style={{
                padding: '4px 12px',
                background: 'var(--bg-hover)',
                border: '1px solid var(--border)',
                borderRadius: 4,
                color: 'var(--text)',
                cursor: 'pointer',
                fontSize: 12,
              }}
            >
              Cancel
            </button>
            <button
              onClick={() => onAction('delete')}
              style={{
                padding: '4px 12px',
                background: 'var(--red)',
                border: 'none',
                borderRadius: 4,
                color: '#fff',
                cursor: 'pointer',
                fontSize: 12,
              }}
            >
              Delete
            </button>
          </div>
        </div>
      ) : (
        <>
          <button
            style={itemStyle}
            onClick={() => onAction('rename')}
            onMouseEnter={e => (e.currentTarget.style.background = 'var(--bg-hover)')}
            onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
          >
            <Pencil size={14} /> Rename
          </button>
          <button
            style={itemStyle}
            onClick={() => onAction('pin')}
            onMouseEnter={e => (e.currentTarget.style.background = 'var(--bg-hover)')}
            onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
          >
            {pinned ? <PinOff size={14} /> : <Pin size={14} />}
            {pinned ? 'Unpin' : 'Pin to top'}
          </button>
          <button
            style={itemStyle}
            onClick={() => onAction('export')}
            onMouseEnter={e => (e.currentTarget.style.background = 'var(--bg-hover)')}
            onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
          >
            <Download size={14} /> Export as Markdown
          </button>
          <div style={{ height: 1, background: 'var(--border)', margin: '4px 0' }} />
          <button
            style={{ ...itemStyle, color: 'var(--red)' }}
            onClick={() => setConfirmingDelete(true)}
            onMouseEnter={e => (e.currentTarget.style.background = 'var(--bg-hover)')}
            onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
          >
            <Trash2 size={14} /> Delete
          </button>
        </>
      )}
    </div>
  );
}
