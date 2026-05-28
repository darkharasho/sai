import { Folder } from 'lucide-react';

interface Member { projectPath: string; name: string }

interface Props {
  members: Member[];
  current: string;
  onPick: (projectPath: string) => void;
}

export default function RepoPicker({ members, current, onPick }: Props) {
  if (members.length === 0) return null;
  return (
    <div style={{
      display: 'flex',
      gap: 6,
      padding: '6px 10px',
      borderBottom: '1px solid var(--border)',
      background: 'var(--bg-mid)',
      overflowX: 'auto',
      WebkitOverflowScrolling: 'touch',
    }}>
      {members.map((m) => {
        const active = m.projectPath === current;
        return (
          <button
            key={m.projectPath}
            onClick={() => onPick(m.projectPath)}
            style={{
              flexShrink: 0,
              display: 'inline-flex',
              alignItems: 'center',
              gap: 5,
              padding: '4px 10px',
              fontSize: 12,
              fontFamily: '"Geist Mono", ui-monospace, monospace',
              background: active ? 'var(--accent)' : 'transparent',
              color: active ? '#000' : 'var(--text-muted)',
              border: `1px solid ${active ? 'var(--accent)' : 'var(--border)'}`,
              borderRadius: 999,
              cursor: 'pointer',
            }}
          >
            <Folder size={11} strokeWidth={2} />
            {m.name}
          </button>
        );
      })}
    </div>
  );
}
