import ReactMarkdown from 'react-markdown';
import rehypeHighlight from 'rehype-highlight';
import 'highlight.js/styles/monokai.css';
import { Circle, ChevronRight } from 'lucide-react';
import ToolCallCard from './ToolCallCard';
import type { ChatMessage as ChatMessageType } from '../../types';

function getDotColor(role: string): string {
  if (role === 'assistant') return 'var(--accent)';
  if (role === 'user') return 'var(--green)';
  if (role === 'system') return 'var(--red)';
  return 'var(--text-muted)';
}

export default function ChatMessage({ message }: { message: ChatMessageType }) {
  const dotColor = getDotColor(message.role);

  return (
    <div className={`chat-msg chat-msg-${message.role}`}>
      {message.content && (
        <div className="chat-msg-content">
          {message.role === 'user'
            ? <ChevronRight size={14} color="var(--green)" className="chat-msg-dot" />
            : <Circle size={8} fill={dotColor} stroke={dotColor} className="chat-msg-dot" />}
          <div className="chat-msg-body">
            <ReactMarkdown rehypePlugins={[rehypeHighlight]}>{message.content}</ReactMarkdown>
          </div>
        </div>
      )}
      {message.toolCalls?.map((tc, i) => (
        <ToolCallCard key={i} toolCall={tc} />
      ))}
      <style>{`
        .chat-msg { margin-bottom: 12px; }
        .chat-msg-content {
          display: flex;
          gap: 10px;
          align-items: flex-start;
        }
        .chat-msg-dot {
          margin-top: 7px;
          flex-shrink: 0;
        }
        .chat-msg-body { color: var(--text); line-height: 1.6; flex: 1; min-width: 0; }
        .chat-msg-body p { margin-bottom: 8px; }
        .chat-msg-body code {
          background: var(--bg-secondary);
          padding: 2px 6px;
          border-radius: 3px;
          font-size: 12px;
        }
        .chat-msg-body pre code { background: none; padding: 0; }
        .chat-msg-body pre {
          background: var(--bg-secondary);
          border-radius: 6px;
          padding: 12px;
          overflow-x: auto;
          margin: 8px 0;
        }
        .chat-msg-body pre code.hljs.language-diff {
          padding: 0;
        }
        .chat-msg-body pre code.hljs.language-diff .hljs-addition {
          color: #a6e22e;
          background: rgba(166, 226, 46, 0.1);
          display: inline-block;
          width: 100%;
        }
        .chat-msg-body pre code.hljs.language-diff .hljs-deletion {
          color: #f92672;
          background: rgba(249, 38, 114, 0.1);
          display: inline-block;
          width: 100%;
        }
        .chat-msg-body pre code.hljs.language-diff .hljs-meta {
          color: #66d9ef;
        }
      `}</style>
    </div>
  );
}
