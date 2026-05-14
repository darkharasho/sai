import { useState, useRef, useEffect } from 'react';
import { Send, Brain } from 'lucide-react';
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
      <div style={{ padding: 16, fontSize: 12, color: '#f87171' }}>
        AI brainstorm unavailable — {startError}. You can still fill out the Setup tab manually.
      </div>
    );
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10, height: 360 }}>
      <div
        ref={scrollRef}
        style={{
          flex: 1, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 8,
          padding: 10, background: 'var(--bg-secondary)', border: '1px solid var(--border)', borderRadius: 5,
        }}
      >
        {messages.length === 0 && !isStreaming && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, color: 'var(--text-muted)', fontSize: 12 }}>
            <Brain size={14} />
            <span>Talk through what you want to build before we scaffold anything.</span>
          </div>
        )}
        {messages.map((m, i) => (
          <Bubble key={i} role={m.role} text={m.content} />
        ))}
        {isStreaming && streamingText && <Bubble role="assistant" text={streamingText} />}
        {isStreaming && !streamingText && (
          <div style={{ fontSize: 11, color: 'var(--text-muted)', fontStyle: 'italic' }}>thinking…</div>
        )}
        {error && (
          <div style={{ fontSize: 11, color: '#f87171' }}>{error}</div>
        )}
      </div>
      <div style={{ display: 'flex', gap: 6 }}>
        <textarea
          value={draft}
          onChange={e => setDraft(e.target.value)}
          onKeyDown={e => {
            if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
              e.preventDefault();
              handleSend();
            }
          }}
          placeholder="What are you thinking about building?"
          rows={2}
          style={{
            flex: 1,
            background: 'var(--bg-secondary)', border: '1px solid var(--border)',
            borderRadius: 5, padding: '7px 10px', fontSize: 13, color: 'var(--text)',
            fontFamily: 'system-ui, sans-serif', resize: 'none',
          }}
        />
        <button
          onClick={handleSend}
          disabled={!draft.trim() || isStreaming}
          aria-label="Send"
          style={{
            background: 'none',
            border: `1px solid ${draft.trim() && !isStreaming ? 'var(--accent)' : 'var(--border)'}`,
            color: draft.trim() && !isStreaming ? 'var(--accent)' : 'var(--text-muted)',
            borderRadius: 5, padding: '0 12px', cursor: draft.trim() && !isStreaming ? 'pointer' : 'not-allowed',
          }}
        >
          <Send size={14} />
        </button>
      </div>
    </div>
  );
}

function Bubble({ role, text }: { role: 'user' | 'assistant'; text: string }) {
  const isUser = role === 'user';
  return (
    <div
      style={{
        alignSelf: isUser ? 'flex-end' : 'flex-start',
        maxWidth: '85%',
        background: isUser ? 'rgba(199,145,12,0.1)' : 'var(--bg-elevated)',
        border: `1px solid ${isUser ? 'rgba(199,145,12,0.3)' : 'var(--border)'}`,
        borderRadius: 6, padding: '6px 10px',
        fontSize: 12.5, color: 'var(--text)', whiteSpace: 'pre-wrap', lineHeight: 1.45,
      }}
    >
      {text}
    </div>
  );
}
