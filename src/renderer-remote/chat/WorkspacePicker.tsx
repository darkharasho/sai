import { useEffect, useState } from 'react';
import { Folder, Layers } from 'lucide-react';
import type { WireClient } from '../wire';

interface WorkspaceMeta {
  projectPath: string;
  name: string;
  kind: 'project' | 'meta';
  members?: { projectPath: string; name: string }[];
}

interface Props {
  client: WireClient;
  currentProjectPath: string | null;
  onPick: (projectPath: string) => void;
}

export default function WorkspacePicker({ client, currentProjectPath, onPick }: Props) {
  const [workspaces, setWorkspaces] = useState<WorkspaceMeta[]>([]);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    setLoading(true); setErr(null);
    client.listWorkspaces()
      .then((ws) => setWorkspaces((ws as WorkspaceMeta[]) ?? []))
      .catch((e: Error) => setErr(e.message))
      .finally(() => setLoading(false));
  }, [client]);

  return (
    <div>
      <div style={{
        padding: '12px 14px 6px',
        fontFamily: '"Geist Mono", ui-monospace, monospace',
        fontSize: 10,
        textTransform: 'uppercase',
        letterSpacing: '0.08em',
        color: 'var(--text-muted)',
      }}>
        Workspaces
      </div>
      {loading && <div style={{ padding: '8px 14px', fontSize: 12, color: 'var(--text-muted)' }}>Loading…</div>}
      {err && <div style={{ padding: '8px 14px', fontSize: 12, color: 'var(--red)' }}>{err}</div>}
      {!loading && !err && workspaces.length === 0 && (
        <div style={{ padding: '8px 14px', fontSize: 12, color: 'var(--text-muted)' }}>
          No workspaces open on desktop.
        </div>
      )}
      {workspaces.map((w) => {
        const active = w.projectPath === currentProjectPath;
        const Icon = w.kind === 'meta' ? Layers : Folder;
        return (
          <button
            key={w.projectPath}
            onClick={() => onPick(w.projectPath)}
            style={{
              display: 'block',
              width: '100%',
              textAlign: 'left',
              padding: '10px 14px 10px 12px',
              background: 'transparent',
              color: 'var(--text)',
              border: 'none',
              borderBottom: '1px solid var(--border)',
              borderLeft: active ? '2px solid var(--accent)' : '2px solid transparent',
              cursor: 'pointer',
              fontFamily: 'inherit',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <Icon size={14} color={active ? 'var(--accent)' : 'var(--text-muted)'} strokeWidth={2} />
              <span style={{
                fontSize: 13,
                fontWeight: active ? 600 : 400,
                color: active ? 'var(--accent)' : 'var(--text)',
              }}>
                {w.name}
              </span>
              {w.kind === 'meta' && (
                <span style={{
                  fontSize: 10,
                  fontFamily: '"Geist Mono", ui-monospace, monospace',
                  color: 'var(--text-muted)',
                  textTransform: 'uppercase',
                  letterSpacing: '0.08em',
                }}>
                  meta
                </span>
              )}
            </div>
            {w.kind === 'meta' && w.members && w.members.length > 0 && (
              <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 3, marginLeft: 22 }}>
                {w.members.map((m) => m.name).join(' · ')}
              </div>
            )}
          </button>
        );
      })}
    </div>
  );
}
