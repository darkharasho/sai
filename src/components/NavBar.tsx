import { FolderClosed, GitBranch, MessagesSquare, Puzzle, Server, Search, Zap } from 'lucide-react';
import { DOT_MASK_URL } from '../lib/assets';

type OverallStatus = 'approval' | 'completed' | 'busy' | null;

interface NavBarProps {
  activeSidebar: string | null;
  onToggle: (id: string) => void;
  gitChangeCount?: number;
  swarmApprovalCount?: number;
  /** Total unread + awaiting chat sessions in the current workspace. Surfaced
   *  as a badge on the Chats button so attention is drawn even while the
   *  sidebar is collapsed (mirrors the workspace dropdown badge pattern). */
  chatNotificationCount?: number;
  overallStatus?: OverallStatus;
}

export default function NavBar({ activeSidebar, onToggle, gitChangeCount = 0, swarmApprovalCount = 0, chatNotificationCount = 0, overallStatus = null }: NavBarProps) {
  const badgeLabel = gitChangeCount > 100 ? '99+' : `${gitChangeCount}`;
  const swarmBadgeLabel = swarmApprovalCount > 100 ? '99+' : `${swarmApprovalCount}`;
  const chatBadgeLabel = chatNotificationCount > 100 ? '99+' : `${chatNotificationCount}`;

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
        title="Chats"
      >
        <MessagesSquare size={18} />
        <span className="nav-label">Chats</span>
        {chatNotificationCount > 0 && <span className="nav-badge">{chatBadgeLabel}</span>}
      </button>
      <button
        className={`nav-btn ${activeSidebar === 'swarm' ? 'active' : ''}`}
        onClick={() => onToggle('swarm')}
        title="Swarm"
        aria-label="Swarm"
      >
        <Zap size={18} />
        <span className="nav-label">Swarm</span>
        {swarmApprovalCount > 0 && <span className="nav-badge">{swarmBadgeLabel}</span>}
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
      {overallStatus && (
        <div className="nav-status-indicator">
          <span className={`nav-status-dot nav-status-${overallStatus}`} />
        </div>
      )}
      <style>{`
        .navbar {
          width: var(--nav-width);
          background: var(--bg-secondary);
          background-image: var(--elev-1);
          box-shadow: var(--elev-highlight);
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
          color: #000;
          font-size: 10px;
          font-weight: 700;
          font-family: 'Geist Mono', 'JetBrains Mono', monospace;
          min-width: 18px;
          height: 16px;
          padding: 0 5px;
          display: inline-flex;
          align-items: center;
          justify-content: center;
          isolation: isolate;
          animation: badge-pop var(--dur-base) var(--ease-out-soft);
        }
        .git-badge::before {
          content: '';
          position: absolute;
          inset: 0;
          background: var(--accent);
          -webkit-mask: url("${DOT_MASK_URL}") center / 100% 100% no-repeat;
          mask: url("${DOT_MASK_URL}") center / 100% 100% no-repeat;
          z-index: -1;
        }
        .nav-badge {
          position: absolute;
          top: 2px;
          right: 0px;
          background: var(--accent);
          color: #000;
          font-size: 10px;
          font-weight: 700;
          font-family: 'Geist Mono', 'JetBrains Mono', monospace;
          min-width: 16px;
          height: 16px;
          padding: 0 4px;
          border-radius: 8px;
          display: inline-flex;
          align-items: center;
          justify-content: center;
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
          color: var(--on-accent);
          background: var(--gradient-accent);
          box-shadow: var(--glow-accent), var(--elev-highlight);
        }
        .nav-divider {
          width: 24px;
          height: 1px;
          background: var(--border);
          margin: 4px 0;
        }
        .nav-status-indicator {
          margin-top: auto;
          padding-bottom: 10px;
          display: flex;
          align-items: center;
          justify-content: center;
        }
        .nav-status-dot {
          display: block;
          width: 10px;
          height: 10px;
          -webkit-mask: url("${DOT_MASK_URL}") center / contain no-repeat;
          mask: url("${DOT_MASK_URL}") center / contain no-repeat;
        }
        .nav-status-approval {
          background: #f59e0b;
          animation: nav-status-blink 1s ease-in-out infinite;
        }
        .nav-status-completed {
          background: var(--green);
          animation: nav-status-pulse 2s ease-in-out infinite;
        }
        .nav-status-busy {
          background: var(--accent);
          animation: nav-status-spin 2.2s ease-in-out infinite;
        }
        @keyframes nav-status-blink {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.2; }
        }
        @keyframes nav-status-pulse {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.4; }
        }
        @keyframes nav-status-spin {
          0%, 100% { opacity: 1; transform: scale(1); }
          50% { opacity: 0.35; transform: scale(0.75); }
        }
      `}</style>
    </div>
  );
}
