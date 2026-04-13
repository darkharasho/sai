import { useState, useEffect, useRef } from 'react';
import { FileEdit, Terminal, FileText, Wrench, ChevronRight, ChevronDown, Circle, Globe, AlertCircle } from 'lucide-react';
import type { ToolCall } from '../../types';
import { getShikiHighlighter, getActiveHighlightTheme } from '../../themes';

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
  const isDiff = lang === 'diff';
  const ref = useRef<HTMLDivElement>(null);
  const [html, setHtml] = useState<string>('');
  const [hlTheme, setHlTheme] = useState(getActiveHighlightTheme());

  useEffect(() => {
    const handler = () => setHlTheme(getActiveHighlightTheme());
    window.addEventListener('sai-highlight-theme-change', handler);
    return () => window.removeEventListener('sai-highlight-theme-change', handler);
  }, []);

  useEffect(() => {
    if (!code || lang === 'text') return;
    getShikiHighlighter().then(highlighter => {
      try {
        const result = highlighter.codeToHtml(code, { lang, theme: hlTheme });
        setHtml(result);
      } catch {
        // Language not loaded
      }
    });
  }, [code, lang, hlTheme]);

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
    return <div ref={ref} className={`highlighted-code${isDiff ? ' lang-diff' : ''}`} dangerouslySetInnerHTML={{ __html: html }} />;
  }
  return <pre className="plain-code"><code>{code}</code></pre>;
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

function DiffHighlightedCode({ oldString, newString, lang }: { oldString: string; newString: string; lang: string }) {
  const [lines, setLines] = useState<{ html: string; type: 'del' | 'add' }[]>([]);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    if (lang === 'text') {
      const result: { html: string; type: 'del' | 'add' }[] = [];
      for (const l of oldString.split('\n')) result.push({ html: escapeHtml(l), type: 'del' });
      for (const l of newString.split('\n')) result.push({ html: escapeHtml(l), type: 'add' });
      setLines(result);
      setReady(true);
      return;
    }
    getShikiHighlighter().then(highlighter => {
      try {
        const oldHtml = highlighter.codeToHtml(oldString, { lang, theme: 'monokai' });
        const newHtml = highlighter.codeToHtml(newString, { lang, theme: 'monokai' });
        const oldLines = extractLineHtmls(oldHtml);
        const newLines = extractLineHtmls(newHtml);
        const result: { html: string; type: 'del' | 'add' }[] = [];
        for (const l of oldLines) result.push({ html: l, type: 'del' });
        for (const l of newLines) result.push({ html: l, type: 'add' });
        setLines(result);
      } catch {
        // fallback
        const result: { html: string; type: 'del' | 'add' }[] = [];
        for (const l of oldString.split('\n')) result.push({ html: escapeHtml(l), type: 'del' });
        for (const l of newString.split('\n')) result.push({ html: escapeHtml(l), type: 'add' });
        setLines(result);
      }
      setReady(true);
    });
  }, [oldString, newString, lang]);

  if (!ready && lines.length === 0) return null;

  return (
    <pre className="diff-highlighted">
      <code>
        {lines.map((line, i) => (
          <div key={i} className={`diff-line diff-${line.type}`}>
            <span className="diff-marker">{line.type === 'add' ? '+' : '-'}</span>
            <span dangerouslySetInnerHTML={{ __html: line.html || '&nbsp;' }} />
          </div>
        ))}
      </code>
    </pre>
  );
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
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

interface FormatResult {
  label: string;
  code: string;
  langOverride?: string;
  diff?: { oldString: string; newString: string; fileLang: string };
}

function formatInput(toolCall: ToolCall): FormatResult {
  const input = toolCall.input || '';
  try {
    const parsed = JSON.parse(input);

    // Bash — show command
    if (parsed.command) return { label: 'Command', code: parsed.command };

    // Write — show file path + content
    if (parsed.file_path && parsed.content) return { label: parsed.file_path, code: parsed.content };

    // Edit — show diff with structured data for syntax-highlighted rendering
    if (parsed.file_path && parsed.old_string != null) {
      const oldLines = (parsed.old_string || '').split('\n').map((l: string) => `- ${l}`).join('\n');
      const newLines = (parsed.new_string || '').split('\n').map((l: string) => `+ ${l}`).join('\n');
      return {
        label: parsed.file_path,
        code: `${oldLines}\n${newLines}`,
        langOverride: 'diff',
        diff: {
          oldString: parsed.old_string || '',
          newString: parsed.new_string || '',
          fileLang: langFromPath(parsed.file_path),
        },
      };
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
  web_fetch: Globe,
  other: Wrench,
} as const;

const MAX_PREVIEW_LINES = 20;

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

/** Detect and strip <tool_error>, <error>, or tool_use_error wrapper tags from output */
function parseToolError(output: string): { isToolError: boolean; message: string } {
  const stripped = output.trim();
  const tagMatch = stripped.match(/^<(?:tool_use_error|tool_error|error)>([\s\S]*?)<\/(?:tool_use_error|tool_error|error)>$/);
  if (tagMatch) return { isToolError: true, message: tagMatch[1].trim() };
  if (/tool_use_error/i.test(stripped)) {
    return { isToolError: true, message: stripped.replace(/tool_use_error[:\s]*/i, '').trim() || stripped };
  }
  return { isToolError: false, message: output };
}

function ToolErrorDisplay({ message }: { message: string }) {
  return (
    <div className="tool-error-display">
      <AlertCircle size={13} />
      <span>{message}</span>
    </div>
  );
}

function BashInOut({ output, showAll, onToggleShowAll }: {
  output?: string;
  showAll: boolean;
  onToggleShowAll: () => void;
}) {
  if (!output) return null;
  const parsed = parseToolError(output);

  if (parsed.isToolError) {
    return (
      <div className="tool-call-body bash-inout-body">
        <div className="bash-io-row bash-out-row">
          <span className="bash-io-label bash-out-label">OUT</span>
          <div className="bash-out-lines">
            <ToolErrorDisplay message={parsed.message} />
          </div>
        </div>
      </div>
    );
  }

  const outputLines = output.split('\n').filter(l => l.trim());
  const MAX_OUT = 8;
  const isTruncated = outputLines.length > MAX_OUT;
  const visibleLines = showAll ? outputLines : outputLines.slice(0, MAX_OUT);

  return (
    <div className="tool-call-body bash-inout-body">
      <div className="bash-io-row bash-out-row">
        <span className="bash-io-label bash-out-label">OUT</span>
        <div className="bash-out-lines">
          {visibleLines.map((line, i) => (
            <div key={i} className="bash-out-line">
              <span className="bash-out-bullet">•</span>
              <span>{line}</span>
            </div>
          ))}
          {isTruncated && (
            <button className="tool-call-show-more bash-show-more" onClick={onToggleShowAll}>
              {showAll ? 'Show less' : `Show all (${outputLines.length} lines)`}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

export default function ToolCallCard({ toolCall, defaultExpanded = true }: { toolCall: ToolCall; defaultExpanded?: boolean }) {
  const [expanded, setExpanded] = useState(defaultExpanded);
  const [showAllCode, setShowAllCode] = useState(false);
  const [showAllOutput, setShowAllOutput] = useState(false);
  const Icon = iconMap[toolCall.type] || Wrench;
  const { label, code, langOverride, diff } = formatInput(toolCall);
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
          {hasBody && (expanded ? <ChevronDown size={14} className="tool-call-chevron" /> : <ChevronRight size={14} className="tool-call-chevron" />)}
        </div>
        {expanded && hasBody && (
          <>
            {isBash && (
              <BashInOut
                output={toolCall.output}
                showAll={showAllOutput}
                onToggleShowAll={() => setShowAllOutput(prev => !prev)}
              />
            )}
            {isTodo && <TodoListView input={toolCall.input || ''} />}
            {!isBash && !isTodo && code && (
              <div className="tool-call-body">
                {diff ? (
                  <DiffHighlightedCode oldString={diff.oldString} newString={diff.newString} lang={diff.fileLang} />
                ) : (
                  <HighlightedCode code={showAllCode ? code : truncated} lang={lang} />
                )}
                {isTruncated && (
                  <button
                    className="tool-call-show-more"
                    onClick={() => setShowAllCode(prev => !prev)}
                  >
                    {showAllCode ? 'Show less' : `Show all (${code.split('\n').length} lines)`}
                  </button>
                )}
                {toolCall.output && (() => {
                  const parsedOutput = parseToolError(toolCall.output);
                  if (parsedOutput.isToolError) {
                    return (
                      <div className="tool-call-output">
                        <ToolErrorDisplay message={parsedOutput.message} />
                      </div>
                    );
                  }
                  const outputTruncation = truncateCode(toolCall.output, MAX_PREVIEW_LINES);
                  return (
                    <div className="tool-call-output">
                      <div className="tool-call-output-header">
                        <span className="tool-call-output-label">Output</span>
                      </div>
                      <HighlightedCode code={showAllOutput ? toolCall.output : outputTruncation.truncated} lang="text" />
                      {outputTruncation.isTruncated && (
                        <button
                          className="tool-call-show-more"
                          onClick={() => setShowAllOutput(prev => !prev)}
                        >
                          {showAllOutput ? 'Show less' : `Show all (${toolCall.output.split('\n').length} lines)`}
                        </button>
                      )}
                    </div>
                  );
                })()}
              </div>
            )}
          </>
        )}
        <style>{`
          .tool-call-card {
            margin: 2px 0;
            background: var(--bg-secondary);
            border: 1px solid var(--border);
            border-radius: 8px;
            overflow: hidden;
            box-shadow: inset 0 1px 3px rgba(0, 0, 0, 0.2);
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
            font-family: 'Geist Mono', 'JetBrains Mono', monospace;
            font-size: 12px;
            color: var(--text);
          }
          .tool-call-label {
            flex: 1;
            font-family: 'Geist Mono', 'JetBrains Mono', monospace;
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
          .diff-highlighted {
            margin: 0;
            padding: 10px 0;
            background: transparent !important;
            border-radius: 0;
            font-size: 12px;
            line-height: 20px;
          }
          .diff-highlighted code {
            font-size: inherit;
            background: none;
            padding: 0;
          }
          .diff-line {
            display: flex;
            padding: 0 12px;
            white-space: pre;
          }
          .diff-line.diff-add {
            background: rgba(72, 100, 40, 0.35);
          }
          .diff-line.diff-del {
            background: rgba(180, 60, 40, 0.25);
          }
          .diff-marker {
            flex-shrink: 0;
            width: 1.5ch;
            color: var(--text-muted);
            user-select: none;
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
          .tool-error-display {
            display: flex;
            align-items: flex-start;
            gap: 6px;
            color: var(--red, #f85149);
            font-family: 'Geist Mono', 'JetBrains Mono', monospace;
            font-size: 12px;
            line-height: 1.5;
            padding: 6px 12px;
            white-space: pre-wrap;
            word-break: break-word;
          }
          .tool-error-display svg {
            flex-shrink: 0;
            margin-top: 2px;
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
            font-family: 'Geist Mono', 'JetBrains Mono', monospace;
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
            font-family: 'Geist Mono', 'JetBrains Mono', monospace;
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
            font-family: 'Geist Mono', 'JetBrains Mono', monospace;
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
            font-family: 'Geist Mono', 'JetBrains Mono', monospace;
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
    </>
  );
}
