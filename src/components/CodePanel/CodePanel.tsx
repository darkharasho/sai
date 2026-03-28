import { useEffect } from 'react';
import { X } from 'lucide-react';
import type { OpenFile } from '../../types';
import DiffViewer from './DiffViewer';

interface CodePanelProps {
  openFiles: OpenFile[];
  activeFilePath: string;
  projectPath: string;
  onActivate: (path: string) => void;
  onClose: (path: string) => void;
  onCloseAll: () => void;
  onDiffModeChange: (path: string, mode: 'unified' | 'split') => void;
}

export default function CodePanel({
  openFiles,
  activeFilePath,
  projectPath,
  onActivate,
  onClose,
  onCloseAll,
  onDiffModeChange,
}: CodePanelProps) {
  const activeFile = openFiles.find(f => f.file.path === activeFilePath);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose(activeFilePath);
      }
    };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [activeFilePath, onClose]);

  if (!activeFile) return null;

  return (
    <div style={{
      flex: 1,
      display: 'flex',
      flexDirection: 'column',
      overflow: 'hidden',
      background: 'var(--bg-primary)',
    }}>
      {/* Tab bar */}
      <div style={{
        display: 'flex',
        alignItems: 'stretch',
        background: 'var(--bg-secondary)',
        borderBottom: '1px solid var(--border)',
        flexShrink: 0,
        overflow: 'hidden',
      }}>
        <div style={{
          display: 'flex',
          flex: 1,
          overflow: 'hidden',
        }}>
          {openFiles.map(({ file }) => {
            const isActive = file.path === activeFilePath;
            const fileName = file.path.split('/').pop() ?? file.path;
            return (
              <div
                key={file.path}
                onClick={() => onActivate(file.path)}
                onMouseDown={(e) => {
                  if (e.button === 1) {
                    e.preventDefault();
                    onClose(file.path);
                  }
                }}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 6,
                  padding: '0 12px',
                  height: 35,
                  fontSize: 12,
                  cursor: 'pointer',
                  color: isActive ? 'var(--text)' : 'var(--text-muted)',
                  background: isActive ? 'var(--bg-primary)' : 'transparent',
                  borderBottom: isActive ? '2px solid var(--accent)' : '2px solid transparent',
                  borderRight: '1px solid var(--border)',
                  userSelect: 'none' as const,
                  flexShrink: 0,
                }}
              >
                <span style={{
                  fontFamily: "'JetBrains Mono', monospace",
                  fontSize: 12,
                  whiteSpace: 'nowrap' as const,
                }}>
                  {fileName}
                </span>
                <button
                  onClick={(e) => { e.stopPropagation(); onClose(file.path); }}
                  style={{
                    background: 'none',
                    border: 'none',
                    color: isActive ? 'var(--text-muted)' : 'transparent',
                    cursor: 'pointer',
                    padding: 2,
                    borderRadius: 3,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                  }}
                  onMouseEnter={(e) => {
                    (e.target as HTMLElement).style.color = 'var(--text)';
                    (e.target as HTMLElement).style.background = 'var(--bg-hover)';
                  }}
                  onMouseLeave={(e) => {
                    (e.target as HTMLElement).style.color = isActive ? 'var(--text-muted)' : 'transparent';
                    (e.target as HTMLElement).style.background = 'none';
                  }}
                >
                  <X size={14} />
                </button>
              </div>
            );
          })}
        </div>

        {/* Close all button */}
        {openFiles.length > 1 && (
          <button
            onClick={onCloseAll}
            title="Close all tabs"
            style={{
              background: 'none',
              border: 'none',
              borderLeft: '1px solid var(--border)',
              color: 'var(--text-muted)',
              cursor: 'pointer',
              padding: '0 10px',
              fontSize: 11,
              flexShrink: 0,
            }}
          >
            Close All
          </button>
        )}
      </div>

      {/* Toolbar */}
      <div style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        padding: '4px 12px',
        background: 'var(--bg-secondary)',
        borderBottom: '1px solid var(--border)',
        flexShrink: 0,
      }}>
        <span style={{
          fontFamily: "'JetBrains Mono', monospace",
          fontSize: 11,
          color: 'var(--text-muted)',
        }}>
          {activeFile.file.path}
        </span>

        {/* Unified / Split toggle */}
        <div style={{
          display: 'flex',
          borderRadius: 4,
          overflow: 'hidden',
          border: '1px solid var(--border)',
        }}>
          {(['unified', 'split'] as const).map((m) => (
            <button
              key={m}
              onClick={() => onDiffModeChange(activeFilePath, m)}
              style={{
                background: activeFile.diffMode === m ? 'var(--bg-hover)' : 'transparent',
                color: activeFile.diffMode === m ? 'var(--text)' : 'var(--text-muted)',
                border: 'none',
                padding: '3px 10px',
                fontSize: 11,
                cursor: 'pointer',
                textTransform: 'capitalize' as const,
              }}
            >
              {m}
            </button>
          ))}
        </div>
      </div>

      {/* Diff content */}
      <DiffViewer
        projectPath={projectPath}
        filePath={activeFile.file.path}
        staged={activeFile.file.staged}
        mode={activeFile.diffMode}
      />
    </div>
  );
}
