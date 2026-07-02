import { useState, useEffect, useRef, useContext } from 'react';
import {
  Terminal, FileText, Wrench, ChevronRight, Globe, AlertCircle,
  FilePen, FilePlus, SearchCode, FolderSearch, ListTodo, Bot,
  ClipboardList, ClipboardCheck, Zap, Send, GitBranch, GitMerge,
  Activity, AlarmClock, Timer, TimerOff, SquareTerminal, CircleStop,
  Radio, MessageCircleQuestion, NotebookPen, Plug, ListChecks,
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import type { ToolCall, MetaWorkspaceRuntime } from '../../types';
import { SPRING, useReducedMotionTransition } from './motion';
import { getShikiHighlighter, getActiveHighlightTheme } from '../../themes';
import { DOT_MASK_URL } from '../../lib/assets';
import { owningLink } from '../../lib/syntheticRoot';
import PlanReviewCard from './PlanReviewCard';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { CARD_MD_CLASS, CARD_MD_STYLES } from './markdownCardStyles';
import { parseSearchResults, isSearchTool, highlightMatches, type SearchRow } from './searchResults';
import { TaskRegistryContext, type TaskInfo } from './taskRegistry';
import { ToolResultImagePreview } from './ToolResultImagePreview';

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

/** Decide whether a tool-card body should render as formatted markdown.
 *  True when the label is a .md/.markdown path, or the body shows clear
 *  markdown structure. Conservative: plain prose / plain code stays as source. */
export function isMarkdownBody(label: string, code: string): boolean {
  if (/\.(md|markdown)$/i.test(label.trim())) return true;
  // Any other file extension means a non-markdown file: never promote, no
  // matter what the body looks like (JSDoc " * line"s match the list-item
  // heuristic, TS union arms look table-ish). Heuristics below are only for
  // extension-less labels (bash output, generic content).
  if (/\.[a-z0-9]+$/i.test(label.trim())) return false;
  const body = code || '';
  // Require non-trivial content so a single value line doesn't promote.
  if (body.split('\n').filter(l => l.trim()).length < 2) return false;
  // ATX heading
  if (/^#{1,6}\s+\S/m.test(body)) return true;
  // Fenced code block (a ``` on its own line)
  if (/^```/m.test(body)) return true;
  // GFM table: a pipe row immediately followed by a separator row (---/:--/| ---)
  if (/^.*\|.*\n[ \t]*\|?[ \t]*:?-{3,}/m.test(body)) return true;
  // Two or more list items
  const listItems = (body.match(/^\s*([-*+]|\d+\.)\s+\S/gm) || []).length;
  if (listItems >= 2) return true;
  return false;
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

function InlineHighlightedCode({ code, lang }: { code: string; lang: string }) {
  const [innerHtml, setInnerHtml] = useState<string>('');
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
        const codeMatch = result.match(/<code[^>]*>([\s\S]*)<\/code>/);
        if (!codeMatch) return;
        // Strip the outer <span class="line">...</span> wrapper shiki adds
        const lineMatch = codeMatch[1].match(/<span class="line">([\s\S]*)<\/span>/);
        setInnerHtml(lineMatch ? lineMatch[1] : codeMatch[1]);
      } catch {
        // language not loaded
      }
    });
  }, [code, lang, hlTheme]);

  if (innerHtml) {
    return <span className="tool-call-label tool-call-label-hl" dangerouslySetInnerHTML={{ __html: innerHtml }} />;
  }
  return <span className="tool-call-label">{code}</span>;
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
  labelLang?: string;
  diff?: { oldString: string; newString: string; fileLang: string };
  query?: { pattern?: string; path?: string; glob?: string; type?: string };
}

function formatInput(toolCall: ToolCall): FormatResult {
  const input = toolCall.input || '';
  try {
    const parsed = JSON.parse(input);

    // Bash — show command
    if (parsed.command) return { label: 'Command', code: parsed.command, labelLang: 'bash' };

    // Write — show file path + content, highlighted as the target file's
    // language (detectLang only sees the tool name + raw JSON input, which
    // misguesses for Write bodies).
    if (parsed.file_path && parsed.content) {
      return { label: parsed.file_path, code: parsed.content, langOverride: langFromPath(parsed.file_path) };
    }

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
      return {
        label: isGlob ? `glob: ${parsed.pattern}` : `grep: ${parsed.pattern}`,
        code: parts.length > 1 ? parts.join('\n') : '',
        labelLang: isGlob ? undefined : 'regexp',
        query: { pattern: parsed.pattern, path: parsed.path, glob: parsed.glob, type: parsed.type },
      };
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
  TaskCreate: ListTodo,
  TaskUpdate: ListChecks,
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

const MD_REMARK_PLUGINS = [remarkGfm];

function ToolCardMarkdown({ code }: { code: string }) {
  return (
    <div className={`tool-call-md ${CARD_MD_CLASS}`}>
      <ReactMarkdown remarkPlugins={MD_REMARK_PLUGINS}>{code}</ReactMarkdown>
    </div>
  );
}

function SearchQueryView({ query }: { query: NonNullable<FormatResult['query']> }) {
  const fields: [string, string | undefined][] = [
    ['pattern', query.pattern],
    ['path', query.path],
    ['glob', query.glob],
    ['type', query.type],
  ];
  const present = fields.filter(([, v]) => v != null && v !== '');
  if (present.length === 0) return null;
  return (
    <div className="search-query">
      {present.map(([k, v]) => (
        <div key={k} className="search-query-row">
          <span className="search-query-key">{k}</span>
          <span className="search-query-val">{v}</span>
        </div>
      ))}
    </div>
  );
}

const SEARCH_MAX_ROWS = 12;

function SearchResultLine({ text, pattern }: { text: string; pattern?: string }) {
  const segments = highlightMatches(text, pattern || '');
  return (
    <span className="search-line-text">
      {segments.map((s, i) =>
        s.hit ? <mark key={i} className="search-hit">{s.text}</mark> : <span key={i}>{s.text}</span>
      )}
    </span>
  );
}

/** Merge shiki inner HTML with match highlights.
 *  Splits shiki span tokens at match boundaries so <mark> can wrap
 *  across token boundaries without breaking the syntax colors. */
function mergeHighlightsIntoHtml(innerHtml: string, pattern: string): string {
  // Parse shiki tokens: each is either a <span style="...">text</span> or a bare text node
  const tokenRe = /<span style="([^"]*)">(.*?)<\/span>|([^<]+)/g;
  const tokens: { style: string; text: string }[] = [];
  let m: RegExpExecArray | null;
  while ((m = tokenRe.exec(innerHtml)) !== null) {
    const text = m[3] !== undefined ? m[3] : m[2];
    if (text) tokens.push({ style: m[3] !== undefined ? '' : m[1], text });
  }

  // Decode HTML entities for plain-text matching
  const decode = (s: string) => s.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'");
  const plainText = tokens.map(t => decode(t.text)).join('');
  const segments = highlightMatches(plainText, pattern);
  if (segments.length === 1 && !segments[0].hit) return innerHtml; // no matches, return as-is

  let result = '';
  let tokenIdx = 0;
  let posInToken = 0; // position in decoded text of current token

  for (const seg of segments) {
    let remaining = seg.text.length;
    const parts: { style: string; text: string }[] = [];
    while (remaining > 0 && tokenIdx < tokens.length) {
      const token = tokens[tokenIdx];
      const decoded = decode(token.text);
      const available = decoded.length - posInToken;
      const take = Math.min(remaining, available);
      parts.push({ style: token.style, text: escapeHtml(decoded.slice(posInToken, posInToken + take)) });
      remaining -= take;
      posInToken += take;
      if (posInToken >= decoded.length) { tokenIdx++; posInToken = 0; }
    }
    const partsHtml = parts.map(p =>
      p.style ? `<span style="${p.style}">${p.text}</span>` : p.text
    ).join('');
    result += seg.hit ? `<mark class="search-hit">${partsHtml}</mark>` : partsHtml;
  }
  return result;
}

function SyntaxHighlightedSearchLine({ path, text, pattern }: { path: string; text: string; pattern?: string }) {
  const lang = langFromPath(path);
  const [innerHtml, setInnerHtml] = useState<string>('');
  const [hlTheme, setHlTheme] = useState(getActiveHighlightTheme());

  useEffect(() => {
    const handler = () => setHlTheme(getActiveHighlightTheme());
    window.addEventListener('sai-highlight-theme-change', handler);
    return () => window.removeEventListener('sai-highlight-theme-change', handler);
  }, []);

  useEffect(() => {
    if (!text || lang === 'text') { setInnerHtml(''); return; }
    getShikiHighlighter().then(highlighter => {
      try {
        const result = highlighter.codeToHtml(text.trim(), { lang, theme: hlTheme });
        const lineMatch = result.match(/<span class="line">([\s\S]*)<\/span>/);
        const lineInner = lineMatch ? lineMatch[1] : '';
        setInnerHtml(mergeHighlightsIntoHtml(lineInner, pattern || ''));
      } catch {
        setInnerHtml('');
      }
    });
  }, [text, lang, pattern, hlTheme]);

  if (innerHtml) {
    return <span className="search-line-text" dangerouslySetInnerHTML={{ __html: innerHtml }} />;
  }
  return <SearchResultLine text={text} pattern={pattern} />;
}

function SearchResultView({ rows, pattern }: { rows: SearchRow[]; pattern?: string }) {
  const [showAll, setShowAll] = useState(false);
  if (rows.length === 0) return null;
  const visible = showAll ? rows : rows.slice(0, SEARCH_MAX_ROWS);
  const hiddenCount = rows.length - visible.length;
  return (
    <div className="search-result">
      {visible.map((row, i) => {
        if (row.type === 'separator') return <div key={i} className="search-sep" aria-hidden />;
        if (row.type === 'file') {
          return (
            <div key={i} className="search-row search-row-file">
              <span className="search-dot" aria-hidden />
              <span className="search-path">{row.path}</span>
            </div>
          );
        }
        if (row.type === 'match') {
          return (
            <div key={i} className="search-row search-row-match">
              <span className="search-path">{row.path}</span>
              <span className="search-gutter">:{row.line}:</span>
              <SyntaxHighlightedSearchLine path={row.path} text={row.text} pattern={pattern} />
            </div>
          );
        }
        return <div key={i} className="search-row search-row-raw">{row.text}</div>;
      })}
      {(hiddenCount > 0 || showAll) && rows.length > SEARCH_MAX_ROWS && (
        <button className="tool-call-show-more" onClick={() => setShowAll(prev => !prev)}>
          {showAll ? 'Show less' : `Show all (${rows.length} results)`}
        </button>
      )}
    </div>
  );
}

interface TaskFields {
  taskId?: string;
  subject?: string;
  description?: string;
  activeForm?: string;
  status?: string;
  owner?: string;
  addBlocks?: string[];
  addBlockedBy?: string[];
}

function parseTaskFields(input: string): TaskFields {
  try {
    const p = JSON.parse(input || '{}');
    return {
      taskId: p.taskId != null ? String(p.taskId) : undefined,
      subject: typeof p.subject === 'string' ? p.subject : undefined,
      description: typeof p.description === 'string' ? p.description : undefined,
      activeForm: typeof p.activeForm === 'string' ? p.activeForm : undefined,
      status: typeof p.status === 'string' ? p.status : undefined,
      owner: typeof p.owner === 'string' ? p.owner : undefined,
      addBlocks: Array.isArray(p.addBlocks) ? p.addBlocks.map(String) : undefined,
      addBlockedBy: Array.isArray(p.addBlockedBy) ? p.addBlockedBy.map(String) : undefined,
    };
  } catch { return {}; }
}

function TaskCardView({ kind, fields, resolved }: { kind: 'create' | 'update'; fields: TaskFields; resolved?: TaskInfo }) {
  const title = fields.subject || resolved?.subject || `Task #${fields.taskId ?? '?'}`;
  const description = fields.description || (kind === 'update' ? resolved?.description : undefined);
  const activeForm = fields.activeForm || (kind === 'update' ? resolved?.activeForm : undefined);
  const badge = kind === 'create'
    ? { cls: 'created', label: 'Created' }
    : fields.status
      ? { cls: fields.status, label: fields.status.replace(/_/g, ' ') }
      : { cls: 'updated', label: 'Updated' };
  return (
    <div className="tool-call-body task-card">
      <div className="task-card-head">
        <span className="task-card-title">{title}</span>
        <span className={`task-badge task-badge-${badge.cls}`}>{badge.label}</span>
      </div>
      {description && <div className="task-card-desc">{description}</div>}
      <div className="task-card-meta">
        {activeForm && <span className="task-chip">{activeForm}</span>}
        {fields.owner && <span className="task-chip">owner: {fields.owner}</span>}
        {fields.addBlocks && fields.addBlocks.length > 0 && <span className="task-chip">blocks {fields.addBlocks.length}</span>}
        {fields.addBlockedBy && fields.addBlockedBy.length > 0 && <span className="task-chip">blocked by {fields.addBlockedBy.length}</span>}
      </div>
    </div>
  );
}

const MAX_PREVIEW_LINES = 20;

interface Todo {
  id: string;
  content: string;
  activeForm?: string;
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

  const done = todos.filter(t => t.status === 'completed').length;

  return (
    <div className="tool-call-body todo-list-body">
      <div className="todo-list-head">
        <span className="todo-list-title">Tasks</span>
        <span className="todo-list-count" data-testid="todo-count">{done}/{todos.length}</span>
      </div>
      {todos.map((todo, i) => (
        <div key={todo.id || i} className={`todo-item todo-${todo.status}`}>
          <span className="todo-icon">
            {todo.status === 'completed' ? '✓' : todo.status === 'in_progress' ? '✦' : '○'}
          </span>
          <span className="todo-content">
            {todo.status === 'in_progress' ? (todo.activeForm || todo.content) : todo.content}
          </span>
          {todo.priority && <span className="todo-priority">{todo.priority}</span>}
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
  const { label, code, langOverride, labelLang, diff, query } = formatInput(toolCall);
  const lang = langOverride || detectLang(toolCall);
  const { truncated, isTruncated } = truncateCode(code, MAX_PREVIEW_LINES);
  const renderMarkdown = !diff && isMarkdownBody(label, code);
  const [mdView, setMdView] = useState<'rendered' | 'source'>('rendered');
  const search = !diff && !renderMarkdown
    && toolCall.type !== 'terminal_command'
    && toolCall.name !== 'TodoWrite'
    && toolCall.name !== 'AskUserQuestion'
    && isSearchTool(toolCall.name, toolCall.output || '');
  const searchParsed = search && toolCall.output && !parseToolError(toolCall.output).isToolError
    ? parseSearchResults(toolCall.output)
    : null;
  const entryTransition = useReducedMotionTransition(SPRING.pop);
  const badgeTransition = useReducedMotionTransition(SPRING.flick);
  const chevronTransition = useReducedMotionTransition(SPRING.flick);
  const expandTransition = useReducedMotionTransition({ height: { duration: 0.26, ease: [0.22, 1, 0.36, 1] as const }, opacity: { duration: 0.18 } });

  const isBash = toolCall.type === 'terminal_command';
  const isTodo = toolCall.name === 'TodoWrite';
  const isAskUserQuestion = toolCall.name === 'AskUserQuestion';
  const isTaskCreate = toolCall.name === 'TaskCreate';
  const isTaskUpdate = toolCall.name === 'TaskUpdate';
  const isTask = isTaskCreate || isTaskUpdate;
  const taskRegistry = useContext(TaskRegistryContext);
  const taskFields = isTask ? parseTaskFields(toolCall.input || '') : null;
  const taskResolved = isTaskUpdate && taskFields?.taskId ? taskRegistry.get(taskFields.taskId) : undefined;
  const askAnswered = isAskUserQuestion && (() => {
    try { return Object.keys(JSON.parse(toolCall.input || '{}').answers || {}).length > 0; } catch { return false; }
  })();

  const status: 'running' | 'done' | 'error' =
    isAskUserQuestion ? (askAnswered ? 'done' : 'running') :
    toolCall.output && parseToolError(toolCall.output).isToolError ? 'error' :
    toolCall.output ? 'done' : 'running';

  const hasBody = isAskUserQuestion ? true : isTask ? true : isBash ? !!toolCall.output : isTodo ? true : search ? (!!toolCall.output || !!query) : !!code;

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
        className={`tool-call-card${status === 'running' ? ' tool-call-card--running' : ''}`}
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
          {!isBash && !isTodo && !isAskUserQuestion && label && (
            labelLang
              ? <InlineHighlightedCode code={label} lang={labelLang} />
              : <span className="tool-call-label">{label}</span>
          )}
          {isAskUserQuestion && <span className="tool-call-label">{askAnswered ? 'Answered' : 'Waiting for answer…'}</span>}
          {isBash && code && <InlineHighlightedCode code={code} lang="bash" />}
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
        {toolCall.resultImages?.length ? (
          <div className="tool-call-image-strip" onClick={(e) => e.stopPropagation()}>
            {toolCall.resultImages.map((img, i) => (
              <ToolResultImagePreview key={i} image={img} />
            ))}
          </div>
        ) : null}
        <AnimatePresence initial={false}>
          {expanded && hasBody && (
            <motion.div
              key="tool-call-expand"
              className="tool-call-expand dashed-divider-top"
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
            {isTask && taskFields && (
              <TaskCardView kind={isTaskCreate ? 'create' : 'update'} fields={taskFields} resolved={taskResolved} />
            )}
            {isAskUserQuestion && (
              <AskUserQuestionView
                toolUseId={toolCall.id}
                input={toolCall.input || ''}
                onAnswerQuestion={onAnswerQuestion}
              />
            )}
            {search && !isTask && (
              <div className="tool-call-body search-tool-body">
                {query && <SearchQueryView query={query} />}
                {toolCall.output && (() => {
                  const parsedOutput = parseToolError(toolCall.output);
                  if (parsedOutput.isToolError) {
                    return (
                      <div className="tool-call-output">
                        <ToolErrorDisplay message={parsedOutput.message} />
                      </div>
                    );
                  }
                  return (
                    <div className="tool-call-output">
                      <div className="tool-call-output-header">
                        <span className="tool-call-output-label">Results</span>
                      </div>
                      <SearchResultView rows={searchParsed?.rows || []} pattern={query?.pattern} />
                    </div>
                  );
                })()}
              </div>
            )}
            {!isBash && !isTodo && !isAskUserQuestion && !search && !isTask && code && (
              <div className="tool-call-body">
                {diff ? (
                  <DiffHighlightedCode oldString={diff.oldString} newString={diff.newString} lang={diff.fileLang} />
                ) : renderMarkdown ? (
                  <>
                    <div className="tool-call-md-toggle" data-testid="md-view-toggle" onClick={e => e.stopPropagation()}>
                      <button
                        type="button"
                        data-testid="md-view-rendered"
                        aria-pressed={mdView === 'rendered'}
                        className={`tool-call-md-seg${mdView === 'rendered' ? ' tool-call-md-seg-on' : ''}`}
                        onClick={() => setMdView('rendered')}
                      >
                        Rendered
                      </button>
                      <button
                        type="button"
                        data-testid="md-view-source"
                        aria-pressed={mdView === 'source'}
                        className={`tool-call-md-seg${mdView === 'source' ? ' tool-call-md-seg-on' : ''}`}
                        onClick={() => setMdView('source')}
                      >
                        Source
                      </button>
                    </div>
                    {mdView === 'rendered'
                      ? <ToolCardMarkdown code={code} />
                      : <HighlightedCode code={showAllCode ? code : truncated} lang={lang} />}
                    {mdView === 'source' && isTruncated && (
                      <button
                        className="tool-call-show-more"
                        onClick={() => setShowAllCode(prev => !prev)}
                      >
                        {showAllCode ? 'Show less' : `Show all (${code.split('\n').length} lines)`}
                      </button>
                    )}
                  </>
                ) : (
                  <HighlightedCode code={showAllCode ? code : truncated} lang={lang} />
                )}
                {!renderMarkdown && !diff && isTruncated && (
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
                      <HighlightedCode code={showAllOutput ? toolCall.output : outputTruncation.truncated} lang={lang} />
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
            background: var(--surface-2);
            border: 1px solid var(--border-hairline);
            border-radius: 8px;
            overflow: hidden;
            transition: border-color .25s ease;
          }
          .tool-call-card--running {
            border-color: color-mix(in srgb, var(--accent) 22%, transparent);
          }
          .tool-call-header {
            padding: 8px 12px;
            display: flex;
            align-items: center;
            gap: 8px;
            font-size: 12px;
            color: var(--text-secondary);
            border-bottom: 1px solid var(--border-hairline);
          }
          .tool-call-header-expandable {
            cursor: pointer;
          }
          .tool-call-header-expandable:hover {
            background: var(--surface-3);
          }
          .tool-call-card--running .tool-call-name {
            background: linear-gradient(
              90deg,
              var(--text-muted) 20%,
              color-mix(in srgb, var(--accent) 75%, #fff) 50%,
              var(--text-muted) 80%
            );
            background-size: 200% 100%;
            -webkit-background-clip: text;
            background-clip: text;
            color: transparent;
            animation: sai-shimmer 2.2s linear infinite;
          }
          @media (prefers-reduced-motion: reduce) {
            .tool-call-card--running .tool-call-name {
              animation: none;
              background: none;
              color: var(--text);
            }
          }
          .tool-call-icon {
            color: var(--accent);
            flex-shrink: 0;
          }
          .tool-call-name {
            font-family: 'Geist Mono', 'JetBrains Mono', monospace;
            font-size: var(--text-xs);
            font-weight: 600;
            color: var(--text);
          }
          .tool-call-label {
            flex: 1;
            font-family: 'Geist Mono', 'JetBrains Mono', monospace;
            font-size: var(--text-xs);
            color: var(--text-secondary);
            overflow: hidden;
            text-overflow: ellipsis;
            white-space: nowrap;
          }
          .tool-call-label-hl {
            background: transparent !important;
            filter: saturate(0.6);
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
            /* header↔body separator is the dashed line on .tool-call-expand (.dashed-divider-top) */
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
          .tool-call-md {
            padding: 10px 12px;
            font-size: 12.5px;
            line-height: 1.55;
            color: var(--text);
            max-height: 420px;
            overflow-y: auto;
          }
          .tool-call-md-toggle {
            display: inline-flex;
            gap: 2px;
            margin: 8px 12px 0;
            padding: 2px;
            border: 1px solid var(--border-hairline);
            border-radius: 6px;
            background: var(--bg-secondary);
          }
          .tool-call-md-seg {
            font-family: inherit;
            font-size: 10px;
            text-transform: uppercase;
            letter-spacing: 0.4px;
            padding: 3px 9px;
            border: none;
            border-radius: 4px;
            background: transparent;
            color: var(--text-muted);
            cursor: pointer;
          }
          .tool-call-md-seg-on {
            background: color-mix(in srgb, var(--accent) 16%, transparent);
            color: var(--accent);
          }
          .search-tool-body { padding-bottom: 4px; }
          .search-query {
            display: flex;
            flex-direction: column;
            gap: 3px;
            padding: 10px 12px 6px;
          }
          .search-query-row {
            display: flex;
            align-items: baseline;
            gap: 8px;
            font-family: 'Geist Mono', 'JetBrains Mono', monospace;
            font-size: 11.5px;
          }
          .search-query-key {
            flex-shrink: 0;
            min-width: 56px;
            font-size: 9px;
            text-transform: uppercase;
            letter-spacing: 0.5px;
            color: var(--text-muted);
            padding-top: 1px;
          }
          .search-query-val { color: var(--text); word-break: break-all; }
          .search-result {
            display: flex;
            flex-direction: column;
            gap: 1px;
            padding: 4px 0;
          }
          .search-row {
            display: flex;
            align-items: baseline;
            gap: 6px;
            padding: 1px 12px;
            font-family: 'Geist Mono', 'JetBrains Mono', monospace;
            font-size: 11.5px;
            line-height: 1.5;
            white-space: pre-wrap;
            word-break: break-word;
          }
          .search-dot {
            flex-shrink: 0;
            width: 4px;
            height: 4px;
            border-radius: 50%;
            background: var(--accent);
            opacity: 0.7;
            transform: translateY(-2px);
          }
          .search-path { color: var(--accent); flex-shrink: 0; }
          .search-row-match .search-path { opacity: 0.85; }
          .search-gutter { color: var(--text-muted); flex-shrink: 0; }
          .search-line-text { color: var(--text-secondary); filter: saturate(0.6); }
          .search-hit {
            background: color-mix(in srgb, var(--accent) 30%, transparent);
            color: var(--text);
            border-radius: 2px;
            padding: 0 1px;
          }
          .search-row-raw { color: var(--text-muted); }
          .search-sep {
            height: 0;
            border-top: 1px dashed var(--border-hairline);
            margin: 3px 12px;
          }
          .task-card { padding: 10px 12px; display: flex; flex-direction: column; gap: 6px; }
          .task-card-head { display: flex; align-items: baseline; gap: 8px; }
          .task-card-title { font-size: 12.5px; color: var(--text); font-weight: 600; flex: 1; word-break: break-word; }
          .task-badge {
            flex-shrink: 0; font-size: 9px; text-transform: uppercase; letter-spacing: 0.4px;
            font-weight: 600; padding: 2px 7px; border-radius: 4px;
            background: color-mix(in srgb, var(--text-muted) 18%, transparent); color: var(--text-secondary);
          }
          .task-badge-created { background: color-mix(in srgb, var(--accent) 18%, transparent); color: var(--accent); }
          .task-badge-in_progress { background: color-mix(in srgb, var(--orange, #e6b84f) 20%, transparent); color: var(--orange, #e6b84f); }
          .task-badge-completed { background: color-mix(in srgb, var(--green) 18%, transparent); color: var(--green); }
          .task-badge-deleted { background: color-mix(in srgb, var(--red, #f85149) 16%, transparent); color: var(--red, #f85149); }
          .task-card-desc { font-size: 11.5px; color: var(--text-muted); line-height: 1.5; word-break: break-word; }
          .task-card-meta { display: flex; flex-wrap: wrap; gap: 6px; }
          .task-chip {
            font-size: 10px; padding: 2px 7px; border-radius: 4px;
            background: var(--bg-secondary); border: 1px solid var(--border-hairline); color: var(--text-secondary);
            font-family: 'Geist Mono', 'JetBrains Mono', monospace;
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
            border-top: 1px solid var(--border-hairline);
            color: var(--accent);
            font-size: 11px;
            cursor: pointer;
            text-align: center;
          }
          .tool-call-show-more:hover {
            background: var(--bg-hover);
          }
          .tool-call-output {
            border-top: 1px dashed var(--border-hairline);
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
            border-top: 1px dashed var(--border-hairline);
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
            border-top: 1px solid var(--border-hairline);
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
          .todo-list-head {
            display: flex; align-items: baseline; gap: 8px;
            padding: 4px 12px 2px; border-bottom: 1px dashed var(--border-hairline); margin-bottom: 4px;
          }
          .todo-list-title {
            font-size: 9px; text-transform: uppercase; letter-spacing: 0.5px; color: var(--text-muted); font-weight: 600;
          }
          .todo-list-count {
            margin-left: auto; font-size: 10px; color: var(--text-muted);
            font-variant-numeric: tabular-nums;
            font-family: 'Geist Mono', 'JetBrains Mono', monospace;
          }
          .todo-priority {
            margin-left: auto; flex-shrink: 0;
            font-size: 8.5px; text-transform: uppercase; letter-spacing: 0.4px; font-weight: 600;
            padding: 1px 6px; border-radius: 3px;
            background: color-mix(in srgb, var(--orange, #e6b84f) 18%, transparent);
            color: var(--orange, #e6b84f);
          }
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
            border: 1px solid var(--border-hairline);
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
            border: 1.5px solid var(--border-hairline);
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
        ` + CARD_MD_STYLES}</style>
      </motion.div>
    </>
  );
}
