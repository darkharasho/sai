import { useState, useEffect, useRef } from 'react';
import { FileEdit, Terminal, FileText, Wrench, ChevronRight, ChevronDown, Maximize2, X, Circle } from 'lucide-react';
import type { ToolCall } from '../../types';

// Lazy-load shiki for syntax highlighting
let highlighterPromise: Promise<any> | null = null;
function getHighlighter() {
  if (!highlighterPromise) {
    highlighterPromise = import('shiki').then(({ createHighlighter }) =>
      createHighlighter({
        themes: ['monokai'],
        langs: ['json', 'typescript', 'javascript', 'bash', 'python', 'html', 'css', 'markdown', 'yaml', 'toml', 'rust', 'go', 'diff'],
      })
    );
  }
  return highlighterPromise;
}

function detectLang(toolCall: ToolCall): string {
  if (toolCall.type === 'terminal_command') return 'bash';
  const name = toolCall.name.toLowerCase();
  if (name.includes('.ts') || name.includes('typescript')) return 'typescript';
  if (name.includes('.js')) return 'javascript';
  if (name.includes('.py')) return 'python';
  if (name.includes('.json')) return 'json';
  if (name.includes('.css')) return 'css';
  if (name.includes('.html')) return 'html';
  if (name.includes('.md')) return 'markdown';
  if (name.includes('.yaml') || name.includes('.yml')) return 'yaml';
  if (name.includes('.rs')) return 'rust';
  if (name.includes('.go')) return 'go';
  const input = toolCall.input || '';
  if (input.trim().startsWith('{') || input.trim().startsWith('[')) return 'json';
  if (input.includes('function ') || input.includes('const ') || input.includes('import ')) return 'typescript';
  return 'text';
}

function HighlightedCode({ code, lang, showLineNumbers }: { code: string; lang: string; showLineNumbers?: boolean }) {
  const ref = useRef<HTMLDivElement>(null);
  const [html, setHtml] = useState<string>('');

  useEffect(() => {
    if (!code || lang === 'text') return;
    getHighlighter().then(highlighter => {
      try {
        const result = highlighter.codeToHtml(code, { lang, theme: 'monokai' });
        setHtml(result);
      } catch {
        // Language not loaded
      }
    });
  }, [code, lang]);

  if (showLineNumbers) {
    const lines = code.split('\n');
    const gutterWidth = String(lines.length).length;
    if (html) {
      // Extract inner content from shiki's <pre><code>...</code></pre>
      const codeMatch = html.match(/<code[^>]*>([\s\S]*)<\/code>/);
      const inner = codeMatch ? codeMatch[1] : '';
      // Shiki wraps each line in a <span class="line">
      const lineSpans = inner.split(/<span class="line">/);
      const lineHtmls = lineSpans.slice(1).map(s => {
        const end = s.lastIndexOf('</span>');
        return end >= 0 ? s.substring(0, end) : s;
      });
      return (
        <div ref={ref} className="editor-code">
          <div className="editor-gutter">
            {lines.map((_, i) => (
              <div key={i} className="editor-line-number" style={{ width: `${gutterWidth}ch` }}>{i + 1}</div>
            ))}
          </div>
          <pre className="editor-lines">
            <code>
              {lineHtmls.map((lineHtml, i) => (
                <div key={i} className="editor-line" dangerouslySetInnerHTML={{ __html: lineHtml || '&nbsp;' }} />
              ))}
            </code>
          </pre>
        </div>
      );
    }
    return (
      <div ref={ref} className="editor-code">
        <div className="editor-gutter">
          {lines.map((_, i) => (
            <div key={i} className="editor-line-number" style={{ width: `${gutterWidth}ch` }}>{i + 1}</div>
          ))}
        </div>
        <pre className="editor-lines"><code>{lines.map((line, i) => (
          <div key={i} className="editor-line">{line || '\n'}</div>
        ))}</code></pre>
      </div>
    );
  }

  if (html) {
    return <div ref={ref} className="highlighted-code" dangerouslySetInnerHTML={{ __html: html }} />;
  }
  return <pre className="plain-code"><code>{code}</code></pre>;
}

function formatInput(toolCall: ToolCall): { label: string; code: string; langOverride?: string } {
  const input = toolCall.input || '';
  try {
    const parsed = JSON.parse(input);

    // Bash — show command
    if (parsed.command) return { label: 'Command', code: parsed.command };

    // Write — show file path + content
    if (parsed.file_path && parsed.content) return { label: parsed.file_path, code: parsed.content };

    // Edit — show diff
    if (parsed.file_path && parsed.old_string != null) {
      const oldLines = (parsed.old_string || '').split('\n').map((l: string) => `- ${l}`).join('\n');
      const newLines = (parsed.new_string || '').split('\n').map((l: string) => `+ ${l}`).join('\n');
      return { label: parsed.file_path, code: `${oldLines}\n${newLines}`, langOverride: 'diff' };
    }

    // Read / Glob with file_path — label only, no body needed
    if (parsed.file_path) return { label: parsed.file_path, code: '' };

    // Grep / Glob — show pattern + optional path/glob filter
    if (parsed.pattern) {
      const parts: string[] = [`pattern: ${parsed.pattern}`];
      if (parsed.path) parts.push(`path: ${parsed.path}`);
      if (parsed.glob) parts.push(`glob: ${parsed.glob}`);
      if (parsed.type) parts.push(`type: ${parsed.type}`);
      const isGlob = toolCall.name?.toLowerCase().includes('glob');
      return { label: isGlob ? `glob: ${parsed.pattern}` : `grep: ${parsed.pattern}`, code: parts.length > 1 ? parts.join('\n') : '' };
    }

    // WebFetch / WebSearch
    if (parsed.url) return { label: parsed.url, code: '' };
    if (parsed.query) return { label: parsed.query, code: '' };

    // Fallback — format as key: value pairs instead of raw JSON
    const lines = Object.entries(parsed).map(([k, v]) => {
      if (typeof v === 'string') return `${k}: ${v}`;
      if (typeof v === 'number' || typeof v === 'boolean') return `${k}: ${v}`;
      return `${k}: ${JSON.stringify(v)}`;
    });
    return { label: '', code: lines.join('\n') };
  } catch {
    return { label: '', code: input };
  }
}

function truncateCode(code: string, maxLines: number): { truncated: string; isTruncated: boolean } {
  const lines = code.split('\n');
  if (lines.length <= maxLines) return { truncated: code, isTruncated: false };
  return { truncated: lines.slice(0, maxLines).join('\n'), isTruncated: true };
}

const iconMap = {
  file_edit: FileEdit,
  terminal_command: Terminal,
  file_read: FileText,
  other: Wrench,
} as const;

const MAX_PREVIEW_LINES = 20;

// Fullscreen modal
function FullscreenModal({ code, lang, label, onClose }: { code: string; lang: string; label: string; onClose: () => void }) {
  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [onClose]);

  const lineCount = code.split('\n').length;

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-content" onClick={e => e.stopPropagation()}>
        <div className="modal-header">
          <div className="modal-header-left">
            <span className="modal-title">{label || 'Output'}</span>
            <span className="modal-meta">{lang !== 'text' ? lang : ''}</span>
          </div>
          <div className="modal-header-right">
            <span className="modal-meta">{lineCount} lines</span>
            <button className="modal-close" onClick={onClose}><X size={18} /></button>
          </div>
        </div>
        <div className="modal-body">
          <HighlightedCode code={code} lang={lang} showLineNumbers />
        </div>
      </div>
      <style>{`
        .modal-overlay {
          position: fixed;
          inset: 0;
          background: rgba(0,0,0,0.7);
          display: flex;
          align-items: center;
          justify-content: center;
          z-index: 1000;
          backdrop-filter: blur(2px);
        }
        .modal-content {
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
        .modal-header {
          display: flex;
          align-items: center;
          justify-content: space-between;
          padding: 8px 16px;
          border-bottom: 1px solid var(--border);
          flex-shrink: 0;
          background: var(--bg-secondary);
        }
        .modal-header-left, .modal-header-right {
          display: flex;
          align-items: center;
          gap: 12px;
        }
        .modal-title {
          font-family: 'JetBrains Mono', monospace;
          font-size: 13px;
          color: var(--text);
        }
        .modal-meta {
          font-family: 'JetBrains Mono', monospace;
          font-size: 11px;
          color: var(--text-muted);
        }
        .modal-close {
          background: none;
          border: none;
          color: var(--text-muted);
          cursor: pointer;
          padding: 4px;
          border-radius: 4px;
          display: flex;
        }
        .modal-close:hover {
          color: var(--text);
          background: var(--bg-hover);
        }
        .modal-body {
          flex: 1;
          overflow: auto;
          font-size: 13px;
          background: var(--bg-primary);
        }
        .modal-body .highlighted-code pre,
        .modal-body .highlighted-code pre code,
        .modal-body .shiki {
          background: transparent !important;
          background-color: transparent !important;
        }
        .editor-code {
          display: flex;
          min-height: 100%;
          font-family: 'JetBrains Mono', monospace;
          font-size: 13px;
          line-height: 20px;
        }
        .editor-gutter {
          padding: 16px 0;
          background: var(--bg-secondary);
          border-right: 1px solid var(--border);
          text-align: right;
          user-select: none;
          flex-shrink: 0;
          position: sticky;
          left: 0;
        }
        .editor-line-number {
          padding: 0 12px 0 16px;
          color: var(--text-muted);
          font-size: 12px;
          height: 20px;
        }
        .editor-lines {
          flex: 1;
          margin: 0;
          padding: 16px 16px;
          background: transparent !important;
          border-radius: 0;
          overflow: visible;
          font-size: 13px;
          line-height: 20px;
          color: var(--text);
        }
        .editor-lines code {
          font-size: inherit;
          background: none;
          padding: 0;
        }
        .editor-line {
          height: 20px;
          white-space: pre;
        }
        .editor-line:hover {
          background: var(--bg-hover);
        }
      `}</style>
    </div>
  );
}

interface Todo {
  id: string;
  content: string;
  status: 'pending' | 'in_progress' | 'completed';
  priority?: string;
}

function TodoListView({ input }: { input: string }) {
  let todos: Todo[] = [];
  try {
    const parsed = JSON.parse(input);
    todos = Array.isArray(parsed.todos) ? parsed.todos : [];
  } catch { /* ignore */ }

  if (!todos.length) return null;

  return (
    <div className="tool-call-body todo-list-body">
      {todos.map((todo, i) => (
        <div key={todo.id || i} className={`todo-item todo-${todo.status}`}>
          <span className="todo-icon">
            {todo.status === 'completed' ? '✓' : todo.status === 'in_progress' ? '✦' : '○'}
          </span>
          <span className="todo-content">{todo.content}</span>
        </div>
      ))}
    </div>
  );
}

function BashInOut({ output, onFullscreen }: {
  output?: string;
  onFullscreen: (code: string, lang: string, label: string) => void;
}) {
  if (!output) return null;
  const outputLines = output.split('\n').filter(l => l.trim());
  const MAX_OUT = 8;
  const truncatedLines = outputLines.slice(0, MAX_OUT);
  const isTruncated = outputLines.length > MAX_OUT;

  return (
    <div className="tool-call-body bash-inout-body">
      <div className="bash-io-row bash-out-row">
        <span className="bash-io-label bash-out-label">OUT</span>
        <div className="bash-out-lines">
          {truncatedLines.map((line, i) => (
            <div key={i} className="bash-out-line">
              <span className="bash-out-bullet">•</span>
              <span>{line}</span>
            </div>
          ))}
          {isTruncated && (
            <button className="tool-call-show-more bash-show-more" onClick={() => onFullscreen(output, 'bash', 'Output')}>
              Show all ({outputLines.length} lines)
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

export default function ToolCallCard({ toolCall }: { toolCall: ToolCall }) {
  const [expanded, setExpanded] = useState(true); // Start expanded
  const [fullscreenCode, setFullscreenCode] = useState<{ code: string; lang: string; label: string } | null>(null);
  const Icon = iconMap[toolCall.type] || Wrench;
  const { label, code, langOverride } = formatInput(toolCall);
  const lang = langOverride || detectLang(toolCall);
  const { truncated, isTruncated } = truncateCode(code, MAX_PREVIEW_LINES);

  const isBash = toolCall.type === 'terminal_command';
  const isTodo = toolCall.name === 'TodoWrite';

  const hasBody = isBash ? !!toolCall.output : isTodo ? true : !!code;

  return (
    <>
      <div className="tool-call-card">
        <div className={`tool-call-header${hasBody ? ' tool-call-header-expandable' : ''}`} onClick={() => hasBody && setExpanded(!expanded)}>
          <Circle size={8} fill="var(--text-muted)" stroke="var(--text-muted)" className="tool-call-dot" />
          <Icon size={14} className="tool-call-icon" />
          <span className="tool-call-name">{toolCall.name}</span>
          {!isBash && !isTodo && label && <span className="tool-call-label">{label}</span>}
          {isBash && code && <span className="tool-call-label">{code}</span>}
          {!isBash && !isTodo && code && (
            <button
              className="tool-call-fullscreen"
              onClick={(e) => { e.stopPropagation(); setFullscreenCode({ code, lang, label: label || toolCall.name }); }}
              title="View full"
            >
              <Maximize2 size={12} />
            </button>
          )}
          {hasBody && (expanded ? <ChevronDown size={14} className="tool-call-chevron" /> : <ChevronRight size={14} className="tool-call-chevron" />)}
        </div>
        {expanded && hasBody && (
          <>
            {isBash && (
              <BashInOut
                output={toolCall.output}
                onFullscreen={(c, l, lb) => setFullscreenCode({ code: c, lang: l, label: lb })}
              />
            )}
            {isTodo && <TodoListView input={toolCall.input || ''} />}
            {!isBash && !isTodo && code && (
              <div className="tool-call-body">
                <HighlightedCode code={truncated} lang={lang} />
                {isTruncated && (
                  <button
                    className="tool-call-show-more"
                    onClick={() => setFullscreenCode({ code, lang, label: label || toolCall.name })}
                  >
                    Show all ({code.split('\n').length} lines)
                  </button>
                )}
                {toolCall.output && (
                  <div className="tool-call-output">
                    <div className="tool-call-output-header">
                      <span className="tool-call-output-label">Output</span>
                      <button
                        className="tool-call-fullscreen"
                        onClick={() => setFullscreenCode({ code: toolCall.output!, lang: 'text', label: 'Output' })}
                        title="View full output"
                      >
                        <Maximize2 size={12} />
                      </button>
                    </div>
                    <HighlightedCode code={truncateCode(toolCall.output, MAX_PREVIEW_LINES).truncated} lang="text" />
                    {truncateCode(toolCall.output, MAX_PREVIEW_LINES).isTruncated && (
                      <button
                        className="tool-call-show-more"
                        onClick={() => setFullscreenCode({ code: toolCall.output!, lang: 'text', label: 'Output' })}
                      >
                        Show all ({toolCall.output.split('\n').length} lines)
                      </button>
                    )}
                  </div>
                )}
              </div>
            )}
          </>
        )}
        <style>{`
          .tool-call-card {
            margin: 8px 0;
            background: var(--bg-secondary);
            border: 1px solid var(--border);
            border-radius: 6px;
            overflow: hidden;
          }
          .tool-call-dot {
            flex-shrink: 0;
          }
          .tool-call-header {
            padding: 8px 12px;
            display: flex;
            align-items: center;
            gap: 8px;
            font-size: 12px;
            color: var(--text-secondary);
          }
          .tool-call-header-expandable {
            cursor: pointer;
          }
          .tool-call-header-expandable:hover {
            background: var(--bg-hover);
          }
          .tool-call-icon {
            color: var(--accent);
            flex-shrink: 0;
          }
          .tool-call-name {
            font-family: 'JetBrains Mono', monospace;
            font-size: 12px;
            color: var(--text);
          }
          .tool-call-label {
            flex: 1;
            font-family: 'JetBrains Mono', monospace;
            font-size: 11px;
            color: var(--text-muted);
            overflow: hidden;
            text-overflow: ellipsis;
            white-space: nowrap;
          }
          .tool-call-fullscreen {
            background: none;
            border: none;
            color: var(--text-muted);
            cursor: pointer;
            padding: 2px;
            border-radius: 3px;
            display: flex;
            flex-shrink: 0;
          }
          .tool-call-fullscreen:hover {
            color: var(--text);
            background: var(--bg-hover);
          }
          .tool-call-chevron {
            color: var(--text-muted);
            flex-shrink: 0;
          }
          .tool-call-body {
            border-top: 1px solid var(--border);
          }
          .tool-call-body .highlighted-code {
            font-size: 12px;
          }
          .tool-call-body .highlighted-code pre {
            margin: 0;
            padding: 10px 12px;
            background: transparent !important;
            border-radius: 0;
          }
          .tool-call-body .plain-code {
            margin: 0;
            padding: 10px 12px;
            font-size: 12px;
            background: transparent;
            border-radius: 0;
          }
          .tool-call-body .highlighted-code .line:has(.shiki-diff-add),
          .editor-line:has(.shiki-diff-add) {
            background: rgba(166, 226, 46, 0.1);
          }
          .tool-call-body .highlighted-code .line:has(.shiki-diff-delete),
          .editor-line:has(.shiki-diff-delete) {
            background: rgba(249, 38, 114, 0.1);
          }
          .tool-call-show-more {
            display: block;
            width: 100%;
            padding: 6px 12px;
            background: none;
            border: none;
            border-top: 1px solid var(--border);
            color: var(--accent);
            font-size: 11px;
            cursor: pointer;
            text-align: center;
          }
          .tool-call-show-more:hover {
            background: var(--bg-hover);
          }
          .tool-call-output {
            border-top: 1px dashed var(--border);
          }
          .tool-call-output-header {
            display: flex;
            align-items: center;
            justify-content: space-between;
            padding: 6px 12px 0;
          }
          .tool-call-output-label {
            font-size: 10px;
            text-transform: uppercase;
            color: var(--text-muted);
            letter-spacing: 0.5px;
          }
          /* Bash IN/OUT */
          .bash-inout-body {
            border-top: 1px solid var(--border);
            padding: 8px 0;
            display: flex;
            flex-direction: column;
            gap: 4px;
          }
          .bash-io-row {
            display: flex;
            align-items: flex-start;
            gap: 10px;
            padding: 2px 12px;
          }
          .bash-out-row {
            align-items: flex-start;
          }
          .bash-io-label {
            font-family: 'JetBrains Mono', monospace;
            font-size: 10px;
            font-weight: 600;
            letter-spacing: 0.5px;
            flex-shrink: 0;
            padding-top: 1px;
            min-width: 24px;
          }
          .bash-in-label {
            color: var(--accent);
          }
          .bash-out-label {
            color: var(--text-muted);
          }
          .bash-io-command {
            font-family: 'JetBrains Mono', monospace;
            font-size: 12px;
            color: var(--text);
            white-space: pre-wrap;
            word-break: break-all;
          }
          .bash-out-lines {
            display: flex;
            flex-direction: column;
            gap: 2px;
            flex: 1;
          }
          .bash-out-line {
            display: flex;
            align-items: baseline;
            gap: 6px;
            font-family: 'JetBrains Mono', monospace;
            font-size: 11px;
            color: var(--text-secondary);
          }
          .bash-out-bullet {
            color: var(--text-muted);
            flex-shrink: 0;
          }
          .bash-show-more {
            margin-top: 4px;
            border-top: none !important;
            text-align: left;
            padding: 2px 0;
          }
          /* Todo list */
          .todo-list-body {
            border-top: 1px solid var(--border);
            padding: 6px 0;
            display: flex;
            flex-direction: column;
          }
          .todo-item {
            display: flex;
            align-items: baseline;
            gap: 8px;
            padding: 3px 12px;
            font-family: 'JetBrains Mono', monospace;
            font-size: 12px;
          }
          .todo-icon {
            flex-shrink: 0;
            font-size: 11px;
            width: 14px;
            text-align: center;
          }
          .todo-completed .todo-icon { color: var(--accent); }
          .todo-completed .todo-content {
            color: var(--text-muted);
            text-decoration: line-through;
          }
          .todo-in_progress .todo-icon { color: var(--orange, #e6b84f); }
          .todo-in_progress .todo-content { color: var(--text); }
          .todo-pending .todo-icon { color: var(--text-muted); }
          .todo-pending .todo-content { color: var(--text-secondary); }
        `}</style>
      </div>
      {fullscreenCode && (
        <FullscreenModal
          code={fullscreenCode.code}
          lang={fullscreenCode.lang}
          label={fullscreenCode.label}
          onClose={() => setFullscreenCode(null)}
        />
      )}
    </>
  );
}
