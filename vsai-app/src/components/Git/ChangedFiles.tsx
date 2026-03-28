import { useState } from 'react';
import { GitFile } from '../../types';

const STATUS_CONFIG: Record<GitFile['status'], { label: string; color: string }> = {
  modified: { label: 'M', color: 'var(--orange)' },
  added:    { label: 'A', color: 'var(--green)' },
  deleted:  { label: 'D', color: 'var(--red)' },
  renamed:  { label: 'R', color: 'var(--blue)' },
};

interface ChangedFilesProps {
  title: string;
  files: GitFile[];
  onAction: (file: GitFile) => void;
  actionLabel: string;
}

export default function ChangedFiles({ title, files, onAction, actionLabel }: ChangedFilesProps) {
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
        }}
      >
        {title} ({files.length})
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
            style={{
              display: 'flex',
              alignItems: 'center',
              padding: '3px 12px',
              gap: 6,
              background: isHovered ? 'var(--bg-hover)' : 'transparent',
              cursor: 'default',
              minWidth: 0,
            }}
          >
            {/* Status badge */}
            <span
              style={{
                fontSize: 11,
                fontWeight: 700,
                color: cfg.color,
                width: 12,
                flexShrink: 0,
                textAlign: 'center' as const,
              }}
            >
              {cfg.label}
            </span>

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
              onClick={() => onAction(file)}
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
              {actionLabel}
            </button>
          </div>
        );
      })}
    </div>
  );
}
