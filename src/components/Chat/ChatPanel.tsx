import { useState, useEffect, useRef } from 'react';
import ChatMessage from './ChatMessage';
import ChatInput from './ChatInput';
import type { ChatMessage as ChatMessageType, ToolCall } from '../../types';

export default function ChatPanel({ projectPath }: { projectPath: string }) {
  const [messages, setMessages] = useState<ChatMessageType[]>([]);
  const [isStreaming, setIsStreaming] = useState(false);
  const [ready, setReady] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const currentAssistantRef = useRef<string | null>(null);

  useEffect(() => {
    window.vsai.claudeStart(projectPath || '').then(() => setReady(true));

    const cleanup = window.vsai.claudeOnMessage((msg: any) => {
      if (msg.type === 'ready') {
        setReady(true);
        return;
      }

      if (msg.type === 'process_exit') {
        setReady(false);
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

      // System messages (init, hooks) — ignore for UI
      if (msg.type === 'system') {
        return;
      }

      // Rate limit events — could show as warning
      if (msg.type === 'rate_limit_event') {
        return;
      }

      // Assistant message — contains streaming content
      if (msg.type === 'assistant' && msg.message?.content) {
        setIsStreaming(true);
        const textBlocks = msg.message.content
          .filter((b: any) => b.type === 'text')
          .map((b: any) => b.text)
          .join('');

        const toolBlocks: ToolCall[] = msg.message.content
          .filter((b: any) => b.type === 'tool_use')
          .map((b: any) => ({
            type: b.name?.includes('Edit') || b.name?.includes('Write') ? 'file_edit' as const :
                  b.name?.includes('Bash') ? 'terminal_command' as const :
                  b.name?.includes('Read') ? 'file_read' as const : 'other' as const,
            name: b.name || 'tool',
            input: typeof b.input === 'string' ? b.input : JSON.stringify(b.input, null, 2),
          }));

        if (textBlocks || toolBlocks.length > 0) {
          setMessages(prev => {
            const last = prev[prev.length - 1];
            if (last?.role === 'assistant' && currentAssistantRef.current === last.id) {
              return [...prev.slice(0, -1), {
                ...last,
                content: textBlocks || last.content,
                toolCalls: toolBlocks.length > 0 ? toolBlocks : last.toolCalls,
              }];
            }
            const newId = Date.now().toString();
            currentAssistantRef.current = newId;
            return [...prev, {
              id: newId,
              role: 'assistant',
              content: textBlocks,
              timestamp: Date.now(),
              toolCalls: toolBlocks.length > 0 ? toolBlocks : undefined,
            }];
          });
        }
      }

      // Result — final response, marks end of turn
      if (msg.type === 'result') {
        setIsStreaming(false);
        currentAssistantRef.current = null;

        // Update with final text if available
        if (msg.result && typeof msg.result === 'string') {
          setMessages(prev => {
            const last = prev[prev.length - 1];
            if (last?.role === 'assistant') {
              return [...prev.slice(0, -1), { ...last, content: msg.result }];
            }
            return prev;
          });
        }
      }
    });

    return cleanup;
  }, [projectPath]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, isStreaming]);

  const handleSend = (text: string) => {
    setMessages(prev => [...prev, {
      id: Date.now().toString(),
      role: 'user',
      content: text,
      timestamp: Date.now(),
    }]);
    currentAssistantRef.current = null;
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
        {isStreaming && (
          <div className="thinking-indicator">
            <div className="thinking-bar" />
            <span className="thinking-label">
              {messages[messages.length - 1]?.role === 'assistant' ? 'Writing...' : 'Thinking...'}
            </span>
          </div>
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
        .thinking-indicator {
          display: flex;
          align-items: center;
          gap: 10px;
          padding: 12px 0;
        }
        .thinking-bar {
          width: 3px;
          height: 20px;
          background: var(--accent);
          border-radius: 2px;
          animation: thinking-pulse 1.5s ease-in-out infinite;
        }
        .thinking-label {
          font-size: 13px;
          color: var(--accent);
          font-style: italic;
          animation: thinking-fade 1.5s ease-in-out infinite;
        }
        @keyframes thinking-pulse {
          0%, 100% { opacity: 0.3; height: 12px; }
          50% { opacity: 1; height: 20px; }
        }
        @keyframes thinking-fade {
          0%, 100% { opacity: 0.5; }
          50% { opacity: 1; }
        }
      `}</style>
    </div>
  );
}
