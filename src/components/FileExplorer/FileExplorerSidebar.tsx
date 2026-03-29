import { useState, useEffect, useCallback, useRef } from 'react';
import { Folder, FolderOpen, FileText, FileCode2, ChevronRight, ChevronDown } from 'lucide-react';
import type { DirEntry } from '../../types';
import ContextMenu from './ContextMenu';

const CODE_EXTENSIONS = new Set([
  '.ts', '.tsx', '.js', '.jsx', '.py', '.rs', '.go', '.java',
  '.c', '.cpp', '.h', '.css', '.html', '.json', '.yaml', '.yml',
  '.toml', '.md', '.sh', '.bash', '.vue', '.svelte',
]);

function getFileIcon(name: string) {
  const ext = '.' + name.split('.').pop()?.toLowerCase();
  if (CODE_EXTENSIONS.has(ext)) return FileCode2;
  return FileText;
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

export default function FileExplorerSidebar({ projectPath, onFileOpen }: FileExplorerSidebarProps) {
  const [tree, setTree] = useState<Map<string, TreeState>>(new Map());
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; entry: DirEntry | null; parentPath: string } | null>(null);
  const [inlineInput, setInlineInput] = useState<InlineInput | null>(null);

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
    } catch (err: any) {
      setTree(prev => {
        const next = new Map(prev);
        next.set(dirPath, { entries: [], expanded: true, loading: false, error: err?.message ?? 'Permission denied' });
        return next;
      });
    }
  }, []);

  useEffect(() => {
    if (projectPath) {
      setTree(new Map());
      loadDir(projectPath);
    }
  }, [projectPath, loadDir]);

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

  const renderInlineInput = (parentPath: string) => {
    if (!inlineInput || inlineInput.parentPath !== parentPath || inlineInput.renamePath) return null;
    return <InlineNameInput initialValue={inlineInput.initialValue} onSubmit={handleInlineSubmit} onCancel={() => setInlineInput(null)} />;
  };

  const renderEntry = (entry: DirEntry, depth: number, parentPath: string) => {
    const isDir = entry.type === 'directory';
    const state = tree.get(entry.path);
    const isExpanded = state?.expanded ?? false;
    const isRenaming = inlineInput?.renamePath === entry.path;

    if (isDir) {
      return (
        <div key={entry.path}>
          <div
            className="tree-row"
            style={{ paddingLeft: depth * 16 + 8 }}
            onClick={() => toggleDir(entry.path)}
            onContextMenu={e => handleContextMenu(e, entry, parentPath)}
          >
            {isExpanded ? <ChevronDown size={14} className="tree-chevron" /> : <ChevronRight size={14} className="tree-chevron" />}
            {isExpanded ? <FolderOpen size={14} className="tree-icon folder" /> : <Folder size={14} className="tree-icon folder" />}
            {isRenaming ? (
              <InlineNameInput initialValue={inlineInput!.initialValue} onSubmit={handleInlineSubmit} onCancel={() => setInlineInput(null)} />
            ) : (
              <span className="tree-name">{entry.name}</span>
            )}
          </div>
          {isExpanded && state && (
            <>
              {state.loading && <div className="tree-row tree-loading" style={{ paddingLeft: (depth + 1) * 16 + 8 }}>Loading...</div>}
              {state.error && <div className="tree-row tree-error" style={{ paddingLeft: (depth + 1) * 16 + 8 }}>{state.error}</div>}
              {renderInlineInput(entry.path)}
              {state.entries.map(child => renderEntry(child, depth + 1, entry.path))}
            </>
          )}
        </div>
      );
    }

    const FileIcon = getFileIcon(entry.name);
    return (
      <div
        key={entry.path}
        className="tree-row"
        style={{ paddingLeft: depth * 16 + 8 }}
        onClick={() => onFileOpen(entry.path)}
        onContextMenu={e => handleContextMenu(e, entry, parentPath)}
      >
        <span style={{ width: 14, flexShrink: 0 }} />
        <FileIcon size={14} className="tree-icon file" />
        {isRenaming ? (
          <InlineNameInput initialValue={inlineInput!.initialValue} onSubmit={handleInlineSubmit} onCancel={() => setInlineInput(null)} />
        ) : (
          <span className="tree-name">{entry.name}</span>
        )}
      </div>
    );
  };

  const rootState = tree.get(projectPath);
  const projectName = projectPath.split('/').pop() ?? projectPath;

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
          className="tree-row"
          style={{ paddingLeft: 8, fontWeight: 700, fontSize: 11, color: 'var(--text-secondary)' }}
          onContextMenu={e => handleContextMenu(e, null, projectPath)}
        >
          {projectName}
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
          font-family: 'JetBrains Mono', 'Fira Code', monospace;
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
