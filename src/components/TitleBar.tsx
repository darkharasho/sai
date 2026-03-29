import { useState, useEffect, useRef } from 'react';
import UpdateNotification from './UpdateNotification';
import CloseWorkspaceModal from './CloseWorkspaceModal';

interface WorkspaceInfo {
  projectPath: string;
  status: string;
  lastActivity: number;
}

interface TitleBarProps {
  projectPath: string;
  onProjectChange: (path: string) => void;
}

export default function TitleBar({ projectPath, onProjectChange }: TitleBarProps) {
  const [open, setOpen] = useState(false);
  const [workspaceList, setWorkspaceList] = useState<WorkspaceInfo[]>([]);
  const [version, setVersion] = useState('');
  const dropdownRef = useRef<HTMLDivElement>(null);
  const [overflowOpen, setOverflowOpen] = useState<string | null>(null);
  const [closeTarget, setCloseTarget] = useState<string | null>(null);

  useEffect(() => {
    window.sai.updateGetVersion().then((v: string) => setVersion(v));
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

  return (
    <div className="titlebar">
      <div className="titlebar-brand">
        <img src="svg/sai.svg" alt="SAI" width="18" height="18" />
      </div>
      <div className="titlebar-drag" />
      <div className="project-dropdown-wrapper" ref={dropdownRef}>
        <button className="project-selector" onClick={() => setOpen(!open)}>
          {projectName} ▾
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
                            <span className="workspace-status-dot workspace-dot-active" />
                            <span className="dropdown-item-name">{w.projectPath.split('/').pop()}</span>
                            <span className="dropdown-item-path">{w.projectPath}</span>
                          </button>
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
                  <button className="dropdown-item open-new" onClick={handleOpenNew}>
                    + Open New Project...
                  </button>
                </>
              );
            })()}
          </div>
        )}
      </div>
      <UpdateNotification />
      {version && (
        version === 'DEV'
          ? <span className="titlebar-dev-pill">DEV</span>
          : <span className="titlebar-version" onClick={() => window.sai.updateCheck()} title="Check for updates">v{version}</span>
      )}
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
          border-bottom: 1px solid var(--border);
          display: flex;
          align-items: center;
          justify-content: center;
          -webkit-app-region: drag;
          user-select: none;
          position: relative;
          z-index: 100;
        }
        .titlebar-brand {
          -webkit-app-region: no-drag;
          display: flex;
          align-items: center;
          margin-left: 12px;
          flex-shrink: 0;
        }
        .titlebar-drag { flex: 1; }
        .titlebar-version {
          color: var(--text-secondary);
          font-size: 10px;
          margin-right: 140px;
          font-family: 'JetBrains Mono', monospace;
          cursor: pointer;
          -webkit-app-region: no-drag;
        }
        .titlebar-version:hover {
          color: var(--accent);
        }
        .titlebar-dev-pill {
          font-size: 9px;
          font-weight: 700;
          font-family: 'JetBrains Mono', monospace;
          letter-spacing: 0.5px;
          color: #c7910c;
          background: rgba(199, 145, 12, 0.12);
          border: 1px solid rgba(199, 145, 12, 0.35);
          border-radius: 8px;
          padding: 1px 8px;
          margin-right: 140px;
        }
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
          border-radius: 6px;
          min-width: 300px;
          max-width: 450px;
          box-shadow: 0 8px 24px rgba(0,0,0,0.4);
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
        .open-new {
          color: var(--accent);
          font-weight: 500;
          padding: 8px 12px;
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
