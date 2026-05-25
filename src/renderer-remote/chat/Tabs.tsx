interface Props {
  value: 'chat' | 'files';
  onChange: (v: 'chat' | 'files') => void;
}

export default function Tabs({ value, onChange }: Props) {
  const baseStyle: React.CSSProperties = {
    flex: 1,
    padding: '8px 0',
    fontSize: 12,
    fontWeight: 600,
    background: 'transparent',
    color: 'var(--text-muted)',
    border: 'none',
    cursor: 'pointer',
    fontFamily: '"Geist Mono", ui-monospace, monospace',
    textTransform: 'uppercase',
    letterSpacing: '0.08em',
    borderBottom: '2px solid transparent',
  };
  const activeStyle: React.CSSProperties = {
    color: 'var(--accent)',
    borderBottom: '2px solid var(--accent)',
  };
  return (
    <div style={{
      display: 'flex',
      background: 'var(--bg-secondary)',
      borderBottom: '1px solid var(--border)',
      flexShrink: 0,
    }}>
      <button
        style={{ ...baseStyle, ...(value === 'chat' ? activeStyle : null) }}
        onClick={() => onChange('chat')}
      >
        Chat
      </button>
      <button
        style={{ ...baseStyle, ...(value === 'files' ? activeStyle : null) }}
        onClick={() => onChange('files')}
      >
        Files
      </button>
    </div>
  );
}
