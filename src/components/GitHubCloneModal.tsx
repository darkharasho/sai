import { useState, useEffect, useCallback, useRef } from 'react';
import { X, Search, Lock, Globe, Loader, FolderOpen } from 'lucide-react';

const GitHubIcon = ({ size = 18 }: { size?: number }) => (
  <svg viewBox="0 0 24 24" fill="currentColor" width={size} height={size}>
    <path d="M12 0C5.37 0 0 5.37 0 12c0 5.31 3.435 9.795 8.205 11.385.6.105.825-.255.825-.57 0-.285-.015-1.23-.015-2.235-3.015.555-3.795-.735-4.035-1.41-.135-.345-.72-1.41-1.23-1.695-.42-.225-1.02-.78-.015-.795.945-.015 1.62.87 1.845 1.23 1.08 1.815 2.805 1.305 3.495.99.105-.78.42-1.305.765-1.605-2.67-.3-5.46-1.335-5.46-5.925 0-1.305.465-2.385 1.23-3.225-.12-.3-.54-1.53.12-3.18 0 0 1.005-.315 3.3 1.23.96-.27 1.98-.405 3-.405s2.04.135 3 .405c2.295-1.56 3.3-1.23 3.3-1.23.66 1.65.24 2.88.12 3.18.765.84 1.23 1.905 1.23 3.225 0 4.605-2.805 5.625-5.475 5.925.435.375.81 1.095.81 2.22 0 1.605-.015 2.895-.015 3.3 0 .315.225.69.825.57A12.02 12.02 0 0 0 24 12c0-6.63-5.37-12-12-12z"/>
  </svg>
);

interface Repo {
  name: string;
  full_name: string;
  clone_url: string;
  private: boolean;
  description: string | null;
  updated_at: string;
  language: string | null;
}

interface Props {
  onCloned: (path: string) => void;
  onClose: () => void;
}

type Stage = 'browse' | 'cloning' | 'error' | 'done';

export default function GitHubCloneModal({ onCloned, onClose }: Props) {
  const [repos, setRepos] = useState<Repo[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [page, setPage] = useState(1);
  const [hasMore, setHasMore] = useState(false);
  const [selected, setSelected] = useState<Repo | null>(null);
  const [targetDir, setTargetDir] = useState('');
  const [stage, setStage] = useState<Stage>('browse');
  const [error, setError] = useState('');
  const [clonedPath, setClonedPath] = useState('');
  const searchRef = useRef<HTMLInputElement>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout>>(undefined);

  // Load default project directory
  useEffect(() => {
    window.sai.settingsGet('defaultProjectDir', '').then((v: string) => {
      if (v) setTargetDir(v);
    });
  }, []);

  // Focus search on mount
  useEffect(() => {
    setTimeout(() => searchRef.current?.focus(), 100);
  }, []);

  // Debounce search
  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      setDebouncedSearch(search);
      setPage(1);
    }, 300);
    return () => { if (debounceRef.current) clearTimeout(debounceRef.current); };
  }, [search]);

  // Fetch repos
  useEffect(() => {
    setLoading(true);
    window.sai.githubListRepos(page, debouncedSearch || undefined)
      .then((result: { items: Repo[]; hasMore: boolean }) => {
        setRepos(page === 1 ? result.items : prev => [...prev, ...result.items]);
        setHasMore(result.hasMore);
        setLoading(false);
      })
      .catch(() => {
        setLoading(false);
      });
  }, [page, debouncedSearch]);

  const handleBrowse = useCallback(async () => {
    const folder = await window.sai.selectFolder(targetDir || undefined);
    if (folder) setTargetDir(folder);
  }, [targetDir]);

  const handleClone = useCallback(async () => {
    if (!selected || !targetDir) return;
    setStage('cloning');
    setError('');
    try {
      const resultPath = await window.sai.githubClone(selected.clone_url, targetDir);
      setClonedPath(resultPath);
      setStage('done');
    } catch (e: any) {
      setError(e?.message ?? 'Clone failed');
      setStage('error');
    }
  }, [selected, targetDir]);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [onClose]);

  const formatDate = (iso: string) => {
    const d = new Date(iso);
    const now = new Date();
    const diff = now.getTime() - d.getTime();
    const days = Math.floor(diff / 86400000);
    if (days === 0) return 'today';
    if (days === 1) return 'yesterday';
    if (days < 30) return `${days}d ago`;
    if (days < 365) return `${Math.floor(days / 30)}mo ago`;
    return `${Math.floor(days / 365)}y ago`;
  };

  return (
    <div className="clone-modal-overlay" onClick={onClose}>
      <div className="clone-modal" onClick={e => e.stopPropagation()}>
        <button className="clone-modal-close" onClick={onClose}><X size={16} /></button>

        <div className="clone-modal-header">
          <GitHubIcon size={18} />
          <div>
            <div className="clone-modal-title">Clone Repository</div>
            <div className="clone-modal-subtitle">Clone a GitHub repository to your machine</div>
          </div>
        </div>

        {stage === 'browse' && (
          <>
            {/* Search */}
            <div className="clone-search-wrap">
              <Search size={13} className="clone-search-icon" />
              <input
                ref={searchRef}
                className="clone-search"
                value={search}
                onChange={e => setSearch(e.target.value)}
                placeholder="Search repositories..."
              />
            </div>

            {/* Repo list */}
            <div className="clone-repo-list">
              {repos.map(r => (
                <button
                  key={r.full_name}
                  className={`clone-repo-item${selected?.full_name === r.full_name ? ' selected' : ''}`}
                  onClick={() => setSelected(r)}
                >
                  <div className="clone-repo-top">
                    {r.private ? <Lock size={11} className="clone-repo-vis" /> : <Globe size={11} className="clone-repo-vis" />}
                    <span className="clone-repo-name">{r.full_name}</span>
                  </div>
                  {r.description && <div className="clone-repo-desc">{r.description}</div>}
                  <div className="clone-repo-meta">
                    {r.language && <span className="clone-repo-lang">{r.language}</span>}
                    <span className="clone-repo-date">Updated {formatDate(r.updated_at)}</span>
                  </div>
                </button>
              ))}
              {loading && (
                <div className="clone-loading">
                  <Loader size={14} className="clone-spinner" />
                  <span>Loading repositories...</span>
                </div>
              )}
              {!loading && repos.length === 0 && (
                <div className="clone-empty">No repositories found</div>
              )}
              {!loading && hasMore && (
                <button className="clone-load-more" onClick={() => setPage(p => p + 1)}>
                  Load more
                </button>
              )}
            </div>

            {/* Target directory */}
            <div className="clone-target-section">
              <span className="clone-target-label">Clone to</span>
              <div className="clone-target-row">
                <input
                  className="clone-target-input"
                  value={targetDir}
                  onChange={e => setTargetDir(e.target.value)}
                  placeholder="/home/user/projects"
                />
                <button className="clone-target-browse" onClick={handleBrowse}>
                  <FolderOpen size={13} />
                </button>
              </div>
              {selected && targetDir && (
                <span className="clone-target-preview">
                  → {targetDir.replace(/\/+$/, '')}/{selected.name}
                </span>
              )}
            </div>

            {/* Footer */}
            <div className="clone-footer">
              <button className="clone-cancel-btn" onClick={onClose}>Cancel</button>
              <button
                className="clone-action-btn"
                disabled={!selected || !targetDir}
                onClick={handleClone}
              >
                <GitHubIcon size={13} />
                Clone
              </button>
            </div>
          </>
        )}

        {stage === 'cloning' && (
          <div className="clone-status">
            <Loader size={20} className="clone-spinner" />
            <span>Cloning {selected?.full_name}...</span>
          </div>
        )}

        {stage === 'error' && (
          <div className="clone-error-wrap">
            <div className="clone-error-msg">{error}</div>
            <div className="clone-footer">
              <button className="clone-cancel-btn" onClick={onClose}>Cancel</button>
              <button className="clone-action-btn" onClick={() => setStage('browse')}>
                Try again
              </button>
            </div>
          </div>
        )}

        {stage === 'done' && (
          <div className="clone-done-wrap">
            <div className="clone-done-msg">
              Successfully cloned <strong>{selected?.full_name}</strong>
            </div>
            <div className="clone-done-path">{clonedPath}</div>
            <div className="clone-footer">
              <button className="clone-cancel-btn" onClick={onClose}>Close</button>
              <button className="clone-action-btn" onClick={() => { onCloned(clonedPath); onClose(); }}>
                <FolderOpen size={13} />
                Open Project
              </button>
            </div>
          </div>
        )}

        <style>{`
          .clone-modal-overlay {
            position: fixed;
            inset: 0;
            background: rgba(0,0,0,0.6);
            display: flex;
            align-items: center;
            justify-content: center;
            z-index: 3000;
            backdrop-filter: blur(4px);
          }
          .clone-modal {
            background: var(--bg-elevated);
            border: 1px solid var(--border);
            border-radius: 10px;
            padding: 24px;
            width: 480px;
            max-height: 80vh;
            display: flex;
            flex-direction: column;
            position: relative;
            box-shadow: 0 24px 64px rgba(0,0,0,0.5);
          }
          .clone-modal-close {
            position: absolute;
            top: 12px;
            right: 12px;
            background: none;
            border: none;
            color: var(--text-muted);
            cursor: pointer;
            padding: 4px;
            border-radius: 4px;
            display: flex;
          }
          .clone-modal-close:hover { color: var(--text); background: var(--bg-hover); }
          .clone-modal-header {
            display: flex;
            align-items: center;
            gap: 12px;
            margin-bottom: 16px;
          }
          .clone-modal-title { font-size: 15px; font-weight: 600; color: var(--text); }
          .clone-modal-subtitle { font-size: 12px; color: var(--text-muted); margin-top: 2px; }

          .clone-search-wrap {
            position: relative;
            margin-bottom: 10px;
          }
          .clone-search-icon {
            position: absolute;
            left: 10px;
            top: 50%;
            transform: translateY(-50%);
            color: var(--text-muted);
            pointer-events: none;
          }
          .clone-search {
            width: 100%;
            background: var(--bg-secondary);
            border: 1px solid var(--border);
            border-radius: 6px;
            padding: 8px 10px 8px 30px;
            font-size: 13px;
            color: var(--text);
            box-sizing: border-box;
          }
          .clone-search:focus { outline: none; border-color: var(--accent); }

          .clone-repo-list {
            flex: 1;
            overflow-y: auto;
            border: 1px solid var(--border);
            border-radius: 6px;
            max-height: 280px;
            margin-bottom: 12px;
          }
          .clone-repo-item {
            display: flex;
            flex-direction: column;
            gap: 3px;
            width: 100%;
            padding: 10px 12px;
            background: none;
            border: none;
            border-bottom: 1px solid var(--border);
            color: var(--text);
            cursor: pointer;
            text-align: left;
          }
          .clone-repo-item:last-child { border-bottom: none; }
          .clone-repo-item:hover { background: var(--bg-hover); }
          .clone-repo-item.selected {
            background: var(--accent);
            color: #000;
          }
          .clone-repo-item.selected .clone-repo-vis,
          .clone-repo-item.selected .clone-repo-desc,
          .clone-repo-item.selected .clone-repo-meta,
          .clone-repo-item.selected .clone-repo-lang,
          .clone-repo-item.selected .clone-repo-date { color: #000; opacity: 0.7; }
          .clone-repo-top {
            display: flex;
            align-items: center;
            gap: 6px;
          }
          .clone-repo-vis { color: var(--text-muted); flex-shrink: 0; }
          .clone-repo-name { font-size: 13px; font-weight: 500; }
          .clone-repo-desc {
            font-size: 11px;
            color: var(--text-muted);
            overflow: hidden;
            text-overflow: ellipsis;
            white-space: nowrap;
          }
          .clone-repo-meta {
            display: flex;
            align-items: center;
            gap: 10px;
            font-size: 11px;
            color: var(--text-muted);
          }
          .clone-repo-lang { font-weight: 500; }
          .clone-repo-date { }

          .clone-loading, .clone-empty {
            display: flex;
            align-items: center;
            justify-content: center;
            gap: 8px;
            padding: 20px;
            font-size: 12px;
            color: var(--text-muted);
          }
          .clone-spinner { animation: gh-spin 1s linear infinite; }
          .clone-load-more {
            width: 100%;
            padding: 8px;
            background: none;
            border: none;
            border-top: 1px solid var(--border);
            color: var(--accent);
            font-size: 12px;
            cursor: pointer;
          }
          .clone-load-more:hover { background: var(--bg-hover); }

          .clone-target-section {
            display: flex;
            flex-direction: column;
            gap: 6px;
            margin-bottom: 14px;
          }
          .clone-target-label {
            font-size: 11px;
            color: var(--text-muted);
            text-transform: uppercase;
            letter-spacing: 0.07em;
          }
          .clone-target-row {
            display: flex;
            gap: 6px;
          }
          .clone-target-input {
            flex: 1;
            background: var(--bg-secondary);
            border: 1px solid var(--border);
            border-radius: 5px;
            padding: 7px 10px;
            font-size: 13px;
            color: var(--text);
            font-family: 'JetBrains Mono', monospace;
            box-sizing: border-box;
          }
          .clone-target-input:focus { outline: none; border-color: var(--accent); }
          .clone-target-browse {
            background: var(--bg-secondary);
            border: 1px solid var(--border);
            border-radius: 5px;
            padding: 7px 10px;
            color: var(--text-secondary);
            cursor: pointer;
            display: flex;
            align-items: center;
          }
          .clone-target-browse:hover { border-color: var(--accent); color: var(--accent); }
          .clone-target-preview {
            font-size: 11px;
            color: var(--text-muted);
            font-family: 'JetBrains Mono', monospace;
          }

          .clone-footer {
            display: flex;
            justify-content: flex-end;
            gap: 8px;
          }
          .clone-cancel-btn {
            background: none;
            border: none;
            color: var(--text-muted);
            font-size: 13px;
            cursor: pointer;
            padding: 7px 12px;
            border-radius: 5px;
          }
          .clone-cancel-btn:hover { color: var(--text); }
          .clone-action-btn {
            background: none;
            border: 1px solid var(--accent);
            color: var(--accent);
            border-radius: 5px;
            padding: 7px 16px;
            font-size: 13px;
            cursor: pointer;
            display: flex;
            align-items: center;
            gap: 6px;
          }
          .clone-action-btn:hover { background: rgba(199,145,12,0.1); }
          .clone-action-btn:disabled {
            border-color: var(--border);
            color: var(--text-muted);
            cursor: not-allowed;
          }
          .clone-action-btn:disabled:hover { background: none; }

          .clone-status {
            display: flex;
            align-items: center;
            gap: 10px;
            color: var(--text-secondary);
            font-size: 13px;
            padding: 24px 0;
            justify-content: center;
          }
          .clone-error-wrap { padding: 8px 0; }
          .clone-error-msg {
            color: #f87171;
            font-size: 13px;
            margin-bottom: 14px;
            background: rgba(248,113,113,0.08);
            border: 1px solid rgba(248,113,113,0.2);
            border-radius: 5px;
            padding: 8px 10px;
          }
          .clone-done-wrap {
            text-align: center;
            padding: 12px 0;
          }
          .clone-done-msg {
            font-size: 13px;
            color: var(--text);
            margin-bottom: 6px;
          }
          .clone-done-path {
            font-size: 11px;
            color: var(--text-muted);
            font-family: 'JetBrains Mono', monospace;
            margin-bottom: 16px;
          }
        `}</style>
      </div>
    </div>
  );
}
