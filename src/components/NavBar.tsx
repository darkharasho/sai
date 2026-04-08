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
        <FolderClosed size={18} />
        <span className="nav-label">Files</span>
      </button>
      <button
        className={`nav-btn ${activeSidebar === 'git' ? 'active' : ''} ${activeTerminal ? 'disabled' : ''}`}
        onClick={() => !activeTerminal && onToggle('git')}
        title="Source Control"
        disabled={activeTerminal}
      >
        <GitBranch size={18} />
        <span className="nav-label">Git</span>
        {gitChangeCount > 0 && <span className="git-badge">{badgeLabel}</span>}
      </button>
      <button
        className={`nav-btn ${activeTerminal ? 'active' : ''}`}
        onClick={() => onToggle('terminal-mode')}
        title="Terminal Mode"
      >
        <SquareTerminal size={18} />
        <span className="nav-label">Term</span>
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
          border-radius: 8px;
          position: relative;
          transition: color 0.15s, background 0.15s;
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
        }
        .nav-btn:hover {
          color: var(--text);
          background: var(--bg-hover);
        }
        .nav-btn.active {
          color: var(--accent);
          background: rgba(199, 145, 12, 0.08);
          border-left: 2px solid var(--accent);
          border-radius: 0 8px 8px 0;
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
