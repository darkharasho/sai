import { useState, useEffect, useRef } from 'react';
import ChatMessage from './ChatMessage';
import ChatInput from './ChatInput';
import type { ChatMessage as ChatMessageType } from '../../types';

export default function ChatPanel({ projectPath }: { projectPath: string }) {
  const [messages, setMessages] = useState<ChatMessageType[]>([]);
  const [isStreaming, setIsStreaming] = useState(false);
  const [ready, setReady] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const streamingRef = useRef(false);

  useEffect(() => {
    window.vsai.claudeStart(projectPath || '').then(() => setReady(true));

    const cleanup = window.vsai.claudeOnMessage((msg: any) => {
      // Handle stream-json output from `claude -p --output-format stream-json`
      // Messages come as JSON lines with various types

      if (msg.type === 'ready') {
        setReady(true);
        return;
      }

      if (msg.type === 'done') {
        setIsStreaming(false);
        streamingRef.current = false;
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

      // Claude stream-json sends result objects with content blocks
      // Extract text from various possible shapes
      let text = '';
      if (msg.type === 'content_block_delta' && msg.delta?.text) {
        text = msg.delta.text;
      } else if (msg.type === 'assistant' && msg.content) {
        text = typeof msg.content === 'string' ? msg.content : '';
      } else if (msg.type === 'result' && msg.result) {
        // Final result — extract text from content blocks
        const content = msg.result;
        if (typeof content === 'string') {
          text = content;
        } else if (Array.isArray(content)) {
          text = content.filter((b: any) => b.type === 'text').map((b: any) => b.text).join('');
        }
      } else if (msg.type === 'raw') {
        text = msg.text || '';
      } else if (typeof msg.content === 'string') {
        text = msg.content;
      } else if (msg.result && typeof msg.result === 'string') {
        text = msg.result;
      }

      if (!text) return;

      setMessages(prev => {
        const last = prev[prev.length - 1];
        if (last?.role === 'assistant' && streamingRef.current) {
          // Append to existing streaming message
          return [...prev.slice(0, -1), { ...last, content: last.content + text }];
        }
        // New assistant message
        streamingRef.current = true;
        return [...prev, {
          id: Date.now().toString(),
          role: 'assistant',
          content: text,
          timestamp: Date.now(),
        }];
      });
      setIsStreaming(true);
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
    streamingRef.current = false;
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
