import { useState } from 'react';
import { Plus, Minus, FileText, FilePlus, FileX, FileSymlink } from 'lucide-react';
import { GitFile } from '../../types';

const STATUS_CONFIG: Record<GitFile['status'], { icon: typeof FileText; color: string }> = {
  modified: { icon: FileText,     color: 'var(--orange)' },
  added:    { icon: FilePlus,     color: 'var(--green)' },
  deleted:  { icon: FileX,        color: 'var(--red)' },
  renamed:  { icon: FileSymlink,  color: 'var(--blue)' },
};

interface ChangedFilesProps {
  title: string;
  files: GitFile[];
  onAction: (file: GitFile) => void;
  actionLabel: string;
  onFileClick: (file: GitFile) => void;
  onStageAll?: () => void;
}

export default function ChangedFiles({ title, files, onAction, actionLabel, onFileClick, onStageAll }: ChangedFilesProps) {
  const [hoveredPath, setHoveredPath] = useState<string | null>(null);

  if (files.length === 0) return null;

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
          <div
            key={file.path}
            onMouseEnter={() => setHoveredPath(file.path)}
            onMouseLeave={() => setHoveredPath(null)}
            onClick={() => onFileClick(file)}
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
        );
      })}
    </div>
  );
}
