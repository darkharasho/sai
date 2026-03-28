import { useState, useEffect, useRef } from 'react';
import { FileEdit, Terminal, FileText, Wrench, ChevronRight, ChevronDown } from 'lucide-react';
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

const iconMap = {
  file_edit: FileEdit,
  terminal_command: Terminal,
  file_read: FileText,
  other: Wrench,
} as const;

export default function ToolCallCard({ toolCall }: { toolCall: ToolCall }) {
  const [expanded, setExpanded] = useState(false);
  const Icon = iconMap[toolCall.type] || Wrench;
  const lang = detectLang(toolCall);
  const { label, code } = formatInput(toolCall);

  return (
    <div className="tool-call-card">
      <div className="tool-call-header" onClick={() => setExpanded(!expanded)}>
        <Icon size={14} className="tool-call-icon" />
        <span className="tool-call-name">{toolCall.name}</span>
        {label && <span className="tool-call-label">{label}</span>}
        {expanded ? <ChevronDown size={14} className="tool-call-chevron" /> : <ChevronRight size={14} className="tool-call-chevron" />}
      </div>
      {expanded && code && (
        <div className="tool-call-body">
          <HighlightedCode code={code} lang={lang} />
          {toolCall.output && (
            <div className="tool-call-output">
              <div className="tool-call-output-label">Output</div>
              <HighlightedCode code={toolCall.output} lang="text" />
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
        .tool-call-chevron {
          color: var(--text-muted);
          flex-shrink: 0;
        }
        .tool-call-body {
          border-top: 1px solid var(--border);
          max-height: 400px;
          overflow: auto;
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
        .tool-call-output {
          border-top: 1px dashed var(--border);
        }
        .tool-call-output-label {
          padding: 6px 12px 0;
          font-size: 10px;
          text-transform: uppercase;
          color: var(--text-muted);
          letter-spacing: 0.5px;
        }
      `}</style>
    </div>
  );
}
