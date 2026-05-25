import { useEffect, useRef } from 'react';
import ToolCard from './ToolCard';
import ThinkingAnimation from '../branding/ThinkingAnimation';

export interface TranscriptMessage {
  id: string;
  role: 'user' | 'assistant' | 'tool' | 'system';
  text?: string;
  toolName?: string;
  toolInput?: Record<string, unknown>;
  toolResult?: string | Record<string, unknown>;
  toolStatus?: 'running' | 'done' | 'error';
  streaming?: boolean;
}

interface Props {
  messages: TranscriptMessage[];
}

export default function Transcript({ messages }: Props) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!ref.current) return;
    ref.current.scrollTop = ref.current.scrollHeight;
  }, [messages.length, messages[messages.length - 1]?.text?.length]);

  return (
    <div
      ref={ref}
      style={{
        height: '100%',
        overflowY: 'auto',
        overflowX: 'hidden',
        padding: '16px 14px',
        display: 'flex',
        flexDirection: 'column',
        gap: 12,
        background: 'var(--bg-primary)',
      }}
    >
      {messages.map((m) => {
        if (m.role === 'tool') {
          return (
            <ToolCard
              key={m.id}
              name={m.toolName ?? 'tool'}
              input={m.toolInput}
              result={m.toolResult}
              status={m.toolStatus ?? 'running'}
            />
          );
        }

        // System bubbles get a muted center-aligned style
        if (m.role === 'system') {
          return (
            <div
              key={m.id}
              style={{
                alignSelf: 'center',
                maxWidth: '90%',
                color: 'var(--text-muted)',
                fontSize: 11,
                fontStyle: 'italic',
                fontFamily: '"Geist Mono", ui-monospace, monospace',
              }}
            >
              {m.text}
            </div>
          );
        }

        const isUser = m.role === 'user';
        const bubbleStyle: React.CSSProperties = {
          alignSelf: isUser ? 'flex-end' : 'flex-start',
          maxWidth: '88%',
          minWidth: 0,
          padding: '10px 14px',
          fontSize: 14,
          lineHeight: 1.5,
          background: isUser ? 'var(--accent)' : 'var(--bg-secondary)',
          color: isUser ? '#000' : 'var(--text)',
          border: isUser ? '1px solid var(--accent)' : '1px solid var(--border)',
          borderRadius: 12,
          // Soften one corner to mark direction (chat-bubble convention)
          borderBottomRightRadius: isUser ? 4 : 12,
          borderBottomLeftRadius: isUser ? 12 : 4,
        };

        return (
          <div key={m.id} style={bubbleStyle}>
            {m.streaming && !m.text ? (
              <ThinkingAnimation size={18} />
            ) : (
              <pre
                style={{
                  margin: 0,
                  whiteSpace: 'pre-wrap',
                  wordBreak: 'break-word',
                  overflowWrap: 'anywhere',
                  fontFamily: 'inherit',
                }}
              >
                {m.text}
              </pre>
            )}
          </div>
        );
      })}
    </div>
  );
}
