import ReactMarkdown from 'react-markdown';
import ToolCallCard from './ToolCallCard';
import type { ChatMessage as ChatMessageType } from '../../types';

export default function ChatMessage({ message }: { message: ChatMessageType }) {
  return (
    <div className={`chat-msg chat-msg-${message.role}`}>
      <div className="chat-msg-header">
        {message.role === 'assistant' ? 'Claude' : message.role === 'user' ? 'You' : 'System'}
      </div>
      <div className="chat-msg-body">
        <ReactMarkdown>{message.content}</ReactMarkdown>
      </div>
      {message.toolCalls?.map((tc, i) => (
        <ToolCallCard key={i} toolCall={tc} />
      ))}
      <style>{`
        .chat-msg { margin-bottom: 16px; }
        .chat-msg-header { font-size: 12px; font-weight: 600; margin-bottom: 4px; }
        .chat-msg-user .chat-msg-header { color: var(--green); }
        .chat-msg-assistant .chat-msg-header { color: var(--accent); }
        .chat-msg-system .chat-msg-header { color: var(--red); }
        .chat-msg-body { color: var(--text); line-height: 1.6; }
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
      `}</style>
    </div>
  );
}
