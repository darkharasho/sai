import { useState, useEffect, useRef } from 'react';
import {
  Terminal, FileText, Wrench, ChevronRight, Globe, AlertCircle,
  FilePen, FilePlus, SearchCode, FolderSearch, ListTodo, Bot,
  ClipboardList, ClipboardCheck, Zap, Send, GitBranch, GitMerge,
  Activity, AlarmClock, Timer, TimerOff, SquareTerminal, CircleStop,
  Radio, MessageCircleQuestion, NotebookPen, Plug,
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import type { ToolCall, MetaWorkspaceRuntime } from '../../types';
import { SPRING, useReducedMotionTransition } from './motion';
import { getShikiHighlighter, getActiveHighlightTheme } from '../../themes';
import { DOT_MASK_URL } from '../../lib/assets';
import { owningLink } from '../../lib/syntheticRoot';
import PlanReviewCard from './PlanReviewCard';

function parseMcpName(name: string): { server: string; tool: string } | null {
  if (!name.startsWith('mcp__')) return null;
  const rest = name.slice(5);
  const idx = rest.indexOf('__');
  if (idx < 0) return null;
  let server = rest.slice(0, idx);
  const tool = rest.slice(idx + 2);
  if (server.startsWith('plugin_')) server = server.slice(7);
  const parts = server.split('_');
  return { server: parts[parts.length - 1], tool };
}

/** Humanize snake_case tool names (e.g. MCP tools) into title case.
 *  PascalCase built-in names (Read, Edit, WebFetch) pass through unchanged. */
function humanizeToolName(name: string): string {
  if (!name.includes('_')) return name;
  return name
    .split('_')
    .filter(Boolean)
    .map(w => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
    .join(' ');
}

function formatMs(ms: number): string {
  const totalSec = Math.floor(ms / 1000);
  const m = Math.floor(totalSec / 60);
  const s = totalSec % 60;
  const d = Math.floor((ms % 1000) / 100);
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}.${d}`;
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

// Exact tool name → icon (primary resolution for all messages including persisted)
const nameToIcon: Record<string, typeof Wrench> = {
  // File operations
  Read: FileText,
  Edit: FilePen,
  Write: FilePlus,
  // Search
  Grep: SearchCode,
  Glob: FolderSearch,
  ToolSearch: SearchCode,
  // Terminal
  Bash: Terminal,
  // Web
  WebFetch: Globe,
  WebSearch: Globe,
  // Planning & tasks
  EnterPlanMode: ClipboardList,
  ExitPlanMode: ClipboardCheck,
  TodoWrite: ListTodo,
  // Agent & orchestration
  Agent: Bot,
  Skill: Zap,
  SendUserMessage: Send,
  // Worktree
  EnterWorktree: GitBranch,
  ExitWorktree: GitMerge,
  // Scheduling & monitoring
  Monitor: Activity,
  ScheduleWakeup: AlarmClock,
  CronCreate: Timer,
  CronDelete: TimerOff,
  CronList: Timer,
  // Background tasks
  TaskOutput: SquareTerminal,
  TaskStop: CircleStop,
  RemoteTrigger: Radio,
  // Interactive
  AskUserQuestion: MessageCircleQuestion,
  // Notebook
  NotebookEdit: NotebookPen,
};

// Type-based fallback for tools that only have a stale type (no name match)
const iconByType: Record<string, typeof Wrench> = {
  file_edit: FilePen,
  terminal_command: Terminal,
  file_read: FileText,
  file_search: SearchCode,
  web_fetch: Globe,
  todo: ListTodo,
  agent: Bot,
  notebook: NotebookPen,
  question: MessageCircleQuestion,
  plan: ClipboardList,
  worktree: GitBranch,
  skill: Zap,
  schedule: Timer,
  task: SquareTerminal,
  mcp: Plug,
  other: Wrench,
};

/** Resolve icon from tool name first, then type, then fallback. */
function resolveIcon(name: string, type: string): typeof Wrench {
  // Exact name match (covers all known Claude CLI tools)
  if (nameToIcon[name]) return nameToIcon[name];
  // MCP tools (mcp__serverName__toolName)
  if (name.startsWith('mcp__')) return Plug;
  // Fuzzy name fallbacks for unexpected variants
  if (name.includes('Edit') || name.includes('Write')) return FilePen;
  if (name.includes('Bash')) return Terminal;
  if (name.includes('Grep') || name.includes('Search')) return SearchCode;
  if (name.includes('Glob')) return FolderSearch;
  if (name.includes('Read')) return FileText;
  if (name.includes('Notebook')) return NotebookPen;
  if (name.includes('Cron')) return Timer;
  // Type-based fallback
  return iconByType[type] || Wrench;
}

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

interface AskQuestionOption {
  label: string;
  description?: string;
}

interface AskQuestion {
  question: string;
  header?: string;
  multiSelect?: boolean;
  options: AskQuestionOption[];
}

interface AskQuestionInput {
  questions: AskQuestion[];
  answers?: Record<string, string | string[]>;
}

function parseAskQuestionInput(input: string): AskQuestionInput | null {
  try {
    const parsed = JSON.parse(input);
    if (!Array.isArray(parsed.questions)) return null;
    return parsed as AskQuestionInput;
  } catch { return null; }
}

const OTHER_OPTION = '__other__';

function AskUserQuestionView({
  toolUseId,
  input,
  onAnswerQuestion,
}: {
  toolUseId?: string;
  input: string;
  onAnswerQuestion?: (toolUseId: string, answers: Record<string, string | string[]>) => Promise<void> | void;
}) {
  const parsed = parseAskQuestionInput(input);
  const recordedAnswers = parsed?.answers || {};
  const isAnswered = Object.keys(recordedAnswers).length > 0;

  // picks holds option-label selections; otherText holds the freeform "Other" text per question.
  const [picks, setPicks] = useState<Record<string, string | string[]>>({});
  const [otherText, setOtherText] = useState<Record<string, string>>({});
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!parsed) {
    return (
      <div className="tool-call-body askq-body">
        <div className="askq-empty">Could not parse questions.</div>
      </div>
    );
  }

  const togglePick = (q: AskQuestion, optionLabel: string) => {
    if (isAnswered || submitting) return;
    setPicks(prev => {
      const next = { ...prev };
      if (q.multiSelect) {
        const arr = Array.isArray(next[q.question]) ? [...(next[q.question] as string[])] : [];
        const i = arr.indexOf(optionLabel);
        if (i >= 0) arr.splice(i, 1); else arr.push(optionLabel);
        next[q.question] = arr;
      } else {
        next[q.question] = optionLabel;
      }
      return next;
    });
  };

  const isSelected = (q: AskQuestion, optionLabel: string): boolean => {
    if (isAnswered) {
      // For recorded answers, an "Other" selection looks like a plain string that
      // doesn't match any of the original option labels.
      const v = recordedAnswers[q.question];
      if (optionLabel === OTHER_OPTION) {
        const known = new Set(q.options.map(o => o.label));
        if (q.multiSelect) return Array.isArray(v) && v.some(x => !known.has(x));
        return typeof v === 'string' && !known.has(v);
      }
      if (q.multiSelect) return Array.isArray(v) && v.includes(optionLabel);
      return v === optionLabel;
    }
    const v = picks[q.question];
    if (q.multiSelect) return Array.isArray(v) && v.includes(optionLabel);
    return v === optionLabel;
  };

  const recordedOtherText = (q: AskQuestion): string => {
    const v = recordedAnswers[q.question];
    const known = new Set(q.options.map(o => o.label));
    if (q.multiSelect && Array.isArray(v)) return v.filter(x => !known.has(x)).join(', ');
    if (typeof v === 'string' && !known.has(v)) return v;
    return '';
  };

  const canSubmit = !isAnswered && !submitting && parsed.questions.every(q => {
    const v = picks[q.question];
    const text = otherText[q.question]?.trim() || '';
    if (q.multiSelect) {
      const arr = Array.isArray(v) ? v : [];
      if (arr.includes(OTHER_OPTION) && !text) return false;
      return arr.length > 0;
    }
    if (v === OTHER_OPTION) return text.length > 0;
    return typeof v === 'string' && v.length > 0;
  });

  const submit = async () => {
    if (!canSubmit || !toolUseId || !onAnswerQuestion) return;
    // Resolve picks → final answers: replace OTHER_OPTION sentinel with the typed text.
    const resolved: Record<string, string | string[]> = {};
    for (const q of parsed.questions) {
      const v = picks[q.question];
      const text = otherText[q.question]?.trim() || '';
      if (q.multiSelect) {
        const arr = Array.isArray(v) ? v.slice() : [];
        const idx = arr.indexOf(OTHER_OPTION);
        if (idx >= 0) arr.splice(idx, 1, text);
        resolved[q.question] = arr;
      } else {
        resolved[q.question] = v === OTHER_OPTION ? text : (v as string);
      }
    }
    setSubmitting(true);
    setError(null);
    try {
      await onAnswerQuestion(toolUseId, resolved);
    } catch (e: any) {
      setError(e?.message || 'Failed to submit answers');
      setSubmitting(false);
    }
  };

  return (
    <div className="tool-call-body askq-body">
      {parsed.questions.map((q, qi) => {
        const otherSelected = isSelected(q, OTHER_OPTION);
        const otherTextValue = isAnswered ? recordedOtherText(q) : (otherText[q.question] || '');
        return (
          <div key={qi} className="askq-question">
            {q.header && <div className="askq-header">{q.header}</div>}
            <div className="askq-prompt">{q.question}</div>
            <div className="askq-options">
              {q.options.map((opt, oi) => {
                const selected = isSelected(q, opt.label);
                return (
                  <button
                    key={oi}
                    type="button"
                    className={`askq-option${selected ? ' askq-option-selected' : ''}${isAnswered ? ' askq-option-locked' : ''}`}
                    onClick={() => togglePick(q, opt.label)}
                    disabled={isAnswered || submitting}
                  >
                    <span className={`askq-radio${q.multiSelect ? ' askq-radio-check' : ''}${selected ? ' askq-radio-on' : ''}`} aria-hidden />
                    <span className="askq-option-text">
                      <span className="askq-option-label">{opt.label}</span>
                      {opt.description && <span className="askq-option-desc">{opt.description}</span>}
                    </span>
                  </button>
                );
              })}
              <button
                type="button"
                className={`askq-option${otherSelected ? ' askq-option-selected' : ''}${isAnswered ? ' askq-option-locked' : ''}`}
                onClick={() => togglePick(q, OTHER_OPTION)}
                disabled={isAnswered || submitting}
              >
                <span className={`askq-radio${q.multiSelect ? ' askq-radio-check' : ''}${otherSelected ? ' askq-radio-on' : ''}`} aria-hidden />
                <span className="askq-option-text">
                  <span className="askq-option-label">Other</span>
                  <span className="askq-option-desc">Type your own response</span>
                </span>
              </button>
              {otherSelected && (
                <input
                  type="text"
                  className="askq-other-input"
                  placeholder="Type your response…"
                  value={otherTextValue}
                  onChange={e => setOtherText(prev => ({ ...prev, [q.question]: e.target.value }))}
                  disabled={isAnswered || submitting}
                  autoFocus
                  onKeyDown={e => { if (e.key === 'Enter' && canSubmit) submit(); }}
                />
              )}
            </div>
          </div>
        );
      })}
      {!isAnswered && (
        <div className="askq-actions">
          <button
            type="button"
            className="askq-submit"
            onClick={submit}
            disabled={!canSubmit}
          >
            {submitting ? 'Sending…' : 'Submit answers'}
          </button>
          {error && <span className="askq-error">{error}</span>}
        </div>
      )}
      {isAnswered && <div className="askq-answered">Answered</div>}
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

function extractToolPath(toolCall: ToolCall): string | null {
  try {
    const input = JSON.parse(toolCall.input || '{}');
    if (typeof input.file_path === 'string') return input.file_path;
    if (typeof input.path === 'string') return input.path;
    if (typeof input.notebook_path === 'string') return input.notebook_path;
    if (typeof input.command === 'string') {
      const m = input.command.match(/^\s*cd\s+(?:"([^"]+)"|'([^']+)'|([^\s;&|]+))/);
      if (m) return m[1] || m[2] || m[3];
    }
  } catch {}
  return null;
}

function toolProjectLinkName(toolCall: ToolCall, runtime: MetaWorkspaceRuntime | null | undefined): string | null {
  if (!runtime) return null;
  const p = extractToolPath(toolCall);
  if (!p) return null;
  const isAbs = /^([a-zA-Z]:[\\/]|[\\/])/.test(p);
  if (isAbs) return owningLink(p, runtime.syntheticRoot);
  const seg = p.replace(/^[\\/]+/, '').split(/[\\/]/)[0];
  return runtime.projects.some(pp => pp.linkName === seg) ? seg : null;
}

export default function ToolCallCard({ toolCall, defaultExpanded = true, metaRuntime, onAnswerQuestion, onAnswerPlanReview }: { toolCall: ToolCall; defaultExpanded?: boolean; metaRuntime?: MetaWorkspaceRuntime | null; onAnswerQuestion?: (toolUseId: string, answers: Record<string, string | string[]>) => Promise<void> | void; onAnswerPlanReview?: (toolUseId: string, approved: boolean) => Promise<void> | void }) {
  // --- ExitPlanMode: render a dedicated plan review card instead of the generic tool card ---
  const isExitPlanMode = toolCall.name === 'ExitPlanMode';
  if (isExitPlanMode) {
    let plan = '';
    let planFilePath = '';
    let resolved: 'approved' | 'rejected' | undefined;
    try {
      const input = JSON.parse(toolCall.input || '{}');
      plan = input.plan || '';
      planFilePath = input.planFilePath || '';
      // If there's output, the review has been resolved
      if (toolCall.output) {
        const lower = (toolCall.output || '').toLowerCase();
        resolved = lower.includes('rejected') || lower.includes('reject') ? 'rejected' : 'approved';
      }
    } catch { /* ignore parse errors */ }
    return (
      <PlanReviewCard
        plan={plan}
        planFilePath={planFilePath}
        toolUseId={toolCall.id}
        resolved={resolved}
        onApprove={(id) => onAnswerPlanReview?.(id, true)}
        onReject={(id) => onAnswerPlanReview?.(id, false)}
      />
    );
  }

  const [expanded, setExpanded] = useState(defaultExpanded);
  const [showAllCode, setShowAllCode] = useState(false);
  const [showAllOutput, setShowAllOutput] = useState(false);
  const Icon = resolveIcon(toolCall.name, toolCall.type);
  const { label, code, langOverride, diff } = formatInput(toolCall);
  const lang = langOverride || detectLang(toolCall);
  const { truncated, isTruncated } = truncateCode(code, MAX_PREVIEW_LINES);
  const entryTransition = useReducedMotionTransition(SPRING.pop);
  const badgeTransition = useReducedMotionTransition(SPRING.flick);
  const chevronTransition = useReducedMotionTransition(SPRING.flick);
  const expandTransition = useReducedMotionTransition({ height: { duration: 0.26, ease: [0.22, 1, 0.36, 1] as const }, opacity: { duration: 0.18 } });

  const isBash = toolCall.type === 'terminal_command';
  const isTodo = toolCall.name === 'TodoWrite';
  const isAskUserQuestion = toolCall.name === 'AskUserQuestion';
  const askAnswered = isAskUserQuestion && (() => {
    try { return Object.keys(JSON.parse(toolCall.input || '{}').answers || {}).length > 0; } catch { return false; }
  })();

  const status: 'running' | 'done' | 'error' =
    isAskUserQuestion ? (askAnswered ? 'done' : 'running') :
    toolCall.output && parseToolError(toolCall.output).isToolError ? 'error' :
    toolCall.output ? 'done' : 'running';

  const hasBody = isAskUserQuestion ? true : isBash ? !!toolCall.output : isTodo ? true : !!code;

  const sigClass =
    (toolCall.name.includes('Edit') || toolCall.name === 'Write' || toolCall.type === 'file_edit') ? 'tool-sig-wipe' :
    (toolCall.name.includes('Bash') || toolCall.type === 'terminal_command') ? 'tool-sig-typed' :
    (toolCall.name.includes('Read') || toolCall.name.includes('Glob') || toolCall.name.includes('Grep') ||
     toolCall.type === 'file_read' || toolCall.type === 'file_search') ? 'tool-sig-scan' :
    'tool-sig-shimmer';

  return (
    <>
      <motion.div
        data-testid="tool-card"
        data-entry-transition={JSON.stringify(entryTransition)}
        data-entry-y={String(10)}
        layout
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={entryTransition}
        variants={{ hidden: { opacity: 0, y: 10 }, visible: { opacity: 1, y: 0 } }}
        className="tool-call-card"
      >
        <div className={`tool-call-header${hasBody ? ' tool-call-header-expandable' : ''}`} onClick={() => hasBody && setExpanded(!expanded)}>
          <AnimatePresence mode="popLayout" initial={false}>
            <motion.span
              key={status}
              data-testid="tool-status-badge"
              data-status-transition={JSON.stringify(badgeTransition)}
              initial={{ opacity: 0, scale: 0.8 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.8 }}
              transition={badgeTransition}
              className={`tool-status tool-status-${status}`}
            >
              {status === 'running' && <span className="tool-status-pulse" aria-hidden />}
              {status === 'done' && <span className="tool-status-dot tool-status-dot-done" aria-hidden />}
              {status === 'error' && <AlertCircle size={12} />}
            </motion.span>
          </AnimatePresence>
          <Icon size={14} className="tool-call-icon" />
          {(() => {
            const mcp = parseMcpName(toolCall.name);
            if (mcp) {
              return (
                <>
                  <span className={`tool-call-name${sigClass ? ` ${sigClass}` : ''}`}>{humanizeToolName(mcp.tool)}</span>
                  <span className="tool-call-mcp-chip" title={`MCP server: ${mcp.server}`}>{mcp.server}</span>
                </>
              );
            }
            return <span className={`tool-call-name${sigClass ? ` ${sigClass}` : ''}`}>{humanizeToolName(toolCall.name)}</span>;
          })()}
          {(() => {
            const linkName = toolProjectLinkName(toolCall, metaRuntime);
            if (!linkName) return null;
            return (
              <span className="tool-call-project-chip" title={`Project: ${linkName}`}>{linkName}</span>
            );
          })()}
          {!isBash && !isTodo && !isAskUserQuestion && label && <span className="tool-call-label">{label}</span>}
          {isAskUserQuestion && <span className="tool-call-label">{askAnswered ? 'Answered' : 'Waiting for answer…'}</span>}
          {isBash && code && <span className="tool-call-label">{code}</span>}
          {typeof toolCall.durationMs === 'number' && (
            <span className="tool-call-duration" data-testid="tool-call-duration">
              [{formatMs(toolCall.durationMs)}]
            </span>
          )}
          {hasBody && (
            <motion.span
              className="tool-call-chevron-wrap"
              animate={{ rotate: expanded ? 90 : 0 }}
              transition={chevronTransition}
            >
              <ChevronRight size={14} className="tool-call-chevron" />
            </motion.span>
          )}
        </div>
        <AnimatePresence initial={false}>
          {expanded && hasBody && (
            <motion.div
              key="tool-call-expand"
              className="tool-call-expand"
              initial={{ height: 0, opacity: 0 }}
              animate={{ height: 'auto', opacity: 1 }}
              exit={{ height: 0, opacity: 0 }}
              transition={expandTransition}
              style={{ overflow: 'hidden' }}
            >
            {isBash && (
              <BashInOut
                output={toolCall.output}
                showAll={showAllOutput}
                onToggleShowAll={() => setShowAllOutput(prev => !prev)}
              />
            )}
            {isTodo && <TodoListView input={toolCall.input || ''} />}
            {isAskUserQuestion && (
              <AskUserQuestionView
                toolUseId={toolCall.id}
                input={toolCall.input || ''}
                onAnswerQuestion={onAnswerQuestion}
              />
            )}
            {!isBash && !isTodo && !isAskUserQuestion && code && (
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
            </motion.div>
          )}
        </AnimatePresence>
        <style>{`
          .tool-call-chevron-wrap {
            display: inline-flex;
            align-items: center;
            justify-content: center;
          }
          .tool-call-card {
            margin: 2px 0;
            background: var(--elev-2);
            border: 1px solid var(--border);
            border-radius: 8px;
            overflow: hidden;
            box-shadow: var(--shadow-card), var(--elev-highlight);
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
          .tool-call-project-chip {
            font-size: 9px;
            padding: 2px 7px;
            border-radius: 4px;
            background: color-mix(in srgb, var(--accent) 18%, transparent);
            color: var(--accent);
            border: 1px solid color-mix(in srgb, var(--accent) 55%, transparent);
            font-weight: 600;
            letter-spacing: 0.3px;
            text-transform: uppercase;
            flex-shrink: 0;
          }
          .tool-call-mcp-chip {
            font-size: 9px;
            padding: 2px 7px;
            border-radius: 4px;
            background: color-mix(in srgb, var(--text-muted) 15%, transparent);
            color: var(--text-secondary);
            border: 1px solid color-mix(in srgb, var(--text-muted) 35%, transparent);
            font-weight: 600;
            letter-spacing: 0.3px;
            text-transform: uppercase;
            flex-shrink: 0;
          }
          .tool-call-duration {
            font-family: 'Geist Mono', 'JetBrains Mono', monospace;
            font-variant-numeric: tabular-nums;
            font-size: 11px;
            color: var(--text-tertiary, #6b6253);
            letter-spacing: 0.04em;
            margin-left: auto;
            padding-left: 8px;
            flex-shrink: 0;
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
          /* Status badge */
          .tool-status {
            display: inline-flex;
            align-items: center;
            justify-content: center;
            flex-shrink: 0;
          }
          .tool-status-running { color: var(--accent); }
          .tool-status-done { color: var(--green); }
          .tool-status-error { color: var(--red, #f85149); }
          .tool-status-dot,
          .tool-status-pulse {
            display: inline-block;
            width: 9px;
            height: 9px;
            background: currentColor;
            -webkit-mask: url("${DOT_MASK_URL}") center / contain no-repeat;
            mask: url("${DOT_MASK_URL}") center / contain no-repeat;
          }
          .tool-status-pulse { background: var(--accent); }
          .tool-status-dot-done { background: var(--green); }
          @media (prefers-reduced-motion: no-preference) {
            @keyframes tool-status-hum {
              0%, 100% { background: color-mix(in srgb, var(--accent) 40%, var(--bg-secondary)); }
              50%      { background: color-mix(in srgb, var(--accent) 100%, transparent); }
            }
            .tool-status-pulse {
              animation: tool-status-hum 2.4s cubic-bezier(0.45, 0, 0.55, 1) infinite;
            }
          }
          /* Per-type tool-card entry signatures */
          @media (prefers-reduced-motion: no-preference) {
            @keyframes tool-sig-wipe {
              from { clip-path: inset(0 100% 0 0); }
              to   { clip-path: inset(0 0 0 0); }
            }
            .tool-sig-wipe {
              animation: tool-sig-wipe 550ms cubic-bezier(0.22, 1, 0.36, 1) 1;
              animation-fill-mode: both;
            }

            @keyframes tool-sig-typed {
              from { max-width: 0; }
              to   { max-width: 100%; }
            }
            .tool-sig-typed {
              display: inline-block;
              overflow: hidden;
              white-space: nowrap;
              animation: tool-sig-typed 600ms steps(20, end) 1;
              animation-fill-mode: both;
            }

            @keyframes tool-sig-shimmer {
              0%   { background-position: -120% 0; }
              100% { background-position:  220% 0; }
            }
            .tool-sig-shimmer {
              background-image: linear-gradient(
                90deg,
                transparent 0%,
                color-mix(in srgb, var(--accent) 25%, transparent) 50%,
                transparent 100%
              );
              background-size: 60% 100%;
              background-repeat: no-repeat;
              background-position: 220% 0;
              animation: tool-sig-shimmer 700ms ease-out 1;
              animation-fill-mode: forwards;
            }

            @keyframes tool-sig-scan {
              from { clip-path: inset(0 0 100% 0); }
              to   { clip-path: inset(0 0 0 0); }
            }
            .tool-sig-scan {
              display: inline-block;
              animation: tool-sig-scan 550ms cubic-bezier(0.22, 1, 0.36, 1) 1;
              animation-fill-mode: both;
            }
          }
          .askq-body {
            display: flex;
            flex-direction: column;
            gap: 14px;
            padding: 12px 14px;
          }
          .askq-empty {
            color: var(--text-muted);
            font-size: 12px;
            font-style: italic;
          }
          .askq-question {
            display: flex;
            flex-direction: column;
            gap: 6px;
          }
          .askq-header {
            font-size: 10px;
            text-transform: uppercase;
            letter-spacing: 0.6px;
            color: var(--text-muted);
            font-weight: 600;
          }
          .askq-prompt {
            font-size: 13px;
            color: var(--text);
            line-height: 1.4;
          }
          .askq-options {
            display: flex;
            flex-direction: column;
            gap: 6px;
            margin-top: 4px;
          }
          .askq-option {
            display: flex;
            align-items: flex-start;
            gap: 9px;
            padding: 8px 10px;
            background: var(--bg-secondary);
            border: 1px solid var(--border);
            border-radius: 6px;
            color: var(--text);
            cursor: pointer;
            text-align: left;
            font-size: 12px;
            transition: background 120ms ease, border-color 120ms ease;
          }
          .askq-option:hover:not(:disabled) {
            background: var(--bg-hover);
            border-color: var(--accent);
          }
          .askq-option:disabled {
            cursor: default;
          }
          .askq-option-selected {
            border-color: var(--accent);
            background: color-mix(in srgb, var(--accent) 12%, var(--bg-secondary));
          }
          .askq-option-locked.askq-option-selected {
            opacity: 1;
          }
          .askq-option-locked:not(.askq-option-selected) {
            opacity: 0.55;
          }
          .askq-radio {
            flex-shrink: 0;
            width: 14px;
            height: 14px;
            border-radius: 50%;
            border: 1.5px solid var(--border);
            margin-top: 1px;
            position: relative;
            background: var(--bg-primary);
          }
          .askq-radio-check {
            border-radius: 3px;
          }
          .askq-option-selected .askq-radio {
            border-color: var(--accent);
          }
          .askq-option-selected .askq-radio::after {
            content: '';
            position: absolute;
            inset: 2px;
            background: var(--accent);
            border-radius: inherit;
          }
          .askq-option-text {
            display: flex;
            flex-direction: column;
            gap: 2px;
            min-width: 0;
          }
          .askq-option-label {
            font-weight: 500;
            color: var(--text);
          }
          .askq-option-desc {
            font-size: 11px;
            color: var(--text-muted);
            line-height: 1.4;
          }
          .askq-other-input {
            margin-top: 2px;
            padding: 8px 10px;
            background: var(--bg-primary);
            border: 1px solid var(--accent);
            border-radius: 6px;
            color: var(--text);
            font-size: 12px;
            font-family: inherit;
            outline: none;
          }
          .askq-other-input:focus {
            border-color: var(--accent);
            box-shadow: 0 0 0 2px color-mix(in srgb, var(--accent) 25%, transparent);
          }
          .askq-other-input:disabled {
            opacity: 0.6;
            cursor: not-allowed;
          }
          .askq-actions {
            display: flex;
            align-items: center;
            gap: 12px;
            margin-top: 2px;
          }
          .askq-submit {
            padding: 6px 14px;
            background: var(--accent);
            color: #000;
            border: none;
            border-radius: 5px;
            font-size: 12px;
            font-weight: 600;
            cursor: pointer;
            transition: opacity 120ms ease;
          }
          .askq-submit:disabled {
            opacity: 0.4;
            cursor: not-allowed;
          }
          .askq-submit:not(:disabled):hover {
            background: var(--accent-hover);
          }
          .askq-error {
            font-size: 11px;
            color: #f87171;
          }
          .askq-answered {
            font-size: 11px;
            color: var(--text-muted);
            font-style: italic;
          }
        `}</style>
      </motion.div>
    </>
  );
}
