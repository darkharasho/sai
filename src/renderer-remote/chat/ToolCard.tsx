import { useState } from 'react';
import { Terminal, FileEdit, FileText, Wrench, Globe, AlertCircle, ChevronRight, ListTodo, MessageCircleQuestion } from 'lucide-react';

interface Props {
  name: string;
  input?: Record<string, unknown>;
  result?: string | Record<string, unknown>;
  status: 'running' | 'done' | 'error';
}

interface Summary {
  label: string;      // monospace inline label (filename, command, pattern)
  body?: string;      // pre-formatted body for the expanded view
  language?: string;  // hint for renderer
}

function summarize(name: string, input?: Record<string, unknown>): Summary {
  if (!input) return { label: '' };
  const lower = name.toLowerCase();
  const i = input as any;

  // Bash / terminal
  if (lower === 'bash' || typeof i.command === 'string') {
    return { label: typeof i.command === 'string' ? i.command : '', body: typeof i.command === 'string' ? i.command : '', language: 'bash' };
  }
  // Edit — show a diff-style body
  if (i.file_path && i.old_string != null) {
    const oldLines = String(i.old_string || '').split('\n').map((l: string) => `- ${l}`).join('\n');
    const newLines = String(i.new_string || '').split('\n').map((l: string) => `+ ${l}`).join('\n');
    return { label: String(i.file_path), body: `${oldLines}\n${newLines}`, language: 'diff' };
  }
  // Write
  if (i.file_path && typeof i.content === 'string') {
    return { label: String(i.file_path), body: i.content };
  }
  // Read / single-file ops
  if (typeof i.file_path === 'string') {
    return { label: String(i.file_path) };
  }
  // Grep / Glob
  if (typeof i.pattern === 'string') {
    return { label: `${lower.includes('glob') ? 'glob' : 'grep'}: ${i.pattern}` };
  }
  // WebFetch / WebSearch
  if (typeof i.url === 'string') return { label: i.url };
  if (typeof i.query === 'string') return { label: i.query };
  // TodoWrite
  if (Array.isArray(i.todos)) return { label: `${i.todos.length} todos` };
  // Fallback: a small one-line preview of the keys
  const keys = Object.keys(i).slice(0, 3);
  return { label: keys.length ? keys.join(', ') : '' };
}

function iconFor(name: string) {
  const lower = name.toLowerCase();
  if (lower === 'bash' || lower.includes('terminal')) return Terminal;
  if (lower.startsWith('edit') || lower.startsWith('multiedit') || lower === 'write') return FileEdit;
  if (lower === 'read' || lower.includes('view')) return FileText;
  if (lower === 'todowrite') return ListTodo;
  if (lower === 'askuserquestion') return MessageCircleQuestion;
  if (lower.includes('web') || lower.includes('fetch')) return Globe;
  return Wrench;
}

export default function ToolCard({ name, input, result, status }: Props) {
  const [expanded, setExpanded] = useState(false);
  const summary = summarize(name, input);
  const Icon = status === 'error' ? AlertCircle : iconFor(name);
  const accentColor = status === 'error' ? 'var(--red)' : status === 'done' ? 'var(--green)' : 'var(--accent)';

  const headerStyle: React.CSSProperties = {
    width: '100%',
    display: 'flex',
    alignItems: 'center',
    gap: 8,
    padding: '8px 10px',
    background: 'transparent',
    color: 'var(--text)',
    border: 'none',
    cursor: 'pointer',
    fontFamily: 'inherit',
    fontSize: 'inherit',
    textAlign: 'left',
    minWidth: 0,
  };

  return (
    <div
      style={{
        alignSelf: 'flex-start',
        maxWidth: '92%',
        minWidth: 0,
        border: '1px solid var(--border)',
        background: 'var(--bg-mid)',
        borderRadius: 10,
        overflow: 'hidden',
      }}
    >
      <button onClick={() => setExpanded((v) => !v)} style={headerStyle} aria-expanded={expanded}>
        <Icon size={14} color={accentColor} strokeWidth={2} style={{ flexShrink: 0 }} />
        <span style={{
          fontFamily: '"Geist Mono", ui-monospace, monospace',
          fontSize: 12,
          fontWeight: 600,
          color: 'var(--accent)',
          flexShrink: 0,
        }}>
          {name}
        </span>
        {summary.label && (
          <span
            style={{
              fontFamily: '"Geist Mono", ui-monospace, monospace',
              fontSize: 11,
              color: 'var(--text-muted)',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
              flex: 1,
              minWidth: 0,
            }}
            title={summary.label}
          >
            {summary.label}
          </span>
        )}
        {status === 'running' && (
          <span style={{
            flexShrink: 0,
            fontSize: 10,
            fontFamily: '"Geist Mono", ui-monospace, monospace',
            color: 'var(--accent)',
            letterSpacing: '0.08em',
          }}>RUNNING</span>
        )}
        <ChevronRight
          size={14}
          color="var(--text-muted)"
          style={{
            flexShrink: 0,
            transition: 'transform var(--dur-fast) var(--ease-out-soft)',
            transform: expanded ? 'rotate(90deg)' : 'none',
          }}
        />
      </button>
      {expanded && (
        <div style={{
          borderTop: '1px solid var(--border)',
          padding: 10,
          display: 'flex',
          flexDirection: 'column',
          gap: 10,
        }}>
          {summary.body && (
            <CodeBlock content={summary.body} language={summary.language} />
          )}
          {!summary.body && input && Object.keys(input).length > 0 && (
            <Section title="input">
              <CodeBlock content={JSON.stringify(input, null, 2)} language="json" />
            </Section>
          )}
          {result !== undefined && (
            <Section title={status === 'error' ? 'error' : 'result'}>
              <CodeBlock content={typeof result === 'string' ? result : JSON.stringify(result, null, 2)} />
            </Section>
          )}
        </div>
      )}
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <div style={{
        fontSize: 10,
        fontFamily: '"Geist Mono", ui-monospace, monospace',
        color: 'var(--text-muted)',
        letterSpacing: '0.08em',
        textTransform: 'uppercase',
        marginBottom: 4,
      }}>
        {title}
      </div>
      {children}
    </div>
  );
}

function CodeBlock({ content, language }: { content: string; language?: string }) {
  const isDiff = language === 'diff';
  return (
    <pre style={{
      margin: 0,
      padding: 10,
      background: 'var(--bg-input)',
      border: '1px solid var(--border)',
      borderRadius: 8,
      fontFamily: '"Geist Mono", ui-monospace, monospace',
      fontSize: 12,
      lineHeight: 1.45,
      color: 'var(--text)',
      maxHeight: 280,
      overflow: 'auto',
      whiteSpace: 'pre-wrap',
      wordBreak: 'break-word',
      overflowWrap: 'anywhere',
    }}>
      {isDiff
        ? content.split('\n').map((line, i) => {
            const color = line.startsWith('+ ') ? 'var(--green)' : line.startsWith('- ') ? 'var(--red)' : 'var(--text)';
            return <div key={i} style={{ color }}>{line || ' '}</div>;
          })
        : content}
    </pre>
  );
}
