import { useEffect } from 'react';

interface Props {
  title: string;
  branch: string;
  baseBranch: string;
  diff: string;
  loading?: boolean;
  error?: string;
  onClose: () => void;
}

export default function SwarmDiffModal({ title, branch, baseBranch, diff, loading, error, onClose }: Props) {
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [onClose]);

  return (
    <div
      className="sai-overlay-in"
      onClick={onClose}
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 1000,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: 'rgba(0, 0, 0, 0.6)',
        backdropFilter: 'blur(2px)',
      }}
    >
      <div
        className="sai-modal-in"
        onClick={(e) => e.stopPropagation()}
        style={{
          background: 'var(--bg-elevated)',
          border: '1px solid var(--border)',
          borderRadius: 8,
          width: 'min(900px, 92vw)',
          height: 'min(720px, 86vh)',
          boxShadow: '0 8px 32px rgba(0,0,0,0.6)',
          display: 'flex',
          flexDirection: 'column',
          overflow: 'hidden',
        }}
      >
        <div style={{ padding: '14px 18px', borderBottom: '1px solid var(--border)', display: 'flex', alignItems: 'center', gap: 10 }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 2, flex: 1, minWidth: 0 }}>
            <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {title}
            </span>
            <span style={{ fontSize: 11, color: 'var(--text-muted)', fontFamily: "'Geist Mono', 'JetBrains Mono', monospace" }}>
              {baseBranch} <span style={{ opacity: 0.5 }}>..</span> {branch}
            </span>
          </div>
          <button
            onClick={onClose}
            style={{
              background: 'none',
              border: '1px solid var(--border)',
              color: 'var(--text-muted)',
              borderRadius: 5,
              padding: '4px 10px',
              fontSize: 11,
              cursor: 'pointer',
            }}
          >
            Close
          </button>
        </div>
        <div style={{ flex: 1, overflow: 'auto', padding: 0, background: 'var(--bg-secondary)' }}>
          {loading && (
            <div style={{ padding: 24, color: 'var(--text-muted)', fontSize: 12 }}>Loading diff…</div>
          )}
          {!loading && error && (
            <div style={{ padding: 24, color: 'var(--text-muted)', fontSize: 12 }}>
              Error loading diff: {error}
            </div>
          )}
          {!loading && !error && diff.trim() === '' && (
            <div style={{ padding: 24, color: 'var(--text-muted)', fontSize: 12 }}>
              No changes between {baseBranch} and {branch}.
            </div>
          )}
          {!loading && !error && diff.trim() !== '' && (
            <pre
              style={{
                margin: 0,
                padding: '14px 18px',
                fontFamily: "'Geist Mono', 'JetBrains Mono', monospace",
                fontSize: 12,
                lineHeight: 1.5,
                color: 'var(--text)',
                whiteSpace: 'pre',
                overflow: 'visible',
              }}
            >
              {diff}
            </pre>
          )}
        </div>
      </div>
    </div>
  );
}
