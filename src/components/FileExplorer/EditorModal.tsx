import { useEffect, useRef, useState, useCallback } from 'react';
import { X } from 'lucide-react';
import * as monaco from 'monaco-editor';

// Monaco environment setup for workers
self.MonacoEnvironment = {
  getWorker(_workerId: string, label: string) {
    const getWorkerModule = (moduleUrl: string, label: string) => {
      return new Worker(new URL(`monaco-editor/esm/vs/${moduleUrl}`, import.meta.url), {
        type: 'module',
        name: label,
      });
    };
    switch (label) {
      case 'json':
        return getWorkerModule('language/json/json.worker', label);
      case 'css':
      case 'scss':
      case 'less':
        return getWorkerModule('language/css/css.worker', label);
      case 'html':
      case 'handlebars':
      case 'razor':
        return getWorkerModule('language/html/html.worker', label);
      case 'typescript':
      case 'javascript':
        return getWorkerModule('language/typescript/ts.worker', label);
      default:
        return getWorkerModule('editor/editor.worker', label);
    }
  },
};

// Register SAI dark theme
monaco.editor.defineTheme('sai-dark', {
  base: 'vs-dark',
  inherit: true,
  rules: [],
  colors: {
    'editor.background': '#111418',
    'editor.foreground': '#bec6d0',
    'editorLineNumber.foreground': '#475262',
    'editorLineNumber.activeForeground': '#a0acbb',
    'editor.selectionBackground': '#21292f',
    'editor.lineHighlightBackground': '#161a1f',
    'editorWidget.background': '#0c0f11',
    'editorWidget.border': '#2a2e35',
    'input.background': '#161a1f',
    'input.border': '#2a2e35',
    'dropdown.background': '#1c2128',
    'list.hoverBackground': '#21292f',
    'minimap.background': '#0c0f11',
    'scrollbar.shadow': '#00000000',
    'editorOverviewRuler.border': '#00000000',
  },
});

const EXT_TO_LANG: Record<string, string> = {
  '.ts': 'typescript', '.tsx': 'typescript', '.js': 'javascript', '.jsx': 'javascript',
  '.json': 'json', '.html': 'html', '.css': 'css', '.scss': 'scss', '.less': 'less',
  '.md': 'markdown', '.py': 'python', '.rs': 'rust', '.go': 'go', '.java': 'java',
  '.c': 'c', '.cpp': 'cpp', '.h': 'c', '.yaml': 'yaml', '.yml': 'yaml',
  '.toml': 'ini', '.sh': 'shell', '.bash': 'shell', '.xml': 'xml', '.sql': 'sql',
  '.vue': 'html', '.svelte': 'html', '.graphql': 'graphql', '.gql': 'graphql',
};

function detectLanguage(filePath: string): string {
  const ext = '.' + filePath.split('.').pop()?.toLowerCase();
  return EXT_TO_LANG[ext] ?? 'plaintext';
}

interface EditorModalProps {
  filePath: string;
  content: string;
  onSave: (filePath: string, content: string) => Promise<void>;
  onClose: () => void;
}

export default function EditorModal({ filePath, content, onSave, onClose }: EditorModalProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const editorRef = useRef<monaco.editor.IStandaloneCodeEditor | null>(null);
  const [dirty, setDirty] = useState(false);
  const [saveError, setSaveError] = useState(false);
  const [cursorPosition, setCursorPosition] = useState({ line: 1, column: 1 });
  const language = detectLanguage(filePath);

  const handleSave = useCallback(async () => {
    if (!editorRef.current) return;
    const currentContent = editorRef.current.getValue();
    try {
      await onSave(filePath, currentContent);
      setDirty(false);
      setSaveError(false);
    } catch {
      setSaveError(true);
      setTimeout(() => setSaveError(false), 3000);
    }
  }, [filePath, onSave]);

  const handleClose = useCallback(() => {
    if (dirty) {
      if (!confirm('You have unsaved changes. Close anyway?')) return;
    }
    onClose();
  }, [dirty, onClose]);

  // Create editor on mount
  useEffect(() => {
    if (!containerRef.current) return;

    const editor = monaco.editor.create(containerRef.current, {
      value: content,
      language,
      theme: 'sai-dark',
      fontFamily: "'JetBrains Mono', 'Fira Code', 'Cascadia Code', monospace",
      fontSize: 13,
      lineHeight: 20,
      minimap: { enabled: true },
      scrollBeyondLastLine: false,
      automaticLayout: true,
      padding: { top: 8 },
      renderLineHighlight: 'line',
      cursorBlinking: 'smooth',
      smoothScrolling: true,
      bracketPairColorization: { enabled: true },
    });

    editorRef.current = editor;

    // Track dirty state
    editor.onDidChangeModelContent(() => {
      setDirty(true);
    });

    // Track cursor position
    editor.onDidChangeCursorPosition(e => {
      setCursorPosition({ line: e.position.lineNumber, column: e.position.column });
    });

    // Ctrl+S to save
    editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS, () => {
      handleSave();
    });

    // Focus editor
    editor.focus();

    return () => {
      editor.dispose();
    };
  }, []);  // Only run on mount

  // Escape to close (outside Monaco so it doesn't interfere with editor keybindings)
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      // Only handle Escape if focus is NOT inside the Monaco editor
      if (e.key === 'Escape' && !containerRef.current?.contains(document.activeElement)) {
        handleClose();
      }
    };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [handleClose]);

  const fileName = filePath.split('/').pop() ?? filePath;

  return (
    <div className="editor-modal-overlay" onClick={handleClose}>
      <div className="editor-modal-content" onClick={e => e.stopPropagation()}>
        {/* Header */}
        <div className="editor-modal-header">
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            {dirty && <span className="editor-dirty-dot" />}
            <span className="editor-modal-title">{filePath}</span>
            {saveError && <span style={{ color: 'var(--red)', fontSize: 11 }}>Save failed</span>}
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{ color: 'var(--text-muted)', fontSize: 11, padding: '3px 8px', border: '1px solid var(--border)', borderRadius: 4 }}>
              Ctrl+S to save
            </span>
            <button className="editor-modal-close" onClick={handleClose}><X size={18} /></button>
          </div>
        </div>

        {/* Monaco Editor Container */}
        <div ref={containerRef} style={{ flex: 1, overflow: 'hidden' }} />

        {/* Status Bar */}
        <div className="editor-modal-statusbar">
          <span>{language}</span>
          <span>Ln {cursorPosition.line}, Col {cursorPosition.column}</span>
          <span>UTF-8</span>
        </div>
      </div>

      <style>{`
        .editor-modal-overlay {
          position: fixed;
          inset: 0;
          background: rgba(0,0,0,0.7);
          display: flex;
          align-items: center;
          justify-content: center;
          z-index: 1000;
          backdrop-filter: blur(2px);
        }
        .editor-modal-content {
          background: var(--bg-primary);
          border: 1px solid var(--border);
          border-radius: 10px;
          width: 90vw;
          height: 85vh;
          display: flex;
          flex-direction: column;
          overflow: hidden;
          box-shadow: 0 16px 48px rgba(0,0,0,0.5);
        }
        .editor-modal-header {
          display: flex;
          align-items: center;
          justify-content: space-between;
          padding: 8px 16px;
          border-bottom: 1px solid var(--border);
          flex-shrink: 0;
        }
        .editor-modal-title {
          font-family: 'JetBrains Mono', monospace;
          font-size: 13px;
          color: var(--text);
        }
        .editor-dirty-dot {
          width: 8px;
          height: 8px;
          border-radius: 50%;
          background: var(--accent);
          flex-shrink: 0;
        }
        .editor-modal-close {
          background: none;
          border: none;
          color: var(--text-muted);
          cursor: pointer;
          padding: 4px;
          border-radius: 4px;
          display: flex;
        }
        .editor-modal-close:hover {
          color: var(--text);
          background: var(--bg-hover);
        }
        .editor-modal-statusbar {
          display: flex;
          align-items: center;
          justify-content: space-between;
          padding: 4px 16px;
          border-top: 1px solid var(--border);
          font-family: 'JetBrains Mono', monospace;
          font-size: 11px;
          color: var(--text-muted);
          flex-shrink: 0;
        }
      `}</style>
    </div>
  );
}
