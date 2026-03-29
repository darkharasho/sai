import { GitCommit as GitCommitIcon } from 'lucide-react';
import { GitCommit } from '../../types';

interface ClaudeActivityProps {
  commits: GitCommit[];
}

export default function ClaudeActivity({ commits }: ClaudeActivityProps) {
  const claudeCommits = commits.filter((c) => c.isClaude);

  if (claudeCommits.length === 0) return null;

  return (
    <div
      style={{
        borderTop: '1px solid var(--border)',
        paddingTop: 8,
        marginTop: 4,
      }}
    >
      <div
        style={{
          padding: '4px 12px',
          fontSize: 10,
          fontWeight: 700,
          textTransform: 'uppercase' as const,
          letterSpacing: '0.6px',
          color: 'var(--text-muted)',
          userSelect: 'none' as const,
        }}
      >
        Claude Activity
      </div>

      {claudeCommits.map((commit) => {
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
              }}
            >
              {shortHash} · {dateStr}
            </div>
          </div>
        );
      })}
    </div>
  );
}
