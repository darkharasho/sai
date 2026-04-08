import { useState, useEffect } from 'react';
import { getShikiHighlighter, getActiveHighlightTheme } from '../../themes';

interface DiffViewerProps {
  projectPath: string;
  filePath: string;
  staged: boolean;
  mode: 'unified' | 'split';
}

function langFromPath(filePath: string): string {
  const ext = filePath.split('.').pop()?.toLowerCase();
  const map: Record<string, string> = {
    ts: 'typescript', tsx: 'typescript', js: 'javascript', jsx: 'javascript',
    py: 'python', json: 'json', css: 'css', html: 'html', md: 'markdown',
    yaml: 'yaml', yml: 'yaml', toml: 'toml', rs: 'rust', go: 'go', sh: 'bash', bash: 'bash',
  };
  return (ext && map[ext]) || 'text';
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function extractLineHtmls(shikiHtml: string): string[] {
  const codeMatch = shikiHtml.match(/<code[^>]*>([\s\S]*)<\/code>/);
  const inner = codeMatch ? codeMatch[1] : '';
  const lineSpans = inner.split(/<span class="line">/);
  return lineSpans.slice(1).map(s => {
    const end = s.lastIndexOf('</span>');
    return end >= 0 ? s.substring(0, end) : s;
  });
}

interface DiffLine {
  type: 'context' | 'add' | 'del' | 'hunk' | 'header';
  content: string;
  oldNum?: number;
  newNum?: number;
  html?: string;
}

function parseDiff(raw: string): DiffLine[] {
  const lines = raw.split('\n');
  const result: DiffLine[] = [];
  let oldNum = 0;
  let newNum = 0;

  for (const line of lines) {
    if (line.startsWith('diff ') || line.startsWith('index ') || line.startsWith('---') || line.startsWith('+++')) {
      result.push({ type: 'header', content: line });
    } else if (line.startsWith('@@')) {
      const match = line.match(/@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/);
      if (match) {
        oldNum = parseInt(match[1], 10);
        newNum = parseInt(match[2], 10);
      }
      result.push({ type: 'hunk', content: line });
    } else if (line.startsWith('-')) {
      result.push({ type: 'del', content: line.slice(1), oldNum: oldNum++ });
    } else if (line.startsWith('+')) {
      result.push({ type: 'add', content: line.slice(1), newNum: newNum++ });
    } else if (line.startsWith(' ')) {
      result.push({ type: 'context', content: line.slice(1), oldNum: oldNum++, newNum: newNum++ });
    } else if (line === '') {
      // trailing newline, skip
    } else {
      result.push({ type: 'context', content: line, oldNum: oldNum++, newNum: newNum++ });
    }
  }
  return result;
}

async function highlightDiffLines(diffLines: DiffLine[], lang: string): Promise<DiffLine[]> {
  if (lang === 'text') {
    return diffLines.map(l => ({
      ...l,
      html: l.type === 'hunk' || l.type === 'header' ? escapeHtml(l.content) : escapeHtml(l.content),
    }));
  }

  const highlighter = await getShikiHighlighter();

  // Build old and new file content to highlight as coherent blocks
  const oldLines: { idx: number; content: string }[] = [];
  const newLines: { idx: number; content: string }[] = [];

  diffLines.forEach((l, i) => {
    if (l.type === 'context') {
      oldLines.push({ idx: i, content: l.content });
      newLines.push({ idx: i, content: l.content });
    } else if (l.type === 'del') {
      oldLines.push({ idx: i, content: l.content });
    } else if (l.type === 'add') {
      newLines.push({ idx: i, content: l.content });
    }
  });

  const result = diffLines.map(l => ({ ...l }));

  try {
    // Highlight old and new as blocks for proper syntax context
    const oldText = oldLines.map(l => l.content).join('\n');
    const newText = newLines.map(l => l.content).join('\n');

    const oldHtml = highlighter.codeToHtml(oldText, { lang, theme: getActiveHighlightTheme() });
    const newHtml = highlighter.codeToHtml(newText, { lang, theme: getActiveHighlightTheme() });

    const oldHighlighted = extractLineHtmls(oldHtml);
    const newHighlighted = extractLineHtmls(newHtml);

    // Map highlighted lines back
    oldLines.forEach((entry, i) => {
      if (oldHighlighted[i] !== undefined) {
        result[entry.idx].html = oldHighlighted[i];
      }
    });
    // For context lines, new highlight overwrites old — they should be identical anyway
    newLines.forEach((entry, i) => {
      if (newHighlighted[i] !== undefined) {
        result[entry.idx].html = newHighlighted[i];
      }
    });
  } catch {
    // Fallback to escaped HTML
    result.forEach(l => {
      if (!l.html && (l.type === 'context' || l.type === 'add' || l.type === 'del')) {
        l.html = escapeHtml(l.content);
      }
    });
  }

  // Ensure hunk/header lines have html
  result.forEach(l => {
    if (!l.html) l.html = escapeHtml(l.content);
  });

  return result;
}

export default function DiffViewer({ projectPath, filePath, staged, mode }: DiffViewerProps) {
  const [lines, setLines] = useState<DiffLine[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [hlTheme, setHlTheme] = useState(getActiveHighlightTheme());

  useEffect(() => {
    const handler = () => setHlTheme(getActiveHighlightTheme());
    window.addEventListener('sai-highlight-theme-change', handler);
    return () => window.removeEventListener('sai-highlight-theme-change', handler);
  }, []);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);

    const lang = langFromPath(filePath);

    window.sai.gitDiff(projectPath, filePath, staged)
      .then(async (raw: string) => {
        if (cancelled) return;
        if (!raw || !raw.trim()) {
          setLines([]);
          setLoading(false);
          return;
        }
        const parsed = parseDiff(raw);
        const highlighted = await highlightDiffLines(parsed, lang);
        if (cancelled) return;
        setLines(highlighted);
        setLoading(false);
      })
      .catch((err: Error) => {
        if (cancelled) return;
        setError(err.message || 'Failed to load diff');
        setLoading(false);
      });

    return () => { cancelled = true; };
  }, [projectPath, filePath, staged, mode, hlTheme]);

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

  if (lines.length === 0) {
    return (
      <div className="diff-empty">No changes</div>
    );
  }

  if (mode === 'split') {
    return <SplitView lines={lines} />;
  }

  return (
    <>
      <div className="diff-viewer" style={{ flex: 1, overflow: 'auto' }}>
        <pre className="diff-pre">
          <code>
            {lines.map((line, i) => {
              if (line.type === 'header') return null;
              if (line.type === 'hunk') {
                return (
                  <div key={i} className="diff-line diff-hunk">
                    <span className="diff-linenum diff-linenum-old"></span>
                    <span className="diff-linenum diff-linenum-new"></span>
                    <span className="diff-marker"> </span>
                    <span className="diff-content" dangerouslySetInnerHTML={{ __html: line.html || '' }} />
                  </div>
                );
              }
              const marker = line.type === 'add' ? '+' : line.type === 'del' ? '-' : ' ';
              return (
                <div key={i} className={`diff-line diff-${line.type}`}>
                  <span className="diff-linenum diff-linenum-old">{line.oldNum ?? ''}</span>
                  <span className="diff-linenum diff-linenum-new">{line.newNum ?? ''}</span>
                  <span className="diff-marker">{marker}</span>
                  <span className="diff-content" dangerouslySetInnerHTML={{ __html: line.html || '&nbsp;' }} />
                </div>
              );
            })}
          </code>
        </pre>
      </div>
      <DiffStyles />
    </>
  );
}

function SplitView({ lines }: { lines: DiffLine[] }) {
  // Build left (old) and right (new) paired rows
  const rows: { left: DiffLine | null; right: DiffLine | null }[] = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (line.type === 'header') { i++; continue; }
    if (line.type === 'hunk') {
      rows.push({ left: line, right: line });
      i++;
      continue;
    }
    if (line.type === 'context') {
      rows.push({ left: line, right: line });
      i++;
      continue;
    }
    // Collect consecutive del/add blocks
    const dels: DiffLine[] = [];
    const adds: DiffLine[] = [];
    while (i < lines.length && lines[i].type === 'del') { dels.push(lines[i]); i++; }
    while (i < lines.length && lines[i].type === 'add') { adds.push(lines[i]); i++; }
    const max = Math.max(dels.length, adds.length);
    for (let j = 0; j < max; j++) {
      rows.push({ left: dels[j] || null, right: adds[j] || null });
    }
  }

  return (
    <>
      <div className="diff-viewer diff-split" style={{ flex: 1, overflow: 'auto' }}>
        <pre className="diff-pre">
          <code>
            {rows.map((row, i) => {
              if (row.left?.type === 'hunk') {
                return (
                  <div key={i} className="diff-split-row">
                    <div className="diff-split-side diff-hunk">
                      <span className="diff-linenum"></span>
                      <span className="diff-marker"> </span>
                      <span className="diff-content" dangerouslySetInnerHTML={{ __html: row.left.html || '' }} />
                    </div>
                    <div className="diff-split-side diff-hunk">
                      <span className="diff-linenum"></span>
                      <span className="diff-marker"> </span>
                      <span className="diff-content" />
                    </div>
                  </div>
                );
              }
              return (
                <div key={i} className="diff-split-row">
                  <div className={`diff-split-side ${row.left ? `diff-${row.left.type}` : 'diff-empty-side'}`}>
                    <span className="diff-linenum">{row.left?.oldNum ?? row.left?.newNum ?? ''}</span>
                    <span className="diff-marker">{row.left ? (row.left.type === 'del' ? '-' : ' ') : ' '}</span>
                    <span className="diff-content" dangerouslySetInnerHTML={{ __html: row.left?.html || '&nbsp;' }} />
                  </div>
                  <div className={`diff-split-side ${row.right ? `diff-${row.right.type}` : 'diff-empty-side'}`}>
                    <span className="diff-linenum">{row.right?.newNum ?? ''}</span>
                    <span className="diff-marker">{row.right ? (row.right.type === 'add' ? '+' : ' ') : ' '}</span>
                    <span className="diff-content" dangerouslySetInnerHTML={{ __html: row.right?.html || '&nbsp;' }} />
                  </div>
                </div>
              );
            })}
          </code>
        </pre>
      </div>
      <DiffStyles />
    </>
  );
}

function DiffStyles() {
  return (
    <style>{`
      .diff-viewer {
        background: var(--bg-primary);
        font-family: 'Geist Mono', 'JetBrains Mono', 'Fira Code', monospace;
        font-size: 12px;
      }
      .diff-pre {
        margin: 0;
        padding: 0;
        background: transparent;
        font-size: inherit;
        line-height: 20px;
      }
      .diff-pre code {
        font-size: inherit;
        background: none;
        padding: 0;
      }

      /* Unified lines */
      .diff-line {
        display: flex;
        white-space: pre;
      }
      .diff-line.diff-add {
        background: rgba(72, 100, 40, 0.35);
      }
      .diff-line.diff-del {
        background: rgba(180, 60, 40, 0.25);
      }
      .diff-line.diff-context {
        background: transparent;
      }
      .diff-line.diff-hunk {
        background: rgba(17, 183, 212, 0.08);
        color: var(--blue);
      }

      /* Line numbers */
      .diff-linenum {
        flex-shrink: 0;
        width: 50px;
        min-width: 50px;
        padding: 0 8px;
        text-align: right;
        color: var(--text-muted);
        user-select: none;
        border-right: 1px solid var(--border);
        box-sizing: border-box;
      }
      .diff-line.diff-add .diff-linenum {
        background: rgba(72, 100, 40, 0.40);
      }
      .diff-line.diff-del .diff-linenum {
        background: rgba(180, 60, 40, 0.30);
      }
      .diff-line.diff-context .diff-linenum {
        background: var(--bg-secondary);
      }
      .diff-line.diff-hunk .diff-linenum {
        background: rgba(17, 183, 212, 0.08);
        border-right-color: transparent;
      }

      /* +/- marker */
      .diff-marker {
        flex-shrink: 0;
        width: 2ch;
        padding-left: 4px;
        color: var(--text-muted);
        user-select: none;
      }

      /* Content */
      .diff-content {
        flex: 1;
        min-width: 0;
        color: var(--text);
      }
      .diff-line.diff-hunk .diff-content {
        color: var(--blue);
      }

      /* Split view */
      .diff-split-row {
        display: flex;
      }
      .diff-split-side {
        display: flex;
        flex: 1;
        white-space: pre;
        min-width: 0;
        overflow: hidden;
      }
      .diff-split-side.diff-add {
        background: rgba(72, 100, 40, 0.35);
      }
      .diff-split-side.diff-del {
        background: rgba(180, 60, 40, 0.25);
      }
      .diff-split-side.diff-context {
        background: transparent;
      }
      .diff-split-side.diff-hunk {
        background: rgba(17, 183, 212, 0.08);
        color: var(--blue);
      }
      .diff-split-side.diff-empty-side {
        background: var(--bg-secondary);
      }
      .diff-split-side .diff-linenum {
        width: 40px;
        min-width: 40px;
      }
      .diff-split-side.diff-add .diff-linenum {
        background: rgba(72, 100, 40, 0.40);
      }
      .diff-split-side.diff-del .diff-linenum {
        background: rgba(180, 60, 40, 0.30);
      }
      .diff-split-side.diff-context .diff-linenum {
        background: var(--bg-secondary);
      }
      .diff-split-side.diff-hunk .diff-linenum {
        background: rgba(17, 183, 212, 0.08);
        border-right-color: transparent;
      }
      .diff-split-side.diff-empty-side .diff-linenum {
        background: var(--bg-secondary);
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
  );
}
