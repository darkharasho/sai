import { useEffect } from 'react';
import { X } from 'lucide-react';
import type { OpenFile } from '../../types';
import DiffViewer from './DiffViewer';
import MarkdownPreview from './MarkdownPreview';
import MonacoEditor from '../FileExplorer/MonacoEditor';
import ImageViewer from './ImageViewer';
import { isImageFile } from '../../utils/imageFiles';

interface CodePanelProps {
  openFiles: OpenFile[];
  activeFilePath: string;
  projectPath: string;
  editorFontSize?: number;
  editorMinimap?: boolean;
  externallyModified: Set<string>;
  onActivate: (path: string) => void;
  onClose: (path: string) => void;
  onCloseAll: () => void;
  onDiffModeChange: (path: string, mode: 'unified' | 'split') => void;
  onEditorSave: (filePath: string, content: string) => Promise<void>;
  onEditorContentChange?: (filePath: string, content: string) => void;
  onEditorDirtyChange?: (filePath: string, dirty: boolean) => void;
  onReloadFile: (path: string) => void;
  onKeepMyEdits: (path: string) => void;
  onLineRevealed?: (path: string) => void;
  onToggleMdPreview?: (path: string) => void;
}

export default function CodePanel({
  openFiles,
  activeFilePath,
  projectPath,
  editorFontSize = 13,
  editorMinimap = true,
  externallyModified,
  onActivate,
  onClose,
  onCloseAll,
  onDiffModeChange,
  onEditorSave,
  onEditorContentChange,
  onEditorDirtyChange,
  onReloadFile,
  onKeepMyEdits,
  onLineRevealed,
  onToggleMdPreview,
}: CodePanelProps) {
  const activeFile = openFiles.find(f => f.path === activeFilePath);

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

  const isDiff = activeFile.viewMode === 'diff';

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
          {openFiles.map((f) => {
            const isActive = f.path === activeFilePath;
            const fileName = f.path.split('/').pop() ?? f.path;
            const isDirty = f.viewMode === 'editor' && !!f.isDirty;
            return (
              <div
                key={f.path}
                onClick={() => onActivate(f.path)}
                onMouseDown={(e) => {
                  if (e.button === 1) {
                    e.preventDefault();
                    onClose(f.path);
                  }
                }}
                className="tab-item"
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
                <div style={{ position: 'relative', width: 18, height: 18, flexShrink: 0 }}>
                  {isDirty && (
                    <div
                      className="tab-dirty-dot"
                      style={{
                        position: 'absolute',
                        inset: 0,
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                      }}
                    >
                      <div style={{
                        width: 8,
                        height: 8,
                        borderRadius: '50%',
                        background: 'var(--text-muted)',
                      }} />
                    </div>
                  )}
                  <button
                    onClick={(e) => { e.stopPropagation(); onClose(f.path); }}
                    className={isDirty ? 'tab-close-hidden' : ''}
                    style={{
                      position: 'absolute',
                      inset: 0,
                      background: 'none',
                      border: 'none',
                      color: isActive ? 'var(--text-muted)' : 'transparent',
                      cursor: 'pointer',
                      padding: 2,
                      borderRadius: 3,
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      opacity: isDirty ? 0 : 1,
                    }}
                    onMouseEnter={(e) => {
                      const btn = e.currentTarget;
                      btn.style.opacity = '1';
                      btn.style.color = 'var(--text)';
                      btn.style.background = 'var(--bg-hover)';
                      const dot = btn.parentElement?.querySelector('.tab-dirty-dot') as HTMLElement | null;
                      if (dot) dot.style.opacity = '0';
                    }}
                    onMouseLeave={(e) => {
                      const btn = e.currentTarget;
                      btn.style.color = isActive ? 'var(--text-muted)' : 'transparent';
                      btn.style.background = 'none';
                      btn.style.opacity = isDirty ? '0' : '1';
                      const dot = btn.parentElement?.querySelector('.tab-dirty-dot') as HTMLElement | null;
                      if (dot) dot.style.opacity = '1';
                    }}
                  >
                    <X size={14} />
                  </button>
                </div>
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
          {activeFile.path}
        </span>

        {isDiff && (
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
        )}

        {!isDiff && (
          <span style={{
            color: 'var(--text-muted)',
            fontSize: 11,
            padding: '3px 8px',
            border: '1px solid var(--border)',
            borderRadius: 4,
          }}>
            Ctrl+S to save
          </span>
        )}
      </div>

      {/* External change banner */}
      {externallyModified.has(activeFilePath) && (
        <div style={{
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          padding: '6px 12px',
          background: 'var(--bg-secondary)',
          borderBottom: '1px solid var(--border)',
          flexShrink: 0,
          fontSize: 12,
          color: 'var(--text-muted)',
        }}>
          <span style={{ color: 'var(--text-warning, #e8a838)' }}>⚠</span>
          <span>File changed on disk</span>
          <div style={{ marginLeft: 'auto', display: 'flex', gap: 6 }}>
            <button
              onClick={() => onReloadFile(activeFilePath)}
              style={{
                background: 'var(--accent)',
                border: 'none',
                borderRadius: 4,
                color: '#fff',
                cursor: 'pointer',
                fontSize: 11,
                padding: '3px 10px',
              }}
            >
              Reload
            </button>
            <button
              onClick={() => onKeepMyEdits(activeFilePath)}
              style={{
                background: 'none',
                border: '1px solid var(--border)',
                borderRadius: 4,
                color: 'var(--text-muted)',
                cursor: 'pointer',
                fontSize: 11,
                padding: '3px 10px',
              }}
            >
              Keep My Edits
            </button>
          </div>
        </div>
      )}

      {/* Content */}
      {isDiff && activeFile.file ? (
        <DiffViewer
          projectPath={projectPath}
          filePath={activeFile.file.path}
          staged={activeFile.file.staged}
          mode={activeFile.diffMode ?? 'unified'}
          minimap={editorMinimap}
        />
      ) : activeFile.viewMode === 'editor' && activeFile.mdPreview && activeFile.content !== undefined ? (
        <MarkdownPreview
          content={activeFile.content}
          onTogglePreview={() => onToggleMdPreview?.(activeFile.path)}
        />
      ) : activeFile.viewMode === 'editor' && isImageFile(activeFile.path) ? (
        <ImageViewer
          key={activeFile.path}
          filePath={activeFile.path}
          projectPath={projectPath}
          onEditorSave={onEditorSave}
          onEditorContentChange={onEditorContentChange}
          onEditorDirtyChange={onEditorDirtyChange}
          editorFontSize={editorFontSize}
          editorMinimap={editorMinimap}
        />
      ) : activeFile.viewMode === 'editor' && activeFile.content !== undefined ? (
        <MonacoEditor
          key={activeFile.path}
          filePath={activeFile.path}
          content={activeFile.content}
          fontSize={editorFontSize}
          minimap={editorMinimap}
          projectPath={projectPath}
          initialLine={activeFile.pendingLine}
          onSave={onEditorSave}
          onContentChange={onEditorContentChange}
          onDirtyChange={onEditorDirtyChange ? (dirty) => onEditorDirtyChange(activeFile.path, dirty) : undefined}
          onLineRevealed={onLineRevealed ? () => onLineRevealed(activeFile.path) : undefined}
          onTogglePreview={onToggleMdPreview ? () => onToggleMdPreview(activeFile.path) : undefined}
        />
      ) : null}
    </div>
  );
}
