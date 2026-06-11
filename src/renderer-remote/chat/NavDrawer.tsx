import { useEffect, useMemo, useRef, useState } from 'react';
import { FolderClosed, GitBranch, MessagesSquare, X, Terminal as TerminalIcon, Plus, Search, Pin } from 'lucide-react';
import SaiLogo from '../branding/SaiLogo';
import type { WireClient } from '../wire';
import type { WorkspaceStatusStore } from '../lib/workspaceStatusStore';
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
  /** Extra metadata desktop persists on each session row. Used for per-row
   *  status indicators (unread, error, suspended) in the chat list. */
  lastViewedAt?: number;
  lastTurnErrored?: boolean;
  scopeSuspended?: boolean;
  messageCount?: number;
  pinned?: boolean;
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
  /** Current attached session id (the row to mark ACTIVE). */
  currentSessionId?: string | null;
  /** Workspace status store — drives per-row status indicators. */
  statusStore?: WorkspaceStatusStore;
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
  { id: 'files',    icon: FolderClosed,   label: 'Files' },
  { id: 'git',      icon: GitBranch,      label: 'Changes' },
  { id: 'chats',    icon: MessagesSquare, label: 'Chats' },
  { id: 'terminal', icon: TerminalIcon,   label: 'Terminal' },
];

export default function NavDrawer({
  open, onClose, client, workspacePath, metaMembers,
  currentSessionProjectPath, currentSessionId, statusStore,
  followEnabled, onFollowChange, onAttach,
}: Props) {
  const [active, setActive] = useState<NavItem>('files');
  const [gitChangeCount, setGitChangeCount] = useState(0);
  const [activeTerm, setActiveTerm] = useState<{ termId: number; origin: 'phone' | 'desktop' } | null>(null);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [filesFileOpen, setFilesFileOpen] = useState(false);

  const gitCwd = metaMembers && metaMembers.length > 0 ? metaMembers[0].projectPath : workspacePath;

  // When the user clicks the Terminal rail item, open the picker (unless a term is already active).
  useEffect(() => {
    if (active === 'terminal' && activeTerm === null) setPickerOpen(true);
    if (active !== 'terminal') setPickerOpen(false);
  }, [active, activeTerm]);

  useEffect(() => {
    if (!open || !gitCwd) return;
    let cancelled = false;
    // Track in-flight response listeners so closing the drawer detaches them
    // immediately instead of waiting out the 5s response timeout.
    const inflight = new Set<() => void>();
    const poll = () => {
      const reqId = `gb${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      const off = client.on((m: any) => {
        if (m && m.reqId === reqId) {
          off();
          inflight.delete(off);
          if (cancelled) return;
          if (m.type === 'files.status.result') {
            const entries = (m.entries ?? []) as { path: string }[];
            const paths = new Set<string>();
            for (const e of entries) paths.add(e.path);
            setGitChangeCount(paths.size);
          }
        }
      });
      inflight.add(off);
      client.send({ type: 'files.status', cwd: gitCwd, reqId });
      setTimeout(() => { off(); inflight.delete(off); }, 5000);
    };
    poll();
    const id = setInterval(poll, 5000);
    return () => {
      cancelled = true;
      clearInterval(id);
      for (const off of inflight) off();
      inflight.clear();
    };
  }, [client, gitCwd, open]);

  if (!open) return null;

  const badgeLabel = gitChangeCount > 100 ? '99+' : `${gitChangeCount}`;
  const terminalActive = active === 'terminal' && activeTerm !== null;
  const filesActive = active === 'files' && filesFileOpen;
  const fullscreen = terminalActive || filesActive;
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
      {!fullscreen && (
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
          marginRight: fullscreen ? 0 : SLIVER_WIDTH,
        }}
      >
        {active === 'files' && (
          <Files
            client={client}
            workspacePath={workspacePath}
            metaMembers={metaMembers}
            onOpenChange={setFilesFileOpen}
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
            currentSessionId={currentSessionId ?? null}
            statusStore={statusStore}
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
      {!fullscreen && (
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

/** Sessions list — mirrors the desktop ChatHistorySidebar visual language.
 *  Search, time groupings, per-row status indicators (busy / awaiting / error /
 *  unread / suspended), active highlight, relative timestamps, msg counts.
 *  Preserves the PWA-only "Follow desktop" toggle. */
function ChatsPanel({
  client, currentProjectPath, currentSessionId, statusStore,
  followEnabled, onFollowChange, onAttach,
}: {
  client: WireClient;
  currentProjectPath: string | null;
  currentSessionId: string | null;
  statusStore?: WorkspaceStatusStore;
  followEnabled: boolean;
  onFollowChange: (v: boolean) => void;
  onAttach: (projectPath: string, sessionId: string) => void;
}) {
  const [sessions, setSessions] = useState<SessionMeta[]>([]);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [debouncedQuery, setDebouncedQuery] = useState('');
  // Force re-render on status changes for the active workspace.
  const [, setStatusTick] = useState(0);
  const refreshRef = useRef<() => void>(() => {});

  useEffect(() => {
    const t = setTimeout(() => setDebouncedQuery(searchQuery), 250);
    return () => clearTimeout(t);
  }, [searchQuery]);

  useEffect(() => {
    if (!statusStore) return;
    const off = statusStore.subscribe((projectPath) => {
      if (projectPath === currentProjectPath) setStatusTick((n) => n + 1);
    });
    return off;
  }, [statusStore, currentProjectPath]);

  const refresh = () => {
    if (!currentProjectPath) { setSessions([]); return; }
    setLoading(true); setErr(null);
    client.listSessions(currentProjectPath)
      .then((s) => setSessions((s as SessionMeta[]) ?? []))
      .catch((e: Error) => setErr(e.message))
      .finally(() => setLoading(false));
  };
  refreshRef.current = refresh;

  useEffect(() => { refresh(); }, [client, currentProjectPath]);

  // Re-pull the session list when the desktop signals new activity (e.g. a
  // background turn completes), so msg counts / titles / updatedAt advance.
  useEffect(() => {
    if (!currentProjectPath) return;
    const status = statusStore?.get(currentProjectPath);
    if (status?.completed) refreshRef.current();
  }, [statusStore, currentProjectPath]);

  const status = currentProjectPath ? statusStore?.get(currentProjectPath) : undefined;
  const streamingIds = new Set(status?.streamingSessionIds ?? []);
  const awaitingIds = new Set(status?.awaitingSessionIds ?? []);
  const suspendedIds = new Set(status?.suspendedSessionIds ?? []);

  const filtered = useMemo(() => {
    if (!debouncedQuery.trim()) return sessions;
    const q = debouncedQuery.toLowerCase();
    return sessions.filter((s) => (s.title ?? '').toLowerCase().includes(q));
  }, [sessions, debouncedQuery]);

  const grouped = useMemo(() => {
    if (debouncedQuery.trim()) return [{ label: 'Results', sessions: filtered }];
    const pinned = filtered.filter((s) => s.pinned);
    const unpinned = filtered.filter((s) => !s.pinned);
    const groups: { label: string; sessions: SessionMeta[] }[] = [];
    if (pinned.length > 0) groups.push({ label: 'Pinned', sessions: pinned });
    const now = Date.now();
    const dayMs = 24 * 60 * 60 * 1000;
    const bucket = (ts: number): string => {
      const ageDays = Math.floor((now - ts) / dayMs);
      if (ageDays <= 0) return 'Today';
      if (ageDays === 1) return 'Yesterday';
      if (ageDays < 7) return 'This week';
      if (ageDays < 30) return 'This month';
      return 'Older';
    };
    for (const s of unpinned) {
      const label = bucket(s.updatedAt);
      const existing = groups.find((g) => g.label === label);
      if (existing) existing.sessions.push(s); else groups.push({ label, sessions: [s] });
    }
    return groups;
  }, [filtered, debouncedQuery]);

  const formatRelative = (ts: number): string => {
    const diff = Date.now() - ts;
    const mins = Math.floor(diff / 60000);
    if (mins < 1) return 'just now';
    if (mins < 60) return `${mins}m ago`;
    const hours = Math.floor(mins / 60);
    if (hours < 24) return `${hours}h ago`;
    return new Date(ts).toLocaleDateString();
  };

  return (
    <div className="pwa-chats-panel">
      <div className="pwa-chats-header">
        <div className="pwa-chats-title">Chats</div>
        <button
          onClick={() => {
            if (!currentProjectPath) return;
            onFollowChange(false);
            onAttach(currentProjectPath, '');
          }}
          disabled={!currentProjectPath}
          aria-label="New session"
          title="New session"
          className="pwa-chats-new-btn"
        >
          <Plus size={14} strokeWidth={2} />
          New
        </button>
      </div>
      <div className="pwa-chats-search">
        <Search size={12} className="pwa-chats-search-icon" />
        <input
          type="text"
          placeholder="Search conversations..."
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          className="pwa-chats-search-input"
        />
        {searchQuery && (
          <button className="pwa-chats-search-clear" onClick={() => setSearchQuery('')}>
            <X size={12} />
          </button>
        )}
      </div>
      <label className="pwa-chats-follow">
        <input
          type="checkbox"
          checked={followEnabled}
          onChange={(e) => onFollowChange(e.target.checked)}
        />
        Follow desktop
      </label>
      <div className="pwa-chats-list">
        {loading && <div className="pwa-chats-empty">Loading…</div>}
        {err && <div className="pwa-chats-error">{err}</div>}
        {!loading && filtered.length === 0 && !err && (
          <div className="pwa-chats-empty">
            <SaiLogo mode={debouncedQuery ? 'static' : 'idle'} size={44} ariaLabel="" />
            <span>{debouncedQuery ? 'No matching conversations' : 'No conversations yet'}</span>
          </div>
        )}
        {grouped.map((group) => (
          <div key={group.label}>
            <div className="pwa-chats-group-label">
              {group.label === 'Pinned' && <Pin size={10} />}
              {group.label}
            </div>
            {group.sessions.map((s) => {
              const isActive = s.id === currentSessionId;
              const isStreaming = streamingIds.has(s.id);
              const isAwaiting = awaitingIds.has(s.id);
              const isError = !!s.lastTurnErrored;
              const isSuspended = !!s.scopeSuspended || suspendedIds.has(s.id);
              const isUnread = !isActive
                && typeof s.lastViewedAt === 'number'
                && s.updatedAt > s.lastViewedAt;
              const statusIcon = (() => {
                if (isAwaiting) return <span className="pwa-chats-status pwa-chats-status-awaiting" title="Approval needed">!</span>;
                if (isError) return <span className="pwa-chats-status pwa-chats-status-error" title="Error">!</span>;
                if (isStreaming) return <span className="pwa-chats-status pwa-chats-status-busy" title="Working..." />;
                if (isUnread) return <span className="pwa-chats-status pwa-chats-status-done" title="Response complete" />;
                if (isSuspended) return <span className="pwa-chats-status pwa-chats-status-suspended" title="Suspended (idle)" />;
                return <span className="pwa-chats-status pwa-chats-status-spacer" aria-hidden="true" />;
              })();
              return (
                <button
                  key={s.id}
                  onClick={() => onAttach(s.projectPath, s.id)}
                  className={`pwa-chats-card${isActive ? ' pwa-chats-card-active' : ''}`}
                >
                  <div className="pwa-chats-card-header">
                    {statusIcon}
                    <span className="pwa-chats-card-title">{s.title || 'Untitled'}</span>
                    {isActive && <span className="pwa-chats-active-badge">ACTIVE</span>}
                  </div>
                  <div className="pwa-chats-card-meta">
                    {typeof s.messageCount === 'number' && <span>{s.messageCount} msgs</span>}
                    {typeof s.messageCount === 'number' && <span className="pwa-chats-meta-dot">·</span>}
                    <span>{formatRelative(s.updatedAt)}</span>
                  </div>
                </button>
              );
            })}
          </div>
        ))}
      </div>
      <style>{`
        .pwa-chats-panel {
          display: flex;
          flex-direction: column;
          height: 100%;
          min-height: 0;
          background: var(--bg-primary);
        }
        .pwa-chats-header {
          padding: 12px 14px;
          border-bottom: 1px solid var(--border);
          background: var(--bg-secondary);
          display: flex;
          align-items: center;
          gap: 10px;
        }
        .pwa-chats-title {
          font-size: 13px;
          font-weight: 600;
          color: var(--text);
          flex: 1;
        }
        .pwa-chats-new-btn {
          display: inline-flex;
          align-items: center;
          gap: 6px;
          padding: 6px 10px;
          background: transparent;
          color: var(--accent);
          border: 1px solid var(--border);
          border-radius: 8px;
          cursor: pointer;
          font-size: 12px;
          font-family: inherit;
        }
        .pwa-chats-new-btn:disabled { color: var(--text-muted); cursor: not-allowed; }
        .pwa-chats-search {
          padding: 8px 12px;
          border-bottom: 1px solid var(--border);
          display: flex;
          align-items: center;
          gap: 6px;
        }
        .pwa-chats-search-icon { color: var(--text-muted); flex-shrink: 0; }
        .pwa-chats-search-input {
          flex: 1;
          background: none;
          border: none;
          color: var(--text);
          font-size: 13px;
          font-family: inherit;
          outline: none;
        }
        .pwa-chats-search-input::placeholder { color: var(--text-muted); }
        .pwa-chats-search-clear {
          background: none;
          border: none;
          color: var(--text-muted);
          cursor: pointer;
          padding: 2px;
          display: flex;
        }
        .pwa-chats-follow {
          display: flex;
          align-items: center;
          gap: 10px;
          padding: 10px 14px;
          font-size: 12px;
          color: var(--text);
          cursor: pointer;
          border-bottom: 1px solid var(--border);
        }
        .pwa-chats-follow input { accent-color: var(--accent); width: 16px; height: 16px; }
        .pwa-chats-list {
          flex: 1;
          overflow-y: auto;
          padding: 4px 0;
        }
        .pwa-chats-empty {
          padding: 32px 16px;
          text-align: center;
          color: var(--text-muted);
          font-size: 12px;
          display: flex;
          flex-direction: column;
          align-items: center;
          gap: 14px;
        }
        .pwa-chats-error {
          padding: 12px 14px;
          font-size: 12px;
          color: var(--red);
        }
        .pwa-chats-group-label {
          padding: 10px 12px 4px;
          font-size: 10px;
          text-transform: uppercase;
          letter-spacing: 0.5px;
          color: var(--text-muted);
          display: flex;
          align-items: center;
          gap: 4px;
        }
        .pwa-chats-card {
          display: block;
          width: 100%;
          text-align: left;
          padding: 10px 12px;
          margin: 1px 6px;
          border-radius: 6px;
          background: transparent;
          color: var(--text);
          border: none;
          cursor: pointer;
          font-family: inherit;
          transition: background 0.15s;
        }
        .pwa-chats-card:hover { background: rgba(255,255,255,0.04); }
        .pwa-chats-card-active {
          border-left: 2px solid var(--accent);
          background: rgba(199,145,12,0.12);
        }
        .pwa-chats-card-header {
          display: flex;
          align-items: center;
          gap: 6px;
          margin-bottom: 3px;
        }
        .pwa-chats-card-title {
          font-weight: 500;
          font-size: 13px;
          color: var(--text);
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
          flex: 1;
        }
        .pwa-chats-active-badge {
          font-size: 9px;
          background: var(--accent);
          color: #000;
          padding: 1px 5px;
          border-radius: 3px;
          font-weight: 600;
          flex-shrink: 0;
        }
        .pwa-chats-card-meta {
          display: flex;
          align-items: center;
          gap: 6px;
          font-size: 11px;
          color: var(--text-muted);
          opacity: 0.75;
        }
        .pwa-chats-meta-dot { color: var(--text-muted); opacity: 0.5; }
        .pwa-chats-status {
          display: inline-flex;
          align-items: center;
          justify-content: center;
          width: 9px;
          height: 9px;
          flex-shrink: 0;
        }
        .pwa-chats-status-awaiting,
        .pwa-chats-status-error {
          width: 14px;
          height: 14px;
          border-radius: 50%;
          color: #000;
          font-size: 10px;
          font-weight: 800;
          background: #f59e0b;
          animation: pwa-chats-approval-blink 1s ease-in-out infinite;
        }
        .pwa-chats-status-error { background: var(--red); }
        @keyframes pwa-chats-approval-blink {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.2; }
        }
        .pwa-chats-status-busy {
          background: var(--accent);
          border-radius: 2px;
          animation: pwa-chats-pulse 2.2s ease-in-out infinite;
        }
        .pwa-chats-status-done {
          background: var(--green);
          border-radius: 2px;
          animation: pwa-chats-done-pulse 2s ease-in-out infinite;
        }
        .pwa-chats-status-suspended {
          background: #d4a72c;
          border-radius: 2px;
        }
        .pwa-chats-status-spacer { background: transparent; }
        @keyframes pwa-chats-pulse {
          0%, 100% { opacity: 1; transform: scale(1); }
          50%      { opacity: 0.35; transform: scale(0.75); }
        }
        @keyframes pwa-chats-done-pulse {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.4; }
        }
      `}</style>
    </div>
  );
}
