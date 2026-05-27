import { useEffect, useRef } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import ToolCard from './ToolCard';
import ThinkingAnimation from '../branding/ThinkingAnimation';

const mdComponents = {
  p: (props: any) => <p style={{ margin: '0 0 8px 0', lineHeight: 1.5 }} {...props} />,
  h1: (props: any) => <h1 style={{ fontSize: 18, fontWeight: 700, margin: '12px 0 8px' }} {...props} />,
  h2: (props: any) => <h2 style={{ fontSize: 16, fontWeight: 700, margin: '12px 0 6px' }} {...props} />,
  h3: (props: any) => <h3 style={{ fontSize: 15, fontWeight: 600, margin: '10px 0 4px' }} {...props} />,
  h4: (props: any) => <h4 style={{ fontSize: 14, fontWeight: 600, margin: '8px 0 4px' }} {...props} />,
  ul: (props: any) => <ul style={{ margin: '4px 0 8px 18px', padding: 0 }} {...props} />,
  ol: (props: any) => <ol style={{ margin: '4px 0 8px 22px', padding: 0 }} {...props} />,
  li: (props: any) => <li style={{ marginBottom: 2 }} {...props} />,
  a: (props: any) => <a style={{ color: 'var(--blue)', textDecoration: 'underline' }} target="_blank" rel="noreferrer" {...props} />,
  code: ({ inline, ...props }: any) => inline
    ? <code style={{
        fontFamily: '"Geist Mono", ui-monospace, monospace',
        fontSize: '0.9em',
        background: 'var(--bg-input)',
        padding: '1px 5px',
        borderRadius: 4,
      }} {...props} />
    : <code style={{ fontFamily: '"Geist Mono", ui-monospace, monospace', fontSize: 12, lineHeight: 1.45 }} {...props} />,
  pre: (props: any) => (
    <pre style={{
      margin: '8px 0',
      padding: 10,
      background: 'var(--bg-input)',
      border: '1px solid var(--border)',
      borderRadius: 8,
      overflowX: 'auto',
      whiteSpace: 'pre-wrap',
      wordBreak: 'break-word',
      overflowWrap: 'anywhere',
    }} {...props} />
  ),
  blockquote: (props: any) => (
    <blockquote style={{
      margin: '6px 0',
      padding: '4px 10px',
      borderLeft: '3px solid var(--border)',
      color: 'var(--text-secondary)',
    }} {...props} />
  ),
  hr: () => <hr style={{ border: 0, borderTop: '1px solid var(--border)', margin: '10px 0' }} />,
  table: (props: any) => <table style={{ borderCollapse: 'collapse', margin: '8px 0', fontSize: 12 }} {...props} />,
  th: (props: any) => <th style={{ border: '1px solid var(--border)', padding: '4px 8px', textAlign: 'left' }} {...props} />,
  td: (props: any) => <td style={{ border: '1px solid var(--border)', padding: '4px 8px' }} {...props} />,
  strong: (props: any) => <strong style={{ fontWeight: 600 }} {...props} />,
};

export interface TranscriptMessage {
  id: string;
  role: 'user' | 'assistant' | 'tool' | 'system';
  text?: string;
  toolName?: string;
  toolUseId?: string;
  toolInput?: Record<string, unknown>;
  toolResult?: string | Record<string, unknown>;
  toolStatus?: 'running' | 'done' | 'error';
  streaming?: boolean;
}

interface Props {
  messages: TranscriptMessage[];
  /** Whether the assistant is currently working (between user send and turn done). */
  streaming?: boolean;
  onAnswerQuestion?: (toolUseId: string, answers: Record<string, string | string[]>) => void;
}

export default function Transcript({ messages, streaming = false, onAnswerQuestion }: Props) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!ref.current) return;
    ref.current.scrollTop = ref.current.scrollHeight;
  }, [messages.length, messages[messages.length - 1]?.text?.length, streaming]);

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
              toolUseId={m.toolUseId}
              onAnswerQuestion={onAnswerQuestion}
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
            {isUser ? (
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
            ) : (
              <ReactMarkdown remarkPlugins={[remarkGfm]} components={mdComponents}>
                {m.text ?? ''}
              </ReactMarkdown>
            )}
          </div>
        );
      })}
      {streaming && (
        <div
          aria-live="polite"
          style={{
            alignSelf: 'flex-start',
            paddingLeft: 4,
          }}
        >
          <ThinkingAnimation size={18} />
        </div>
      )}
    </div>
  );
}
