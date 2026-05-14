import { useState } from 'react';
import type { MetaWorkspaceRuntime } from '../../types';
import GitSidebar from './GitSidebar';

interface Props {
  runtime: MetaWorkspaceRuntime;
  onFileClick: (file: any) => void;
  commitMessageProvider?: 'claude' | 'codex' | 'gemini';
}

export function MetaGitSidebar({ runtime, onFileClick, commitMessageProvider }: Props) {
  const repos = runtime.projects.filter(p => p.status === 'ok');
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});

  function toggle(name: string) {
    setCollapsed(c => ({ ...c, [name]: !c[name] }));
  }

  return (
    <div className="meta-git-sidebar">
      <style>{`
        .meta-git-sidebar {
          width: var(--sidebar-width);
          min-width: var(--sidebar-width);
          background: var(--bg-secondary);
          border-right: 1px solid var(--border);
          display: flex;
          flex-direction: column;
          overflow: hidden;
          height: 100%;
        }
        .meta-git-header {
          height: 36px;
          display: flex;
          align-items: center;
          gap: 6px;
          padding: 0 12px;
          font-size: 11px;
          font-weight: 600;
          text-transform: uppercase;
          letter-spacing: 0.5px;
          color: var(--text-muted);
          border-bottom: 1px solid var(--border);
          flex-shrink: 0;
        }
        .meta-git-header span {
          flex: 1;
        }
        .meta-git-header button {
          background: transparent;
          border: 1px solid var(--border);
          border-radius: 3px;
          padding: 2px 7px;
          font-size: 10px;
          color: var(--text-muted);
          cursor: pointer;
          text-transform: none;
          letter-spacing: 0;
        }
        .meta-git-header button:hover {
          color: var(--text);
          background: var(--bg-hover);
        }
        .meta-git-sections {
          flex: 1;
          overflow-y: auto;
        }
        .meta-git-section {
          border-bottom: 1px solid var(--border);
        }
        .meta-git-section header {
          display: flex;
          align-items: center;
          gap: 6px;
          padding: 6px 10px;
          cursor: pointer;
          user-select: none;
          background: var(--bg-secondary);
        }
        .meta-git-section header:hover {
          background: var(--bg-hover);
        }
        .meta-git-section .caret {
          font-size: 12px;
          color: var(--text-muted);
          transition: transform 0.15s;
          display: inline-block;
          width: 12px;
        }
        .meta-git-section .caret.collapsed {
          transform: rotate(-90deg);
        }
        .meta-git-section header strong {
          font-size: 12px;
          font-weight: 600;
          color: var(--text);
        }
        .meta-git-section header .path {
          font-size: 10px;
          color: var(--text-muted);
          margin-left: 4px;
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
        }
        .meta-git-section .embedded-git {
          border-top: 1px solid var(--border);
        }
      `}</style>
      <div className="meta-git-header">
        <span>{repos.length} repos</span>
        <button onClick={() => setCollapsed(Object.fromEntries(repos.map(r => [r.linkName, true])))}>Collapse all</button>
        <button onClick={() => setCollapsed({})}>Expand all</button>
      </div>
      <div className="meta-git-sections">
        {repos.map(p => (
          <section key={p.linkName} className="meta-git-section">
            <header onClick={() => toggle(p.linkName)}>
              <span className={`caret ${collapsed[p.linkName] ? 'collapsed' : ''}`}>▾</span>
              <strong>{p.linkName}</strong>
              <span className="path">{p.path}</span>
            </header>
            {!collapsed[p.linkName] && (
              <div className="embedded-git">
                <GitSidebar projectPath={p.path} onFileClick={onFileClick} commitMessageProvider={commitMessageProvider} embedded />
              </div>
            )}
          </section>
        ))}
      </div>
    </div>
  );
}
