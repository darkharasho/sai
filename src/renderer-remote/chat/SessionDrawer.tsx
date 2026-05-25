import { useState, useEffect } from 'react';
import type { WireClient } from '../wire';
import SaiLogo from '../branding/SaiLogo';
import WorkspacePicker from './WorkspacePicker';

interface SessionMeta {
  id: string;
  projectPath: string;
  title?: string;
  updatedAt: number;
  kind?: string;
}

interface Props {
  client: WireClient;
  followEnabled: boolean;
  onFollowChange: (v: boolean) => void;
  onAttach: (projectPath: string, sessionId: string) => void;
  currentProjectPath: string | null;
  open: boolean;
  onClose: () => void;
  onPickWorkspace: (projectPath: string) => void;
}

export default function SessionDrawer({
  client, followEnabled, onFollowChange, onAttach, currentProjectPath, open, onClose, onPickWorkspace,
}: Props) {
  const [sessions, setSessions] = useState<SessionMeta[]>([]);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    if (!open || !currentProjectPath) return;
    setLoading(true); setErr(null);
    client.listSessions(currentProjectPath)
      .then((s) => setSessions((s as SessionMeta[]) ?? []))
      .catch((e) => setErr(e.message))
      .finally(() => setLoading(false));
  }, [open, currentProjectPath, client]);

  if (!open) return null;

  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 50, display: 'flex' }}>
      <div
        style={{
          width: 290,
          maxWidth: '85%',
          display: 'flex',
          flexDirection: 'column',
          background: 'var(--bg-secondary)',
          borderRight: '1px solid var(--border)',
          paddingTop: 'env(safe-area-inset-top)',
          paddingBottom: 'env(safe-area-inset-bottom)',
        }}
      >
        <div style={{
          padding: '12px 14px',
          borderBottom: '1px solid var(--border)',
          display: 'flex',
          alignItems: 'center',
          gap: 10,
        }}>
          <SaiLogo mode="idle" size={20} color="var(--accent)" />
          <div style={{ flex: 1, fontSize: 13, fontWeight: 600, color: 'var(--text)' }}>Sessions</div>
          <button
            onClick={onClose}
            aria-label="Close drawer"
            style={{
              background: 'transparent',
              color: 'var(--text-muted)',
              border: 'none',
              fontSize: 22,
              lineHeight: 1,
              cursor: 'pointer',
              padding: 4,
            }}
          >×</button>
        </div>

        <label
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 10,
            padding: '12px 14px',
            fontSize: 13,
            color: 'var(--text)',
            cursor: 'pointer',
            borderBottom: '1px solid var(--border)',
          }}
        >
          <input
            type="checkbox"
            checked={followEnabled}
            onChange={(e) => onFollowChange(e.target.checked)}
            style={{ accentColor: 'var(--accent)', width: 16, height: 16 }}
          />
          Follow desktop
        </label>

        <div style={{ flex: 1, overflowY: 'auto' }}>
          <WorkspacePicker
            client={client}
            currentProjectPath={currentProjectPath}
            onPick={(path) => { onPickWorkspace(path); onClose(); }}
          />
          <div style={{ borderTop: '1px solid var(--border)' }} />
          {loading && <div style={{ padding: '12px 14px', fontSize: 12, color: 'var(--text-muted)' }}>Loading…</div>}
          {err && <div style={{ padding: '12px 14px', fontSize: 12, color: 'var(--red)' }}>{err}</div>}
          {!loading && sessions.length === 0 && !err && (
            <div style={{ padding: '12px 14px', fontSize: 12, color: 'var(--text-muted)' }}>
              No sessions yet.
            </div>
          )}
          {sessions.map((s) => (
            <button
              key={s.id}
              onClick={() => { onAttach(s.projectPath, s.id); onClose(); }}
              style={{
                display: 'block',
                width: '100%',
                textAlign: 'left',
                padding: '10px 14px',
                background: 'transparent',
                color: 'var(--text)',
                border: 'none',
                borderBottom: '1px solid var(--border)',
                cursor: 'pointer',
                fontFamily: 'inherit',
              }}
            >
              <div style={{
                fontSize: 13,
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
                color: 'var(--text)',
              }}>
                {s.title ?? `Session ${s.id.slice(0, 6)}`}
              </div>
              <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 2 }}>
                {new Date(s.updatedAt).toLocaleString()}
              </div>
            </button>
          ))}
        </div>
      </div>
      <div onClick={onClose} style={{ flex: 1, background: 'rgba(0,0,0,0.55)' }} />
    </div>
  );
}
