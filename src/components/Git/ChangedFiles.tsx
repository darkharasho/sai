import { useState, useEffect, useRef } from 'react';
import { Plus, Minus, FileText, FilePlus, FileX, FileSymlink } from 'lucide-react';
import { GitFile } from '../../types';
import InlineDiff from './InlineDiff';

const STATUS_CONFIG: Record<GitFile['status'], { icon: typeof FileText; color: string }> = {
  modified: { icon: FileText,     color: 'var(--orange)' },
  added:    { icon: FilePlus,     color: 'var(--green)' },
  deleted:  { icon: FileX,        color: 'var(--red)' },
  renamed:  { icon: FileSymlink,  color: 'var(--blue)' },
};

interface ContextMenuState {
  x: number;
  y: number;
  file: GitFile;
}

interface ChangedFilesProps {
  title: string;
  files: GitFile[];
  onAction: (file: GitFile) => void;
  actionLabel: string;
  onFileClick: (file: GitFile) => void;
  onStageAll?: () => void;
  onDiscard?: (file: GitFile) => void;
  staged?: boolean;
  projectPath: string;
}

export default function ChangedFiles({ title, files, onAction, actionLabel, onFileClick, onStageAll, onDiscard, staged, projectPath }: ChangedFilesProps) {
  const [hoveredPath, setHoveredPath] = useState<string | null>(null);
  const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null);
  const [expandedPath, setExpandedPath] = useState<string | null>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (expandedPath && !files.some(f => f.path === expandedPath)) {
      setExpandedPath(null);
    }
  }, [files, expandedPath]);

  useEffect(() => {
    if (!contextMenu) return;
    const handleClick = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setContextMenu(null);
    };
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setContextMenu(null);
    };
    document.addEventListener('mousedown', handleClick);
    document.addEventListener('keydown', handleKey);
    return () => {
      document.removeEventListener('mousedown', handleClick);
      document.removeEventListener('keydown', handleKey);
    };
  }, [contextMenu]);

  // Reposition if menu overflows viewport
  useEffect(() => {
    if (!menuRef.current) return;
    const rect = menuRef.current.getBoundingClientRect();
    if (rect.right > window.innerWidth) {
      menuRef.current.style.left = `${window.innerWidth - rect.width - 8}px`;
    }
    if (rect.bottom > window.innerHeight) {
      menuRef.current.style.top = `${window.innerHeight - rect.height - 8}px`;
    }
  }, [contextMenu]);

  if (files.length === 0) return null;

  const handleContextMenu = (e: React.MouseEvent, file: GitFile) => {
    e.preventDefault();
    e.stopPropagation();
    setContextMenu({ x: e.clientX, y: e.clientY, file });
  };

  return (
    <div style={{ marginBottom: 8 }}>
      <div
        style={{
          padding: '4px 12px',
          fontSize: 10,
          fontWeight: 700,
          textTransform: 'uppercase' as const,
          letterSpacing: '0.6px',
          color: 'var(--text-muted)',
          userSelect: 'none' as const,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
        }}
      >
        <span>{title} ({files.length})</span>
        {onStageAll && (
          <button
            onClick={onStageAll}
            title="Stage all changes"
            style={{
              background: 'none',
              border: 'none',
              color: 'var(--text-muted)',
              cursor: 'pointer',
              padding: '0 2px',
              fontSize: 10,
              fontWeight: 600,
              fontFamily: 'inherit',
              letterSpacing: '0.4px',
              textTransform: 'uppercase' as const,
              display: 'flex',
              alignItems: 'center',
              gap: 3,
              borderRadius: 3,
            }}
            onMouseEnter={e => { e.currentTarget.style.color = 'var(--accent)'; e.currentTarget.style.background = 'var(--bg-hover)'; }}
            onMouseLeave={e => { e.currentTarget.style.color = 'var(--text-muted)'; e.currentTarget.style.background = 'none'; }}
          >
            <Plus size={10} /> Stage All
          </button>
        )}
      </div>

      {files.map((file) => {
        const cfg = STATUS_CONFIG[file.status];
        const isHovered = hoveredPath === file.path;
        const fileName = file.path.split('/').pop() ?? file.path;
        const dirName = file.path.includes('/')
          ? file.path.substring(0, file.path.lastIndexOf('/'))
          : '';

        return (
          <div key={file.path}>
            <div
              data-filepath={file.path}
              tabIndex={0}
              onMouseEnter={() => setHoveredPath(file.path)}
              onMouseLeave={() => setHoveredPath(null)}
              onClick={() => onFileClick(file)}
              onContextMenu={e => handleContextMenu(e, file)}
              onKeyDown={e => {
                if (e.key === ' ') { e.preventDefault(); onAction(file); }
                if (e.key === 'Enter') { onFileClick(file); }
              }}
              style={{
                display: 'flex',
                alignItems: 'center',
                padding: '3px 12px',
                gap: 6,
                background: isHovered ? 'var(--bg-hover)' : 'transparent',
                cursor: 'pointer',
                minWidth: 0,
              }}
            >
              {/* Expand toggle */}
              <span
                onClick={e => { e.stopPropagation(); setExpandedPath(expandedPath === file.path ? null : file.path); }}
                style={{ color: 'var(--text-muted)', fontSize: 9, flexShrink: 0, width: 10, cursor: 'pointer' }}
              >
                {expandedPath === file.path ? '▼' : '▶'}
              </span>

              {/* Status icon */}
              <cfg.icon size={14} color={cfg.color} style={{ flexShrink: 0 }} />

              {/* File name + directory */}
              <div style={{ flex: 1, minWidth: 0, overflow: 'hidden' }}>
                <span
                  style={{
                    fontSize: 12,
                    color: 'var(--text)',
                    whiteSpace: 'nowrap' as const,
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    display: 'block',
                  }}
                  title={file.path}
                >
                  {fileName}
                </span>
                {dirName && (
                  <span
                    style={{
                      fontSize: 10,
                      color: 'var(--text-muted)',
                      whiteSpace: 'nowrap' as const,
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      display: 'block',
                    }}
                  >
                    {dirName}
                  </span>
                )}
              </div>

              {/* Action button */}
              <button
                onClick={(e) => { e.stopPropagation(); onAction(file); }}
                title={actionLabel}
                style={{
                  flexShrink: 0,
                  width: 18,
                  height: 18,
                  border: 'none',
                  borderRadius: 3,
                  background: isHovered ? 'var(--accent)' : 'transparent',
                  color: isHovered ? '#000' : 'transparent',
                  cursor: 'pointer',
                  fontSize: 14,
                  fontWeight: 700,
                  lineHeight: '18px',
                  textAlign: 'center' as const,
                  padding: 0,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                }}
              >
                {actionLabel === '+' ? <Plus size={14} /> : <Minus size={14} />}
              </button>
            </div>
            {expandedPath === file.path && (
              <InlineDiff
                projectPath={projectPath}
                filepath={file.path}
                staged={!!staged}
                onOpen={() => { onFileClick(file); setExpandedPath(null); }}
              />
            )}
          </div>
        );
      })}

      {contextMenu && (
        <div
          ref={menuRef}
          style={{
            position: 'fixed',
            left: contextMenu.x,
            top: contextMenu.y,
            background: '#1c2128',
            border: '1px solid var(--border)',
            borderRadius: 6,
            padding: '4px 0',
            minWidth: 180,
            boxShadow: '0 8px 24px rgba(0,0,0,0.4)',
            zIndex: 2000,
            fontFamily: "'JetBrains Mono', monospace",
            fontSize: 13,
          }}
        >
          <div
            onClick={() => { onAction(contextMenu.file); setContextMenu(null); }}
            style={{ padding: '6px 16px', color: 'var(--text)', cursor: 'pointer' }}
            onMouseEnter={e => (e.currentTarget.style.background = 'var(--bg-hover)')}
            onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
          >
            {staged ? 'Unstage' : 'Stage'}
          </div>
          <div style={{ height: 1, background: 'var(--border)', margin: '4px 0' }} />
          <div
            onClick={() => { onDiscard?.(contextMenu.file); setContextMenu(null); }}
            style={{ padding: '6px 16px', color: 'var(--red)', cursor: 'pointer' }}
            onMouseEnter={e => (e.currentTarget.style.background = 'var(--bg-hover)')}
            onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
          >
            Discard Changes
          </div>
        </div>
      )}
    </div>
  );
}
