import { FolderClosed, GitBranch, Clock, Puzzle, Server, Search } from 'lucide-react';

interface NavBarProps {
  activeSidebar: string | null;
  onToggle: (id: string) => void;
  gitChangeCount?: number;
}

export default function NavBar({ activeSidebar, onToggle, gitChangeCount = 0 }: NavBarProps) {
  const badgeLabel = gitChangeCount > 100 ? '99+' : `${gitChangeCount}`;

  return (
    <div className="navbar">
      <button
        className={`nav-btn ${activeSidebar === 'files' ? 'active' : ''}`}
        onClick={() => onToggle('files')}
        title="Explorer"
      >
        <FolderClosed size={18} />
        <span className="nav-label">Files</span>
      </button>
      <button
        className={`nav-btn ${activeSidebar === 'git' ? 'active' : ''}`}
        onClick={() => onToggle('git')}
        title="Source Control"
      >
        <GitBranch size={18} />
        <span className="nav-label">Git</span>
        {gitChangeCount > 0 && <span className="git-badge">{badgeLabel}</span>}
      </button>
      <button
        className={`nav-btn ${activeSidebar === 'search' ? 'active' : ''}`}
        onClick={() => onToggle('search')}
        title="Search"
      >
        <Search size={18} />
        <span className="nav-label">Search</span>
      </button>
      <button
        className={`nav-btn ${activeSidebar === 'chats' ? 'active' : ''}`}
        onClick={() => onToggle('chats')}
        title="Chat History"
      >
        <Clock size={18} />
        <span className="nav-label">Chats</span>
      </button>
      <div className="nav-divider" />
      <button
        className={`nav-btn ${activeSidebar === 'plugins' ? 'active' : ''}`}
        onClick={() => onToggle('plugins')}
        title="Plugins"
      >
        <Puzzle size={18} />
        <span className="nav-label">Plugins</span>
      </button>
      <button
        className={`nav-btn ${activeSidebar === 'mcp' ? 'active' : ''}`}
        onClick={() => onToggle('mcp')}
        title="MCP Servers"
      >
        <Server size={18} />
        <span className="nav-label">MCP</span>
      </button>
      <style>{`
        .navbar {
          width: var(--nav-width);
          background: var(--bg-secondary);
          display: flex;
          flex-direction: column;
          align-items: center;
          padding-top: 8px;
          gap: 2px;
          border-right: 1px solid var(--border);
          flex-shrink: 0;
        }
        .nav-btn {
          width: 42px;
          height: 44px;
          display: flex;
          flex-direction: column;
          align-items: center;
          justify-content: center;
          gap: 2px;
          background: none;
          border: none;
          color: var(--text-muted);
          cursor: pointer;
          border-radius: 0 8px 8px 0;
          position: relative;
          transition: color var(--dur-fast) var(--ease-out-soft),
                      background var(--dur-fast) var(--ease-out-soft),
                      transform var(--dur-fast) var(--ease-out-soft);
        }
        .nav-btn::before {
          content: '';
          position: absolute;
          left: 0;
          top: 6px;
          bottom: 6px;
          width: 2px;
          background: var(--accent);
          border-radius: 0 2px 2px 0;
          transform: scaleY(0);
          transform-origin: center;
          transition: transform var(--dur-base) var(--ease-out-soft);
        }
        .nav-btn.active::before {
          transform: scaleY(1);
        }
        .nav-btn:active {
          transform: scale(0.94);
        }
        .nav-label {
          font-size: 8px;
          font-weight: 500;
          font-family: 'Geist', sans-serif;
          letter-spacing: 0.3px;
          line-height: 1;
        }
        .git-badge {
          position: absolute;
          top: 2px;
          right: 0px;
          background: var(--accent);
          color: #000;
          font-size: 9px;
          font-weight: 700;
          font-family: 'Geist Mono', 'JetBrains Mono', monospace;
          min-width: 16px;
          height: 16px;
          line-height: 16px;
          text-align: center;
          border-radius: 8px;
          padding: 0 3px;
          animation: badge-pop var(--dur-base) var(--ease-out-soft);
        }
        @keyframes badge-pop {
          from { transform: scale(0.6); opacity: 0; }
          to { transform: scale(1); opacity: 1; }
        }
        .nav-btn:hover {
          color: var(--text);
          background: var(--bg-hover);
        }
        .nav-btn.active {
          color: var(--accent);
          background: rgba(199, 145, 12, 0.08);
        }
        .nav-divider {
          width: 24px;
          height: 1px;
          background: var(--border);
          margin: 4px 0;
        }
      `}</style>
    </div>
  );
}
