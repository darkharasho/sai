import { useEffect, useState } from 'react';
import { FolderClosed, GitBranch, Clock, X, Terminal as TerminalIcon } from 'lucide-react';
import SaiLogo from '../branding/SaiLogo';
import type { WireClient } from '../wire';
import Files from '../files/Files';
import Git from '../files/Git';
import Terminal from '../terminal/Terminal';
import TerminalPicker from '../terminal/TerminalPicker';

interface SessionMeta {
  id: string;
  projectPath: string;
  title?: string;
  updatedAt: number;
  kind?: string;
}

type NavItem = 'files' | 'git' | 'chats' | 'terminal';

interface Props {
  open: boolean;
  onClose: () => void;
  client: WireClient;
  /** Active workspace's projectPath (drives Files cwd default). */
  workspacePath: string;
  /** Meta workspace members, if any. */
  metaMembers?: { projectPath: string; name: string }[];
  /** Current attached session info, used to highlight the active row. */
  currentSessionProjectPath: string | null;
  /** Follow-desktop toggle state + setter. */
  followEnabled: boolean;
  onFollowChange: (v: boolean) => void;
  /** Called when a session is picked. */
  onAttach: (projectPath: string, sessionId: string) => void;
}

const RAIL_WIDTH = 56;
const SLIVER_WIDTH = 32;

interface NavItemMeta { id: NavItem; icon: typeof FolderClosed; label: string }
const NAV_ITEMS: NavItemMeta[] = [
  { id: 'files',    icon: FolderClosed, label: 'Files' },
  { id: 'git',      icon: GitBranch,    label: 'Changes' },
  { id: 'chats',    icon: Clock,        label: 'Chats' },
  { id: 'terminal', icon: TerminalIcon, label: 'Terminal' },
];

export default function NavDrawer({
  open, onClose, client, workspacePath, metaMembers,
  currentSessionProjectPath, followEnabled, onFollowChange, onAttach,
}: Props) {
  const [active, setActive] = useState<NavItem>('files');
  const [gitChangeCount, setGitChangeCount] = useState(0);
  const [activeTerm, setActiveTerm] = useState<{ termId: number; origin: 'phone' | 'desktop' } | null>(null);
  const [pickerOpen, setPickerOpen] = useState(false);

  const gitCwd = metaMembers && metaMembers.length > 0 ? metaMembers[0].projectPath : workspacePath;

  // When the user clicks the Terminal rail item, open the picker (unless a term is already active).
  useEffect(() => {
    if (active === 'terminal' && activeTerm === null) setPickerOpen(true);
    if (active !== 'terminal') setPickerOpen(false);
  }, [active, activeTerm]);

  useEffect(() => {
    if (!open || !gitCwd) return;
    let cancelled = false;
    const poll = () => {
      const reqId = `gb${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      const off = client.on((m: any) => {
        if (m && m.reqId === reqId) {
          off();
          if (cancelled) return;
          if (m.type === 'files.status.result') {
            const entries = (m.entries ?? []) as { path: string }[];
            const paths = new Set<string>();
            for (const e of entries) paths.add(e.path);
            setGitChangeCount(paths.size);
          }
        }
      });
      client.send({ type: 'files.status', cwd: gitCwd, reqId });
      setTimeout(() => off(), 5000);
    };
    poll();
    const id = setInterval(poll, 5000);
    return () => { cancelled = true; clearInterval(id); };
  }, [client, gitCwd, open]);

  if (!open) return null;

  const badgeLabel = gitChangeCount > 100 ? '99+' : `${gitChangeCount}`;
  const terminalActive = active === 'terminal' && activeTerm !== null;
  const gitCwdLocal = gitCwd;

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 60,
        display: 'flex',
        // Lightly dim the underlying chat behind everything so it visibly recedes.
        background: 'rgba(0,0,0,0.4)',
      }}
    >
      {/* Left rail */}
      {!terminalActive && (
      <div
        style={{
          width: RAIL_WIDTH,
          flexShrink: 0,
          background: 'var(--bg-secondary)',
          borderRight: '1px solid var(--border)',
          paddingTop: 'env(safe-area-inset-top)',
          paddingBottom: 'env(safe-area-inset-bottom)',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          gap: 6,
        }}
      >
        <div style={{
          width: '100%',
          padding: '12px 0 8px',
          display: 'flex',
          justifyContent: 'center',
          borderBottom: '1px solid var(--border)',
          marginBottom: 4,
        }}>
          <SaiLogo mode="idle" size={20} color="var(--accent)" />
        </div>
        {NAV_ITEMS.map((it) => {
          const isActive = it.id === active;
          const Icon = it.icon;
          return (
            <button
              key={it.id}
              onClick={() => setActive(it.id)}
              aria-label={it.label}
              title={it.label}
              style={{
                width: 40, height: 40,
                display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                background: isActive ? 'var(--bg-elevated)' : 'transparent',
                color: isActive ? 'var(--accent)' : 'var(--text-muted)',
                border: 'none',
                borderRadius: 8,
                cursor: 'pointer',
                position: 'relative',
              }}
            >
              <Icon size={18} strokeWidth={2} />
              {it.id === 'git' && gitChangeCount > 0 && (
                <span style={{
                  position: 'absolute',
                  top: 2,
                  right: 2,
                  minWidth: 16,
                  height: 14,
                  padding: '0 4px',
                  borderRadius: 7,
                  background: 'var(--accent)',
                  color: '#000',
                  fontSize: 9,
                  fontWeight: 700,
                  fontFamily: "'Geist Mono', 'JetBrains Mono', monospace",
                  display: 'inline-flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  lineHeight: 1,
                }}>{badgeLabel}</span>
              )}
              {isActive && (
                <span style={{
                  position: 'absolute',
                  left: -8,
                  top: 8,
                  bottom: 8,
                  width: 2,
                  background: 'var(--accent)',
                  borderRadius: 2,
                }} />
              )}
            </button>
          );
        })}
        <div style={{ flex: 1 }} />
        <button
          onClick={onClose}
          aria-label="Close drawer"
          title="Close"
          style={{
            width: 40, height: 40,
            display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
            background: 'transparent',
            color: 'var(--text-muted)',
            border: 'none',
            borderRadius: 8,
            cursor: 'pointer',
            marginBottom: 12,
          }}
        >
          <X size={18} strokeWidth={2} />
        </button>
      </div>
      )}

      {/* Right panel — fills the rest, minus the sliver on the right */}
      <div
        style={{
          flex: 1,
          minWidth: 0,
          display: 'flex',
          flexDirection: 'column',
          background: 'var(--bg-primary)',
          borderRight: '1px solid var(--border)',
          paddingTop: 'env(safe-area-inset-top)',
          paddingBottom: 'env(safe-area-inset-bottom)',
          marginRight: terminalActive ? 0 : SLIVER_WIDTH,
        }}
      >
        {active === 'files' && (
          <Files
            client={client}
            workspacePath={workspacePath}
            metaMembers={metaMembers}
          />
        )}
        {active === 'git' && (
          <Git
            client={client}
            workspacePath={workspacePath}
            metaMembers={metaMembers}
          />
        )}
        {active === 'chats' && (
          <ChatsPanel
            client={client}
            currentProjectPath={currentSessionProjectPath}
            followEnabled={followEnabled}
            onFollowChange={onFollowChange}
            onAttach={(p, s) => { onAttach(p, s); onClose(); }}
          />
        )}
        {active === 'terminal' && activeTerm !== null && (
          <Terminal
            client={client}
            termId={activeTerm.termId}
            cwd={gitCwdLocal}
            origin={activeTerm.origin}
            onBack={() => { setActiveTerm(null); setActive('files'); }}
            onExit={() => { setActiveTerm(null); }}
          />
        )}
      </div>

      {/* Sliver — tap-to-close */}
      {!terminalActive && (
        <button
          onClick={onClose}
          aria-label="Close drawer"
          style={{
            position: 'absolute',
            top: 0, bottom: 0, right: 0,
            width: SLIVER_WIDTH,
            background: 'transparent',
            border: 'none',
            cursor: 'pointer',
            padding: 0,
          }}
        />
      )}
      {pickerOpen && (
        <TerminalPicker
          client={client}
          cwd={gitCwdLocal}
          onPick={(termId, origin) => { setActiveTerm({ termId, origin }); setPickerOpen(false); }}
          onClose={() => {
            setPickerOpen(false);
            // If no terminal was picked, drop back to files
            if (activeTerm === null) setActive('files');
          }}
        />
      )}
    </div>
  );
}

/** Sessions list with follow toggle. Embedded inside NavDrawer. */
function ChatsPanel({
  client, currentProjectPath, followEnabled, onFollowChange, onAttach,
}: {
  client: WireClient;
  currentProjectPath: string | null;
  followEnabled: boolean;
  onFollowChange: (v: boolean) => void;
  onAttach: (projectPath: string, sessionId: string) => void;
}) {
  const [sessions, setSessions] = useState<SessionMeta[]>([]);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    if (!currentProjectPath) { setSessions([]); return; }
    setLoading(true); setErr(null);
    client.listSessions(currentProjectPath)
      .then((s) => setSessions((s as SessionMeta[]) ?? []))
      .catch((e: Error) => setErr(e.message))
      .finally(() => setLoading(false));
  }, [client, currentProjectPath]);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', minHeight: 0 }}>
      <div style={{
        padding: '12px 14px',
        borderBottom: '1px solid var(--border)',
        background: 'var(--bg-secondary)',
        display: 'flex',
        alignItems: 'center',
        gap: 10,
      }}>
        <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text)' }}>Sessions</div>
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
            onClick={() => onAttach(s.projectPath, s.id)}
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
  );
}
