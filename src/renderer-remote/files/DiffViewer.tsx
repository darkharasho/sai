interface Props {
  diff: string;
}

interface ParsedLine {
  kind: 'context' | 'add' | 'remove' | 'hunk' | 'meta';
  text: string;
}

function parseDiff(diff: string): ParsedLine[] {
  const out: ParsedLine[] = [];
  for (const line of diff.split('\n')) {
    if (line.startsWith('@@')) out.push({ kind: 'hunk', text: line });
    else if (line.startsWith('+++') || line.startsWith('---') || line.startsWith('diff ') || line.startsWith('index ')) {
      out.push({ kind: 'meta', text: line });
    }
    else if (line.startsWith('+')) out.push({ kind: 'add', text: line });
    else if (line.startsWith('-')) out.push({ kind: 'remove', text: line });
    else out.push({ kind: 'context', text: line });
  }
  return out;
}

export default function DiffViewer({ diff }: Props) {
  if (!diff || !diff.trim()) {
    return (
      <div style={{ padding: 16, color: 'var(--text-muted)', fontSize: 13 }}>
        No changes.
      </div>
    );
  }
  const lines = parseDiff(diff);
  return (
    <pre style={{
      margin: 0,
      padding: 12,
      background: 'var(--bg-input)',
      border: '1px solid var(--border)',
      borderRadius: 8,
      fontFamily: '"Geist Mono", ui-monospace, monospace',
      fontSize: 12,
      lineHeight: 1.45,
      overflowX: 'auto',
      whiteSpace: 'pre',
    }}>
      {lines.map((l, i) => {
        let color = 'var(--text)';
        let bg: string | undefined;
        if (l.kind === 'add')    { color = 'var(--green)'; bg = 'color-mix(in srgb, var(--green) 10%, transparent)'; }
        else if (l.kind === 'remove') { color = 'var(--red)';   bg = 'color-mix(in srgb, var(--red)   10%, transparent)'; }
        else if (l.kind === 'hunk')   { color = 'var(--accent)'; }
        else if (l.kind === 'meta')   { color = 'var(--text-muted)'; }
        return (
          <div key={i} style={{ color, background: bg, padding: '0 6px' }}>
            {l.text || ' '}
          </div>
        );
      })}
    </pre>
  );
}
