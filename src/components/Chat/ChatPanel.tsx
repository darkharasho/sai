import { useState, useEffect, useRef } from 'react';
import ChatMessage from './ChatMessage';
import ChatInput from './ChatInput';
import type { ChatMessage as ChatMessageType, ToolCall } from '../../types';

export default function ChatPanel({ projectPath }: { projectPath: string }) {
  const [messages, setMessages] = useState<ChatMessageType[]>([]);
  const [isStreaming, setIsStreaming] = useState(false);
  const [ready, setReady] = useState(false);
  const [slashCommands, setSlashCommands] = useState<string[]>([]);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    window.vsai.claudeStart(projectPath || '').then(() => setReady(true));

    const cleanup = window.vsai.claudeOnMessage((msg: any) => {
      if (msg.type === 'ready') {
        setReady(true);
        return;
      }

      if (msg.type === 'streaming_start') {
        setIsStreaming(true);
        return;
      }

      // Process exited — turn is fully complete
      if (msg.type === 'done') {
        setIsStreaming(false);
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

      // Capture slash commands from init
      if (msg.type === 'system' && msg.subtype === 'init' && msg.slash_commands) {
        setSlashCommands(msg.slash_commands);
        return;
      }

      // Skip other system/rate_limit noise
      if (msg.type === 'system' || msg.type === 'rate_limit_event' || msg.type === 'user') {
        return;
      }

      // Assistant message — streaming content + tool calls
      if (msg.type === 'assistant' && msg.message?.content) {
        const textParts: string[] = [];
        const tools: ToolCall[] = [];

        for (const block of msg.message.content) {
          if (block.type === 'text' && block.text) {
            textParts.push(block.text);
          }
          if (block.type === 'tool_use') {
            tools.push({
              type: block.name?.includes('Edit') || block.name?.includes('Write') ? 'file_edit' :
                    block.name?.includes('Bash') ? 'terminal_command' :
                    block.name?.includes('Read') || block.name?.includes('Glob') || block.name?.includes('Grep') ? 'file_read' : 'other',
              name: block.name || 'tool',
              input: typeof block.input === 'string' ? block.input :
                     typeof block.input === 'object' ? JSON.stringify(block.input, null, 2) : '',
            });
          }
        }

        const text = textParts.join('');

        if (text || tools.length > 0) {
          setMessages(prev => {
            // Each assistant message is a new message in the chat
            // (Claude may send multiple during multi-turn)
            return [...prev, {
              id: `${Date.now()}-${Math.random()}`,
              role: 'assistant',
              content: text,
              timestamp: Date.now(),
              toolCalls: tools.length > 0 ? tools : undefined,
            }];
          });
        }
      }

      // Result — final answer for this turn
      if (msg.type === 'result' && msg.result) {
        const text = typeof msg.result === 'string' ? msg.result : '';
        if (text) {
          // Replace the last assistant message with the final clean result
          setMessages(prev => {
            const last = prev[prev.length - 1];
            if (last?.role === 'assistant') {
              return [...prev.slice(0, -1), { ...last, content: text }];
            }
            return [...prev, {
              id: `result-${Date.now()}`,
              role: 'assistant',
              content: text,
              timestamp: Date.now(),
            }];
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
    window.vsai.claudeSend(text);
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
            <span className="thinking-label">Claude is working...</span>
          </div>
        )}
        <div ref={messagesEndRef} />
      </div>
      <ChatInput onSend={handleSend} disabled={!ready} slashCommands={slashCommands} />
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
