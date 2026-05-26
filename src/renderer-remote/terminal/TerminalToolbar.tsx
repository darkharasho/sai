import { ArrowLeft } from 'lucide-react';

type Key = 'Esc' | 'Tab' | 'Up' | 'Down' | 'Left' | 'Right' | 'Ctrl' | 'Enter';

interface Props {
  ctrlSticky: boolean;
  onKey: (k: Key) => void;
  onBack: () => void;
  onCtrlChar?: (ch: string) => boolean;
  /** 'full' (default, phone-owned): typing via xterm textarea + control keys.
   *  'view-only' (desktop-owned): no typing; toolbar exposes Enter as well. */
  variant?: 'full' | 'view-only';
}

export default function TerminalToolbar({ ctrlSticky, onKey, onBack, variant = 'full' }: Props) {
  const btnBase: React.CSSProperties = {
    minWidth: 40,
    height: 36,
    padding: '0 10px',
    background: 'var(--bg-elevated)',
    color: 'var(--text)',
    border: '1px solid var(--border)',
    borderRadius: 8,
    fontFamily: '"Geist Mono", ui-monospace, monospace',
    fontSize: 13,
    cursor: 'pointer',
    flexShrink: 0,
  };
  const ctrlStyle: React.CSSProperties = ctrlSticky ? {
    ...btnBase, background: 'var(--accent)', color: '#000', borderColor: 'var(--accent)',
  } : btnBase;

  return (
    <div style={{
      display: 'flex',
      alignItems: 'center',
      gap: 6,
      padding: '6px 8px',
      background: 'var(--bg-secondary)',
      borderTop: '1px solid var(--border)',
      overflowX: 'auto',
      WebkitOverflowScrolling: 'touch',
    }}>
      <button onClick={onBack} aria-label="Back to drawer" style={{ ...btnBase, minWidth: 36 }}>
        <ArrowLeft size={16} strokeWidth={2} />
      </button>
      <button onClick={() => onKey('Esc')}  style={btnBase}>Esc</button>
      <button onClick={() => onKey('Tab')}  style={btnBase}>Tab</button>
      <button onClick={() => onKey('Ctrl')} style={ctrlStyle}>Ctrl</button>
      <button onClick={() => onKey('Up')}    style={btnBase}>↑</button>
      <button onClick={() => onKey('Down')}  style={btnBase}>↓</button>
      <button onClick={() => onKey('Left')}  style={btnBase}>←</button>
      <button onClick={() => onKey('Right')} style={btnBase}>→</button>
      {variant === 'view-only' && (
        <>
          <button onClick={() => onKey('Enter')} style={btnBase}>Enter</button>
          <div style={{ flex: 1 }} />
          <span style={{
            fontSize: 11,
            padding: '2px 8px',
            borderRadius: 999,
            border: '1px solid var(--border)',
            color: 'var(--text-muted)',
            background: 'transparent',
            whiteSpace: 'nowrap',
          }}>view only</span>
        </>
      )}
    </div>
  );
}
