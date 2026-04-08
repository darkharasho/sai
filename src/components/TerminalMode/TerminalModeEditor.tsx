import { PanelRightClose } from 'lucide-react';

interface EditorFile {
  path: string;
  content: string;
  highlightLine?: number;
}

interface TerminalModeEditorProps {
  files: EditorFile[];
  activeFile: string | null;
  onSelectFile: (path: string) => void;
  onClose: () => void;
}

export default function TerminalModeEditor({ files, activeFile, onSelectFile, onClose }: TerminalModeEditorProps) {
  const file = files.find(f => f.path === activeFile);

  if (files.length === 0) return null;

  return (
    <div className="tm-editor">
      {/* Tab bar */}
      <div className="tm-editor-tabs">
        {files.map(f => (
          <div
            key={f.path}
            className={`tm-editor-tab ${f.path === activeFile ? 'tm-editor-tab-active' : ''}`}
            onClick={() => onSelectFile(f.path)}
          >
            {f.path.split('/').pop()}
          </div>
        ))}
        <div className="tm-editor-close" onClick={onClose}>
          <PanelRightClose size={14} />
        </div>
      </div>

      {/* File content */}
      <div className="tm-editor-content">
        {file && file.content.split('\n').map((line, i) => (
          <div
            key={i}
            className={file.highlightLine === i + 1 ? 'tm-editor-line-highlight' : ''}
          >
            <span className="tm-editor-line-num">{i + 1}</span>
            {'  '}{line}
          </div>
        ))}
      </div>

      <style>{`
        .tm-editor {
          width: 260px;
          border-left: 1px solid var(--border);
          background: var(--bg);
          display: flex;
          flex-direction: column;
          flex-shrink: 0;
        }
        .tm-editor-tabs {
          background: var(--bg);
          padding: 0;
          border-bottom: 1px solid var(--border);
          display: flex;
          font-size: 11px;
        }
        .tm-editor-tab {
          padding: 6px 12px;
          color: var(--text-muted);
          cursor: pointer;
        }
        .tm-editor-tab-active {
          color: var(--text);
          border-bottom: 2px solid var(--accent);
        }
        .tm-editor-close {
          margin-left: auto;
          padding: 6px 8px;
          color: var(--text-muted);
          cursor: pointer;
          display: flex;
          align-items: center;
        }
        .tm-editor-close:hover {
          color: var(--text);
        }
        .tm-editor-content {
          flex: 1;
          padding: 12px;
          font-family: 'Geist Mono', 'JetBrains Mono', monospace;
          font-size: 11px;
          color: var(--text-muted);
          line-height: 1.8;
          overflow: auto;
          white-space: pre;
        }
        .tm-editor-line-num {
          color: var(--text-muted);
          opacity: 0.4;
          user-select: none;
        }
        .tm-editor-line-highlight {
          background: rgba(248, 81, 73, 0.13);
          margin: 0 -12px;
          padding: 0 12px;
        }
      `}</style>
    </div>
  );
}
