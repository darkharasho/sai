import { Search } from 'lucide-react';

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
          background: 'var(--surface-2)',
          border: `1px solid ${value ? 'var(--border-strong)' : 'var(--border-subtle)'}`,
          borderRadius: 4,
          padding: '3px 8px',
        }}
      >
        <Search size={11} color="var(--text-muted)" aria-hidden="true" />
        <input
          type="text"
          value={value}
          onChange={e => onChange(e.target.value)}
          placeholder="Filter changed files… (Ctrl+F)"
          aria-label="Filter changed files"
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
