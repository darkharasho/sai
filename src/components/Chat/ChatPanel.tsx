import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
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
function CodexThinkingAnimation() {
  return (
    <div className="codex-thinking">
      <span className="codex-thinking-dot">•</span>
      <span className="codex-working">Working</span>
    </div>
  );
}

import ChatMessage from './ChatMessage';
import ChatInput from './ChatInput';
import type { ChatMessage as ChatMessageType, ToolCall } from '../../types';

type CodexPermission = 'auto' | 'read-only' | 'full-access';

interface ChatPanelProps {
  projectPath: string;
  permissionMode: 'default' | 'bypass';
  onPermissionChange: (mode: 'default' | 'bypass') => void;
  effortLevel: 'low' | 'medium' | 'high' | 'max';
  onEffortChange: (level: 'low' | 'medium' | 'high' | 'max') => void;
  modelChoice: 'sonnet' | 'opus' | 'haiku';
  onModelChange: (model: 'sonnet' | 'opus' | 'haiku') => void;
  aiProvider: 'claude' | 'codex';
  codexModel: string;
  onCodexModelChange: (model: string) => void;
  codexModels: { id: string; name: string }[];
  codexPermission: CodexPermission;
  onCodexPermissionChange: (perm: CodexPermission) => void;
  initialMessages?: ChatMessageType[];
  onMessagesChange?: (messages: ChatMessageType[]) => void;
  onTurnComplete?: () => void;
  activeFilePath?: string | null;
  onFileOpen?: (path: string) => void;
}

const EMPTY_PROMPTS = [
  "Describe what to build",
  "What are we breaking today?",
  "Got a bug that's personal? Let's settle it.",
  "Your wish, my `git commit`.",
  "No task too cursed.",
  "Ready to ship something questionable.",
  "Let's turn coffee into code.",
  "Tell me your wildest feature request.",
  "I've seen worse codebases. Probably.",
  "Bugs fear me. Users... less so.",
  "What monstrosity are we creating today?",
  "Let's pretend we planned this.",
  "Refactor, feature, or chaos — you pick.",
  "Stack traces are just treasure maps.",
  "LGTM before you even write it.",
  "I'm warmed up. Are you?",
  "No judgment. Just code.",
  "It works on my machine. Let's make it work on yours.",
  "Tell me the dream. I'll handle the `catch` block.",
  "New session, new mistakes.",
  "Let's ship it and find out.",
  "I read the docs so you don't have to.",
  "Paste the error. I won't laugh. (much)",
  "Every great app starts with a bad idea.",
  "What fresh hell are we building?",
  "I'm basically a rubber duck that talks back.",
  "Chaos is just an untracked feature.",
  "Your tech debt is safe with me. For now.",
  "Ready to violate some best practices?",
  "Let's make the linter cry.",
  "Commit early, commit often, commit crimes.",
  "One more feature and we'll refactor. Promise.",
  "The README will explain everything. Eventually.",
  "I've already forgotten the last session. Fresh start.",
  "undefined is not a problem. Yet.",
  "Type safety? We respect it here. Mostly.",
  "What are we over-engineering today?",
  "Production is just staging with consequences.",
  "We can fix it in post.",
  "It's not a bug, it's a surprise feature.",
  "Spaghetti or lasagna? Your architecture, your choice.",
  "I promise not to introduce new bugs. Statistically.",
  "Let's write code future-us will yell about.",
  "The best error message is no error message.",
  "Let's make something that works. Beautifully.",
  "Compiles clean. Ship it.",
  "Ready when you are.",
  "npm install hope",
  "No feature is too small to over-architect.",
  "Have you tried turning the codebase off and on again?",
  "Tell me what's wrong. We'll fix it together.",
  "Today's WIP is tomorrow's legacy code.",
  "What's the plan? (I'll ignore it anyway)",
  "Every line of code is a love letter to the future.",
  "Semicolons or not, I don't care. I'll adapt.",
  "Let's add a dark mode for the soul of this app.",
  "The tests will pass. Believe.",
  "I'm like a senior engineer, but faster and less jaded.",
  "Another day, another abstraction.",
  "Let's make it scale. Or at least look like it does.",
  "Your idea, my keyboard.",
  "Clean code is a feeling, not a rule.",
  "The diff will be beautiful.",
  "Write once, debug everywhere.",
  "Let's avoid the `any` type today. Let's try.",
  "What's the ticket? (You don't need one here)",
  "Just vibes and version control.",
  "One does not simply ship without testing. But we can try.",
  "Main branch? Never heard of her.",
  "I'm stateless. Every session is a new me.",
  "Let's write something you'll actually be proud of.",
  "Feature flags: the coward's deploy. Let's use them.",
  "I have infinite patience for your requirements.",
  "Make it work, make it right, make it fast — pick two.",
  "What cursed corner of the codebase today?",
  "Hot take: the bug is in line one.",
  "This one's going in the portfolio.",
  "Let's build it before you change your mind.",
  "The semicolons are load-bearing. Be careful.",
  "Today we write the code we should have written in v1.",
  "I work well under pressure. Do you?",
  "Spec? Vibes? Either works.",
  "Let's go. The deadline is fake anyway.",
  "Edge cases are just features we haven't named yet.",
  "Copy-paste is a valid architecture until it isn't.",
  "Let's break it down and build it back up.",
  "The simplest solution is usually the last one you try.",
  "I've seen the entire internet. Let's build something new.",
  "No codebase is beyond saving. Mostly.",
  "What's the one thing users keep asking for?",
  "Let's make the happy path happy.",
  "The user experience starts here.",
  "Small PR or big bang? Your call.",
  "Ready to make something real.",
  "Tell me the goal and I'll find the path.",
  "Every system is just plumbing once you zoom out.",
  "Let's add the feature everyone secretly wanted.",
  "Debug mode: on. Let's hunt.",
  "Describe the behavior, not the implementation.",
  "The architecture diagrams are in my head. Trust me.",
  "Let's ship the MVP before it becomes the MLP.",
  "Good code is deleted code. What are we removing?",
  "What's the thing you keep putting off?",
  "Today's the day we fix that one thing.",
  "I work for tokens, not equity. Let's go.",
  "This will look great in the changelog.",
  "New feature? Great. Requirements? Optional.",
  "Tell me the story. I'll write the code.",
  "Let's make the compiler happy for once.",
  "Abstraction layer incoming.",
  "We'll write the tests after. (We won't)",
  "Let's see if this idea survives contact with reality.",
  "I'm powered by context. Give me some.",
  "The refactor starts now.",
  "Zero warnings policy starts today.",
  "Let's make this thing feel alive.",
  "I am your rubber duck, your pair programmer, your scapegoat.",
  "The 10x developer was a lie. I am the 10x tool.",
  "Let's finally tackle the thing in the backlog.",
  "What does 'done' look like today?",
  "My favorite bug is one I haven't seen yet.",
  "Let's not break the build this time. Attempt #4.",
  "Async all the things?",
  "Permission to over-engineer: requested.",
  "Let's add one more layer of indirection.",
  "What would the simplest version look like?",
  "Hot reload is on. Start breaking things.",
  "I'll write the boilerplate. You bring the vision.",
  "Let's make this the last time we touch this file.",
  "First, we build. Then, we document. Maybe.",
  "The gap between MVP and MVC is just vibes.",
  "Let's make it obvious what this code does.",
  "Console.log is the thinking man's debugger.",
  "Ready for another episode of 'Why Is This Broken'?",
  "We ball.",
  "Let's make the product manager cry happy tears.",
  "There's no such thing as too many components.",
  "The design is final. The design is never final.",
  "What we build today will outlast us both.",
  "I'll handle the how. You handle the why.",
  "The best codebases are built one small thing at a time.",
  "I have access to your files. Let's use that power for good.",
  "Idle hands write messy code. Let's get moving.",
  "One more useEffect won't hurt.",
  "Remember when we thought this would be simple?",
  "Let's make it work, then make it pretty.",
  "What's the skeleton? We'll flesh it out from there.",
];

export default function ChatPanel({ projectPath, permissionMode, onPermissionChange, effortLevel, onEffortChange, modelChoice, onModelChange, aiProvider, codexModel, onCodexModelChange, codexModels, codexPermission, onCodexPermissionChange, initialMessages, onMessagesChange, onTurnComplete, activeFilePath, onFileOpen }: ChatPanelProps) {
  const [messages, setMessages] = useState<ChatMessageType[]>(initialMessages || []);
  const emptyPrompt = useMemo(() => EMPTY_PROMPTS[Math.floor(Math.random() * EMPTY_PROMPTS.length)], []);
  const [isStreaming, setIsStreaming] = useState(false);
  const [ready, setReady] = useState(false);
  const [slashCommands, setSlashCommands] = useState<string[]>([]);
  const [contextUsage, setContextUsage] = useState<{ used: number; total: number; inputTokens: number; cacheReadTokens: number; cacheCreationTokens: number; outputTokens: number }>({ used: 0, total: 1000000, inputTokens: 0, cacheReadTokens: 0, cacheCreationTokens: 0, outputTokens: 0 });
  const [sessionUsage, setSessionUsage] = useState<{ inputTokens: number; outputTokens: number }>({ inputTokens: 0, outputTokens: 0 });
  const [rateLimits, setRateLimits] = useState<Map<string, { rateLimitType: string; resetsAt: number; status: string; isUsingOverage: boolean; overageResetsAt: number; utilization?: number }>>(new Map());
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const chatContainerRef = useRef<HTMLDivElement>(null);
  const lastUserMsgRef = useRef<HTMLDivElement>(null);
  const isAtBottomRef = useRef(true);
  const [showPinnedPrompt, setShowPinnedPrompt] = useState(false);
  const [showNewMessages, setShowNewMessages] = useState(false);

  useEffect(() => {
    setReady(false);
    const startFn = aiProvider === 'codex' ? window.sai.codexStart : window.sai.claudeStart;
    startFn(projectPath || '').then(() => setReady(true));

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
            utilization: info.utilization,
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
        // Don't guess post-compaction size — the next result message will have accurate numbers
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
          const inputTokens = msg.usage.input_tokens || 0;
          const cacheReadTokens = msg.usage.cache_read_input_tokens || 0;
          const cacheCreationTokens = msg.usage.cache_creation_input_tokens || 0;
          const outputTokens = msg.usage.output_tokens || 0;
          const used = inputTokens + cacheReadTokens + cacheCreationTokens + outputTokens;
          // Use the CLI-reported context window, but fall back to known model sizes
          // since the CLI may report incorrect values (e.g., 200K for 1M-context models)
          const modelUsage = msg.modelUsage || {};
          const modelKey = Object.keys(modelUsage)[0];
          let total = modelKey ? modelUsage[modelKey].contextWindow || 0 : 0;
          // If reported total seems wrong (used exceeds it), use a sensible default
          if (!total || used > total) {
            total = 1000000; // Default to 1M for extended context models
          }
          setContextUsage({ used, total, inputTokens, cacheReadTokens, cacheCreationTokens, outputTokens });
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
  }, [projectPath, aiProvider]);

  // Poll the Anthropic usage API for real utilization percentages
  useEffect(() => {
    const handleUsage = (data: any) => {
      if (!data) return;
      setRateLimits(prev => {
        const next = new Map(prev);
        // five_hour → Current session
        if (data.five_hour) {
          const existing = next.get('five_hour') || {
            rateLimitType: 'five_hour',
            resetsAt: 0,
            status: 'unknown',
            isUsingOverage: false,
            overageResetsAt: 0,
          };
          next.set('five_hour', {
            ...existing,
            utilization: (data.five_hour.utilization ?? 0) / 100, // API returns 0-100, we use 0-1
            ...(data.five_hour.resets_at ? { resetsAt: Math.floor(new Date(data.five_hour.resets_at).getTime() / 1000) } : {}),
          });
        }
        // seven_day → Weekly (All models)
        if (data.seven_day) {
          const existing = next.get('seven_day') || {
            rateLimitType: 'seven_day',
            resetsAt: 0,
            status: 'unknown',
            isUsingOverage: false,
            overageResetsAt: 0,
          };
          next.set('seven_day', {
            ...existing,
            utilization: (data.seven_day.utilization ?? 0) / 100,
            ...(data.seven_day.resets_at ? { resetsAt: Math.floor(new Date(data.seven_day.resets_at).getTime() / 1000) } : {}),
          });
        }
        return next;
      });
    };

    const cleanup = (window.sai as any).onUsageUpdate?.(handleUsage);
    // Also do an initial fetch
    (window.sai as any).usageFetch?.().then(handleUsage);
    return () => cleanup?.();
  }, []);

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
    if (aiProvider === 'codex') {
      window.sai.codexSend(projectPath, prompt, imagePaths, codexPermission, codexModel);
    } else {
      window.sai.claudeSend(projectPath, prompt, imagePaths, permissionMode, effortLevel, modelChoice);
    }
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
              {projectPath ? emptyPrompt : 'Select a project to get started'}
            </div>
          </div>
        ) : (
          messages.map(msg => msg.id === lastUserMessage?.id
            ? <div key={msg.id} ref={lastUserMsgRef}><ChatMessage message={msg} projectPath={projectPath} onFileOpen={onFileOpen} aiProvider={aiProvider} /></div>
            : <ChatMessage key={msg.id} message={msg} projectPath={projectPath} onFileOpen={onFileOpen} aiProvider={aiProvider} />
          )
        )}
        {isStreaming && (aiProvider === 'codex'
          ? <CodexThinkingAnimation />
          : <ThinkingAnimation hasContent={messages[messages.length - 1]?.role === 'assistant'} />
        )}
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
        onStop={() => aiProvider === 'codex' ? window.sai.codexStop(projectPath) : window.sai.claudeStop?.(projectPath)}
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
        aiProvider={aiProvider}
        codexModel={codexModel}
        codexModels={codexModels}
        onCodexModelChange={onCodexModelChange}
        codexPermission={codexPermission}
        onCodexPermissionChange={onCodexPermissionChange}
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
          font-style: italic;
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
        .codex-thinking {
          display: flex;
          align-items: center;
          gap: 8px;
          padding: 12px 0;
        }
        .codex-thinking-dot {
          color: var(--text-muted);
          font-size: 16px;
          line-height: 1;
        }
        .codex-working {
          font-size: 14px;
          font-weight: 700;
          background-image: linear-gradient(
            90deg,
            rgba(220,220,220,0.95) 0%,
            rgba(220,220,220,0.95) 42%,
            rgba(100,100,100,0.7) 50%,
            rgba(220,220,220,0.95) 58%,
            rgba(220,220,220,0.95) 100%
          );
          background-size: 400% 100%;
          background-position: 200% 0;
          -webkit-background-clip: text;
          background-clip: text;
          color: transparent;
          animation: codex-working-shimmer 8s linear infinite;
        }
        @keyframes codex-working-shimmer {
          from { background-position: 200% 0; }
          to { background-position: -200% 0; }
        }
      `}</style>
    </div>
  );
}
