import { useState, useEffect, useRef } from 'react';
import { MessageCirclePlus, Clock } from 'lucide-react';
import type { ChatSession } from '../types';
import { formatSessionDate, formatSessionTime } from '../sessions';

interface TitleBarProps {
  projectPath: string;
  onProjectChange: (path: string) => void;
  onNewChat: () => void;
  sessions: ChatSession[];
  activeSessionId: string;
  onSelectSession: (id: string) => void;
}

export default function TitleBar({ projectPath, onProjectChange, onNewChat, sessions, activeSessionId, onSelectSession }: TitleBarProps) {
  const [open, setOpen] = useState(false);
  const [recentProjects, setRecentProjects] = useState<string[]>([]);
  const dropdownRef = useRef<HTMLDivElement>(null);

  const [historyOpen, setHistoryOpen] = useState(false);
  const historyRef = useRef<HTMLDivElement>(null);

  // Close history dropdown on outside click
  useEffect(() => {
    const handleClick = (e: MouseEvent) => {
      if (historyRef.current && !historyRef.current.contains(e.target as Node)) {
        setHistoryOpen(false);
      }
    };
    if (historyOpen) document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [historyOpen]);

  // Group sessions by date
  const groupedSessions = sessions.reduce<{ label: string; sessions: ChatSession[] }[]>((groups, session) => {
    const label = formatSessionDate(session.updatedAt);
    const existing = groups.find(g => g.label === label);
    if (existing) {
      existing.sessions.push(session);
    } else {
      groups.push({ label, sessions: [session] });
    }
    return groups;
  }, []);

  const projectName = projectPath
    ? projectPath.split('/').pop() || projectPath
    : 'No Project';

  useEffect(() => {
    if (open) {
      window.sai.getRecentProjects().then(setRecentProjects);
    }
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

  const handleSelectRecent = async (path: string) => {
    await window.sai.openRecentProject(path);
    onProjectChange(path);
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
        <svg viewBox="0 0 156 143" width="18" height="18" fill="#c7910c">
          <path d="m19.314,142.571c-5.294-0.475-9.335-2.352-13.039-6.056-2.785-2.785-4.811-6.355-5.804-10.23-0.444-1.73-0.471-4.814-0.471-53.166 0-47.827 0.031-51.451 0.458-53.112 1.865-7.25 6.069-12.817 12.546-16.613 2.264-1.327 6.676-2.776 9.624-3.16 1.592-0.208 18.017-0.27 56.615-0.216l54.372 0.076 2.545 0.704c5.079 1.404 9.16 3.767 12.669 7.336 3.451 3.511 5.665 7.621 6.643 12.334 0.472 2.276 0.494 4.613 0.497 52.729 0.004 55.307 0.094 52.103-1.578 56.298-1.066 2.675-2.447 4.716-4.746 7.015-3.359 3.359-7.866 5.479-12.867 6.052-2.72 0.312-113.996 0.321-117.463 0.01zM131.365 120.48v-5.424h3.44 3.44v-2.91-2.91h-5.953-5.953v6.085 6.085H71.437 16.536v-31.618-31.618h-2.646-2.646v33.867 33.867h60.06 60.06zm13.229-0.132v-2.91h-2.595-2.595l0.039 2.315c0.067 3.926-0.25 3.506 2.637 3.506h2.514zm-64.062-28.244c9.885-30.013 12.204-37.117 12.204-37.387 0-0.146-1.689-0.25-4.072-0.25h-4.072l-9.333 28.112c-5.133 15.462-9.386 28.261-9.45 28.443-0.09 0.256 0.847 0.331 4.134 0.331h4.251zm64.33-21.455V37.178l-59.862 0.067-59.862 0.067 0.024 4.16 0.024 4.16-3.464 0.074-3.464 0.074-0.075 3.109-0.075 3.109h6.094 6.094v-4.763-4.763l54.703 0 54.703 0-0.077 29.699c-0.043 16.335-0.005 30.206 0.082 30.824l0.16 1.124h2.497 2.497zm-81.674 28.102 1.472-4.442-1.003-0.717c-0.552-0.394-5.246-3.572-10.432-7.062-8.893-5.984-9.403-6.37-8.968-6.791 0.253-0.245 2.961-2.141 6.017-4.212 14.039-9.517 16.007-10.877 16.007-11.06 0-0.166-4.68-6.368-5.284-7.002-0.193-0.203-34.199 22.371-34.329 22.789-0.089 0.287 34.682 23.349 34.876 23.132 0.094-0.106 0.834-2.191 1.644-4.634zm40.882-0.806c3.736-2.523 11.02-7.421 16.186-10.884 5.166-3.463 9.534-6.43 9.706-6.592 0.235-0.221-1.584-1.562-7.276-5.363-8.552-5.711-16.768-11.259-22.287-15.049-2.049-1.407-3.776-2.507-3.838-2.445-0.062 0.062-0.804 2.154-1.648 4.647l-1.535 4.534 5.568 3.773c3.062 2.075 7.438 5.027 9.725 6.558 2.286 1.532 4.156 2.904 4.154 3.049-0.002 0.146-4.73 3.453-10.507 7.35-5.777 3.897-10.762 7.291-11.077 7.541-0.572 0.454-0.568 0.46 2.514 3.937 1.697 1.915 3.184 3.493 3.304 3.506 0.12 0.013 3.275-2.041 7.011-4.563zM16.272 43.619c0-1.601 0.001-3 0.001-3.109 0.001-0.109-1.13-0.233-2.514-0.274l-2.515-0.076v3.185 3.185h2.514 2.514zm128.318-15.015c-0.008-6.696-1.008-9.543-4.644-13.223-1.661-1.681-2.599-2.39-4.118-3.111-3.891-1.848-0.066-1.74-58.772-1.662-50.703 0.068-53.041 0.092-54.434 0.559-5.654 1.898-9.746 6.118-10.97 11.313-0.266 1.128-0.4 3.083-0.403 5.86l-0.004 4.167h66.675 66.675zM25.577 25.853c-2.753-1.363-3.471-4.979-1.461-7.367 0.976-1.16 1.967-1.59 3.666-1.59 2.895 0 4.668 1.757 4.668 4.625 0 2.171-0.989 3.646-3.009 4.491-1.342 0.561-2.506 0.513-3.863-0.158zm13.806 0.023c-2.176-1.077-3.214-3.687-2.358-5.93 1.119-2.93 4.584-4.111 7.095-2.419 3.214 2.166 2.819 6.789-0.717 8.395-1.402 0.637-2.669 0.622-4.02-0.047zm14.063 0.354c-0.722-0.175-2.169-1.294-2.678-2.071-2.818-4.301 2.557-9.521 6.835-6.638 2.443 1.646 2.802 5.529 0.693 7.498-1.227 1.145-3.148 1.625-4.85 1.212zm58.605-1.794v-1.984h2.646 2.646v1.984 1.984h-2.646-2.646zm8.996 0v-1.984h5.821 5.821v1.984 1.984h-5.821-5.821z" />
        </svg>
      </div>
      <div className="titlebar-drag" />
      <div className="project-dropdown-wrapper" ref={dropdownRef}>
        <button className="project-selector" onClick={() => setOpen(!open)}>
          {projectName} ▾
        </button>
        {open && (
          <div className="project-dropdown">
            {recentProjects.length > 0 && (
              <>
                <div className="dropdown-label">Recent Projects</div>
                {recentProjects.map(p => (
                  <button
                    key={p}
                    className={`dropdown-item ${p === projectPath ? 'active' : ''}`}
                    onClick={() => handleSelectRecent(p)}
                  >
                    <span className="dropdown-item-name">{p.split('/').pop()}</span>
                    <span className="dropdown-item-path">{p}</span>
                  </button>
                ))}
                <div className="dropdown-divider" />
              </>
            )}
            <button className="dropdown-item open-new" onClick={handleOpenNew}>
              + Open New Project...
            </button>
          </div>
        )}
      </div>
      <div className="titlebar-actions">
        <div className="history-dropdown-wrapper" ref={historyRef}>
          <button
            className="new-chat-btn"
            onClick={() => setHistoryOpen(!historyOpen)}
            title="Recent conversations"
          >
            <Clock size={16} />
          </button>
          {historyOpen && (
            <div className="history-dropdown">
              {sessions.length === 0 ? (
                <div className="dropdown-label" style={{ padding: '12px' }}>
                  No recent conversations
                </div>
              ) : (
                groupedSessions.map((group, gi) => (
                  <div key={group.label}>
                    {gi > 0 && <div className="dropdown-divider" />}
                    <div className="dropdown-label">{group.label}</div>
                    {group.sessions.map(session => (
                      <button
                        key={session.id}
                        className={`dropdown-item history-item ${session.id === activeSessionId ? 'active' : ''}`}
                        onClick={() => {
                          onSelectSession(session.id);
                          setHistoryOpen(false);
                        }}
                      >
                        <span className="dropdown-item-name">{session.title || 'Untitled'}</span>
                        <span className="dropdown-item-path">{formatSessionTime(session.updatedAt)}</span>
                      </button>
                    ))}
                  </div>
                ))
              )}
            </div>
          )}
        </div>
        <button className="new-chat-btn" onClick={onNewChat} title="New conversation">
          <MessageCirclePlus size={18} />
        </button>
      </div>
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
        .titlebar-actions {
          -webkit-app-region: no-drag;
          display: flex;
          align-items: center;
          gap: 2px;
          margin-right: 140px; /* Space for window controls overlay */
        }
        .new-chat-btn {
          -webkit-app-region: no-drag;
          background: none;
          border: none;
          color: var(--text-muted);
          cursor: pointer;
          padding: 4px;
          border-radius: 4px;
          display: flex;
          align-items: center;
        }
        .new-chat-btn:hover {
          color: var(--accent);
          background: var(--bg-hover);
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
          overflow: hidden;
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
        .history-dropdown-wrapper {
          -webkit-app-region: no-drag;
          position: relative;
        }
        .history-dropdown {
          position: absolute;
          top: 100%;
          right: 0;
          margin-top: 4px;
          background: var(--bg-elevated);
          border: 1px solid var(--border);
          border-radius: 6px;
          min-width: 280px;
          max-width: 350px;
          max-height: 400px;
          overflow-y: auto;
          box-shadow: 0 8px 24px rgba(0,0,0,0.4);
          z-index: 200;
        }
        .history-item.active {
          border-left: 2px solid var(--accent);
          background: rgba(126,184,247,0.05);
          color: #fff;
        }
        .history-item.active .dropdown-item-name {
          color: #fff;
        }
        .history-item.active .dropdown-item-path {
          color: var(--text-muted);
        }
      `}</style>
    </div>
  );
}
