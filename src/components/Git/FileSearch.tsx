interface FileSearchProps {
  value: string;
  onChange: (value: string) => void;
  matchCount?: number;
}

export default function FileSearch({ value, onChange, matchCount }: FileSearchProps) {
  return (
    <div style={{ padding: '4px 12px 6px' }}>
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 6,
          background: value ? 'var(--bg-input)' : 'var(--bg-secondary)',
          border: `1px solid ${value ? 'var(--accent)' : 'var(--border)'}`,
          borderRadius: 4,
          padding: '3px 8px',
        }}
      >
        <span style={{ color: 'var(--text-muted)', fontSize: 11 }}>🔍</span>
        <input
          type="text"
          value={value}
          onChange={e => onChange(e.target.value)}
          placeholder="Filter changed files… (Ctrl+F)"
          style={{
            flex: 1,
            background: 'none',
            border: 'none',
            outline: 'none',
            color: 'var(--text)',
            fontSize: 11,
            fontFamily: 'inherit',
          }}
          onKeyDown={e => {
            if (e.key === 'Escape') onChange('');
          }}
        />
        {value && matchCount !== undefined && (
          <span style={{ color: 'var(--text-muted)', fontSize: 10, flexShrink: 0 }}>
            {matchCount} match{matchCount !== 1 ? 'es' : ''}
          </span>
        )}
      </div>
    </div>
  );
}
