import { useEffect, useState } from 'react';
import { GitCommit as GitCommitIcon, ChevronDown, ChevronRight, FileText, RefreshCw } from 'lucide-react';
import { GitCommit } from '../../types';

interface GitHistoryProps {
  projectPath: string;
}

interface CommitDetails {
  hash: string;
  author: string;
  email: string;
  date: string;
  parents: string[];
  message: string;
  files: { path: string; additions: number; deletions: number }[];
}

const PROVIDER_LABELS = {
  claude: 'Claude',
  codex: 'Codex',
  gemini: 'Gemini',
} as const;

const PAGE_SIZE = 50;

function formatDate(dateStr: string): string {
  const date = new Date(dateStr);
  if (isNaN(date.getTime())) return dateStr;
  return date.toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    year: date.getFullYear() !== new Date().getFullYear() ? 'numeric' : undefined,
    hour: 'numeric',
    minute: '2-digit',
  });
}

export default function GitHistory({ projectPath }: GitHistoryProps) {
  const [commits, setCommits] = useState<GitCommit[]>([]);
  const [count, setCount] = useState(PAGE_SIZE);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [details, setDetails] = useState<Record<string, CommitDetails>>({});
  const [reachedEnd, setReachedEnd] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    window.sai
      .gitLog(projectPath, count)
      .then((log: GitCommit[]) => {
        if (cancelled) return;
        setCommits(log ?? []);
        setReachedEnd((log ?? []).length < count);
      })
      .catch((err: any) => {
        if (cancelled) return;
        setError(err?.message ?? 'Failed to load history');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [projectPath, count]);

  const toggle = async (hash: string) => {
    if (expanded === hash) {
      setExpanded(null);
      return;
    }
    setExpanded(hash);
    if (!details[hash]) {
      try {
        const d = await (window.sai as any).gitCommitDetails(projectPath, hash);
        setDetails((prev) => ({ ...prev, [hash]: d }));
      } catch (err: any) {
        setError(err?.message ?? 'Failed to load commit');
      }
    }
  };

  if (error) {
    return (
      <div style={{ padding: '24px 12px', textAlign: 'center', fontSize: 11, color: 'var(--red)' }}>
        {error}
      </div>
    );
  }

  if (!loading && commits.length === 0) {
    return (
      <div style={{ padding: '24px 12px', textAlign: 'center' }}>
        <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-muted)', marginBottom: 4 }}>
          No commits
        </div>
        <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>History is empty</div>
      </div>
    );
  }

  return (
    <div>
      {commits.map((commit) => {
        const shortHash = commit.hash.slice(0, 7);
        const isOpen = expanded === commit.hash;
        const det = details[commit.hash];
        return (
          <div
            key={commit.hash}
            style={{ borderBottom: '1px solid var(--border)' }}
          >
            <div
              onClick={() => toggle(commit.hash)}
              style={{
                padding: '6px 12px',
                display: 'flex',
                alignItems: 'flex-start',
                gap: 6,
                cursor: 'pointer',
                userSelect: 'none',
              }}
              title={commit.message}
            >
              <span style={{ flexShrink: 0, marginTop: 2 }}>
                {isOpen ? (
                  <ChevronDown size={12} color="var(--text-muted)" />
                ) : (
                  <ChevronRight size={12} color="var(--text-muted)" />
                )}
              </span>
              <GitCommitIcon
                size={14}
                color={commit.aiProvider ? 'var(--accent)' : 'var(--text-secondary)'}
                style={{ flexShrink: 0, marginTop: 1 }}
              />
              <div style={{ flex: 1, minWidth: 0 }}>
                <div
                  style={{
                    fontSize: 12,
                    color: 'var(--text)',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                  }}
                >
                  {commit.message.split('\n')[0]}
                </div>
                <div
                  style={{
                    fontSize: 10,
                    color: 'var(--text-muted)',
                    marginTop: 2,
                    display: 'flex',
                    alignItems: 'center',
                    gap: 6,
                    flexWrap: 'wrap',
                  }}
                >
                  <span>{shortHash}</span>
                  <span>·</span>
                  <span>{commit.author}</span>
                  <span>·</span>
                  <span>{formatDate(commit.date)}</span>
                  {commit.aiProvider && (
                    <span
                      style={{
                        padding: '1px 6px',
                        borderRadius: 999,
                        background: 'var(--bg-tertiary)',
                        color: 'var(--text-secondary)',
                      }}
                    >
                      {PROVIDER_LABELS[commit.aiProvider]}
                    </span>
                  )}
                </div>
              </div>
            </div>

            {isOpen && (
              <div
                style={{
                  padding: '4px 12px 10px 32px',
                  background: 'var(--bg-primary)',
                  fontSize: 11,
                  color: 'var(--text-secondary)',
                }}
              >
                {!det && (
                  <div style={{ color: 'var(--text-muted)', padding: '6px 0' }}>Loading…</div>
                )}
                {det && (
                  <>
                    {det.message && det.message.split('\n').length > 1 && (
                      <pre
                        style={{
                          margin: '4px 0 8px',
                          padding: '6px 8px',
                          background: 'var(--bg-secondary)',
                          border: '1px solid var(--border)',
                          borderRadius: 3,
                          fontSize: 11,
                          color: 'var(--text-secondary)',
                          whiteSpace: 'pre-wrap',
                          wordBreak: 'break-word',
                          fontFamily: 'inherit',
                        }}
                      >
                        {det.message}
                      </pre>
                    )}
                    <div style={{ color: 'var(--text-muted)', marginBottom: 4 }}>
                      {det.files.length} file{det.files.length === 1 ? '' : 's'} changed
                    </div>
                    {det.files.map((f) => (
                      <div
                        key={f.path}
                        style={{
                          display: 'flex',
                          alignItems: 'center',
                          gap: 6,
                          padding: '2px 0',
                          fontSize: 11,
                        }}
                        title={f.path}
                      >
                        <FileText size={11} color="var(--text-muted)" style={{ flexShrink: 0 }} />
                        <span
                          style={{
                            flex: 1,
                            overflow: 'hidden',
                            textOverflow: 'ellipsis',
                            whiteSpace: 'nowrap',
                            color: 'var(--text)',
                          }}
                        >
                          {f.path}
                        </span>
                        {f.additions > 0 && (
                          <span style={{ color: 'var(--green)' }}>+{f.additions}</span>
                        )}
                        {f.deletions > 0 && (
                          <span style={{ color: 'var(--red)' }}>-{f.deletions}</span>
                        )}
                      </div>
                    ))}
                  </>
                )}
              </div>
            )}
          </div>
        );
      })}

      {!reachedEnd && (
        <div style={{ padding: '8px 12px', display: 'flex', justifyContent: 'center' }}>
          <button
            disabled={loading}
            onClick={() => setCount((c) => c + PAGE_SIZE)}
            style={{
              background: 'var(--bg-hover)',
              border: '1px solid var(--border)',
              borderRadius: 3,
              padding: '4px 12px',
              fontSize: 11,
              color: 'var(--text-secondary)',
              cursor: loading ? 'default' : 'pointer',
              display: 'flex',
              alignItems: 'center',
              gap: 6,
            }}
          >
            {loading && <RefreshCw size={11} className="spin" />}
            {loading ? 'Loading…' : 'Load more'}
          </button>
        </div>
      )}
    </div>
  );
}
