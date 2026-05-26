import { ArrowLeft } from 'lucide-react';

type Key = 'Esc' | 'Tab' | 'Up' | 'Down' | 'Left' | 'Right' | 'Ctrl';

interface Props {
  ctrlSticky: boolean;
  onKey: (k: Key) => void;
  /** Restore the drawer / leave fullscreen. */
  onBack: () => void;
  /** Hook so a Ctrl+letter shortcut from another input layer can consume Ctrl. Currently unused but reserved. */
  onCtrlChar?: (ch: string) => boolean;
}

export default function TerminalToolbar({ ctrlSticky, onKey, onBack }: Props) {
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
    </div>
  );
}
