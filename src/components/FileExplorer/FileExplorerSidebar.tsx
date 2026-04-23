import { useState, useEffect, useCallback, useRef } from 'react';
import { Folder, FolderOpen, FileText, FileCode2, Image, ChevronRight, ChevronDown, FilePlus, FolderPlus } from 'lucide-react';
import type { DirEntry } from '../../types';
import ContextMenu from './ContextMenu';
import { basename } from '../../utils/pathUtils';

const IMAGE_EXTENSIONS = new Set([
  '.png', '.jpg', '.jpeg', '.gif', '.webp', '.svg',
]);

const CODE_EXTENSIONS = new Set([
  '.ts', '.tsx', '.js', '.jsx', '.py', '.rs', '.go', '.java',
  '.c', '.cpp', '.h', '.css', '.html', '.json', '.yaml', '.yml',
  '.toml', '.md', '.sh', '.bash', '.vue', '.svelte',
]);

const EXT_COLORS: Record<string, string> = {
  '.ts': 'var(--blue)', '.tsx': 'var(--blue)',
  '.js': 'var(--yellow)', '.jsx': 'var(--yellow)',
  '.py': 'var(--green)',
  '.rs': 'var(--orange)',
  '.go': 'var(--turquoise)',
  '.java': 'var(--red)',
  '.css': 'var(--pink)', '.scss': 'var(--pink)',
  '.html': 'var(--orange)',
  '.json': 'var(--yellow)',
  '.md': 'var(--text-secondary)',
  '.yaml': 'var(--purple)', '.yml': 'var(--purple)', '.toml': 'var(--purple)',
  '.sh': 'var(--green)', '.bash': 'var(--green)',
  '.vue': 'var(--green)', '.svelte': 'var(--orange)',
  '.c': 'var(--blue)', '.cpp': 'var(--blue)', '.h': 'var(--blue)',
  '.png': 'var(--purple)', '.jpg': 'var(--purple)', '.jpeg': 'var(--purple)',
  '.gif': 'var(--purple)', '.webp': 'var(--purple)', '.svg': 'var(--purple)',
};

function getFileIcon(name: string): { icon: typeof FileCode2; color: string } {
  const ext = '.' + name.split('.').pop()?.toLowerCase();
  const color = EXT_COLORS[ext] || 'var(--text-muted)';
  if (CODE_EXTENSIONS.has(ext)) return { icon: FileCode2, color };
  if (IMAGE_EXTENSIONS.has(ext)) return { icon: Image, color };
  return { icon: FileText, color };
}

interface TreeState {
  entries: DirEntry[];
  expanded: boolean;
  loading: boolean;
  error: string | null;
}

interface FileExplorerSidebarProps {
  projectPath: string;
  onFileOpen: (filePath: string) => void;
}

interface InlineInput {
  parentPath: string;
  type: 'file' | 'directory';
  initialValue: string;
  renamePath?: string;
}

type GitDirtyStatus = 'added' | 'modified' | 'deleted';

interface GitStatusItem { path: string; status: string }
interface GitStatusResult {
  staged: GitStatusItem[];
  modified: GitStatusItem[];
  created: GitStatusItem[];
  deleted: GitStatusItem[];
  not_added: GitStatusItem[];
}

function buildDirtyMap(projectPath: string, status: GitStatusResult): Map<string, GitDirtyStatus> {
  const fileMap = new Map<string, GitDirtyStatus>();
  const addFile = (relPath: string, s: GitDirtyStatus) => {
    const absPath = projectPath + '/' + relPath;
    const existing = fileMap.get(absPath);
    if (!existing || (existing === 'added' && s === 'modified')) fileMap.set(absPath, s);
  };

  for (const f of status.modified ?? []) addFile(f.path, 'modified');
  for (const f of status.created ?? []) addFile(f.path, 'added');
  for (const f of status.not_added ?? []) addFile(f.path, 'added');
  for (const f of status.deleted ?? []) addFile(f.path, 'deleted');
  for (const f of status.staged ?? []) {
    const absPath = projectPath + '/' + f.path;
    if (!fileMap.has(absPath)) fileMap.set(absPath, 'modified');
  }

  const folderMap = new Map<string, GitDirtyStatus>();
  for (const [filePath, status] of fileMap) {
    let dir = filePath.substring(0, filePath.lastIndexOf('/'));
    while (dir.length >= projectPath.length) {
      const existing = folderMap.get(dir);
      if (existing === 'modified') break;
      if (!existing || (existing === 'added' && status === 'modified')) {
        folderMap.set(dir, status);
      }
      dir = dir.substring(0, dir.lastIndexOf('/'));
    }
  }

  return new Map([...fileMap, ...folderMap]);
}

const DIRTY_COLORS: Record<GitDirtyStatus, string> = {
  added: 'var(--green)',
  modified: 'var(--accent)',
  deleted: 'var(--red)',
};

export default function FileExplorerSidebar({ projectPath, onFileOpen }: FileExplorerSidebarProps) {
  const [tree, setTree] = useState<Map<string, TreeState>>(new Map());
  const [ignoredPaths, setIgnoredPaths] = useState<Set<string>>(new Set());
  const [dirtyMap, setDirtyMap] = useState<Map<string, GitDirtyStatus>>(new Map());
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; entry: DirEntry | null; parentPath: string } | null>(null);
  const [inlineInput, setInlineInput] = useState<InlineInput | null>(null);
  const [dragOverPath, setDragOverPath] = useState<string | null>(null);
  const dragEntryRef = useRef<{ path: string; parentPath: string } | null>(null);

  const loadDir = useCallback(async (dirPath: string) => {
    setTree(prev => {
      const next = new Map(prev);
      const existing = next.get(dirPath);
      next.set(dirPath, { entries: existing?.entries ?? [], expanded: true, loading: true, error: null });
      return next;
    });
    try {
      const entries = await window.sai.fsReadDir(dirPath) as DirEntry[];
      setTree(prev => {
        const next = new Map(prev);
        next.set(dirPath, { entries, expanded: true, loading: false, error: null });
        return next;
      });
      // Check which entries are gitignored
      const paths = entries.map((e: DirEntry) => e.path);
      const ignored = await window.sai.fsCheckIgnored(projectPath, paths) as string[];
      if (ignored.length > 0) {
        setIgnoredPaths(prev => {
          const next = new Set(prev);
          ignored.forEach(p => next.add(p));
          return next;
        });
      }
    } catch (err: any) {
      setTree(prev => {
        const next = new Map(prev);
        next.set(dirPath, { entries: [], expanded: true, loading: false, error: err?.message ?? 'Permission denied' });
        return next;
      });
    }
  }, [projectPath]);

  useEffect(() => {
    if (projectPath) {
      setTree(new Map());
      setIgnoredPaths(new Set());
      loadDir(projectPath);
    }
  }, [projectPath, loadDir]);

  // Poll expanded directories for external filesystem changes
  useEffect(() => {
    const interval = setInterval(() => {
      setTree(current => {
        current.forEach((state, dirPath) => {
          if (state.expanded && !state.loading) {
            loadDir(dirPath);
          }
        });
        return current;
      });
    }, 2000);
    return () => clearInterval(interval);
  }, [loadDir]);

  useEffect(() => {
    if (!projectPath) return;
    let cancelled = false;
    const fetchStatus = async () => {
      try {
        const status = await window.sai.gitStatus(projectPath) as GitStatusResult;
        if (!cancelled) setDirtyMap(buildDirtyMap(projectPath, status));
      } catch {}
    };
    fetchStatus();
    const interval = setInterval(fetchStatus, 3000);
    return () => { cancelled = true; clearInterval(interval); };
  }, [projectPath]);

  const toggleDir = (dirPath: string) => {
    const state = tree.get(dirPath);
    if (state?.expanded) {
      setTree(prev => {
        const next = new Map(prev);
        next.set(dirPath, { ...state, expanded: false });
        return next;
      });
    } else if (state && state.entries.length > 0) {
      setTree(prev => {
        const next = new Map(prev);
        next.set(dirPath, { ...state, expanded: true });
        return next;
      });
    } else {
      loadDir(dirPath);
    }
  };

  const refreshDir = (dirPath: string) => {
    loadDir(dirPath);
  };

  const handleDragStart = (e: React.DragEvent, entry: DirEntry, parentPath: string) => {
    dragEntryRef.current = { path: entry.path, parentPath };
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', entry.path);
  };

  const handleDragOver = (e: React.DragEvent, targetPath: string) => {
    e.preventDefault();
    e.stopPropagation();
    e.dataTransfer.dropEffect = 'move';
    setDragOverPath(targetPath);
  };

  const handleDragLeave = (e: React.DragEvent) => {
    e.stopPropagation();
    setDragOverPath(null);
  };

  const handleDrop = async (e: React.DragEvent, targetDirPath: string) => {
    e.preventDefault();
    e.stopPropagation();
    setDragOverPath(null);
    const drag = dragEntryRef.current;
    if (!drag) return;
    dragEntryRef.current = null;

    const sourceName = basename(drag.path);
    const newPath = targetDirPath + '/' + sourceName;
    if (newPath === drag.path || drag.path === targetDirPath) return;
    // Don't drop a folder into itself
    if (targetDirPath.startsWith(drag.path + '/')) return;

    try {
      await window.sai.fsRename(drag.path, newPath);
      refreshDir(drag.parentPath);
      if (drag.parentPath !== targetDirPath) refreshDir(targetDirPath);
    } catch {
      // move failed silently
    }
  };

  const handleContextMenu = (e: React.MouseEvent, entry: DirEntry | null, parentPath: string) => {
    e.preventDefault();
    setContextMenu({ x: e.clientX, y: e.clientY, entry, parentPath });
  };

  const handleContextAction = async (action: string) => {
    if (!contextMenu) return;
    const { entry, parentPath } = contextMenu;
    setContextMenu(null);

    switch (action) {
      case 'open':
        if (entry && entry.type === 'file') onFileOpen(entry.path);
        break;
      case 'newFile':
        setInlineInput({ parentPath: entry?.type === 'directory' ? entry.path : parentPath, type: 'file', initialValue: '' });
        if (entry?.type === 'directory') {
          const state = tree.get(entry.path);
          if (!state?.expanded) loadDir(entry.path);
        }
        break;
      case 'newFolder':
        setInlineInput({ parentPath: entry?.type === 'directory' ? entry.path : parentPath, type: 'directory', initialValue: '' });
        if (entry?.type === 'directory') {
          const state = tree.get(entry.path);
          if (!state?.expanded) loadDir(entry.path);
        }
        break;
      case 'rename':
        if (entry) {
          setInlineInput({ parentPath, type: entry.type, initialValue: entry.name, renamePath: entry.path });
        }
        break;
      case 'delete':
        if (entry) {
          const deleted = await window.sai.fsDelete(entry.path);
          if (deleted) refreshDir(parentPath);
        }
        break;
      case 'copyPath':
        if (entry) navigator.clipboard.writeText(entry.path);
        break;
      case 'copyRelativePath':
        if (entry) {
          const rel = entry.path.startsWith(projectPath)
            ? entry.path.slice(projectPath.length + 1)
            : entry.name;
          navigator.clipboard.writeText(rel);
        }
        break;
    }
  };

  const handleInlineSubmit = async (value: string) => {
    if (!inlineInput || !value.trim()) {
      setInlineInput(null);
      return;
    }
    const { parentPath, type, renamePath } = inlineInput;
    setInlineInput(null);
    try {
      if (renamePath) {
        const newPath = renamePath.replace(/[^/]+$/, value.trim());
        await window.sai.fsRename(renamePath, newPath);
      } else if (type === 'file') {
        await window.sai.fsCreateFile(parentPath + '/' + value.trim());
      } else {
        await window.sai.fsCreateDir(parentPath + '/' + value.trim());
      }
      refreshDir(parentPath);
    } catch {
      // error handled silently — tree refresh will show current state
    }
  };

  const renderInlineInput = (parentPath: string, depth = 0) => {
    if (!inlineInput || inlineInput.parentPath !== parentPath || inlineInput.renamePath) return null;
    return (
      <div className="tree-row" style={{ paddingLeft: depth * 16 + 8 }}>
        <span style={{ width: 14, flexShrink: 0 }} />
        {inlineInput.type === 'directory'
          ? <Folder size={14} className="tree-icon folder" />
          : <FileText size={14} className="tree-icon file" />}
        <InlineNameInput initialValue={inlineInput.initialValue} onSubmit={handleInlineSubmit} onCancel={() => setInlineInput(null)} />
      </div>
    );
  };

  const renderEntry = (entry: DirEntry, depth: number, parentPath: string) => {
    const isDir = entry.type === 'directory';
    const state = tree.get(entry.path);
    const isExpanded = state?.expanded ?? false;
    const isRenaming = inlineInput?.renamePath === entry.path;
    const isIgnored = ignoredPaths.has(entry.path);
    const dirtyStatus = dirtyMap.get(entry.path);
    const dirtyColor = dirtyStatus ? DIRTY_COLORS[dirtyStatus] : undefined;

    if (isDir) {
      return (
        <div key={entry.path}>
          <div
            className={`tree-row ${dragOverPath === entry.path ? 'drag-over' : ''} ${isIgnored ? 'tree-row-ignored' : ''}`}
            style={{ paddingLeft: depth * 16 + 8 }}
            draggable
            onDragStart={e => handleDragStart(e, entry, parentPath)}
            onDragOver={e => handleDragOver(e, entry.path)}
            onDragLeave={handleDragLeave}
            onDrop={e => handleDrop(e, entry.path)}
            onClick={() => toggleDir(entry.path)}
            onContextMenu={e => handleContextMenu(e, entry, parentPath)}
          >
            {isExpanded ? <ChevronDown size={14} className="tree-chevron" /> : <ChevronRight size={14} className="tree-chevron" />}
            {isExpanded ? <FolderOpen size={14} className="tree-icon folder" /> : <Folder size={14} className="tree-icon folder" />}
            {isRenaming ? (
              <InlineNameInput initialValue={inlineInput!.initialValue} onSubmit={handleInlineSubmit} onCancel={() => setInlineInput(null)} />
            ) : (
              <span className="tree-name" style={dirtyColor ? { color: dirtyColor } : undefined}>{entry.name}</span>
            )}
          </div>
          {isExpanded && state && (
            <>
              {state.loading && <div className="tree-row tree-loading" style={{ paddingLeft: (depth + 1) * 16 + 8 }}>Loading...</div>}
              {state.error && <div className="tree-row tree-error" style={{ paddingLeft: (depth + 1) * 16 + 8 }}>{state.error}</div>}
              {renderInlineInput(entry.path, depth + 1)}
              {state.entries.map(child => renderEntry(child, depth + 1, entry.path))}
            </>
          )}
        </div>
      );
    }

    const { icon: FileIcon, color: fileColor } = getFileIcon(entry.name);
    return (
      <div
        key={entry.path}
        className={`tree-row ${isIgnored ? 'tree-row-ignored' : ''}`}
        style={{ paddingLeft: depth * 16 + 8 }}
        draggable
        onDragStart={e => handleDragStart(e, entry, parentPath)}
        onClick={() => onFileOpen(entry.path)}
        onContextMenu={e => handleContextMenu(e, entry, parentPath)}
      >
        <span style={{ width: 14, flexShrink: 0 }} />
        <FileIcon size={14} className="tree-icon file" style={{ color: fileColor }} />
        {isRenaming ? (
          <InlineNameInput initialValue={inlineInput!.initialValue} onSubmit={handleInlineSubmit} onCancel={() => setInlineInput(null)} />
        ) : (
          <span className="tree-name" style={dirtyColor ? { color: dirtyColor } : undefined}>{entry.name}</span>
        )}
      </div>
    );
  };

  const rootState = tree.get(projectPath);
  const projectName = basename(projectPath);

  return (
    <div
      style={{
        width: 'var(--sidebar-width)',
        minWidth: 'var(--sidebar-width)',
        background: 'var(--bg-secondary)',
        borderRight: '1px solid var(--border)',
        display: 'flex',
        flexDirection: 'column',
        overflow: 'hidden',
      }}
      onContextMenu={e => {
        if ((e.target as HTMLElement).closest('.tree-row')) return;
        handleContextMenu(e, null, projectPath);
      }}
    >
      <div
        style={{
          height: 36,
          display: 'flex',
          alignItems: 'center',
          padding: '0 12px',
          fontSize: 11,
          fontWeight: 600,
          textTransform: 'uppercase',
          letterSpacing: '0.5px',
          color: 'var(--text-muted)',
          borderBottom: '1px solid var(--border)',
          flexShrink: 0,
        }}
      >
        Explorer
      </div>

      <div
        style={{
          padding: '6px 0',
          fontSize: 11,
          fontWeight: 600,
          color: 'var(--text)',
          textTransform: 'uppercase',
          letterSpacing: '0.3px',
        }}
      >
        <div
          className={`tree-row project-root-row ${dragOverPath === projectPath ? 'drag-over' : ''}`}
          style={{ paddingLeft: 8, fontWeight: 700, fontSize: 11, color: 'var(--text-secondary)' }}
          onContextMenu={e => handleContextMenu(e, null, projectPath)}
          onDragOver={e => handleDragOver(e, projectPath)}
          onDragLeave={handleDragLeave}
          onDrop={e => handleDrop(e, projectPath)}
        >
          <span className="tree-name">{projectName}</span>
          <div className="project-actions">
            <button
              className="project-action-btn"
              title="New File"
              onClick={e => {
                e.stopPropagation();
                setInlineInput({ parentPath: projectPath, type: 'file', initialValue: '' });
              }}
            >
              <FilePlus size={14} />
            </button>
            <button
              className="project-action-btn"
              title="New Folder"
              onClick={e => {
                e.stopPropagation();
                setInlineInput({ parentPath: projectPath, type: 'directory', initialValue: '' });
              }}
            >
              <FolderPlus size={14} />
            </button>
          </div>
        </div>
      </div>

      <div style={{ flex: 1, overflowY: 'auto', fontSize: 13 }}>
        {renderInlineInput(projectPath)}
        {rootState?.entries.map(entry => renderEntry(entry, 0, projectPath))}
      </div>

      {contextMenu && (
        <ContextMenu
          x={contextMenu.x}
          y={contextMenu.y}
          entry={contextMenu.entry}
          onAction={handleContextAction}
          onClose={() => setContextMenu(null)}
        />
      )}

      <style>{`
        .tree-row {
          display: flex;
          align-items: center;
          gap: 6px;
          height: 28px;
          padding-right: 8px;
          cursor: pointer;
          color: var(--text-secondary);
          font-family: 'Geist Mono', 'JetBrains Mono', 'Fira Code', monospace;
          font-size: 13px;
          white-space: nowrap;
          overflow: hidden;
        }
        .tree-row:hover {
          background: var(--bg-hover);
          color: var(--text);
        }
        .tree-chevron {
          color: var(--text-muted);
          flex-shrink: 0;
        }
        .tree-icon.folder {
          color: var(--accent);
          flex-shrink: 0;
        }
        .tree-icon.file {
          color: var(--text-muted);
          flex-shrink: 0;
        }
        .tree-name {
          overflow: hidden;
          text-overflow: ellipsis;
        }
        .tree-loading {
          color: var(--text-muted);
          font-style: italic;
          font-size: 11px;
        }
        .tree-error {
          color: var(--red);
          font-size: 11px;
        }
        .tree-row-ignored {
          opacity: 0.45;
        }
        .tree-row-ignored:hover {
          opacity: 0.65;
        }
        .tree-row.drag-over {
          background: rgba(199, 145, 12, 0.12);
          outline: 1px solid rgba(199, 145, 12, 0.4);
          outline-offset: -1px;
        }
        .project-root-row {
          position: relative;
        }
        .project-actions {
          display: flex;
          align-items: center;
          gap: 2px;
          margin-left: auto;
        }
        .project-action-btn {
          background: none;
          border: none;
          color: var(--text-muted);
          cursor: pointer;
          padding: 2px;
          border-radius: 4px;
          display: flex;
          align-items: center;
        }
        .project-action-btn:hover {
          color: var(--accent);
          background: var(--bg-hover);
        }
      `}</style>
    </div>
  );
}

function InlineNameInput({ initialValue, onSubmit, onCancel }: { initialValue: string; onSubmit: (v: string) => void; onCancel: () => void }) {
  const ref = useRef<HTMLInputElement>(null);
  const [value, setValue] = useState(initialValue);

  useEffect(() => {
    ref.current?.focus();
    ref.current?.select();
  }, []);

  return (
    <input
      ref={ref}
      value={value}
      onChange={e => setValue(e.target.value)}
      onKeyDown={e => {
        if (e.key === 'Enter') onSubmit(value);
        if (e.key === 'Escape') onCancel();
      }}
      onBlur={() => onCancel()}
      style={{
        flex: 1,
        background: 'var(--bg-input)',
        border: '1px solid var(--accent)',
        borderRadius: 3,
        color: 'var(--text)',
        fontSize: 13,
        fontFamily: "'JetBrains Mono', monospace",
        padding: '1px 6px',
        outline: 'none',
        height: 22,
      }}
    />
  );
}
