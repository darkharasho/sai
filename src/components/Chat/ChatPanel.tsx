import { useState, useEffect, useRef } from 'react';
import ChatMessage from './ChatMessage';
import ChatInput from './ChatInput';
import type { ChatMessage as ChatMessageType } from '../../types';

export default function ChatPanel({ projectPath }: { projectPath: string }) {
  const [messages, setMessages] = useState<ChatMessageType[]>([]);
  const [isStreaming, setIsStreaming] = useState(false);
  const [claudeStarted, setClaudeStarted] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!projectPath) return;

    window.vsai.claudeStart(projectPath).then(() => {
      setClaudeStarted(true);
    });

    const cleanup = window.vsai.claudeOnMessage((msg: any) => {
      if (msg.type === 'assistant' || msg.type === 'content_block_delta') {
        setMessages(prev => {
          const last = prev[prev.length - 1];
          if (last?.role === 'assistant' && isStreaming) {
            return [...prev.slice(0, -1), {
              ...last,
              content: last.content + (msg.content || msg.delta?.text || ''),
            }];
          }
          return [...prev, {
            id: Date.now().toString(),
            role: 'assistant',
            content: msg.content || msg.delta?.text || '',
            timestamp: Date.now(),
          }];
        });
        setIsStreaming(true);
      } else if (msg.type === 'result' || msg.type === 'message_stop') {
        setIsStreaming(false);
      } else if (msg.type === 'error') {
        setMessages(prev => [...prev, {
          id: Date.now().toString(),
          role: 'system',
          content: `Error: ${msg.text || msg.error?.message || 'Unknown error'}`,
          timestamp: Date.now(),
        }]);
        setIsStreaming(false);
      } else if (msg.type === 'exit') {
        setClaudeStarted(false);
      }
    });

    return () => {
      cleanup();
      setClaudeStarted(false);
    };
  }, [projectPath]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const handleSend = (text: string) => {
    setMessages(prev => [...prev, {
      id: Date.now().toString(),
      role: 'user',
      content: text,
      timestamp: Date.now(),
    }]);
    window.vsai.claudeSend(text);
    setIsStreaming(true);
  };

  return (
    <div className="chat-panel">
      <div className="chat-messages">
        {messages.length === 0 ? (
          <div className="chat-empty">
            <div className="chat-empty-title">VSAI</div>
            <div className="chat-empty-subtitle">
              {projectPath ? 'Describe what to build' : 'Select a project to get started'}
            </div>
          </div>
        ) : (
          messages.map(msg => <ChatMessage key={msg.id} message={msg} />)
        )}
        <div ref={messagesEndRef} />
      </div>
      <ChatInput onSend={handleSend} disabled={!projectPath || !claudeStarted} />
      <style>{`
        .chat-panel {
          flex: 1;
          display: flex;
          flex-direction: column;
          overflow: hidden;
        }
        .chat-messages {
          flex: 1;
          overflow-y: auto;
          padding: 16px;
        }
        .chat-empty {
          display: flex;
          flex-direction: column;
          align-items: center;
          justify-content: center;
          height: 100%;
          gap: 8px;
        }
        .chat-empty-title {
          font-size: 28px;
          font-weight: 700;
          color: var(--accent);
          letter-spacing: 2px;
        }
        .chat-empty-subtitle {
          font-size: 14px;
          color: var(--text-secondary);
        }
      `}</style>
    </div>
  );
}
