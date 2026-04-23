import { useState, useEffect, useRef } from 'react';
import UpdateNotification from './UpdateNotification';
import CloseWorkspaceModal from './CloseWorkspaceModal';
import GitHubAuthModal from './GitHubAuthModal';
import SettingsModal from './SettingsModal';
import { LogOut, Settings, ChevronDown, FolderOpen, FolderPlus } from 'lucide-react';

interface GitHubUser {
  login: string;
  avatar_url: string;
  name: string;
}

interface WorkspaceInfo {
  projectPath: string;
  status: string;
  lastActivity: number;
}

interface TitleBarProps {
  projectPath: string;
  onProjectChange: (path: string) => void;
  completedWorkspaces?: Set<string>;
  busyWorkspaces?: Set<string>;
  approvalWorkspaces?: Set<string>;
  onSettingChange?: (key: string, value: any) => void;
  onOpenWhatsNew?: () => void;
  onHistoryRetentionChange?: (days: number | null) => void;
  onNewProject?: () => void;
}

export default function TitleBar({ projectPath, onProjectChange, completedWorkspaces, busyWorkspaces, approvalWorkspaces, onSettingChange, onOpenWhatsNew, onHistoryRetentionChange, onNewProject }: TitleBarProps) {
  const [open, setOpen] = useState(false);
  const [workspaceList, setWorkspaceList] = useState<WorkspaceInfo[]>([]);
  const [version, setVersion] = useState('');
  const dropdownRef = useRef<HTMLDivElement>(null);
  const [overflowOpen, setOverflowOpen] = useState<string | null>(null);
  const [closeTarget, setCloseTarget] = useState<string | null>(null);
  const [ghUser, setGhUser] = useState<GitHubUser | null>(null);
  const [ghDropOpen, setGhDropOpen] = useState(false);
  const [showAuthModal, setShowAuthModal] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [syncStatus, setSyncStatus] = useState<'idle' | 'syncing' | 'synced' | 'error'>('idle');
  const ghDropRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    window.sai.updateGetVersion().then((v: string) => setVersion(v));
    window.sai.githubGetUser().then((u: GitHubUser | null) => setGhUser(u));
    const unsubSync = window.sai.githubOnSyncStatus((data: { status: string }) => {
      setSyncStatus(data.status as any);
    });
    return () => unsubSync();
  }, []);

  const projectName = projectPath
    ? projectPath.split('/').pop() || projectPath
    : 'No Project';

  useEffect(() => {
    if (open) {
      window.sai.workspaceGetAll?.().then((list: WorkspaceInfo[]) => {
        setWorkspaceList(list || []);
      }).catch(() => {
        window.sai.getRecentProjects().then((recent: string[]) => {
          setWorkspaceList(recent.map(p => ({ projectPath: p, status: 'recent', lastActivity: 0 })));
        });
      });
    }
  }, [open]);

  useEffect(() => {
    if (!open) setOverflowOpen(null);
  }, [open]);

  // Close dropdown on outside click
  useEffect(() => {
    const handleClick = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    if (open) document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [open]);

  const handleSuspend = async (path: string) => {
    setOverflowOpen(null);
    await window.sai.workspaceSuspend?.(path);
    const list = await window.sai.workspaceGetAll?.();
    if (list) setWorkspaceList(list);
  };

  const handleCloseConfirm = async () => {
    if (!closeTarget) return;
    await window.sai.workspaceClose?.(closeTarget);
    setCloseTarget(null);
    setOpen(false);
  };

  const handleOpenNew = async () => {
    const folder = await window.sai.selectFolder();
    if (folder) {
      onProjectChange(folder);
    }
    setOpen(false);
  };

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ghDropRef.current && !ghDropRef.current.contains(e.target as Node)) {
        setGhDropOpen(false);
      }
    };
    if (ghDropOpen) document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [ghDropOpen]);

  const handleGhLogout = async () => {
    await window.sai.githubLogout();
    setGhUser(null);
    setGhDropOpen(false);
  };

  const handleAuthSuccess = (user: GitHubUser) => {
    setGhUser(user);
    setShowAuthModal(false);
  };

  return (
    <div className={`titlebar${window.sai.platform === 'darwin' ? ' titlebar-mac' : ''}`}>
      {window.sai.platform !== 'darwin' && (
        <div className="titlebar-brand">
          <img src="svg/sai.svg" alt="SAI" width="18" height="18" />
        </div>
      )}
      <div className="titlebar-drag" />
      <div className="project-dropdown-wrapper" ref={dropdownRef}>
        <button className="project-selector" onClick={() => setOpen(!open)}>
          {projectName} ▾
          {(() => {
            const approvalCount = approvalWorkspaces ? approvalWorkspaces.size : 0;
            const bgBusyCount = busyWorkspaces ? [...busyWorkspaces].filter(p => p !== projectPath).length : 0;
            if (approvalCount > 0) return <span className="titlebar-approval-dot" />;
            if (completedWorkspaces && completedWorkspaces.size > 0) return <span className="workspace-done-dot" />;
            if (bgBusyCount > 0) return (
              <span className="titlebar-busy-indicator">
                <span className="titlebar-busy-spinner" />
                {bgBusyCount > 1 && <span className="titlebar-busy-count">{bgBusyCount}</span>}
              </span>
            );
            return null;
          })()}
        </button>
        {open && (
          <div className="project-dropdown" onMouseDown={(e) => {
            const target = e.target as HTMLElement;
            if (!target.closest(`[data-path="${overflowOpen}"]`)) {
              setOverflowOpen(null);
            }
          }}>
            {(() => {
              const active = workspaceList.filter(w => w.status === 'active');
              const suspended = workspaceList.filter(w => w.status === 'suspended');
              const recent = workspaceList.filter(w => w.status === 'recent');

              return (
                <>
                  {active.length > 0 && (
                    <>
                      <div className="dropdown-label">Active</div>
                      {active.map(w => (
                        <div key={w.projectPath} className="workspace-row-wrapper" data-path={w.projectPath}>
                          <button
                            className={`dropdown-item workspace-item ${w.projectPath === projectPath ? 'active' : ''}`}
                            onClick={() => { onProjectChange(w.projectPath); setOpen(false); }}
                          >
                            {approvalWorkspaces?.has(w.projectPath)
                              ? <span className="workspace-approval-icon" title="Approval needed">!</span>
                              : busyWorkspaces?.has(w.projectPath)
                                ? <span className="workspace-spinner" title="Working..." />
                                : <span className="workspace-status-dot workspace-dot-active" />}
                            <span className="dropdown-item-name">{w.projectPath.split('/').pop()}</span>
                            {approvalWorkspaces?.has(w.projectPath)
                              ? <span className="workspace-approval-label">Approval needed</span>
                              : completedWorkspaces?.has(w.projectPath) && <span className="workspace-completed-icon" title="Response complete">!</span>}
                            <span className="dropdown-item-path">{w.projectPath}</span>
                          </button>
                          {w.projectPath !== projectPath && (<>
                          <button
                            className={`workspace-overflow-btn${overflowOpen === w.projectPath ? ' open' : ''}`}
                            onClick={(e) => {
                              e.stopPropagation();
                              setOverflowOpen(overflowOpen === w.projectPath ? null : w.projectPath);
                            }}
                          >···</button>
                          {overflowOpen === w.projectPath && (
                            <div className="workspace-submenu">
                              <button className="workspace-submenu-item" onClick={() => handleSuspend(w.projectPath)}>
                                ⏸ Suspend
                              </button>
                              <button
                                className="workspace-submenu-item danger"
                                onClick={() => { setOverflowOpen(null); setCloseTarget(w.projectPath); }}
                              >
                                ✕ Close
                              </button>
                            </div>
                          )}
                          </>)}
                        </div>
                      ))}
                    </>
                  )}
                  {suspended.length > 0 && (
                    <>
                      {active.length > 0 && <div className="dropdown-divider" />}
                      <div className="dropdown-label">Suspended</div>
                      {suspended.map(w => (
                        <button
                          key={w.projectPath}
                          className={`dropdown-item workspace-item ${w.projectPath === projectPath ? 'active' : ''}`}
                          onClick={() => { onProjectChange(w.projectPath); setOpen(false); }}
                        >
                          <span className="workspace-status-dot workspace-dot-suspended" />
                          <span className="dropdown-item-name">{w.projectPath.split('/').pop()}</span>
                          <span className="dropdown-item-path">{w.projectPath}</span>
                        </button>
                      ))}
                    </>
                  )}
                  {recent.length > 0 && (
                    <>
                      {(active.length > 0 || suspended.length > 0) && <div className="dropdown-divider" />}
                      <div className="dropdown-label">Recent</div>
                      {recent.map(w => (
                        <button
                          key={w.projectPath}
                          className={`dropdown-item workspace-item ${w.projectPath === projectPath ? 'active' : ''}`}
                          onClick={() => { onProjectChange(w.projectPath); setOpen(false); }}
                        >
                          <span className="dropdown-item-name">{w.projectPath.split('/').pop()}</span>
                          <span className="dropdown-item-path">{w.projectPath}</span>
                        </button>
                      ))}
                    </>
                  )}
                  <div className="dropdown-divider" />
                  <div style={{ display: 'flex', alignItems: 'center' }}>
                    <button
                      className="dropdown-item"
                      onClick={handleOpenNew}
                      style={{
                        flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center',
                        gap: 5, color: 'var(--accent)', fontSize: 13, borderRadius: '4px 0 0 4px',
                      }}
                      onMouseEnter={e => { e.currentTarget.style.color = 'var(--accent-hover)'; e.currentTarget.style.background = 'var(--bg-elevated)'; }}
                      onMouseLeave={e => { e.currentTarget.style.color = 'var(--accent)'; e.currentTarget.style.background = 'transparent'; }}
                    >
                      <FolderOpen size={13} />
                      Open Project
                    </button>
                    <div style={{ width: 1, height: 16, background: 'var(--border)', flexShrink: 0 }} />
                    <button
                      className="dropdown-item"
                      onClick={() => { setOpen(false); onNewProject?.(); }}
                      style={{
                        flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center',
                        gap: 5, color: 'var(--accent)', fontSize: 13, borderRadius: '0 4px 4px 0',
                      }}
                      onMouseEnter={e => { e.currentTarget.style.color = 'var(--accent-hover)'; e.currentTarget.style.background = 'var(--bg-elevated)'; }}
                      onMouseLeave={e => { e.currentTarget.style.color = 'var(--accent)'; e.currentTarget.style.background = 'transparent'; }}
                    >
                      <FolderPlus size={13} />
                      New Project
                    </button>
                  </div>
                </>
              );
            })()}
          </div>
        )}
      </div>
      <UpdateNotification />
      <div className="titlebar-right">
        {version && (
          version === 'DEV'
            ? <span className="titlebar-dev-pill">DEV</span>
            : <span className="titlebar-version" onClick={() => window.sai.updateCheck()} title="Check for updates">v{version}</span>
        )}
        {ghUser ? (
          <div className="gh-user-wrapper" ref={ghDropRef}>
            <button className="gh-user-btn" onClick={() => setGhDropOpen(v => !v)}>
              <div className="gh-avatar-wrap">
                <img src={ghUser.avatar_url} className="gh-avatar" alt={ghUser.login} />
                {syncStatus === 'syncing' && <span className="gh-sync-dot syncing" />}
                {syncStatus === 'error' && <span className="gh-sync-dot error" />}
              </div>
              <span className="gh-username">{ghUser.login}</span>
              <ChevronDown size={11} className={`gh-chevron${ghDropOpen ? ' open' : ''}`} />
            </button>
            {ghDropOpen && (
              <div className="gh-dropdown">
                <div className="gh-dropdown-header">
                  <img src={ghUser.avatar_url} className="gh-dropdown-avatar" alt={ghUser.login} />
                  <div>
                    <div className="gh-dropdown-name">{ghUser.name}</div>
                    <div className="gh-dropdown-login">@{ghUser.login}</div>
                  </div>
                </div>
                <div className="gh-dropdown-divider" />
                <button className="gh-dropdown-item" onClick={() => { setGhDropOpen(false); setShowSettings(true); }}>
                  <Settings size={13} /> Settings
                </button>
                <button className="gh-dropdown-item danger" onClick={handleGhLogout}>
                  <LogOut size={13} /> Sign out
                </button>
              </div>
            )}
          </div>
        ) : (
          <button className="gh-login-btn" onClick={() => setShowAuthModal(true)}>
            <svg viewBox="0 0 24 24" fill="currentColor" width="13" height="13">
              <path d="M12 0C5.37 0 0 5.37 0 12c0 5.31 3.435 9.795 8.205 11.385.6.105.825-.255.825-.57 0-.285-.015-1.23-.015-2.235-3.015.555-3.795-.735-4.035-1.41-.135-.345-.72-1.41-1.23-1.695-.42-.225-1.02-.78-.015-.795.945-.015 1.62.87 1.845 1.23 1.08 1.815 2.805 1.305 3.495.99.105-.78.42-1.305.765-1.605-2.67-.3-5.46-1.335-5.46-5.925 0-1.305.465-2.385 1.23-3.225-.12-.3-.54-1.53.12-3.18 0 0 1.005-.315 3.3 1.23.96-.27 1.98-.405 3-.405s2.04.135 3 .405c2.295-1.56 3.3-1.23 3.3-1.23.66 1.65.24 2.88.12 3.18.765.84 1.23 1.905 1.23 3.225 0 4.605-2.805 5.625-5.475 5.925.435.375.81 1.095.81 2.22 0 1.605-.015 2.895-.015 3.3 0 .315.225.69.825.57A12.02 12.02 0 0 0 24 12c0-6.63-5.37-12-12-12z"/>
            </svg>
            Login
          </button>
        )}
        {window.sai.platform === 'darwin' && (
          <div className="titlebar-brand">
            <img src="svg/sai.svg" alt="SAI" width="18" height="18" />
          </div>
        )}
      </div>
      {showAuthModal && <GitHubAuthModal onSuccess={handleAuthSuccess} onClose={() => setShowAuthModal(false)} />}
      {showSettings && <SettingsModal onClose={() => setShowSettings(false)} onSettingChange={onSettingChange} onOpenWhatsNew={onOpenWhatsNew} onHistoryRetentionChange={onHistoryRetentionChange} />}
      {closeTarget && (
        <CloseWorkspaceModal
          projectPath={closeTarget}
          onConfirm={handleCloseConfirm}
          onCancel={() => setCloseTarget(null)}
        />
      )}
      <style>{`
        .titlebar {
          height: var(--titlebar-height);
          background: var(--bg-secondary);
          border-bottom: none;
          display: flex;
          align-items: center;
          justify-content: center;
          -webkit-app-region: drag;
          user-select: none;
          position: relative;
          z-index: 100;
        }
        .titlebar::after {
          content: '';
          position: absolute;
          bottom: 0;
          left: 0;
          right: 0;
          height: 1px;
          background: linear-gradient(90deg, var(--accent) 0%, var(--accent) 20%, transparent 85%);
          z-index: 200;
          pointer-events: none;
        }
        .titlebar-brand {
          -webkit-app-region: no-drag;
          display: flex;
          align-items: center;
          margin-left: 12px;
          flex-shrink: 0;
        }
        .titlebar-drag { flex: 1; }
        .titlebar-right {
          display: flex;
          align-items: center;
          gap: 8px;
          margin-right: 104px;
          -webkit-app-region: no-drag;
          flex-shrink: 0;
        }
        .titlebar-mac {
          padding-left: 78px;
        }
        .titlebar-mac .titlebar-right {
          margin-right: 12px;
        }
        .titlebar-version {
          color: var(--text-secondary);
          font-size: 10px;
          font-family: 'Geist Mono', 'JetBrains Mono', monospace;
          cursor: pointer;
          -webkit-app-region: no-drag;
        }
        .titlebar-version:hover { color: var(--accent); }
        .titlebar-dev-pill {
          font-size: 9px;
          font-weight: 700;
          font-family: 'Geist Mono', 'JetBrains Mono', monospace;
          letter-spacing: 0.5px;
          color: #c7910c;
          background: rgba(199, 145, 12, 0.12);
          border: 1px solid rgba(199, 145, 12, 0.35);
          border-radius: 8px;
          padding: 1px 8px;
        }
        .gh-login-btn {
          display: flex;
          align-items: center;
          gap: 5px;
          background: var(--bg-secondary);
          border: 1px solid var(--border);
          border-radius: 5px;
          color: var(--text-secondary);
          font-size: 11px;
          padding: 3px 8px;
          cursor: pointer;
        }
        .gh-login-btn:hover { color: var(--text); border-color: var(--accent); }
        .gh-user-wrapper {
          position: relative;
        }
        .gh-user-btn {
          display: flex;
          align-items: center;
          gap: 5px;
          background: none;
          border: 1px solid transparent;
          border-radius: 5px;
          cursor: pointer;
          padding: 2px 6px;
          color: var(--text-secondary);
        }
        .gh-user-btn:hover { background: var(--bg-hover); border-color: var(--border); color: var(--text); }
        .gh-avatar-wrap { position: relative; flex-shrink: 0; }
        .gh-avatar {
          width: 18px;
          height: 18px;
          border-radius: 50%;
          object-fit: cover;
          display: block;
        }
        .gh-sync-dot {
          position: absolute;
          bottom: -1px;
          right: -1px;
          width: 6px;
          height: 6px;
          border-radius: 50%;
          border: 1px solid var(--bg-secondary);
        }
        .gh-sync-dot.syncing { background: var(--accent); animation: sync-pulse 1s ease-in-out infinite; }
        .gh-sync-dot.error { background: #f87171; }
        @keyframes sync-pulse { 0%,100% { opacity: 1; } 50% { opacity: 0.3; } }
        .gh-username {
          font-size: 11px;
          max-width: 80px;
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
        }
        .gh-chevron {
          transition: transform 0.15s;
        }
        .gh-chevron.open { transform: rotate(180deg); }
        .gh-dropdown {
          position: absolute;
          top: calc(100% + 6px);
          right: 0;
          background: var(--bg-elevated);
          border: 1px solid var(--border);
          border-radius: 8px;
          min-width: 200px;
          box-shadow: 0 8px 24px rgba(0,0,0,0.4);
          overflow: hidden;
          z-index: 500;
          animation: dropdown-in 0.15s ease-out;
        }
        .gh-dropdown-header {
          display: flex;
          align-items: center;
          gap: 10px;
          padding: 12px;
        }
        .gh-dropdown-avatar {
          width: 36px;
          height: 36px;
          border-radius: 50%;
        }
        .gh-dropdown-name {
          font-size: 13px;
          font-weight: 500;
          color: var(--text);
        }
        .gh-dropdown-login {
          font-size: 11px;
          color: var(--text-muted);
          margin-top: 1px;
        }
        .gh-dropdown-divider {
          height: 1px;
          background: var(--border);
        }
        .gh-dropdown-item {
          display: flex;
          align-items: center;
          gap: 8px;
          width: 100%;
          padding: 8px 12px;
          background: none;
          border: none;
          color: var(--text);
          font-size: 12px;
          cursor: pointer;
          text-align: left;
        }
        .gh-dropdown-item:hover { background: var(--bg-hover); }
        .gh-dropdown-item.danger { color: #f87171; }
        .gh-dropdown-item.danger:hover { background: rgba(248,113,113,0.08); }
        .project-dropdown-wrapper {
          -webkit-app-region: no-drag;
          position: absolute;
          left: 50%;
          transform: translateX(-50%);
        }
        .project-selector {
          background: transparent;
          border: 1px solid transparent;
          color: var(--text);
          font-size: 12px;
          cursor: pointer;
          padding: 4px 12px;
          border-radius: 4px;
          position: relative;
        }
        .workspace-done-dot {
          display: inline-block;
          width: 7px;
          height: 7px;
          border-radius: 50%;
          background: var(--accent);
          margin-left: 6px;
          vertical-align: middle;
          animation: done-pulse 2s ease-in-out infinite;
        }
        .titlebar-busy-indicator {
          display: inline-flex;
          align-items: center;
          gap: 4px;
          margin-left: 6px;
          vertical-align: middle;
        }
        .titlebar-busy-spinner {
          display: inline-block;
          width: 9px;
          height: 9px;
          border: 1.5px solid rgba(199, 145, 12, 0.25);
          border-top-color: var(--accent);
          border-radius: 50%;
          animation: workspace-spin 0.8s linear infinite;
        }
        .titlebar-busy-count {
          font-size: 10px;
          font-family: 'Geist Mono', 'JetBrains Mono', monospace;
          color: var(--text-muted);
          opacity: 0.6;
          font-weight: 500;
        }
        .workspace-completed-icon {
          display: inline-flex;
          align-items: center;
          justify-content: center;
          width: 14px;
          height: 14px;
          border-radius: 50%;
          background: var(--accent);
          color: #000;
          font-size: 10px;
          font-weight: 800;
          flex-shrink: 0;
          animation: done-pulse 2s ease-in-out infinite;
        }
        @keyframes done-pulse {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.4; }
        }
        @keyframes approval-blink {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.2; }
        }
        .titlebar-approval-dot {
          display: inline-block;
          width: 7px;
          height: 7px;
          border-radius: 50%;
          background: #f59e0b;
          margin-left: 6px;
          vertical-align: middle;
          animation: approval-blink 1s ease-in-out infinite;
        }
        .workspace-approval-icon {
          display: inline-flex;
          align-items: center;
          justify-content: center;
          width: 14px;
          height: 14px;
          border-radius: 50%;
          background: #f59e0b;
          color: #000;
          font-size: 10px;
          font-weight: 800;
          flex-shrink: 0;
          animation: approval-blink 1s ease-in-out infinite;
        }
        .dropdown-item.active .workspace-approval-icon {
          background: #000;
          color: #f59e0b;
        }
        .workspace-approval-label {
          font-size: 11px;
          color: #f59e0b;
          margin-left: 4px;
        }
        .dropdown-item.active .workspace-approval-label {
          color: #000;
          opacity: 0.8;
        }
        .project-selector:hover {
          background: var(--bg-hover);
          border-color: var(--border);
        }
        .project-dropdown {
          position: absolute;
          top: 100%;
          left: 50%;
          transform: translateX(-50%);
          margin-top: 4px;
          background: var(--bg-elevated);
          border: 1px solid var(--border);
          border-radius: 8px;
          min-width: 300px;
          max-width: 450px;
          box-shadow: 0 8px 24px rgba(0,0,0,0.4);
          animation: fade-in 0.15s ease-out;
        }
        @keyframes fade-in {
          from { opacity: 0; }
          to   { opacity: 1; }
        }
        .dropdown-label {
          padding: 8px 12px 4px;
          font-size: 10px;
          text-transform: uppercase;
          letter-spacing: 0.5px;
          color: var(--text-muted);
        }
        .dropdown-item {
          display: flex;
          flex-direction: column;
          width: 100%;
          padding: 6px 12px;
          background: none;
          border: none;
          color: var(--text);
          cursor: pointer;
          text-align: left;
          font-size: 13px;
        }
        .dropdown-item:hover {
          background: var(--bg-hover);
        }
        .dropdown-item.active {
          background: var(--accent);
          color: #000;
        }
        .dropdown-item.active .dropdown-item-path {
          color: #000;
          opacity: 0.7;
        }
        .dropdown-item-name {
          font-weight: 500;
        }
        .dropdown-item-path {
          font-size: 11px;
          color: var(--text-muted);
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
        }
        .dropdown-divider {
          height: 1px;
          background: var(--border);
          margin: 4px 0;
        }
        .workspace-item {
          flex-direction: row !important;
          align-items: center;
          gap: 8px;
        }
        .workspace-item .dropdown-item-path {
          margin-left: auto;
          flex-shrink: 1;
        }
        .workspace-status-dot {
          width: 6px;
          height: 6px;
          border-radius: 50%;
          flex-shrink: 0;
        }
        .workspace-dot-active {
          background: #4ade80;
        }
        .workspace-spinner {
          width: 10px;
          height: 10px;
          border: 1.5px solid rgba(199, 145, 12, 0.3);
          border-top-color: var(--accent);
          border-radius: 50%;
          flex-shrink: 0;
          animation: workspace-spin 0.8s linear infinite;
        }
        .dropdown-item.active .workspace-spinner {
          border-color: rgba(0, 0, 0, 0.2);
          border-top-color: #000;
        }
        @keyframes workspace-spin {
          to { transform: rotate(360deg); }
        }
        .workspace-dot-suspended {
          background: #d4a72c;
        }
        .workspace-row-wrapper {
          position: relative;
        }
        .workspace-row-wrapper .dropdown-item {
          padding-right: 36px;
        }
        .workspace-overflow-btn {
          position: absolute;
          right: 8px;
          top: 50%;
          transform: translateY(-50%);
          background: none;
          border: none;
          color: var(--text-muted);
          cursor: pointer;
          font-size: 14px;
          letter-spacing: 1px;
          padding: 2px 4px;
          border-radius: 3px;
          opacity: 0;
          -webkit-app-region: no-drag;
        }
        .workspace-row-wrapper:hover .workspace-overflow-btn,
        .workspace-overflow-btn.open {
          opacity: 1;
        }
        .workspace-overflow-btn:hover {
          background: var(--bg-secondary);
          color: var(--text);
        }
        .workspace-submenu {
          position: absolute;
          right: 8px;
          top: calc(100% - 4px);
          z-index: 200;
          background: var(--bg-elevated);
          border: 1px solid var(--border);
          border-radius: 6px;
          padding: 4px 0;
          min-width: 120px;
          box-shadow: 0 4px 16px rgba(0,0,0,0.5);
        }
        .workspace-submenu-item {
          display: flex;
          align-items: center;
          gap: 6px;
          width: 100%;
          padding: 7px 12px;
          background: none;
          border: none;
          color: var(--text);
          cursor: pointer;
          font-size: 12px;
          text-align: left;
          -webkit-app-region: no-drag;
        }
        .workspace-submenu-item:hover {
          background: var(--bg-hover);
        }
        .workspace-submenu-item.danger {
          color: #f87171;
        }
        .workspace-submenu-item.danger:hover {
          background: rgba(248,113,113,0.08);
        }
      `}</style>
    </div>
  );
}
