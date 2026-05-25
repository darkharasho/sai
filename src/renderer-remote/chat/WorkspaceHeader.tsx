import { useEffect, useRef, useState } from 'react';
import { Folder, Layers, ChevronDown } from 'lucide-react';
import type { WireClient } from '../wire';

interface WorkspaceStatusMeta {
  busy?: boolean;
  streaming?: boolean;
  completed?: boolean;
  approval?: boolean;
}

interface WorkspaceMeta {
  projectPath: string;
  name: string;
  kind: 'project' | 'meta';
  members?: { projectPath: string; name: string }[];
  status?: WorkspaceStatusMeta;
}

interface Props {
  client: WireClient;
  currentProjectPath: string | null;
  onPick: (projectPath: string) => void;
}

function StatusDots({ status }: { status?: WorkspaceStatusMeta }) {
  if (!status) return null;
  const dot = (color: string, key: string, title: string) => (
    <span
      key={key}
      title={title}
      style={{ display: 'inline-block', width: 6, height: 6, borderRadius: '50%', background: color }}
    />
  );
  const dots: React.ReactNode[] = [];
  if (status.approval) dots.push(dot('var(--orange)', 'approval', 'pending approval'));
  if (status.streaming) dots.push(dot('var(--accent)', 'streaming', 'streaming'));
  if (status.busy && !status.streaming) dots.push(dot('var(--blue)', 'busy', 'working'));
  if (status.completed) dots.push(dot('var(--green)', 'completed', 'completed'));
  return dots.length ? <span style={{ display: 'inline-flex', gap: 4, alignItems: 'center' }}>{dots}</span> : null;
}

export default function WorkspaceHeader({ client, currentProjectPath, onPick }: Props) {
  const [open, setOpen] = useState(false);
  const [workspaces, setWorkspaces] = useState<WorkspaceMeta[]>([]);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  const fetchList = () => {
    setLoading(true); setErr(null);
    client.listWorkspaces()
      .then((ws) => setWorkspaces((ws as WorkspaceMeta[]) ?? []))
      .catch((e: Error) => setErr(e.message))
      .finally(() => setLoading(false));
  };

  // Refetch every time the dropdown opens.
  useEffect(() => { if (open) fetchList(); }, [open]);
  // Initial load for the header's own current-workspace badges.
  useEffect(() => { fetchList(); }, [client, currentProjectPath]);

  // Tap-outside to close.
  useEffect(() => {
    if (!open) return;
    const onDoc = (e: Event) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onDoc);
    document.addEventListener('touchstart', onDoc);
    return () => {
      document.removeEventListener('mousedown', onDoc);
      document.removeEventListener('touchstart', onDoc);
    };
  }, [open]);

  const current = workspaces.find((w) => w.projectPath === currentProjectPath);
  const Icon = current?.kind === 'meta' ? Layers : Folder;

  return (
    <div ref={containerRef} style={{ flex: 1, minWidth: 0, position: 'relative' }}>
      <button
        onClick={() => setOpen((v) => !v)}
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          width: '100%',
          padding: '4px 8px',
          background: 'transparent',
          color: 'var(--text)',
          border: '1px solid transparent',
          borderRadius: 8,
          cursor: 'pointer',
          fontFamily: 'inherit',
          minWidth: 0,
        }}
      >
        <Icon size={14} color="var(--text-muted)" strokeWidth={2} style={{ flexShrink: 0 }} />
        <div style={{
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'flex-start',
          flex: 1,
          minWidth: 0,
        }}>
          <div style={{
            fontSize: 13,
            fontWeight: 500,
            color: 'var(--text)',
            whiteSpace: 'nowrap',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            maxWidth: '100%',
          }}>
            {current?.name ?? 'No workspace'}
          </div>
          {current?.kind === 'meta' && current?.members && current.members.length > 0 && (
            <div style={{
              fontSize: 10,
              color: 'var(--text-muted)',
              fontFamily: '"Geist Mono", ui-monospace, monospace',
              whiteSpace: 'nowrap',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              maxWidth: '100%',
            }}>
              {current.members.map((m) => m.name).join(' · ')}
            </div>
          )}
        </div>
        <StatusDots status={current?.status} />
        <ChevronDown
          size={14}
          color="var(--text-muted)"
          style={{
            flexShrink: 0,
            transition: 'transform var(--dur-fast) var(--ease-out-soft)',
            transform: open ? 'rotate(180deg)' : 'none',
          }}
        />
      </button>

      {open && (
        <div
          style={{
            position: 'absolute',
            top: 'calc(100% + 4px)',
            left: 0,
            right: 0,
            maxHeight: '60vh',
            overflowY: 'auto',
            background: 'var(--bg-secondary)',
            border: '1px solid var(--border)',
            borderRadius: 10,
            boxShadow: '0 8px 24px rgba(0,0,0,0.4)',
            zIndex: 40,
          }}
        >
          {loading && (
            <div style={{ padding: '10px 12px', fontSize: 12, color: 'var(--text-muted)' }}>Loading…</div>
          )}
          {err && (
            <div style={{ padding: '10px 12px', fontSize: 12, color: 'var(--red)' }}>{err}</div>
          )}
          {!loading && !err && workspaces.length === 0 && (
            <div style={{ padding: '10px 12px', fontSize: 12, color: 'var(--text-muted)' }}>
              No workspaces open on desktop.
            </div>
          )}
          {workspaces.map((w) => {
            const active = w.projectPath === currentProjectPath;
            const RowIcon = w.kind === 'meta' ? Layers : Folder;
            return (
              <button
                key={w.projectPath}
                onClick={() => { onPick(w.projectPath); setOpen(false); }}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 8,
                  width: '100%',
                  padding: '10px 12px',
                  background: 'transparent',
                  color: 'var(--text)',
                  border: 'none',
                  borderBottom: '1px solid var(--border)',
                  borderLeft: active ? '2px solid var(--accent)' : '2px solid transparent',
                  cursor: 'pointer',
                  fontFamily: 'inherit',
                  textAlign: 'left',
                  minWidth: 0,
                }}
              >
                <RowIcon size={14} color={active ? 'var(--accent)' : 'var(--text-muted)'} strokeWidth={2} style={{ flexShrink: 0 }} />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{
                    fontSize: 13,
                    fontWeight: active ? 600 : 400,
                    color: active ? 'var(--accent)' : 'var(--text)',
                    whiteSpace: 'nowrap',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                  }}>
                    {w.name}
                    {w.kind === 'meta' && (
                      <span style={{
                        marginLeft: 6,
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
                    <div style={{
                      fontSize: 11,
                      color: 'var(--text-muted)',
                      marginTop: 2,
                      whiteSpace: 'nowrap',
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                    }}>
                      {w.members.map((m) => m.name).join(' · ')}
                    </div>
                  )}
                </div>
                <StatusDots status={w.status} />
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
