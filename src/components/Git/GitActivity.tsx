import { useState } from 'react';
import { GitCommit as GitCommitIcon, ChevronDown, ChevronRight } from 'lucide-react';
import { GitCommit } from '../../types';

interface GitActivityProps {
  commits: GitCommit[];
}

const PROVIDER_LABELS = {
  claude: 'Claude',
  codex: 'Codex',
  gemini: 'Gemini',
} as const;

export default function GitActivity({ commits }: GitActivityProps) {
  const [expanded, setExpanded] = useState(false);
  const aiCommits = commits.filter((commit) => commit.aiProvider);

  if (aiCommits.length === 0) return null;

  return (
    <div
      style={{
        borderTop: '1px solid var(--border-hairline)',
        paddingTop: 8,
        marginTop: 4,
      }}
    >
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        aria-expanded={expanded}
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 4,
          width: '100%',
          padding: '4px 12px',
          fontSize: 'var(--text-xs)',
          fontWeight: 600,
          textTransform: 'uppercase' as const,
          letterSpacing: '0.06em',
          color: 'var(--text-secondary)',
          userSelect: 'none' as const,
          background: 'none',
          border: 'none',
          borderBottom: '1px solid var(--border-hairline)',
          cursor: 'pointer',
          textAlign: 'left' as const,
        }}
      >
        {expanded ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
        <span>AI Activity</span>
        <span style={{ marginLeft: 'auto', color: 'var(--text-muted)', fontWeight: 400 }}>
          {aiCommits.length}
        </span>
      </button>

      {expanded && aiCommits.map((commit) => {
        const shortHash = commit.hash.slice(0, 7);
        const date = new Date(commit.date);
        const dateStr = isNaN(date.getTime())
          ? commit.date
          : date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });

        return (
          <div
            key={commit.hash}
            style={{
              padding: '5px 12px',
              display: 'flex',
              flexDirection: 'column' as const,
              gap: 2,
            }}
          >
            <div style={{ display: 'flex', alignItems: 'flex-start', gap: 6 }}>
              <GitCommitIcon size={14} color="var(--accent)" style={{ flexShrink: 0 }} />
              <span
                style={{
                  fontSize: 12,
                  color: 'var(--text)',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap' as const,
                  flex: 1,
                }}
                title={commit.message}
              >
                {commit.message}
              </span>
            </div>
            <div
              style={{
                fontSize: 10,
                color: 'var(--text-muted)',
                paddingLeft: 18,
                display: 'flex',
                alignItems: 'center',
                gap: 6,
              }}
            >
              <span>{shortHash} · {dateStr}</span>
              {commit.aiProvider && (
                <span
                  style={{
                    padding: '1px 6px',
                    borderRadius: 999,
                    background: 'var(--surface-3)',
                    color: 'var(--text-secondary)',
                  }}
                >
                  {PROVIDER_LABELS[commit.aiProvider]}
                </span>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}
