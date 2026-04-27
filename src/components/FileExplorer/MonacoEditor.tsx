import { useEffect, useRef, useState, useCallback } from 'react';
import * as monaco from 'monaco-editor';
import { getActiveHighlightTheme, buildMonacoThemeData } from '../../themes';
import { registerMonacoEditor, unregisterMonacoEditor } from '../../utils/monacoEditorRegistry';
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
  fontSize?: number;
  minimap?: boolean;
  initialLine?: number;
  projectPath?: string;
  onSave: (filePath: string, content: string) => Promise<void>;
  onDirtyChange?: (dirty: boolean) => void;
  onContentChange?: (filePath: string, content: string) => void;
  onLineRevealed?: () => void;
  onTogglePreview?: () => void;
}

export default function MonacoEditor({ filePath, content, fontSize = 13, minimap = true, initialLine, projectPath, onSave, onDirtyChange, onContentChange, onLineRevealed, onTogglePreview }: MonacoEditorProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const editorRef = useRef<monaco.editor.IStandaloneCodeEditor | null>(null);
  const onContentChangeRef = useRef(onContentChange);
  const decorationsRef = useRef<string[]>([]);
  const headContentRef = useRef<string[] | null>(null);
  const decorationTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  onContentChangeRef.current = onContentChange;
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
      fetchHeadContent();
    } catch {
      setSaveError(true);
      setTimeout(() => setSaveError(false), 3000);
    }
  }, [filePath, onSave, onDirtyChange]);

  const computeAndApplyDecorations = useCallback(() => {
    if (!editorRef.current || !headContentRef.current) return;
    const headLines = headContentRef.current;
    const currentLines = editorRef.current.getValue().split('\n');
    const decorations: monaco.editor.IModelDeltaDecoration[] = [];

    const addDeco = (startLine: number, endLine: number, cls: string, color: string, wholeLine = true) => {
      decorations.push({
        range: new monaco.Range(startLine, 1, endLine, 1),
        options: {
          ...(wholeLine ? { isWholeLine: true } : {}),
          linesDecorationsClassName: cls,
          minimap: { color, position: monaco.editor.MinimapPosition.Inline },
        },
      });
    };

    // Line similarity: ratio of common characters (0-1)
    const similarity = (a: string, b: string): number => {
      if (a === b) return 1;
      if (!a.length || !b.length) return 0;
      const short = a.length < b.length ? a : b;
      const long = a.length < b.length ? b : a;
      let matches = 0;
      const used = new Array(long.length).fill(false);
      for (let i = 0; i < short.length; i++) {
        for (let j = 0; j < long.length; j++) {
          if (!used[j] && short[i] === long[j]) { matches++; used[j] = true; break; }
        }
      }
      return matches / long.length;
    };

    // Classify lines within a hunk using similarity matching
    const classifyHunk = (oldStart: number, oldEnd: number, newStart: number, newEnd: number) => {
      const oldSlice = headLines.slice(oldStart, oldEnd);
      const newSlice = currentLines.slice(newStart, newEnd);
      if (oldSlice.length === 0 && newSlice.length > 0) {
        addDeco(newStart + 1, newEnd, 'git-gutter-added', '#2ea04370');
        return;
      }
      if (newSlice.length === 0 && oldSlice.length > 0) {
        const delLine = Math.min(currentLines.length, newStart + 1);
        addDeco(delLine, delLine, 'git-gutter-deleted', '#f8514970', false);
        return;
      }

      // Match each new line to the best old line by similarity
      const oldUsed = new Array(oldSlice.length).fill(false);
      const newType: ('added' | 'modified')[] = new Array(newSlice.length).fill('added');

      for (let n = 0; n < newSlice.length; n++) {
        let bestSim = 0.4; // minimum threshold to count as modified
        let bestO = -1;
        for (let o = 0; o < oldSlice.length; o++) {
          if (oldUsed[o]) continue;
          const sim = similarity(oldSlice[o].trim(), newSlice[n].trim());
          if (sim > bestSim) { bestSim = sim; bestO = o; }
        }
        if (bestO >= 0) {
          oldUsed[bestO] = true;
          newType[n] = 'modified';
        }
      }

      // Apply decorations, grouping consecutive same-type lines
      let i = 0;
      while (i < newSlice.length) {
        const type = newType[i];
        let j = i + 1;
        while (j < newSlice.length && newType[j] === type) j++;
        const cls = type === 'added' ? 'git-gutter-added' : 'git-gutter-modified';
        const color = type === 'added' ? '#2ea04370' : '#0078d470';
        addDeco(newStart + i + 1, newStart + j, cls, color);
        i = j;
      }

      // Unmatched old lines = deletions — show triangle after the last new line in hunk
      const unmatchedOld = oldUsed.filter(u => !u).length;
      if (unmatchedOld > 0) {
        const delLine = Math.min(currentLines.length, newEnd + 1);
        addDeco(delLine, delLine, 'git-gutter-deleted', '#f8514970', false);
      }
    };

    // Find matching (anchor) lines using greedy forward scan
    const oldLen = headLines.length;
    const newLen = currentLines.length;
    let oldIdx = 0;
    let newIdx = 0;

    while (oldIdx < oldLen || newIdx < newLen) {
      if (oldIdx < oldLen && newIdx < newLen && headLines[oldIdx] === currentLines[newIdx]) {
        oldIdx++;
        newIdx++;
      } else {
        // Find next resync point
        let bestOld = -1;
        let bestNew = -1;
        let bestCost = Infinity;
        const searchLimit = Math.min(50, Math.max(oldLen - oldIdx, newLen - newIdx) + 1);
        for (let skip = 0; skip < searchLimit; skip++) {
          if (newIdx + skip <= newLen && oldIdx < oldLen) {
            for (let j = 0; j <= skip && oldIdx + j <= oldLen; j++) {
              if (oldIdx + j < oldLen && newIdx + skip < newLen && headLines[oldIdx + j] === currentLines[newIdx + skip]) {
                if (j + skip < bestCost) { bestCost = j + skip; bestOld = oldIdx + j; bestNew = newIdx + skip; }
                break;
              }
            }
          }
          if (newIdx + skip < newLen && oldIdx < oldLen) {
            for (let j = skip + 1; j < searchLimit && oldIdx + j <= oldLen; j++) {
              if (oldIdx + j < oldLen && newIdx + skip < newLen && headLines[oldIdx + j] === currentLines[newIdx + skip]) {
                if (j + skip < bestCost) { bestCost = j + skip; bestOld = oldIdx + j; bestNew = newIdx + skip; }
                break;
              }
            }
          }
        }

        const endOld = bestCost === Infinity ? oldLen : bestOld;
        const endNew = bestCost === Infinity ? newLen : bestNew;

        classifyHunk(oldIdx, endOld, newIdx, endNew);

        oldIdx = endOld;
        newIdx = endNew;
        if (bestCost === Infinity) break;
      }
    }

    decorationsRef.current = editorRef.current.deltaDecorations(
      decorationsRef.current,
      decorations,
    );
  }, []);

  const scheduleDecorationUpdate = useCallback(() => {
    if (decorationTimerRef.current) clearTimeout(decorationTimerRef.current);
    decorationTimerRef.current = setTimeout(computeAndApplyDecorations, 150);
  }, [computeAndApplyDecorations]);

  const fetchHeadContent = useCallback(async () => {
    if (!projectPath) return;
    try {
      const relativePath = filePath.startsWith(projectPath)
        ? filePath.slice(projectPath.length).replace(/^\//, '')
        : filePath;
      const headText = await window.sai.gitShow(projectPath, relativePath, 'HEAD');
      headContentRef.current = headText.split('\n');
      computeAndApplyDecorations();
    } catch {
      headContentRef.current = null;
    }
  }, [projectPath, filePath, computeAndApplyDecorations]);

  // Create editor on mount
  useEffect(() => {
    if (!containerRef.current) return;

    const editor = monaco.editor.create(containerRef.current, {
      value: content,
      language,
      theme: 'sai-dark',
      fontFamily: "'JetBrains Mono', 'Fira Code', 'Cascadia Code', monospace",
      fontSize,
      lineHeight: 20,
      minimap: { enabled: minimap },
      scrollBeyondLastLine: false,
      automaticLayout: true,
      fixedOverflowWidgets: true,
      padding: { top: 8 },
      renderLineHighlight: 'line',
      cursorBlinking: 'smooth',
      smoothScrolling: true,
      bracketPairColorization: { enabled: true },
    });

    editorRef.current = editor;
    registerMonacoEditor(filePath, editor);

    // Apply saved highlight theme
    const hlTheme = getActiveHighlightTheme();
    if (hlTheme !== 'monokai') {
      buildMonacoThemeData(hlTheme).then(data => {
        monaco.editor.defineTheme('sai-dark', {
          base: data.base,
          inherit: true,
          rules: data.rules,
          colors: data.colors,
        });
        monaco.editor.setTheme('sai-dark');
      });
    }

    editor.onDidChangeModelContent(() => {
      setDirty(true);
      onDirtyChange?.(true);
      scheduleDecorationUpdate();
    });

    editor.onDidChangeCursorPosition(e => {
      setCursorPosition({ line: e.position.lineNumber, column: e.position.column });
    });

    editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS, () => {
      handleSave();
    });

    if (initialLine) {
      editor.revealLineInCenter(initialLine);
      editor.setPosition({ lineNumber: initialLine, column: 1 });
      onLineRevealed?.();
    }

    editor.focus();
    fetchHeadContent();

    return () => {
      if (onContentChangeRef.current) {
        onContentChangeRef.current(filePath, editor.getValue());
      }
      unregisterMonacoEditor(filePath, editor);
      editor.dispose();
    };
  }, []);

  // Jump to line when initialLine changes (e.g. clicking a second file reference)
  useEffect(() => {
    if (initialLine && editorRef.current) {
      editorRef.current.revealLineInCenter(initialLine);
      editorRef.current.setPosition({ lineNumber: initialLine, column: 1 });
      editorRef.current.focus();
      onLineRevealed?.();
    }
  }, [initialLine]);

  // Listen for highlight theme changes and apply to Monaco
  useEffect(() => {
    const handler = (e: Event) => {
      const data = (e as CustomEvent).detail;
      monaco.editor.defineTheme('sai-dark', {
        base: data.base,
        inherit: true,
        rules: data.rules,
        colors: data.colors,
      });
      monaco.editor.setTheme('sai-dark');
    };
    window.addEventListener('sai-monaco-theme', handler);
    return () => window.removeEventListener('sai-monaco-theme', handler);
  }, []);

  // Apply font/minimap changes live without remounting
  useEffect(() => {
    editorRef.current?.updateOptions({ fontSize, minimap: { enabled: minimap } });
  }, [fontSize, minimap]);

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
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <span>Ln {cursorPosition.line}, Col {cursorPosition.column}</span>
          <span>UTF-8</span>
          {language === 'markdown' && onTogglePreview && (
            <button
              className="md-editor-preview-btn"
              onClick={onTogglePreview}
              title="Preview markdown (Ctrl+Shift+M)"
              aria-label="Preview"
            >
              Preview
            </button>
          )}
        </div>
      </div>

      <style>{`
        .monaco-statusbar {
          display: flex;
          align-items: center;
          justify-content: space-between;
          padding: 4px 16px;
          border-top: 1px solid var(--border);
          font-family: 'Geist Mono', 'JetBrains Mono', monospace;
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
        .md-editor-preview-btn {
          background: none;
          border: 1px solid var(--border);
          border-radius: 3px;
          color: var(--text-muted);
          font-size: 11px;
          padding: 1px 8px;
          cursor: pointer;
          font-family: 'Geist Mono', 'JetBrains Mono', monospace;
        }
        .md-editor-preview-btn:hover {
          background: var(--bg-hover);
          color: var(--text);
        }
        .git-gutter-added {
          width: 3px !important;
          margin-left: 2px;
          background: #2ea043;
        }
        .git-gutter-modified {
          width: 3px !important;
          margin-left: 2px;
          background: #1b81e5;
        }
        .git-gutter-deleted {
          width: 0 !important;
          height: 0 !important;
          margin-left: 2px;
          border-top: 4px solid transparent;
          border-bottom: 4px solid transparent;
          border-left: 4px solid #f85149;
          position: relative;
          top: 50%;
          transform: translateY(-50%);
        }
      `}</style>
    </div>
  );
}
