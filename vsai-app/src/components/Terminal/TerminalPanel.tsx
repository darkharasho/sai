interface TerminalPanelProps {
  projectPath: string;
}

export default function TerminalPanel({ projectPath }: TerminalPanelProps) {
  return (
    <div
      style={{
        height: 200,
        minHeight: 'var(--terminal-min-height)',
        background: 'var(--bg-mid)',
        borderTop: '1px solid var(--border)',
        display: 'flex',
        flexDirection: 'column',
      }}
    >
      <div
        style={{
          height: 32,
          display: 'flex',
          alignItems: 'center',
          padding: '0 12px',
          fontSize: 11,
          fontWeight: 600,
          textTransform: 'uppercase' as const,
          letterSpacing: '0.5px',
          color: 'var(--text-muted)',
          borderBottom: '1px solid var(--border)',
        }}
      >
        Terminal
      </div>
      <div style={{ flex: 1 }} />
    </div>
  );
}
