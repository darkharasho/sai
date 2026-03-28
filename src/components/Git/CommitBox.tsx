import { useState } from 'react';

interface CommitBoxProps {
  branch: string;
  ahead: number;
  behind: number;
  onCommit: (message: string) => Promise<void>;
  onPush: () => Promise<void>;
  onPull: () => Promise<void>;
}

export default function CommitBox({ branch, ahead, behind, onCommit, onPush, onPull }: CommitBoxProps) {
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);

  const handle = async (fn: () => Promise<void>) => {
    setBusy(true);
    try {
      await fn();
    } finally {
      setBusy(false);
    }
  };

  const handleCommit = async () => {
    if (!message.trim()) return;
    await handle(async () => {
      await onCommit(message.trim());
      setMessage('');
    });
  };

  return (
    <div
      style={{
        borderTop: '1px solid var(--border)',
        padding: '10px 12px',
        display: 'flex',
        flexDirection: 'column',
        gap: 8,
      }}
    >
      {/* Branch indicator */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 6,
          fontSize: 11,
          color: 'var(--text-secondary)',
        }}
      >
        <span style={{ color: 'var(--accent)' }}>⎇</span>
        <span
          style={{
            flex: 1,
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap' as const,
          }}
          title={branch}
        >
          {branch || 'no branch'}
        </span>
      </div>

      {/* Commit message textarea */}
      <textarea
        value={message}
        onChange={(e) => setMessage(e.target.value)}
        placeholder="Commit message…"
        rows={3}
        disabled={busy}
        style={{
          width: '100%',
          resize: 'vertical' as const,
          background: 'var(--bg-input)',
          border: '1px solid var(--border)',
          borderRadius: 4,
          color: 'var(--text)',
          fontSize: 12,
          padding: '6px 8px',
          outline: 'none',
          fontFamily: 'inherit',
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
            e.preventDefault();
            handleCommit();
          }
        }}
      />

      {/* Commit button */}
      <button
        onClick={handleCommit}
        disabled={!message.trim() || busy}
        style={{
          width: '100%',
          padding: '6px 0',
          border: 'none',
          borderRadius: 4,
          background: message.trim() && !busy ? 'var(--accent)' : 'var(--bg-hover)',
          color: message.trim() && !busy ? '#000' : 'var(--text-muted)',
          fontSize: 12,
          fontWeight: 600,
          cursor: message.trim() && !busy ? 'pointer' : 'not-allowed',
          transition: 'background 0.15s',
        }}
        onMouseEnter={(e) => {
          if (message.trim() && !busy)
            (e.currentTarget as HTMLButtonElement).style.background = 'var(--accent-hover)';
        }}
        onMouseLeave={(e) => {
          if (message.trim() && !busy)
            (e.currentTarget as HTMLButtonElement).style.background = 'var(--accent)';
        }}
      >
        {busy ? 'Working…' : 'Commit'}
      </button>

      {/* Push / Pull row */}
      <div style={{ display: 'flex', gap: 6 }}>
        <button
          onClick={() => handle(onPush)}
          disabled={busy}
          title="Push"
          style={{
            flex: 1,
            padding: '5px 0',
            border: '1px solid var(--border)',
            borderRadius: 4,
            background: 'var(--bg-input)',
            color: busy ? 'var(--text-muted)' : 'var(--text-secondary)',
            fontSize: 12,
            cursor: busy ? 'not-allowed' : 'pointer',
          }}
          onMouseEnter={(e) => {
            if (!busy) (e.currentTarget as HTMLButtonElement).style.background = 'var(--bg-hover)';
          }}
          onMouseLeave={(e) => {
            (e.currentTarget as HTMLButtonElement).style.background = 'var(--bg-input)';
          }}
        >
          ↑{ahead > 0 ? ahead : ''}
          {' '}Push
        </button>

        <button
          onClick={() => handle(onPull)}
          disabled={busy}
          title="Pull"
          style={{
            flex: 1,
            padding: '5px 0',
            border: '1px solid var(--border)',
            borderRadius: 4,
            background: 'var(--bg-input)',
            color: busy ? 'var(--text-muted)' : 'var(--text-secondary)',
            fontSize: 12,
            cursor: busy ? 'not-allowed' : 'pointer',
          }}
          onMouseEnter={(e) => {
            if (!busy) (e.currentTarget as HTMLButtonElement).style.background = 'var(--bg-hover)';
          }}
          onMouseLeave={(e) => {
            (e.currentTarget as HTMLButtonElement).style.background = 'var(--bg-input)';
          }}
        >
          ↓{behind > 0 ? behind : ''}
          {' '}Pull
        </button>
      </div>
    </div>
  );
}
