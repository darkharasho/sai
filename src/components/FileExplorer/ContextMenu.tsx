import { useEffect, useRef } from 'react';
import type { DirEntry } from '../../types';

interface ContextMenuProps {
  x: number;
  y: number;
  entry: DirEntry | null;
  onAction: (action: string) => void;
  onClose: () => void;
}

interface MenuItem {
  label: string;
  action: string;
  danger?: boolean;
  condition?: boolean;
}

export default function ContextMenu({ x, y, entry, onAction, onClose }: ContextMenuProps) {
  const ref = useRef<HTMLDivElement>(null);

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
  }, []);

  const items: (MenuItem | 'separator')[] = [
    { label: 'Open', action: 'open', condition: entry?.type === 'file' },
    ...(entry?.type === 'file' ? ['separator' as const] : []),
    { label: 'New File...', action: 'newFile' },
    { label: 'New Folder...', action: 'newFolder' },
    'separator',
    { label: 'Rename...', action: 'rename', condition: entry !== null },
    { label: 'Delete', action: 'delete', danger: true, condition: entry !== null },
    'separator',
    { label: 'Copy Path', action: 'copyPath', condition: entry !== null },
    { label: 'Copy Relative Path', action: 'copyRelativePath', condition: entry !== null },
  ];

  const visibleItems = items.filter(item => {
    if (item === 'separator') return true;
    return item.condition !== false;
  });

  const cleaned: typeof visibleItems = [];
  for (let i = 0; i < visibleItems.length; i++) {
    const item = visibleItems[i];
    if (item === 'separator') {
      if (cleaned.length === 0) continue;
      if (cleaned[cleaned.length - 1] === 'separator') continue;
      if (i === visibleItems.length - 1) continue;
    }
    cleaned.push(item);
  }

  return (
    <div
      ref={ref}
      style={{
        position: 'fixed',
        left: x,
        top: y,
        background: '#1c2128',
        border: '1px solid var(--border)',
        borderRadius: 6,
        padding: '4px 0',
        minWidth: 180,
        boxShadow: '0 8px 24px rgba(0,0,0,0.4)',
        zIndex: 2000,
        fontFamily: "'JetBrains Mono', monospace",
        fontSize: 13,
      }}
    >
      {cleaned.map((item, i) => {
        if (item === 'separator') {
          return <div key={`sep-${i}`} style={{ height: 1, background: 'var(--border)', margin: '4px 0' }} />;
        }
        return (
          <div
            key={item.action}
            onClick={() => onAction(item.action)}
            style={{
              padding: '6px 16px',
              color: item.danger ? 'var(--red)' : 'var(--text)',
              cursor: 'pointer',
            }}
            onMouseEnter={e => (e.currentTarget.style.background = 'var(--bg-hover)')}
            onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
          >
            {item.label}
          </div>
        );
      })}
    </div>
  );
}
