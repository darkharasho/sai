import { useState } from 'react';

interface Props {
  name: string;
  input?: Record<string, unknown>;
  result?: string | Record<string, unknown>;
  status: 'running' | 'done' | 'error';
}

export default function ToolCard({ name, input, result, status }: Props) {
  const [expanded, setExpanded] = useState(false);
  const dotColor = status === 'done' ? 'var(--green)' : status === 'error' ? 'var(--red)' : 'var(--accent)';

  return (
    <div
      style={{
        alignSelf: 'flex-start',
        maxWidth: '88%',
        minWidth: 0,
        border: '1px solid var(--border)',
        background: 'var(--bg-mid)',
        borderRadius: 10,
        fontSize: 13,
        overflow: 'hidden',
      }}
    >
      <button
        onClick={() => setExpanded((v) => !v)}
        style={{
          width: '100%',
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          padding: '8px 12px',
          background: 'transparent',
          color: 'var(--text)',
          border: 'none',
          cursor: 'pointer',
          fontFamily: 'inherit',
          fontSize: 'inherit',
          textAlign: 'left',
        }}
      >
        <span style={{
          display: 'inline-block', width: 8, height: 8, borderRadius: '50%', background: dotColor,
        }} />
        <span style={{
          fontFamily: '"Geist Mono", ui-monospace, monospace',
          color: 'var(--accent)',
        }}>{name}</span>
        <span style={{ marginLeft: 'auto', color: 'var(--text-muted)', fontSize: 11 }}>
          {expanded ? '▾' : '▸'}
        </span>
      </button>
      {expanded && (
        <div style={{
          padding: '4px 12px 12px',
          fontFamily: '"Geist Mono", ui-monospace, monospace',
          fontSize: 11,
          color: 'var(--text-secondary)',
          display: 'flex',
          flexDirection: 'column',
          gap: 8,
        }}>
          {input && (
            <div>
              <div style={{ color: 'var(--text-muted)', marginBottom: 2 }}>input</div>
              <pre style={{ margin: 0, whiteSpace: 'pre-wrap', wordBreak: 'break-word', overflowWrap: 'anywhere' }}>
                {JSON.stringify(input, null, 2)}
              </pre>
            </div>
          )}
          {result !== undefined && (
            <div>
              <div style={{ color: 'var(--text-muted)', marginBottom: 2 }}>result</div>
              <pre style={{ margin: 0, whiteSpace: 'pre-wrap', wordBreak: 'break-word', overflowWrap: 'anywhere' }}>
                {typeof result === 'string' ? result : JSON.stringify(result, null, 2)}
              </pre>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
