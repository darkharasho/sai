// src/components/NewProjectTakeover/ConversationPane.tsx
import { useState, useRef, useEffect } from 'react';
import { Send, Terminal, Sparkles } from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import SaiLogo from '../SaiLogo';
import type { BrainstormMessage } from './useBrainstormBrief';

export interface ConversationPaneProps {
  messages: BrainstormMessage[];
  streamingText: string;
  isStreaming: boolean;
  error: string | null;
  questionCount: number;   // status line: `question N of 5` while !ready
  briefReady: boolean;     // status line: `brief ready — refine or create`
  onSend(text: string): void;
}

export default function ConversationPane({
  messages,
  streamingText,
  isStreaming,
  error,
  questionCount,
  briefReady,
  onSend,
}: ConversationPaneProps): JSX.Element {
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

  const canSend = !!draft.trim() && !isStreaming;
  const showEmptyState = messages.length === 0 && !isStreaming;
  const hasAnyContent = messages.length > 0 || !!streamingText;

  const statusText = briefReady
    ? 'brief ready — refine or create'
    : `question ${Math.min(questionCount, 5)} of 5`;

  return (
    <div
      data-testid="conversation-pane"
      style={{
        display: 'flex',
        flexDirection: 'column',
        height: '100%',
        overflow: 'hidden',
      }}
    >
      {/* Transcript */}
      <div
        ref={scrollRef}
        className="brainstorm-transcript"
        style={{
          flex: 1,
          overflowY: 'auto',
          display: 'flex',
          flexDirection: 'column',
          gap: 14,
          padding: '20px 18px 8px',
        }}
      >
        {showEmptyState && (
          <div style={{
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            gap: 8,
            color: 'var(--text-muted)',
            fontSize: 12,
            padding: '40px 16px',
            textAlign: 'center',
            margin: 'auto',
          }}>
            <Sparkles size={18} color="var(--accent)" style={{ opacity: 0.7 }} />
            <div style={{ fontSize: 13, color: 'var(--text)', fontWeight: 500 }}>Think it through</div>
            <div style={{ fontSize: 11.5, lineHeight: 1.55, maxWidth: 300 }}>
              Describe what you want to build — the brief assembles itself on the right.
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

        {/* Status line — shown under last assistant message once there is content */}
        {hasAnyContent && !isStreaming && messages.some(m => m.role === 'assistant') && (
          <div
            data-testid="brainstorm-status-line"
            style={{
              fontSize: 11,
              color: briefReady ? 'var(--accent)' : 'var(--text-muted)',
              paddingLeft: 28,
              paddingBottom: 4,
              fontStyle: 'italic',
            }}
          >
            {statusText}
          </div>
        )}
      </div>

      {/* Composer */}
      <div style={{ padding: '8px 18px 16px', flexShrink: 0 }}>
        <div
          style={{
            display: 'flex',
            gap: 6,
            alignItems: 'stretch',
            background: 'var(--surface-2)',
            border: `1px solid ${inputFocused ? 'var(--accent)' : 'var(--border-subtle)'}`,
            borderRadius: 6,
            padding: 4,
            transition: 'border-color 120ms ease',
          }}
        >
          <textarea
            data-testid="brainstorm-composer"
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
              background: 'transparent',
              border: 'none',
              outline: 'none',
              padding: '6px 8px',
              fontSize: 13,
              color: 'var(--text)',
              fontFamily: 'inherit',
              resize: 'none',
              lineHeight: 1.45,
            }}
          />
          <button
            data-testid="brainstorm-send-btn"
            onClick={handleSend}
            disabled={!canSend}
            aria-label="Send"
            title="Send (Enter)"
            style={{
              background: canSend ? 'rgba(199,145,12,0.12)' : 'transparent',
              border: `1px solid ${canSend ? 'var(--accent)' : 'transparent'}`,
              color: canSend ? 'var(--accent)' : 'var(--text-muted)',
              borderRadius: 4,
              padding: '0 12px',
              cursor: canSend ? 'pointer' : 'not-allowed',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              transition: 'background 120ms ease, color 120ms ease, border-color 120ms ease',
              alignSelf: 'stretch',
            }}
          >
            <Send size={14} />
          </button>
        </div>
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
          border-left: 2px solid var(--accent);
          background: var(--surface-2);
          padding: 8px 12px;
          border-radius: 0 8px 8px 0;
          margin: 6px 0;
          color: var(--text);
        }
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

// ─── Message ─────────────────────────────────────────────────────────────────

function Message({
  role,
  text,
  streaming,
  showDivider,
}: {
  role: 'user' | 'assistant';
  text: string;
  streaming?: boolean;
  showDivider?: boolean;
}) {
  const isUser = role === 'user';
  return (
    <div style={{
      display: 'flex',
      alignItems: 'flex-start',
      gap: 10,
      paddingTop: showDivider ? 12 : 0,
      borderTop: showDivider ? '1px dashed var(--border-hairline)' : 'none',
    }}>
      <div style={{
        flexShrink: 0,
        width: 18,
        height: 18,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        marginTop: 1,
      }}>
        {isUser
          ? <Terminal size={13} color="var(--green, #4caf80)" strokeWidth={2.5} />
          : <SaiLogo mode="static" size={16} />}
      </div>
      <div
        className={`brainstorm-msg brainstorm-msg-${role}${streaming ? ' brainstorm-msg-streaming' : ''}`}
        style={{
          flex: 1,
          minWidth: 0,
          fontSize: 12.5,
          color: 'var(--text)',
          lineHeight: 1.55,
        }}
      >
        {isUser ? (
          <div style={{ whiteSpace: 'pre-wrap' }}>{text}</div>
        ) : (
          <ReactMarkdown remarkPlugins={[remarkGfm]}>{text}</ReactMarkdown>
        )}
      </div>
    </div>
  );
}

// ─── ThinkingIndicator ────────────────────────────────────────────────────────

function ThinkingIndicator() {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
      <div style={{
        flexShrink: 0,
        width: 18,
        height: 18,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
      }}>
        <SaiLogo mode="pulse" size={16} />
      </div>
      <span style={{ fontSize: 11.5, color: 'var(--text-muted)', fontStyle: 'italic' }}>thinking…</span>
    </div>
  );
}
