import { useState, useRef, useEffect } from 'react';
import { Send, Terminal, Sparkles } from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import SaiLogo from '../SaiLogo';
import type { BrainstormMessage } from './useBrainstorm';

interface Props {
  messages: BrainstormMessage[];
  streamingText: string;
  isStreaming: boolean;
  error: string | null;
  startError: string | null;
  onSend: (text: string) => void;
}

export default function BrainstormTab({
  messages, streamingText, isStreaming, error, startError, onSend,
}: Props) {
  const [draft, setDraft] = useState('');
  const [inputFocused, setInputFocused] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages, streamingText]);

  const handleSend = () => {
    const text = draft.trim();
    if (!text || isStreaming) return;
    onSend(text);
    setDraft('');
  };

  if (startError) {
    return (
      <div style={{ padding: 16, fontSize: 12, color: '#f87171', background: 'rgba(248,113,113,0.06)', border: '1px solid rgba(248,113,113,0.2)', borderRadius: 6 }}>
        AI brainstorm unavailable — {startError}. You can still fill out the Setup tab manually.
      </div>
    );
  }

  const canSend = !!draft.trim() && !isStreaming;
  const showEmptyState = messages.length === 0 && !isStreaming;

  return (
    <div className="brainstorm-tab" style={{ display: 'flex', flexDirection: 'column', gap: 10, height: 380 }}>
      <div
        ref={scrollRef}
        className="brainstorm-transcript"
        style={{
          flex: 1, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 14,
          padding: '14px 12px',
          background: 'var(--surface-2)',
          border: '1px solid var(--border-subtle)',
          borderRadius: 6,
        }}
      >
        {showEmptyState && (
          <div style={{
            display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
            gap: 8, color: 'var(--text-muted)', fontSize: 12, padding: '24px 16px', textAlign: 'center',
            margin: 'auto',
          }}>
            <Sparkles size={18} color="var(--accent)" style={{ opacity: 0.7 }} />
            <div style={{ fontSize: 12.5, color: 'var(--text)', fontWeight: 500 }}>Think it through first</div>
            <div style={{ fontSize: 11, lineHeight: 1.5, maxWidth: 320 }}>
              Talk through feasibility, trade-offs, and options before we create the folder, scaffolding, and repo. When you're ready, hit <span style={{ color: 'var(--accent)' }}>Use this →</span>.
            </div>
          </div>
        )}
        {messages.map((m, i) => (
          <Message key={i} role={m.role} text={m.content} showDivider={i > 0} />
        ))}
        {isStreaming && streamingText && (
          <Message role="assistant" text={streamingText} streaming showDivider={messages.length > 0} />
        )}
        {isStreaming && !streamingText && <ThinkingIndicator />}
        {error && (
          <div style={{ fontSize: 11, color: '#f87171', padding: '4px 8px' }}>{error}</div>
        )}
      </div>
      <div
        className="brainstorm-input"
        style={{
          display: 'flex', gap: 6, alignItems: 'stretch',
          background: 'var(--surface-2)',
          border: `1px solid ${inputFocused ? 'var(--accent)' : 'var(--border-subtle)'}`,
          borderRadius: 6,
          padding: 4,
          transition: 'border-color 120ms ease',
        }}
      >
        <textarea
          value={draft}
          onChange={e => setDraft(e.target.value)}
          onFocus={() => setInputFocused(true)}
          onBlur={() => setInputFocused(false)}
          onKeyDown={e => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              handleSend();
            }
          }}
          placeholder="What are you thinking about building?"
          rows={2}
          style={{
            flex: 1,
            background: 'transparent', border: 'none', outline: 'none',
            padding: '6px 8px', fontSize: 13, color: 'var(--text)',
            fontFamily: 'system-ui, sans-serif', resize: 'none', lineHeight: 1.45,
          }}
        />
        <button
          onClick={handleSend}
          disabled={!canSend}
          aria-label="Send"
          title="Send (Enter)"
          style={{
            background: canSend ? 'rgba(199,145,12,0.12)' : 'transparent',
            border: `1px solid ${canSend ? 'var(--accent)' : 'transparent'}`,
            color: canSend ? 'var(--accent)' : 'var(--text-muted)',
            borderRadius: 4, padding: '0 12px',
            cursor: canSend ? 'pointer' : 'not-allowed',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            transition: 'background 120ms ease, color 120ms ease, border-color 120ms ease',
            alignSelf: 'stretch',
          }}
        >
          <Send size={14} />
        </button>
      </div>
    </div>
  );
}

function Message({ role, text, streaming, showDivider }: { role: 'user' | 'assistant'; text: string; streaming?: boolean; showDivider?: boolean }) {
  const isUser = role === 'user';
  return (
    <div style={{
      display: 'flex', alignItems: 'flex-start', gap: 10,
      paddingTop: showDivider ? 12 : 0,
      borderTop: showDivider ? '1px dashed var(--border-hairline)' : 'none',
      opacity: showDivider ? 1 : 1,
    }}>
      <div style={{ flexShrink: 0, width: 18, height: 18, display: 'flex', alignItems: 'center', justifyContent: 'center', marginTop: 1 }}>
        {isUser
          ? <Terminal size={13} color="var(--green, #4caf80)" strokeWidth={2.5} />
          : <SaiLogo mode="static" size={16} />}
      </div>
      <div
        className={`brainstorm-msg brainstorm-msg-${role}${streaming ? ' brainstorm-msg-streaming' : ''}`}
        style={{
          flex: 1, minWidth: 0,
          fontSize: 12.5, color: 'var(--text)', lineHeight: 1.55,
        }}
      >
        {isUser ? (
          <div style={{ whiteSpace: 'pre-wrap' }}>{text}</div>
        ) : (() => {
          const card = tryParseProjectPreview(text);
          if (card) return <ProjectPreviewCard projectName={card.projectName} context={card.context} />;
          return <ReactMarkdown remarkPlugins={[remarkGfm]}>{text}</ReactMarkdown>;
        })()}
      </div>
      <style>{`
        .brainstorm-msg p { margin: 0 0 6px 0; }
        .brainstorm-msg p:last-child { margin-bottom: 0; }
        .brainstorm-msg ul, .brainstorm-msg ol { margin: 4px 0 6px 0; padding-left: 20px; }
        .brainstorm-msg li { margin: 2px 0; }
        .brainstorm-msg li > p { margin: 0; }
        .brainstorm-msg code {
          font-family: 'JetBrains Mono', monospace;
          font-size: 11.5px;
          background: var(--surface-3);
          border: 1px solid var(--border-subtle);
          border-radius: 3px;
          padding: 0 4px;
        }
        .brainstorm-msg pre {
          background: var(--surface-3);
          border: 1px solid var(--border-subtle);
          border-radius: 5px;
          padding: 8px 10px;
          overflow-x: auto;
          margin: 6px 0;
        }
        .brainstorm-msg pre code {
          background: transparent;
          border: none;
          padding: 0;
        }
        .brainstorm-msg h1, .brainstorm-msg h2, .brainstorm-msg h3 {
          font-size: 13px;
          font-weight: 600;
          margin: 8px 0 4px 0;
          color: var(--text);
        }
        .brainstorm-msg a { color: var(--accent); text-decoration: underline; text-underline-offset: 2px; }
        .brainstorm-msg strong { color: var(--text); font-weight: 600; }
        .brainstorm-msg blockquote {
          margin: 6px 0;
          padding: 2px 0 2px 10px;
          border-left: 2px solid var(--border-hairline);
          color: var(--text-muted);
        }
        /* Always-visible scrollbar — the default chrome blends into the
           transcript background. Firefox uses scrollbar-color; WebKit/Chromium
           uses the ::-webkit-scrollbar pseudo-elements. */
        .brainstorm-transcript {
          scrollbar-width: thin;
          scrollbar-color: var(--text-muted) transparent;
        }
        .brainstorm-transcript::-webkit-scrollbar {
          width: 10px;
          height: 10px;
        }
        .brainstorm-transcript::-webkit-scrollbar-track {
          background: transparent;
        }
        .brainstorm-transcript::-webkit-scrollbar-thumb {
          background: var(--text-muted);
          border-radius: 5px;
          border: 2px solid var(--surface-2);
        }
        .brainstorm-transcript::-webkit-scrollbar-thumb:hover {
          background: var(--accent);
        }
      `}</style>
    </div>
  );
}

// Detect a stray synthesize-shaped JSON that occasionally leaks into chat
// (e.g. when the user asks claude to "summarize" mid-conversation).
function tryParseProjectPreview(text: string): { projectName: string; context: string } | null {
  const trimmed = text.trim();
  // Strip code fences if present
  const fenceMatch = trimmed.match(/^```(?:json)?\s*\n?([\s\S]*?)\n?```$/);
  const candidate = fenceMatch ? fenceMatch[1].trim() : trimmed;
  if (!candidate.startsWith('{') || !candidate.endsWith('}')) return null;
  try {
    const parsed = JSON.parse(candidate);
    if (typeof parsed.projectName !== 'string' || typeof parsed.context !== 'string') return null;
    if (!parsed.projectName.trim() || !parsed.context.trim()) return null;
    return { projectName: parsed.projectName.trim(), context: parsed.context.trim() };
  } catch {
    return null;
  }
}

function ProjectPreviewCard({ projectName, context }: { projectName: string; context: string }) {
  return (
    <div style={{
      display: 'flex', flexDirection: 'column', gap: 8,
      padding: 12,
      background: 'rgba(199,145,12,0.05)',
      border: '1px solid rgba(199,145,12,0.25)',
      borderRadius: 6,
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 10.5, textTransform: 'uppercase', letterSpacing: '0.08em', color: 'var(--accent)' }}>
        <Sparkles size={11} />
        Project preview
      </div>
      <div style={{
        fontFamily: "'JetBrains Mono', monospace",
        fontSize: 13, fontWeight: 600, color: 'var(--text)',
      }}>{projectName}</div>
      <div style={{ fontSize: 12, color: 'var(--text)', lineHeight: 1.55 }}>{context}</div>
      <div style={{ fontSize: 10.5, color: 'var(--text-muted)', fontStyle: 'italic' }}>
        Hit <span style={{ color: 'var(--accent)' }}>Use this →</span> below to apply.
      </div>
    </div>
  );
}

function ThinkingIndicator() {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
      <div style={{ flexShrink: 0, width: 18, height: 18, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <SaiLogo mode="pulse" size={16} />
      </div>
      <span style={{ fontSize: 11.5, color: 'var(--text-muted)', fontStyle: 'italic' }}>thinking…</span>
    </div>
  );
}
