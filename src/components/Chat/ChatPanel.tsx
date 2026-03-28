import { useState, useEffect, useRef } from 'react';
import ChatMessage from './ChatMessage';
import ChatInput from './ChatInput';
import type { ChatMessage as ChatMessageType } from '../../types';

export default function ChatPanel({ projectPath }: { projectPath: string }) {
  const [messages, setMessages] = useState<ChatMessageType[]>([]);
  const [isStreaming, setIsStreaming] = useState(false);
  const [ready, setReady] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    window.vsai.claudeStart(projectPath || '').then(() => setReady(true));

    const cleanup = window.vsai.claudeOnMessage((msg: any) => {
      if (msg.type === 'ready') {
        setReady(true);
        return;
      }

      if (msg.type === 'done') {
        setIsStreaming(false);
        return;
      }

      if (msg.type === 'error') {
        setMessages(prev => [...prev, {
          id: Date.now().toString(),
          role: 'system',
          content: msg.text || 'Unknown error',
          timestamp: Date.now(),
        }]);
        return;
      }

      // Claude stream-json format:
      // {"type":"assistant","message":{"content":[{"type":"text","text":"..."}]}}
      // {"type":"result","result":"full text here","session_id":"..."}
      if (msg.type === 'assistant' && msg.message?.content) {
        const textBlocks = msg.message.content
          .filter((b: any) => b.type === 'text')
          .map((b: any) => b.text)
          .join('');

        if (textBlocks) {
          setMessages(prev => {
            const last = prev[prev.length - 1];
            if (last?.role === 'assistant' && isStreaming) {
              // Replace with updated content (assistant messages are cumulative)
              return [...prev.slice(0, -1), { ...last, content: textBlocks }];
            }
            return [...prev, {
              id: Date.now().toString(),
              role: 'assistant',
              content: textBlocks,
              timestamp: Date.now(),
            }];
          });
          setIsStreaming(true);
        }
      }

      // Final result — use this as the definitive response
      if (msg.type === 'result' && msg.result) {
        const text = typeof msg.result === 'string' ? msg.result : '';
        if (text) {
          setMessages(prev => {
            const last = prev[prev.length - 1];
            if (last?.role === 'assistant') {
              // Update final content
              return [...prev.slice(0, -1), { ...last, content: text }];
            }
            return [...prev, {
              id: Date.now().toString(),
              role: 'assistant',
              content: text,
              timestamp: Date.now(),
            }];
          });
        }
        setIsStreaming(false);
      }
    });

    return cleanup;
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
      <ChatInput onSend={handleSend} disabled={!ready || isStreaming} />
      <style>{`
        .chat-panel {
          flex: 1;
          display: flex;
          flex-direction: column;
          min-height: 0;
          overflow: hidden;
        }
        .chat-messages {
          flex: 1;
          overflow-y: auto;
          padding: 16px;
          min-height: 0;
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
