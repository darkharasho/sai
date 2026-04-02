import { useState, useEffect } from 'react';
import { html as diff2html } from 'diff2html';
import 'diff2html/bundles/css/diff2html.min.css';

interface DiffViewerProps {
  projectPath: string;
  filePath: string;
  staged: boolean;
  mode: 'unified' | 'split';
}

export default function DiffViewer({ projectPath, filePath, staged, mode }: DiffViewerProps) {
  const [diffHtml, setDiffHtml] = useState<string>('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);

    window.sai.gitDiff(projectPath, filePath, staged)
      .then((raw: string) => {
        if (cancelled) return;
        if (!raw || !raw.trim()) {
          setDiffHtml('<div class="diff-empty">No changes</div>');
        } else {
          const html = diff2html(raw, {
            drawFileList: false,
            outputFormat: mode === 'split' ? 'side-by-side' : 'line-by-line',
            matching: 'lines',
          });
          setDiffHtml(html);
        }
        setLoading(false);
      })
      .catch((err: Error) => {
        if (cancelled) return;
        setError(err.message || 'Failed to load diff');
        setLoading(false);
      });

    return () => { cancelled = true; };
  }, [projectPath, filePath, staged, mode]);

  if (loading) {
    return (
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
    );
  }

  if (error) {
    return (
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
    );
  }

  return (
    <>
      <div
        className={`diff-container diff-mode-${mode}`}
        style={{ flex: 1, overflow: 'auto' }}
        dangerouslySetInnerHTML={{ __html: diffHtml }}
      />
      <style>{`
        /* Override diff2html for dark theme */
        .d2h-wrapper {
          background: var(--bg-primary);
          color: var(--text);
          font-family: 'JetBrains Mono', 'Fira Code', monospace;
          font-size: 12px;
        }
        .d2h-file-wrapper {
          border: none;
          margin: 0;
          border-radius: 0;
        }
        .d2h-file-header {
          display: none;
        }
        .d2h-diff-table {
          font-family: 'JetBrains Mono', 'Fira Code', monospace;
          font-size: 12px;
          width: 100%;
        }

        /* Line numbers – base */
        .d2h-code-linenumber,
        .d2h-code-side-linenumber {
          background: var(--bg-secondary) !important;
          color: var(--text-muted) !important;
          border-right: 1px solid var(--border);
          min-width: 50px;
          width: 50px;
          padding: 0 10px;
          text-align: right;
          position: static;
        }

        /* Context (unchanged) lines */
        .d2h-code-line {
          background: var(--bg-primary);
          color: var(--text);
        }
        .d2h-code-side-line {
          background: var(--bg-primary);
          color: var(--text);
        }

        /* Deletion rows */
        .d2h-del {
          background: rgba(227, 85, 53, 0.12);
          border-color: transparent;
        }
        .d2h-del .d2h-code-linenumber,
        .d2h-del .d2h-code-side-linenumber {
          background: rgba(227, 85, 53, 0.18) !important;
          color: #e07060 !important;
        }
        .d2h-del .d2h-code-line-ctn {
          color: #f0a8a0;
          background: transparent;
        }
        .d2h-del .d2h-code-side-line {
          background: rgba(227, 85, 53, 0.12);
        }
        .d2h-del .d2h-code-line-prefix {
          color: #e07060;
        }

        /* Insertion rows */
        .d2h-ins {
          background: rgba(0, 168, 132, 0.12);
          border-color: transparent;
        }
        .d2h-ins .d2h-code-linenumber,
        .d2h-ins .d2h-code-side-linenumber {
          background: rgba(0, 168, 132, 0.18) !important;
          color: #60c0a0 !important;
        }
        .d2h-ins .d2h-code-line-ctn {
          color: #a0e0c8;
          background: transparent;
        }
        .d2h-ins .d2h-code-side-line {
          background: rgba(0, 168, 132, 0.12);
        }
        .d2h-ins .d2h-code-line-prefix {
          color: #60c0a0;
        }

        /* Word-level inline changes */
        .d2h-del .d2h-change {
          background: rgba(227, 85, 53, 0.30);
          border-radius: 2px;
        }
        .d2h-ins .d2h-change {
          background: rgba(0, 168, 132, 0.30);
          border-radius: 2px;
        }

        /* Hunk headers */
        .d2h-info {
          background: rgba(17, 183, 212, 0.08);
          color: var(--blue);
          border-bottom: 1px solid var(--border);
        }

        /* Context line prefix (+, -, space) */
        .d2h-code-line-prefix {
          color: var(--text-muted);
        }

        .diff-mode-unified .d2h-code-line-ctn {
          white-space: pre-wrap;
          word-break: break-all;
        }
        .d2h-diff-tbody tr {
          border-color: var(--border);
        }
        .d2h-file-diff {
          overflow: visible;
        }
        .d2h-files-diff {
          display: flex;
          width: 100%;
        }
        .d2h-file-side-diff {
          width: 50%;
          flex-shrink: 0;
          overflow-x: auto;
        }
        .d2h-code-wrapper {
          overflow: visible;
        }
        .d2h-emptyplaceholder {
          background: var(--bg-secondary);
          border-color: var(--border);
        }
        .diff-empty {
          display: flex;
          align-items: center;
          justify-content: center;
          height: 100%;
          color: var(--text-muted);
          font-size: 13px;
          padding: 48px;
        }
      `}</style>
    </>
  );
}
