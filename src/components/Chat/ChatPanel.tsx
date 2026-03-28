import { useState, useEffect, useRef, useCallback } from 'react';
import { Dot, Minus, Plus, Asterisk, SunDim, SunMedium, Sun } from 'lucide-react';

const THINKING_WORDS = [
  'Thinking', 'Pondering', 'Ruminating', 'Cogitating', 'Deliberating',
  'Musing', 'Contemplating', 'Considering', 'Reflecting', 'Computing',
  'Evaluating', 'Reasoning', 'Noodling', 'Percolating', 'Mulling',
  'Scheming', 'Plotting', 'Hatching', 'Crafting', 'Concocting',
  'Formulating', 'Devising', 'Imagining', 'Envisioning', 'Ideating',
  'Fathoming', 'Deciphering', 'Unraveling', 'Exploring', 'Parsing',
  'Dissecting', 'Elucidating', 'Illuminating', 'Flibbertigibbeting',
  'Calculating', 'Solving',
];

const SPINNER_ICONS = [Dot, Minus, Plus, Asterisk, SunDim, SunMedium, Sun];

function ThinkingAnimation({ hasContent }: { hasContent: boolean }) {
  const [wordIndex, setWordIndex] = useState(() => Math.floor(Math.random() * THINKING_WORDS.length));
  const [charIndex, setCharIndex] = useState(0);
  const [phase, setPhase] = useState<'typing' | 'pause' | 'erasing'>('typing');
  const [iconIndex, setIconIndex] = useState(0);

  const word = THINKING_WORDS[wordIndex];
  const Icon = SPINNER_ICONS[iconIndex % SPINNER_ICONS.length];

  // Cycle icons
  useEffect(() => {
    const interval = setInterval(() => setIconIndex(i => i + 1), 150);
    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    let timeout: ReturnType<typeof setTimeout>;

    if (phase === 'typing') {
      if (charIndex < word.length) {
        timeout = setTimeout(() => setCharIndex(c => c + 1), 40 + Math.random() * 30);
      } else {
        timeout = setTimeout(() => setPhase('pause'), 800 + Math.random() * 400);
      }
    } else if (phase === 'pause') {
      timeout = setTimeout(() => setPhase('erasing'), 100);
    } else if (phase === 'erasing') {
      if (charIndex > 0) {
        timeout = setTimeout(() => setCharIndex(c => c - 1), 20);
      } else {
        setWordIndex(i => (i + 1 + Math.floor(Math.random() * 3)) % THINKING_WORDS.length);
        setPhase('typing');
      }
    }

    return () => clearTimeout(timeout);
  }, [charIndex, phase, word.length]);

  const displayText = word.slice(0, charIndex);

  return (
    <div className="thinking-animation">
      <Icon size={16} className="thinking-icon" />
      <span className="thinking-text">
        {displayText}
        <span className="thinking-cursor">|</span>
        ...
      </span>
    </div>
  );
}
import ChatMessage from './ChatMessage';
import ChatInput from './ChatInput';
import type { ChatMessage as ChatMessageType, ToolCall } from '../../types';

export default function ChatPanel({ projectPath }: { projectPath: string }) {
  const [messages, setMessages] = useState<ChatMessageType[]>([]);
  const [isStreaming, setIsStreaming] = useState(false);
  const [ready, setReady] = useState(false);
  const [slashCommands, setSlashCommands] = useState<string[]>([]);
  const [permissionMode, setPermissionMode] = useState<'default' | 'bypass'>('default');
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

  const handleSend = async (text: string, images?: string[]) => {
    // Handle built-in commands locally
    if (text === '/clear') {
      setMessages([]);
      return;
    }
    if (text === '/help') {
      const cmds = slashCommands.length > 0
        ? slashCommands.map(c => `  /${c}`).join('\n')
        : '  No custom commands loaded';
      setMessages(prev => [...prev,
        { id: Date.now().toString(), role: 'user', content: text, timestamp: Date.now() },
        { id: `help-${Date.now()}`, role: 'system', content:
          `**Available Commands**\n\n**Built-in:**\n  /clear — Clear conversation\n  /help — Show this help\n\n**Claude Skills:**\n${cmds}`,
          timestamp: Date.now() },
      ]);
      return;
    }

    setMessages(prev => [...prev, {
      id: Date.now().toString(),
      role: 'user',
      content: text + (images?.length ? ` [${images.length} image(s)]` : ''),
      timestamp: Date.now(),
    }]);

    // Save images to temp files and get paths
    let imagePaths: string[] | undefined;
    if (images && images.length > 0) {
      imagePaths = await Promise.all(
        images.map(data => window.vsai.saveImage(data))
      );
    }

    window.vsai.claudeSend(text, imagePaths, permissionMode);
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
        {isStreaming && <ThinkingAnimation hasContent={messages[messages.length - 1]?.role === 'assistant'} />}
        <div ref={messagesEndRef} />
      </div>
      <ChatInput
        onSend={handleSend}
        disabled={!ready}
        slashCommands={slashCommands}
        isStreaming={isStreaming}
        onStop={() => window.vsai.claudeStop?.()}
        permissionMode={permissionMode}
        onPermissionChange={setPermissionMode}
      />
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
        .thinking-animation {
          display: flex;
          align-items: center;
          gap: 8px;
          padding: 12px 0;
          min-height: 40px;
        }
        .thinking-icon {
          color: var(--accent);
          flex-shrink: 0;
        }
        .thinking-text {
          font-size: 14px;
          color: var(--accent);
          font-weight: 500;
          letter-spacing: 0.3px;
        }
        .thinking-cursor {
          animation: blink-cursor 0.6s step-end infinite;
          font-weight: 300;
          color: var(--accent);
        }
        @keyframes blink-cursor {
          0%, 100% { opacity: 1; }
          50% { opacity: 0; }
        }
      `}</style>
    </div>
  );
}
