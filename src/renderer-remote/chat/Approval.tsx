interface Props {
  toolName: string;
  command?: string;
  input?: Record<string, unknown>;
  onDecide: (decision: 'approve' | 'deny', modifiedCommand?: string) => void;
}

export default function Approval({ toolName, command, input, onDecide }: Props) {
  const btn: React.CSSProperties = {
    padding: '8px 14px',
    fontSize: 13,
    fontWeight: 500,
    borderRadius: 8,
    border: '1px solid var(--border)',
    cursor: 'pointer',
  };
  return (
    <div
      style={{
        margin: '10px 0',
        padding: 12,
        borderRadius: 10,
        border: '1px solid var(--orange)',
        background: 'color-mix(in srgb, var(--orange) 8%, var(--bg-secondary))',
        display: 'flex',
        flexDirection: 'column',
        gap: 10,
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, fontWeight: 600 }}>
        <span style={{ color: 'var(--orange)' }}>●</span>
        <span style={{ color: 'var(--text)' }}>Approval needed</span>
        <span style={{
          fontFamily: '"Geist Mono", ui-monospace, monospace',
          fontSize: 12,
          color: 'var(--accent)',
        }}>{toolName}</span>
      </div>
      {(command || input) && (
        <pre style={{
          margin: 0,
          padding: 10,
          fontSize: 12,
          fontFamily: '"Geist Mono", ui-monospace, monospace',
          background: 'var(--bg-input)',
          color: 'var(--text)',
          border: '1px solid var(--border)',
          borderRadius: 8,
          whiteSpace: 'pre-wrap',
          wordBreak: 'break-word',
          overflowWrap: 'anywhere',
        }}>
          {command ?? JSON.stringify(input, null, 2)}
        </pre>
      )}
      <div style={{ display: 'flex', gap: 8 }}>
        <button
          onClick={() => onDecide('approve')}
          style={{ ...btn, background: 'var(--green)', color: '#000', borderColor: 'var(--green)' }}
        >
          Allow
        </button>
        <button
          onClick={() => onDecide('deny')}
          style={{ ...btn, background: 'var(--bg-elevated)', color: 'var(--text)' }}
        >
          Deny
        </button>
      </div>
    </div>
  );
}
