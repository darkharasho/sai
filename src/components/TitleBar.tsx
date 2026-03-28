import { useState, useEffect, useRef } from 'react';
import { MessageCirclePlus } from 'lucide-react';

interface TitleBarProps {
  projectPath: string;
  onProjectChange: (path: string) => void;
  onNewChat: () => void;
}

export default function TitleBar({ projectPath, onProjectChange, onNewChat }: TitleBarProps) {
  const [open, setOpen] = useState(false);
  const [recentProjects, setRecentProjects] = useState<string[]>([]);
  const dropdownRef = useRef<HTMLDivElement>(null);

  const projectName = projectPath
    ? projectPath.split('/').pop() || projectPath
    : 'No Project';

  useEffect(() => {
    if (open) {
      window.vsai.getRecentProjects().then(setRecentProjects);
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
    await window.vsai.openRecentProject(path);
    onProjectChange(path);
    setOpen(false);
  };

  const handleOpenNew = async () => {
    const folder = await window.vsai.selectFolder();
    if (folder) {
      onProjectChange(folder);
    }
    setOpen(false);
  };

  return (
    <div className="titlebar">
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
      <button className="new-chat-btn" onClick={onNewChat} title="New conversation">
        <MessageCirclePlus size={18} />
      </button>
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
        .titlebar-drag { flex: 1; }
        .new-chat-btn {
          -webkit-app-region: no-drag;
          background: none;
          border: none;
          color: var(--text-muted);
          cursor: pointer;
          padding: 4px 12px;
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
      `}</style>
    </div>
  );
}
