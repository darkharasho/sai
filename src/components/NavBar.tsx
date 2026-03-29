import { FolderClosed, GitBranch } from 'lucide-react';

interface NavBarProps {
  activeSidebar: string | null;
  onToggle: (id: string) => void;
}

export default function NavBar({ activeSidebar, onToggle }: NavBarProps) {
  return (
    <div className="navbar">
      <button
        className={`nav-btn ${activeSidebar === 'files' ? 'active' : ''}`}
        onClick={() => onToggle('files')}
        title="Explorer"
      >
        <FolderClosed size={20} />
      </button>
      <button
        className={`nav-btn ${activeSidebar === 'git' ? 'active' : ''}`}
        onClick={() => onToggle('git')}
        title="Source Control"
      >
        <GitBranch size={20} />
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
      `}</style>
    </div>
  );
}
