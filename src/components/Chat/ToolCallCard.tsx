import { useState, useEffect, useRef } from 'react';
import { FileEdit, Terminal, FileText, Wrench, ChevronRight, ChevronDown, Maximize2, X } from 'lucide-react';
import type { ToolCall } from '../../types';

// Lazy-load shiki for syntax highlighting
let highlighterPromise: Promise<any> | null = null;
function getHighlighter() {
  if (!highlighterPromise) {
    highlighterPromise = import('shiki').then(({ createHighlighter }) =>
      createHighlighter({
        themes: ['github-dark'],
        langs: ['json', 'typescript', 'javascript', 'bash', 'python', 'html', 'css', 'markdown', 'yaml', 'toml', 'rust', 'go'],
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

function HighlightedCode({ code, lang }: { code: string; lang: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const [html, setHtml] = useState<string>('');

  useEffect(() => {
    if (!code || lang === 'text') return;
    getHighlighter().then(highlighter => {
      try {
        const result = highlighter.codeToHtml(code, { lang, theme: 'github-dark' });
        setHtml(result);
      } catch {
        // Language not loaded
      }
    });
  }, [code, lang]);

  if (html) {
    return <div ref={ref} className="highlighted-code" dangerouslySetInnerHTML={{ __html: html }} />;
  }
  return <pre className="plain-code"><code>{code}</code></pre>;
}

function formatInput(toolCall: ToolCall): { label: string; code: string } {
  const input = toolCall.input || '';
  try {
    const parsed = JSON.parse(input);
    if (parsed.command) return { label: 'Command', code: parsed.command };
    if (parsed.file_path && parsed.content) return { label: parsed.file_path, code: parsed.content };
    if (parsed.file_path && parsed.old_string) return { label: parsed.file_path, code: `- ${parsed.old_string}\n+ ${parsed.new_string}` };
    if (parsed.file_path) return { label: parsed.file_path, code: input };
    if (parsed.pattern) return { label: `grep: ${parsed.pattern}`, code: input };
    return { label: '', code: JSON.stringify(parsed, null, 2) };
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

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-content" onClick={e => e.stopPropagation()}>
        <div className="modal-header">
          <span className="modal-title">{label || 'Output'}</span>
          <button className="modal-close" onClick={onClose}><X size={18} /></button>
        </div>
        <div className="modal-body">
          <HighlightedCode code={code} lang={lang} />
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
          padding: 12px 16px;
          border-bottom: 1px solid var(--border);
          flex-shrink: 0;
        }
        .modal-title {
          font-family: 'JetBrains Mono', monospace;
          font-size: 13px;
          color: var(--text);
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
        }
        .modal-body .highlighted-code pre,
        .modal-body .plain-code {
          margin: 0;
          padding: 16px;
          background: transparent !important;
          border-radius: 0;
          font-size: 13px;
        }
      `}</style>
    </div>
  );
}

export default function ToolCallCard({ toolCall }: { toolCall: ToolCall }) {
  const [expanded, setExpanded] = useState(true); // Start expanded
  const [fullscreenCode, setFullscreenCode] = useState<{ code: string; lang: string; label: string } | null>(null);
  const Icon = iconMap[toolCall.type] || Wrench;
  const lang = detectLang(toolCall);
  const { label, code } = formatInput(toolCall);
  const { truncated, isTruncated } = truncateCode(code, MAX_PREVIEW_LINES);

  return (
    <>
      <div className="tool-call-card">
        <div className="tool-call-header" onClick={() => setExpanded(!expanded)}>
          <Icon size={14} className="tool-call-icon" />
          <span className="tool-call-name">{toolCall.name}</span>
          {label && <span className="tool-call-label">{label}</span>}
          {code && (
            <button
              className="tool-call-fullscreen"
              onClick={(e) => { e.stopPropagation(); setFullscreenCode({ code, lang, label: label || toolCall.name }); }}
              title="View full"
            >
              <Maximize2 size={12} />
            </button>
          )}
          {expanded ? <ChevronDown size={14} className="tool-call-chevron" /> : <ChevronRight size={14} className="tool-call-chevron" />}
        </div>
        {expanded && code && (
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
        <style>{`
          .tool-call-card {
            margin: 8px 0;
            background: var(--bg-secondary);
            border: 1px solid var(--border);
            border-radius: 6px;
            overflow: hidden;
          }
          .tool-call-header {
            padding: 8px 12px;
            display: flex;
            align-items: center;
            gap: 8px;
            font-size: 12px;
            color: var(--text-secondary);
            cursor: pointer;
          }
          .tool-call-header:hover {
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
