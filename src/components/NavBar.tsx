import { FolderClosed, GitBranch, SquareTerminal } from 'lucide-react';

interface NavBarProps {
  activeSidebar: string | null;
  activeTerminal?: boolean;
  onToggle: (id: string) => void;
  gitChangeCount?: number;
}

export default function NavBar({ activeSidebar, activeTerminal = false, onToggle, gitChangeCount = 0 }: NavBarProps) {
  const badgeLabel = gitChangeCount > 100 ? '99+' : `${gitChangeCount}`;

  return (
    <div className="navbar">
      <button
        className={`nav-btn ${activeSidebar === 'files' ? 'active' : ''} ${activeTerminal ? 'disabled' : ''}`}
        onClick={() => !activeTerminal && onToggle('files')}
        title="Explorer"
        disabled={activeTerminal}
      >
        <FolderClosed size={20} />
      </button>
      <button
        className={`nav-btn ${activeSidebar === 'git' ? 'active' : ''} ${activeTerminal ? 'disabled' : ''}`}
        onClick={() => !activeTerminal && onToggle('git')}
        title="Source Control"
        disabled={activeTerminal}
      >
        <GitBranch size={20} />
        {gitChangeCount > 0 && <span className="git-badge">{badgeLabel}</span>}
      </button>
      <button
        className={`nav-btn ${activeTerminal ? 'active' : ''}`}
        onClick={() => onToggle('terminal-mode')}
        title="Terminal Mode"
      >
        <SquareTerminal size={20} />
        <span className="nav-beta">beta</span>
      </button>
      <style>{`
        .navbar {
          width: var(--nav-width);
          background: var(--bg-secondary);
          display: flex;
          flex-direction: column;
          align-items: center;
          padding-top: 8px;
          gap: 4px;
          border-right: 1px solid var(--border);
          flex-shrink: 0;
        }
        .nav-btn {
          width: 40px;
          height: 40px;
          display: flex;
          align-items: center;
          justify-content: center;
          background: none;
          border: none;
          color: var(--text-secondary);
          cursor: pointer;
          border-radius: 6px;
          position: relative;
        }
        .git-badge {
          position: absolute;
          top: 4px;
          right: 2px;
          background: var(--accent);
          color: #000;
          font-size: 9px;
          font-weight: 700;
          font-family: 'JetBrains Mono', monospace;
          min-width: 16px;
          height: 16px;
          line-height: 16px;
          text-align: center;
          border-radius: 8px;
          padding: 0 3px;
        }
        .nav-beta {
          position: absolute;
          bottom: 2px;
          right: 0px;
          font-size: 7px;
          font-weight: 600;
          font-family: 'JetBrains Mono', monospace;
          color: var(--accent);
          letter-spacing: 0.3px;
          line-height: 1;
          pointer-events: none;
        }
        .nav-btn:hover {
          color: var(--text);
          background: var(--bg-hover);
        }
        .nav-btn.active {
          color: var(--accent);
          border-left: 2px solid var(--accent);
          border-radius: 0 6px 6px 0;
        }
        .nav-btn.disabled {
          color: var(--text-muted);
          opacity: 0.4;
          cursor: default;
          pointer-events: none;
        }
      `}</style>
    </div>
  );
}
