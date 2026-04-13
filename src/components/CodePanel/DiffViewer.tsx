import { useState, useEffect, useRef } from 'react';
import * as monaco from 'monaco-editor';
import { getActiveHighlightTheme, buildMonacoThemeData } from '../../themes';
import { detectLanguage } from '../FileExplorer/MonacoEditor';

interface DiffViewerProps {
  projectPath: string;
  filePath: string;
  staged: boolean;
  mode: 'unified' | 'split';
  minimap?: boolean;
}

export default function DiffViewer({ projectPath, filePath, staged, mode, minimap = true }: DiffViewerProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const editorRef = useRef<monaco.editor.IStandaloneDiffEditor | null>(null);
  const originalModelRef = useRef<monaco.editor.ITextModel | null>(null);
  const modifiedModelRef = useRef<monaco.editor.ITextModel | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [content, setContent] = useState<{ original: string; modified: string; language: string } | null>(null);

  // Phase 1: Fetch content
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    setContent(null);

    const language = detectLanguage(filePath);

    async function load() {
      try {
        const originalContent = await window.sai.gitShow(projectPath, filePath, 'HEAD');
        if (cancelled) return;

        let modifiedContent: string;
        if (staged) {
          modifiedContent = await window.sai.gitShow(projectPath, filePath, ':');
        } else {
          const fullPath = projectPath.endsWith('/')
            ? projectPath + filePath
            : projectPath + '/' + filePath;
          modifiedContent = await window.sai.fsReadFile(fullPath);
        }
        if (cancelled) return;

        setContent({ original: originalContent, modified: modifiedContent, language });
        setLoading(false);
      } catch (err: unknown) {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : 'Failed to load diff');
        setLoading(false);
      }
    }

    load();

    return () => { cancelled = true; };
  }, [projectPath, filePath, staged]);

  // Phase 2: Create diff editor once content is available and container is mounted
  useEffect(() => {
    if (!content || !containerRef.current) return;

    // Dispose previous editor and models
    editorRef.current?.dispose();
    originalModelRef.current?.dispose();
    modifiedModelRef.current?.dispose();

    const originalModel = monaco.editor.createModel(content.original, content.language);
    const modifiedModel = monaco.editor.createModel(content.modified, content.language);
    originalModelRef.current = originalModel;
    modifiedModelRef.current = modifiedModel;

    const diffEditor = monaco.editor.createDiffEditor(containerRef.current, {
      theme: 'sai-dark',
      fontFamily: "'JetBrains Mono', 'Fira Code', 'Cascadia Code', monospace",
      fontSize: 12,
      lineHeight: 20,
      minimap: { enabled: minimap },
      renderSideBySide: mode === 'split',
      readOnly: true,
      originalEditable: false,
      scrollBeyondLastLine: false,
      automaticLayout: true,
      renderOverviewRuler: true,
    });

    diffEditor.setModel({ original: originalModel, modified: modifiedModel });
    editorRef.current = diffEditor;

    return () => {
      editorRef.current?.dispose();
      originalModelRef.current?.dispose();
      modifiedModelRef.current?.dispose();
      editorRef.current = null;
      originalModelRef.current = null;
      modifiedModelRef.current = null;
    };
  }, [content]);

  // Update side-by-side mode without remounting
  useEffect(() => {
    editorRef.current?.updateOptions({ renderSideBySide: mode === 'split' });
  }, [mode]);

  // Update minimap setting without remounting
  useEffect(() => {
    editorRef.current?.updateOptions({ minimap: { enabled: minimap } });
  }, [minimap]);

  // Listen for theme changes
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

  // Apply saved highlight theme on mount
  useEffect(() => {
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
  }, []);

  return (
    <>
      {loading && (
        <div style={{
          flex: 1,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          color: 'var(--text-muted)',
          fontSize: 13,
        }}>
          Loading diff...
        </div>
      )}
      {!loading && error && (
        <div style={{
          flex: 1,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          color: 'var(--red)',
          fontSize: 13,
        }}>
          {error}
        </div>
      )}
      <div
        ref={containerRef}
        style={{ flex: 1, overflow: 'hidden', display: loading || error ? 'none' : 'block' }}
      />
    </>
  );
}
