import { useEffect, useRef } from 'react';
import { Terminal } from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import ToolCard from './ToolCard';
import SaiLogo from '../branding/SaiLogo';
import ThinkingAnimation from '../branding/ThinkingAnimation';
import GitHubWatcherCard from './GitHubWatcherCard';
import { detectWatchTargets } from './githubWatcher';
import type { GithubWatcherStore } from './githubWatcherStore';
import { useVisualViewportHeight } from '../lib/useVisualViewport';

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
  /** Set on the assistant's terminal envelope (`result`) so we can render
   *  the desktop-style `[Nms]` tag above the bubble body. */
  durationMs?: number;
}

interface Props {
  messages: TranscriptMessage[];
  /** Whether the assistant is currently working (between user send and turn done). */
  streaming?: boolean;
  awaitingQuestion?: boolean;
  onAnswerQuestion?: (toolUseId: string, answers: Record<string, string | string[]>) => void;
  watcherStore?: GithubWatcherStore;
}

export default function Transcript({ messages, streaming = false, awaitingQuestion = false, onAnswerQuestion, watcherStore }: Props) {
  const ref = useRef<HTMLDivElement>(null);
  const stickToBottomRef = useRef(true);
  const isTouchingRef = useRef(false);

  // Track whether the user has scrolled away from the bottom — only auto-stick
  // when they're already near the bottom, so manual scroll-up isn't yanked.
  // Also gate the auto-stick on touch state because iOS Safari withholds the
  // `scroll` event until the gesture ends — without this gate, a ResizeObserver
  // fire mid-touch would re-stick stickToBottomRef-still-true to the bottom
  // and the user could never reach a non-bottom position.
  useEffect(() => {
    const container = ref.current;
    if (!container) return;
    const onScroll = () => {
      const distance = container.scrollHeight - container.scrollTop - container.clientHeight;
      stickToBottomRef.current = distance < 60;
    };
    const onTouchStart = () => { isTouchingRef.current = true; };
    const onTouchEnd = () => {
      isTouchingRef.current = false;
      // After the gesture, re-evaluate stick state from the now-final scrollTop
      // so subsequent ResizeObserver fires honor where the user landed.
      const distance = container.scrollHeight - container.scrollTop - container.clientHeight;
      stickToBottomRef.current = distance < 60;
    };
    container.addEventListener('scroll', onScroll, { passive: true });
    container.addEventListener('touchstart', onTouchStart, { passive: true });
    container.addEventListener('touchend', onTouchEnd, { passive: true });
    container.addEventListener('touchcancel', onTouchEnd, { passive: true });
    return () => {
      container.removeEventListener('scroll', onScroll);
      container.removeEventListener('touchstart', onTouchStart);
      container.removeEventListener('touchend', onTouchEnd);
      container.removeEventListener('touchcancel', onTouchEnd);
    };
  }, []);

  // Watch the content for size changes (new messages, tool-card growth as
  // more questions stream in, code-block expansion) and re-pin to the bottom
  // if the user hasn't scrolled away.
  useEffect(() => {
    const container = ref.current;
    if (!container) return;
    const stick = () => {
      if (!stickToBottomRef.current) return;
      if (isTouchingRef.current) return; // don't fight an in-progress touch
      container.scrollTop = container.scrollHeight;
    };
    stick();
    const ro = new ResizeObserver(() => stick());
    // Observe the scroll container itself (its scrollHeight grows with content).
    for (const child of Array.from(container.children)) ro.observe(child);
    return () => ro.disconnect();
  }, [messages.length]);

  // Explicit re-pin on streaming-text growth (text bubbles don't trigger
  // ResizeObserver fast enough on every character).
  useEffect(() => {
    const container = ref.current;
    if (!container || !stickToBottomRef.current) return;
    container.scrollTop = container.scrollHeight;
  }, [messages[messages.length - 1]?.text?.length, streaming]);

  // When the on-screen keyboard opens/closes on iOS, the visual viewport
  // height changes but ResizeObserver on the transcript children doesn't
  // necessarily fire (the children themselves haven't resized). Re-pin
  // explicitly so the last message stays visible above the keyboard.
  const viewportH = useVisualViewportHeight();
  useEffect(() => {
    const container = ref.current;
    if (!container || !stickToBottomRef.current) return;
    if (isTouchingRef.current) return;
    container.scrollTop = container.scrollHeight;
  }, [viewportH]);

  return (
    <div
      ref={ref}
      style={{
        // Absolute fill of the position:relative parent — sidesteps iOS Safari
        // failing to make `overflow: auto + height: 100%` inside a flex chain
        // an actual scroll container.
        position: 'absolute',
        inset: 0,
        overflowY: 'auto',
        overflowX: 'hidden',
        WebkitOverflowScrolling: 'touch',
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
            <div key={m.id} data-msg-id={m.id} style={{ width: '100%', minWidth: 0, flexShrink: 0 }}>
              <ToolCard
                name={m.toolName ?? 'tool'}
                input={m.toolInput}
                result={m.toolResult}
                status={m.toolStatus ?? 'running'}
                toolUseId={m.toolUseId}
                onAnswerQuestion={onAnswerQuestion}
              />
            </div>
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
                flexShrink: 0,
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
        const formatMs = (ms: number) => ms < 1000 ? `${Math.round(ms)}ms` : `${(ms / 1000).toFixed(1)}s`;
        const watcherTargets = !isUser && m.text ? detectWatchTargets(m.text) : [];

        return (
          <div
            key={m.id}
            className={`pwa-chat-msg pwa-chat-msg-${m.role}${m.streaming ? ' pwa-chat-msg-streaming' : ''}`}
          >
            <div className="pwa-chat-msg-content">
              {isUser
                ? <Terminal size={14} color="var(--green)" strokeWidth={2.5} className="pwa-chat-msg-dot" />
                : <SaiLogo mode="static" size={16} className="pwa-chat-msg-dot" />}
              <div className="pwa-chat-msg-body">
                {!isUser && typeof m.durationMs === 'number' && (
                  <div className="pwa-chat-msg-duration">[{formatMs(m.durationMs)}]</div>
                )}
                {isUser ? (
                  <pre className="pwa-chat-msg-user-text">{m.text}</pre>
                ) : (
                  <ReactMarkdown remarkPlugins={[remarkGfm]} components={mdComponents}>
                    {m.text ?? ''}
                  </ReactMarkdown>
                )}
                {watcherTargets.map((t) => (
                  <GitHubWatcherCard key={t.url} messageId={m.id} target={t} watcherStore={watcherStore} />
                ))}
              </div>
            </div>
          </div>
        );
      })}
      {streaming && !awaitingQuestion && (
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
      <style>{`
        .pwa-chat-msg {
          display: flex;
          flex-direction: column;
          gap: 4px;
          width: 100%;
          min-width: 0;
          flex-shrink: 0;
        }
        .pwa-chat-msg-content {
          display: grid;
          grid-template-columns: 18px 1fr;
          column-gap: 8px;
          align-items: flex-start;
          width: 100%;
          min-width: 0;
        }
        .pwa-chat-msg-dot {
          margin-top: 2px;
          flex-shrink: 0;
        }
        .pwa-chat-msg-body {
          min-width: 0;
          word-break: break-word;
          overflow-wrap: anywhere;
          font-size: 14px;
          line-height: 1.5;
          color: var(--text);
        }
        .pwa-chat-msg-user .pwa-chat-msg-body {
          color: var(--text);
        }
        .pwa-chat-msg-duration {
          font-family: 'Geist Mono', ui-monospace, SFMono-Regular, Menlo, monospace;
          font-variant-numeric: tabular-nums;
          font-size: 10px;
          color: #6b6253;
          letter-spacing: 0.04em;
          margin-bottom: 4px;
        }
        .pwa-chat-msg-user-text {
          margin: 0;
          white-space: pre-wrap;
          word-break: break-word;
          overflow-wrap: anywhere;
          font-family: inherit;
          font-size: 14px;
          line-height: 1.5;
        }
        .pwa-chat-msg-body p:first-child { margin-top: 0; }
        .pwa-chat-msg-body p:last-child { margin-bottom: 0; }
        .pwa-chat-msg-streaming .pwa-chat-msg-body::after {
          content: '';
          display: inline-block;
          width: 0.5em;
          height: 0.95em;
          background: var(--accent);
          vertical-align: -0.15em;
          margin-left: 3px;
          animation: pwa-chat-streaming-blink 1s steps(1) infinite;
        }
        @keyframes pwa-chat-streaming-blink {
          0%, 49% { opacity: 1; }
          50%, 100% { opacity: 0; }
        }
        @media (prefers-reduced-motion: reduce) {
          .pwa-chat-msg-streaming .pwa-chat-msg-body::after { animation: none; opacity: 1; }
        }
      `}</style>
    </div>
  );
}
