import { useEffect, useState } from 'react';

interface InlineDiffProps {
  projectPath: string;
  filepath: string;
  staged: boolean;
  onOpen?: () => void;
}

function parseDiffLines(diff: string): { type: '+' | '-' | ' '; text: string }[] {
  return diff
    .split('\n')
    .filter(line => !line.startsWith('diff ') && !line.startsWith('index ') &&
                    !line.startsWith('--- ') && !line.startsWith('+++ ') &&
                    !line.startsWith('@@') && !line.startsWith('\\ '))
    .map(line => {
      if (line.startsWith('+')) return { type: '+' as const, text: line.slice(1) };
      if (line.startsWith('-')) return { type: '-' as const, text: line.slice(1) };
      return { type: ' ' as const, text: line.slice(1) };
    });
}

const MAX_LINES = 50;

export default function InlineDiff({ projectPath, filepath, staged, onOpen }: InlineDiffProps) {
  const [lines, setLines] = useState<{ type: '+' | '-' | ' '; text: string }[]>([]);
  const [truncated, setTruncated] = useState(false);

  useEffect(() => {
    window.sai.gitDiff(projectPath, filepath, staged).then((diff: string) => {
      const parsed = parseDiffLines(diff);
      if (parsed.length > MAX_LINES) {
        setLines(parsed.slice(0, MAX_LINES));
        setTruncated(true);
      } else {
        setLines(parsed);
        setTruncated(false);
      }
    });
  }, [projectPath, filepath, staged]);

  return (
    <div
      style={{
        background: 'var(--bg-elevated, #0d1117)',
        borderTop: '1px solid var(--border)',
        fontFamily: "'JetBrains Mono', monospace",
        fontSize: 11,
        lineHeight: 1.6,
        overflow: 'hidden',
      }}
    >
      <div style={{ overflowX: 'auto', padding: '4px 0' }}>
        {lines.map((line, i) => (
          <div
            key={i}
            style={{
              padding: '0 12px',
              background: line.type === '+' ? 'rgba(63,185,80,0.15)' :
                          line.type === '-' ? 'rgba(248,81,73,0.15)' : 'transparent',
              color: line.type === '+' ? 'var(--green)' :
                     line.type === '-' ? 'var(--red)' : 'var(--text-muted)',
              whiteSpace: 'pre',
            }}
          >
            {line.type === '+' ? '+' : line.type === '-' ? '-' : ' '}{line.text}
          </div>
        ))}
        {truncated && (
          <div style={{ padding: '2px 12px', color: 'var(--text-muted)', fontSize: 10 }}>
            … more lines — open in editor to see all
          </div>
        )}
      </div>
      <div
        style={{
          borderTop: '1px solid var(--border)',
          padding: '4px 12px',
          textAlign: 'right',
        }}
      >
        <button
          onClick={onOpen}
          style={{
            background: 'none',
            border: 'none',
            color: 'var(--accent)',
            cursor: 'pointer',
            fontSize: 10,
            fontFamily: 'inherit',
            padding: 0,
          }}
        >
          ↗ Open in editor
        </button>
      </div>
    </div>
  );
}
