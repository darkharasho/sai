import { useEffect, useRef, useState, useCallback } from 'react';
import * as monaco from 'monaco-editor';
import editorWorker from 'monaco-editor/esm/vs/editor/editor.worker?worker';
import jsonWorker from 'monaco-editor/esm/vs/language/json/json.worker?worker';
import cssWorker from 'monaco-editor/esm/vs/language/css/css.worker?worker';
import htmlWorker from 'monaco-editor/esm/vs/language/html/html.worker?worker';
import tsWorker from 'monaco-editor/esm/vs/language/typescript/ts.worker?worker';

// Monaco environment setup for workers
self.MonacoEnvironment = {
  getWorker(_workerId: string, label: string) {
    switch (label) {
      case 'json':
        return new jsonWorker();
      case 'css':
      case 'scss':
      case 'less':
        return new cssWorker();
      case 'html':
      case 'handlebars':
      case 'razor':
        return new htmlWorker();
      case 'typescript':
      case 'javascript':
        return new tsWorker();
      default:
        return new editorWorker();
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

export function detectLanguage(filePath: string): string {
  const ext = '.' + filePath.split('.').pop()?.toLowerCase();
  return EXT_TO_LANG[ext] ?? 'plaintext';
}

interface MonacoEditorProps {
  filePath: string;
  content: string;
  onSave: (filePath: string, content: string) => Promise<void>;
  onDirtyChange?: (dirty: boolean) => void;
}

export default function MonacoEditor({ filePath, content, onSave, onDirtyChange }: MonacoEditorProps) {
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
      onDirtyChange?.(false);
      setSaveError(false);
    } catch {
      setSaveError(true);
      setTimeout(() => setSaveError(false), 3000);
    }
  }, [filePath, onSave, onDirtyChange]);

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

    editor.onDidChangeModelContent(() => {
      setDirty(true);
      onDirtyChange?.(true);
    });

    editor.onDidChangeCursorPosition(e => {
      setCursorPosition({ line: e.position.lineNumber, column: e.position.column });
    });

    editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS, () => {
      handleSave();
    });

    editor.focus();

    return () => {
      editor.dispose();
    };
  }, []);

  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
      <div ref={containerRef} style={{ flex: 1, overflow: 'hidden' }} />

      {/* Status Bar */}
      <div className="monaco-statusbar">
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          {dirty && <span className="monaco-dirty-dot" />}
          <span>{language}</span>
          {saveError && <span style={{ color: 'var(--red)' }}>Save failed</span>}
        </div>
        <span>Ln {cursorPosition.line}, Col {cursorPosition.column}</span>
        <span>UTF-8</span>
      </div>

      <style>{`
        .monaco-statusbar {
          display: flex;
          align-items: center;
          justify-content: space-between;
          padding: 4px 16px;
          border-top: 1px solid var(--border);
          font-family: 'JetBrains Mono', monospace;
          font-size: 11px;
          color: var(--text-muted);
          flex-shrink: 0;
          background: var(--bg-secondary);
        }
        .monaco-dirty-dot {
          width: 8px;
          height: 8px;
          border-radius: 50%;
          background: var(--accent);
          flex-shrink: 0;
        }
      `}</style>
    </div>
  );
}
