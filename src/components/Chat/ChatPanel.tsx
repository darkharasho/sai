import { useState, useEffect, useRef, useCallback } from 'react';
import { Dot, Minus, Plus, Asterisk, SunDim, SunMedium, Sun, ChevronDown } from 'lucide-react';

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

function ContextMeter({ used, total }: { used: number; total: number }) {
  const pct = Math.min((used / total) * 100, 100);
  const radius = 8;
  const circumference = 2 * Math.PI * radius;
  const offset = circumference - (pct / 100) * circumference;
  const color = pct > 80 ? 'var(--red)' : pct > 50 ? 'var(--orange)' : 'var(--accent)';

  // Always show, even at 0%

  return (
    <div className="context-meter" title={`Context: ${Math.round(pct)}% (${(used / 1000).toFixed(0)}K / ${(total / 1000).toFixed(0)}K tokens)`}>
      <svg width="22" height="22" viewBox="0 0 22 22">
        <circle cx="11" cy="11" r={radius} fill="none" stroke="var(--border)" strokeWidth="2.5" />
        <circle
          cx="11" cy="11" r={radius} fill="none"
          stroke={color} strokeWidth="2.5"
          strokeDasharray={circumference}
          strokeDashoffset={offset}
          strokeLinecap="round"
          transform="rotate(-90 11 11)"
          style={{ transition: 'stroke-dashoffset 0.5s ease' }}
        />
      </svg>
      <span className="context-meter-label">{Math.round(pct)}%</span>
    </div>
  );
}

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

interface ChatPanelProps {
  projectPath: string;
  permissionMode: 'default' | 'bypass';
  onPermissionChange: (mode: 'default' | 'bypass') => void;
  effortLevel: 'low' | 'medium' | 'high' | 'max';
  onEffortChange: (level: 'low' | 'medium' | 'high' | 'max') => void;
  modelChoice: 'sonnet' | 'opus' | 'haiku';
  onModelChange: (model: 'sonnet' | 'opus' | 'haiku') => void;
  initialMessages?: ChatMessageType[];
  onMessagesChange?: (messages: ChatMessageType[]) => void;
  onTurnComplete?: () => void;
  activeFilePath?: string | null;
}

export default function ChatPanel({ projectPath, permissionMode, onPermissionChange, effortLevel, onEffortChange, modelChoice, onModelChange, initialMessages, onMessagesChange, onTurnComplete, activeFilePath }: ChatPanelProps) {
  const [messages, setMessages] = useState<ChatMessageType[]>(initialMessages || []);
  const [isStreaming, setIsStreaming] = useState(false);
  const [ready, setReady] = useState(false);
  const [slashCommands, setSlashCommands] = useState<string[]>([]);
  const [contextUsage, setContextUsage] = useState<{ used: number; total: number }>({ used: 0, total: 1000000 });
  const [sessionUsage, setSessionUsage] = useState<{ inputTokens: number; outputTokens: number }>({ inputTokens: 0, outputTokens: 0 });
  const [rateLimits, setRateLimits] = useState<Map<string, { rateLimitType: string; resetsAt: number; status: string; isUsingOverage: boolean; overageResetsAt: number }>>(new Map());
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const chatContainerRef = useRef<HTMLDivElement>(null);
  const lastUserMsgRef = useRef<HTMLDivElement>(null);
  const isAtBottomRef = useRef(true);
  const [showPinnedPrompt, setShowPinnedPrompt] = useState(false);
  const [showNewMessages, setShowNewMessages] = useState(false);

  useEffect(() => {
    setReady(false);
    window.sai.claudeStart(projectPath || '').then(() => setReady(true));

    const cleanup = window.sai.claudeOnMessage((msg: any) => {
      // Only process messages for this workspace
      if (msg.projectPath && msg.projectPath !== projectPath) return;

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
        onTurnComplete?.();
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

      // Capture rate limit info (may receive multiple: daily, weekly, etc.)
      if (msg.type === 'rate_limit_event' && msg.rate_limit_info) {
        const info = msg.rate_limit_info;
        const key = info.rateLimitType || 'unknown';
        setRateLimits(prev => {
          const next = new Map(prev);
          next.set(key, {
            rateLimitType: key,
            resetsAt: info.resetsAt || 0,
            status: info.status || 'unknown',
            isUsingOverage: !!info.isUsingOverage,
            overageResetsAt: info.overageResetsAt || 0,
          });
          return next;
        });
        return;
      }

      // Surface context compaction notifications and update context meter
      if (msg.type === 'system' && (msg.subtype === 'context_compacted' || msg.subtype === 'auto_compact' || msg.subtype === 'compact')) {
        const summary = msg.summary ? ` Summary: ${msg.summary.slice(0, 100)}` : '';
        setMessages(prev => [...prev, {
          id: `compact-${Date.now()}`,
          role: 'system',
          content: `Context auto-compacted.${summary}`,
          timestamp: Date.now(),
        }]);
        // Reset context meter — the next result message will have accurate numbers
        setContextUsage(prev => ({ used: Math.round(prev.used * 0.3), total: prev.total }));
        return;
      }

      // Skip system noise
      if (msg.type === 'system' || msg.type === 'rate_limit_event') {
        return;
      }

      // Tool results come back as user messages with tool_result content blocks
      if (msg.type === 'user' && msg.message?.content) {
        const results: Array<{ tool_use_id: string; output: string }> = [];
        for (const block of msg.message.content) {
          if (block.type === 'tool_result' && block.tool_use_id) {
            const text = Array.isArray(block.content)
              ? block.content.filter((c: any) => c.type === 'text').map((c: any) => c.text).join('')
              : typeof block.content === 'string' ? block.content : '';
            results.push({ tool_use_id: block.tool_use_id, output: text });
          }
        }
        if (results.length > 0) {
          setMessages(prev => {
            const next = [...prev];
            for (let i = next.length - 1; i >= 0; i--) {
              const msg = next[i];
              if (msg.role === 'assistant' && msg.toolCalls) {
                let updated = false;
                const newToolCalls = msg.toolCalls.map(tc => {
                  const result = results.find(r => r.tool_use_id === tc.id);
                  if (result) { updated = true; return { ...tc, output: result.output }; }
                  return tc;
                });
                if (updated) { next[i] = { ...msg, toolCalls: newToolCalls }; }
              }
            }
            return next;
          });
        }
        return;
      }

      if (msg.type === 'user') return;

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
              id: block.id,
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

      // Result — final answer for this turn, also has usage data
      if (msg.type === 'result') {
        // Update context usage
        if (msg.usage) {
          const used = (msg.usage.input_tokens || 0) +
            (msg.usage.cache_read_input_tokens || 0) +
            (msg.usage.cache_creation_input_tokens || 0) +
            (msg.usage.output_tokens || 0);
          const modelUsage = msg.modelUsage || {};
          const modelKey = Object.keys(modelUsage)[0];
          const total = modelKey ? modelUsage[modelKey].contextWindow || 1000000 : 1000000;
          setContextUsage({ used, total });
        }
        // Accumulate session usage
        if (msg.usage) {
          setSessionUsage(prev => ({
            inputTokens: prev.inputTokens + (msg.usage.input_tokens || 0) + (msg.usage.cache_read_input_tokens || 0) + (msg.usage.cache_creation_input_tokens || 0),
            outputTokens: prev.outputTokens + (msg.usage.output_tokens || 0),
          }));
        }
      }
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

  // Wheel events are never fired by programmatic scrolls — use them to detect user scrolling up
  useEffect(() => {
    const el = chatContainerRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      if (e.deltaY < 0) isAtBottomRef.current = false;
    };
    el.addEventListener('wheel', onWheel, { passive: true });
    return () => el.removeEventListener('wheel', onWheel);
  }, []);

  useEffect(() => {
    if (isAtBottomRef.current) {
      setShowNewMessages(false);
      messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    } else if (messages[messages.length - 1]?.role === 'assistant') {
      setShowNewMessages(true);
    }
  }, [messages, isStreaming]);

  const scrollToBottom = () => {
    isAtBottomRef.current = true;
    setShowNewMessages(false);
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  const handleScroll = () => {
    const el = chatContainerRef.current;
    if (!el) return;
    const atBottom = el.scrollTop + el.clientHeight >= el.scrollHeight - 60;
    if (atBottom) {
      isAtBottomRef.current = true;
      setShowNewMessages(false);
    }
  };

  const lastUserMessage = [...messages].reverse().find(m => m.role === 'user');

  useEffect(() => {
    const el = lastUserMsgRef.current;
    const container = chatContainerRef.current;
    if (!el || !container) return;
    setShowPinnedPrompt(false);
    const observer = new IntersectionObserver(
      ([entry]) => setShowPinnedPrompt(!entry.isIntersecting),
      { root: container, threshold: 0 }
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, [lastUserMessage?.id]);

  useEffect(() => {
    onMessagesChange?.(messages);
  }, [messages]);

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

    isAtBottomRef.current = true;
    setMessages(prev => [...prev, {
      id: Date.now().toString(),
      role: 'user',
      content: text,
      timestamp: Date.now(),
      images: images?.length ? images : undefined,
    }]);

    // Save images to temp files and get paths
    let imagePaths: string[] | undefined;
    if (images && images.length > 0) {
      imagePaths = await Promise.all(
        images.map(data => window.sai.saveImage(data))
      );
    }

    const prompt = activeFilePath ? `[File: ${activeFilePath}]\n\n${text}` : text;
    window.sai.claudeSend(projectPath, prompt, imagePaths, permissionMode, effortLevel, modelChoice);
  };

  return (
    <div className="chat-panel">
      {showPinnedPrompt && lastUserMessage && (
        <div className="pinned-prompt-bar">
          <span className="pinned-prompt-text">{lastUserMessage.content}</span>
        </div>
      )}
      <div className="chat-messages" ref={chatContainerRef} onScroll={handleScroll}>
        {messages.length === 0 ? (
          <div className="chat-empty">
            <div className="chat-empty-title">SAI</div>
            <div className="chat-empty-subtitle">
              {projectPath ? 'Describe what to build' : 'Select a project to get started'}
            </div>
          </div>
        ) : (
          messages.map(msg => msg.id === lastUserMessage?.id
            ? <div key={msg.id} ref={lastUserMsgRef}><ChatMessage message={msg} /></div>
            : <ChatMessage key={msg.id} message={msg} />
          )
        )}
        {isStreaming && <ThinkingAnimation hasContent={messages[messages.length - 1]?.role === 'assistant'} />}
        <div ref={messagesEndRef} />
      </div>
      <div className="new-messages-anchor">
        {showNewMessages && (
          <button className="new-messages-btn" onClick={scrollToBottom}>
            <ChevronDown size={12} />
            new messages
          </button>
        )}
      </div>
      <ChatInput
        onSend={handleSend}
        disabled={!ready}
        slashCommands={slashCommands}
        isStreaming={isStreaming}
        onStop={() => window.sai.claudeStop?.(projectPath)}
        permissionMode={permissionMode}
        onPermissionChange={onPermissionChange}
        effortLevel={effortLevel}
        onEffortChange={onEffortChange}
        modelChoice={modelChoice}
        onModelChange={onModelChange}
        contextUsage={contextUsage}
        sessionUsage={sessionUsage}
        rateLimits={rateLimits}
        activeFilePath={activeFilePath}
      />
      <style>{`
        .chat-panel {
          flex: 1;
          display: flex;
          flex-direction: column;
          min-height: 0;
          overflow: hidden;
        }
        .new-messages-anchor {
          position: relative;
          flex-shrink: 0;
          height: 0;
          z-index: 10;
        }
        .new-messages-btn {
          position: absolute;
          bottom: 8px;
          left: 50%;
          transform: translateX(-50%);
          z-index: 10;
          display: flex;
          align-items: center;
          gap: 5px;
          background: var(--bg-secondary);
          border: 1px solid var(--accent);
          border-radius: 12px;
          color: var(--text-muted);
          font-size: 11px;
          font-family: 'JetBrains Mono', monospace;
          padding: 4px 12px;
          cursor: pointer;
          box-shadow: 0 2px 12px rgba(0,0,0,0.3);
          white-space: nowrap;
          transition: color 0.15s;
        }
        .new-messages-btn:hover {
          color: var(--text);
        }
        .pinned-prompt-bar {
          flex-shrink: 0;
          padding: 5px 16px;
          border-bottom: 1px solid var(--border);
          background: var(--bg-primary);
          display: flex;
          align-items: center;
          min-width: 0;
        }
        .pinned-prompt-text {
          font-size: 12px;
          color: var(--text-muted);
          opacity: 0.6;
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
          font-family: 'JetBrains Mono', monospace;
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
