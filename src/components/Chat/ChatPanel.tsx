import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { ChevronDown, CornerLeftUp } from 'lucide-react';
import { motion, AnimatePresence, LayoutGroup } from 'motion/react';
import { setFlipRect } from './flipRegistry';
import ThinkingAnimation from '../ThinkingAnimation';
import MotionPresence from './MotionPresence';
import { SPRING, DISTANCE, EASING, useReducedMotionTransition } from './motion';

function tweenScrollToBottom(container: HTMLElement, durationMs = 280) {
  if (typeof window === 'undefined') return;
  if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) {
    container.scrollTop = container.scrollHeight;
    return;
  }
  const start = container.scrollTop;
  const target = container.scrollHeight - container.clientHeight;
  if (target <= start) return;
  const t0 = performance.now();
  // Approximate ease-out cubic-bezier with a power curve: 1 - (1-t)^p
  const p = 1 / (EASING.out[3] || 1);
  const ease = (t: number) => 1 - Math.pow(1 - t, p);
  const step = (t: number) => {
    const k = Math.min(1, (t - t0) / durationMs);
    container.scrollTop = start + (target - start) * ease(k);
    if (k < 1) requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
}

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

function CodexThinkingAnimation() {
  return (
    <div className="codex-thinking">
      <span className="codex-thinking-dot">•</span>
      <span className="codex-working codex-working-wave">
        {'Working'.split('').map((c, i) => (
          <span key={i} style={{ animationDelay: `${i * 50}ms` }}>{c}</span>
        ))}
      </span>
    </div>
  );
}

const GEMINI_COLORS = ['#D7AFFF', '#87AFFF', '#87D7D7', '#D7FFD7', '#FFFFAF', '#FF87AF'];
const COLOR_CYCLE_MS = 4000;
const BRAILLE_FRAMES = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];

function lerpColor(a: string, b: string, t: number): string {
  const parse = (hex: string) => [parseInt(hex.slice(1, 3), 16), parseInt(hex.slice(3, 5), 16), parseInt(hex.slice(5, 7), 16)];
  const [r1, g1, b1] = parse(a);
  const [r2, g2, b2] = parse(b);
  const r = Math.round(r1 + (r2 - r1) * t);
  const g = Math.round(g1 + (g2 - g1) * t);
  const bl = Math.round(b1 + (b2 - b1) * t);
  return `rgb(${r},${g},${bl})`;
}

// Witty loading phrases (from Gemini CLI, Apache 2.0)
const GEMINI_WITTY = [
  "I'm Feeling Lucky", "Shipping awesomeness", "Painting the serifs back on",
  "Navigating the slime mold", "Consulting the digital spirits", "Reticulating splines",
  "Warming up the AI hamsters", "Asking the magic conch shell", "Generating witty retort",
  "Polishing the algorithms", "Don't rush perfection (or my code)", "Brewing fresh bytes",
  "Counting electrons", "Engaging cognitive processors",
  "Checking for syntax errors in the universe", "One moment, optimizing humor",
  "Shuffling punchlines", "Untangling neural nets", "Compiling brilliance",
  "Loading wit.exe", "Summoning the cloud of wisdom", "Preparing a witty response",
  "Just a sec, I'm debugging reality", "Confuzzling the options",
  "Tuning the cosmic frequencies", "Crafting a response worthy of your patience",
  "Compiling the 1s and 0s", "Resolving dependencies... and existential crises",
  "Defragmenting memories... both RAM and personal", "Rebooting the humor module",
  "Caching the essentials (mostly cat memes)", "Optimizing for ludicrous speed",
  "Swapping bits... don't tell the bytes", "Garbage collecting... be right back",
  "Assembling the interwebs", "Converting coffee into code",
  "Updating the syntax for reality", "Rewiring the synapses",
  "Looking for a misplaced semicolon", "Greasin' the cogs of the machine",
  "Pre-heating the servers", "Calibrating the flux capacitor",
  "Engaging the improbability drive", "Channeling the Force",
  "Aligning the stars for optimal response", "So say we all",
  "Loading the next great idea", "Just a moment, I'm in the zone",
  "Preparing to dazzle you with brilliance", "Just a tick, I'm polishing my wit",
  "Hold tight, I'm crafting a masterpiece", "Just a jiffy, I'm debugging the universe",
  "Just a moment, I'm aligning the pixels", "Warp speed engaged",
  "Mining for more Dilithium crystals", "Don't panic",
  "Following the white rabbit", "The truth is in here... somewhere",
  "Blowing on the cartridge", "Loading... Do a barrel roll!",
  "Waiting for the respawn", "Finishing the Kessel Run in less than 12 parsecs",
  "The cake is not a lie, it's just still loading",
  "Fiddling with the character creation screen",
  "Just a moment, I'm finding the right meme", "Pressing 'A' to continue",
  "Herding digital cats", "Polishing the pixels",
  "Finding a suitable loading screen pun", "Distracting you with this witty phrase",
  "Almost there... probably", "Our hamsters are working as fast as they can",
  "Giving Cloudy a pat on the head", "Petting the cat", "Slapping the bass",
  "I'm going the distance, I'm going for speed",
  "Is this the real life? Is this just fantasy?",
  "I've got a good feeling about this", "Doing research on the latest memes",
  "Hmmm... let me think",
  "Why don't programmers like nature? It has too many bugs",
  "Why do programmers prefer dark mode? Because light attracts bugs",
  "Why did the developer go broke? Because they used up all their cache",
  "Applying percussive maintenance", "Searching for the correct USB orientation",
  "Ensuring the magic smoke stays inside the wires",
  "Rewriting in Rust for no particular reason", "Trying to exit Vim",
  "Spinning up the hamster wheel",
  "That's not a bug, it's an undocumented feature",
  "Engage.", "I'll be back... with an answer.", "My other process is a TARDIS",
  "Communing with the machine spirit", "Letting the thoughts marinate",
  "Just remembered where I put my keys", "Pondering the orb",
  "I've seen things you people wouldn't believe... like a user who reads loading messages.",
  "Initiating thoughtful gaze", "What's a computer's favorite snack? Microchips.",
  "Why do Java developers wear glasses? Because they don't C#.",
  "Charging the laser... pew pew!", "Dividing by zero... just kidding!",
  "Making it go beep boop.", "Buffering... because even AIs need a moment.",
  "Entangling quantum particles for a faster response",
  "Are you not entertained? (Working on it!)",
  "Just waiting for the dial-up tone to finish",
  "Pretty sure there's a cat walking on the keyboard somewhere",
  "Enhancing... Enhancing... Still loading.",
  "It's not a bug, it's a feature... of this loading screen.",
  "Have you tried turning it off and on again? (The loading screen, not me.)",
  "Constructing additional pylons", "Releasing the HypnoDrones",
];

// Informative tips about Gemini CLI features (from Gemini CLI, Apache 2.0)
const GEMINI_TIPS = [
  "Restore project files to a previous state with /restore…",
  "Clear the screen and history with /clear…",
  "Save tokens by summarizing the context with /compress…",
  "Copy the last response to your clipboard with /copy…",
  "Open the full documentation in your browser with /docs…",
  "Add directories to your workspace with /directory add <path>…",
  "Get help on commands with /help…",
  "Create a project-specific GEMINI.md file with /init…",
  "List configured MCP servers and tools with /mcp list…",
  "See the current instructional context with /memory show…",
  "Choose your Gemini model with /model…",
  "Check model-specific usage stats with /stats model…",
  "Check tool-specific usage stats with /stats tools…",
  "Change the CLI's color theme with /theme…",
  "List all available tools with /tools…",
  "View and edit settings with /settings…",
  "Toggle Vim keybindings on and off with /vim…",
  "Execute any shell command with !<command>…",
  "Share your conversation to a file with /resume share <file>…",
  "Save your current conversation with /resume save <tag>…",
  "Resume a saved conversation with /resume resume <tag>…",
  "Close dialogs and suggestions with Esc…",
  "Cancel a request with Ctrl+C, or press twice to exit…",
  "Clear your screen at any time with Ctrl+L…",
  "Toggle auto-approval (YOLO mode) for all tools with Ctrl+Y…",
  "Cycle through approval modes with Shift+Tab…",
  "Toggle Markdown rendering with Alt+M…",
  "Toggle shell mode by typing ! in an empty prompt…",
  "Insert a newline with a backslash (\\) followed by Enter…",
  "Navigate your prompt history with the Up and Down arrows…",
  "Search through command history with Ctrl+R…",
  "Accept an autocomplete suggestion with Tab or Enter…",
  "Personalize your CLI with a new color theme (/settings)…",
  "Don't like these tips? You can hide them (/settings)…",
  "Customize loading phrases: tips, witty, all, or off (/settings)…",
  "Show citations to see where the model gets information (/settings)…",
  "Enable AI-powered prompt completion while typing (/settings)…",
  "Automatically accept safe read-only tool calls (/settings)…",
  "Enable checkpointing to recover your session after a crash (settings.json)…",
  "Run tools in a secure sandbox environment (settings.json)…",
  "Define and manage connections to MCP servers (settings.json)…",
  "Set your preferred editor for opening files (/settings)…",
  "File a bug report directly with /bug…",
];

function getGeminiHints(mode: 'witty' | 'tips' | 'all' | 'off'): string[] {
  if (mode === 'witty') return GEMINI_WITTY;
  if (mode === 'tips') return GEMINI_TIPS;
  if (mode === 'all') return [...GEMINI_WITTY, ...GEMINI_TIPS];
  return [];
}


function GeminiThinkingAnimation({ loadingPhrases = 'all' }: { loadingPhrases?: 'witty' | 'tips' | 'all' | 'off' }) {
  const hints = useMemo(() => getGeminiHints(loadingPhrases), [loadingPhrases]);
  const [frame, setFrame] = useState(0);
  const [color, setColor] = useState(GEMINI_COLORS[0]);
  const [hintIndex, setHintIndex] = useState(() => hints.length > 0 ? Math.floor(Math.random() * hints.length) : 0);
  const hintTransition = useReducedMotionTransition({ duration: 0.18, ease: EASING.out });

  // Braille spinner at 80ms
  useEffect(() => {
    const interval = setInterval(() => setFrame(f => (f + 1) % BRAILLE_FRAMES.length), 80);
    return () => clearInterval(interval);
  }, []);

  // Smooth rainbow color cycle over 4s
  useEffect(() => {
    let raf: number;
    const start = Date.now();
    const tick = () => {
      const elapsed = (Date.now() - start) % COLOR_CYCLE_MS;
      const progress = elapsed / COLOR_CYCLE_MS;
      const pos = progress * GEMINI_COLORS.length;
      const idx = Math.floor(pos);
      const t = pos - idx;
      const c1 = GEMINI_COLORS[idx % GEMINI_COLORS.length];
      const c2 = GEMINI_COLORS[(idx + 1) % GEMINI_COLORS.length];
      setColor(lerpColor(c1, c2, t));
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, []);

  // Cycle hints every 5 seconds
  useEffect(() => {
    if (hints.length === 0) return;
    const hintInterval = setInterval(() => {
      setHintIndex(prev => {
        let next;
        do { next = Math.floor(Math.random() * hints.length); } while (next === prev && hints.length > 1);
        return next;
      });
    }, 5000);
    return () => clearInterval(hintInterval);
  }, [hints]);

  return (
    <div className="gemini-thinking">
      <span className="gemini-spinner" style={{ color }}>{BRAILLE_FRAMES[frame]}</span>
      <AnimatePresence mode="popLayout" initial={false}>
        <motion.span
          key={hintIndex}
          className="gemini-hint gemini-hint-slide"
          initial={{ opacity: 0, y: 4 }}
          animate={{ opacity: 0.85, y: 0 }}
          exit={{ opacity: 0, y: -4 }}
          transition={hintTransition}
        >
          {hints.length > 0 ? hints[hintIndex] : 'Thinking...'}
        </motion.span>
      </AnimatePresence>
    </div>
  );
}

import ChatMessage from './ChatMessage';
import ChatInput from './ChatInput';
import MessageQueue from './MessageQueue';
import type { ChatMessage as ChatMessageType, ToolCall, PendingApproval, QueuedMessage, TerminalTab } from '../../types';
import { buildHelpMessage } from './helpText';
import { parseAiError, looksLikeApiError } from './parseAiError';

type CodexPermission = 'auto' | 'read-only' | 'full-access';

interface ChatPanelProps {
  projectPath: string;
  permissionMode: 'default' | 'bypass';
  onPermissionChange: (mode: 'default' | 'bypass') => void;
  effortLevel: 'low' | 'medium' | 'high' | 'max';
  onEffortChange: (level: 'low' | 'medium' | 'high' | 'max') => void;
  modelChoice: 'default' | 'best' | 'sonnet' | 'opus' | 'haiku' | 'sonnet[1m]' | 'opus[1m]' | 'opusplan';
  onModelChange: (model: 'default' | 'best' | 'sonnet' | 'opus' | 'haiku' | 'sonnet[1m]' | 'opus[1m]' | 'opusplan') => void;
  aiProvider: 'claude' | 'codex' | 'gemini';
  codexModel: string;
  onCodexModelChange: (model: string) => void;
  codexModels: { id: string; name: string }[];
  codexPermission: CodexPermission;
  onCodexPermissionChange: (perm: CodexPermission) => void;
  geminiModel: string;
  onGeminiModelChange: (model: string) => void;
  geminiModels: { id: string; name: string }[];
  geminiApprovalMode: 'default' | 'auto_edit' | 'yolo' | 'plan';
  onGeminiApprovalModeChange: (mode: 'default' | 'auto_edit' | 'yolo' | 'plan') => void;
  geminiConversationMode: 'planning' | 'fast';
  onGeminiConversationModeChange: (mode: 'planning' | 'fast') => void;
  geminiLoadingPhrases?: 'witty' | 'tips' | 'all' | 'off';
  initialMessages?: ChatMessageType[];
  onMessagesChange?: (messages: ChatMessageType[]) => void;
  onTurnComplete?: () => void;
  onClaudeSessionId?: (sessionId: string) => void;
  onGeminiSessionId?: (sessionId: string) => void;
  onCodexSessionId?: (sessionId: string) => void;
  activeFilePath?: string | null;
  onFileOpen?: (path: string, line?: number) => void;
  isActive?: boolean;
  messageQueue?: QueuedMessage[];
  onQueueAdd?: (sessionId: string, text: string, fullText: string, images?: string[], attachments?: { images: number; files: number; terminal: boolean }) => void;
  onQueueRemove?: (sessionId: string, id: string) => void;
  onQueueShift?: (sessionId: string) => void;
  sessionId?: string;
  terminalTabs?: TerminalTab[];
  onSlashCommandsUpdate?: (commands: string[]) => void;
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

const HINT_GROUPS = [
  [
    { key: '/', label: 'Slash commands' },
    { key: '@', label: 'Attach context' },
    { key: 'Shift+Enter', label: 'New line' },
  ],
  [
    { key: 'Ctrl+K', label: 'Command palette' },
    { key: '#', label: 'Search in files' },
    { key: '>', label: 'Run command' },
  ],
];

function CyclingHints() {
  const [groupIdx, setGroupIdx] = useState(0);
  const [fading, setFading] = useState(false);

  useEffect(() => {
    const interval = setInterval(() => {
      setFading(true);
      setTimeout(() => {
        setGroupIdx(i => (i + 1) % HINT_GROUPS.length);
        setFading(false);
      }, 500);
    }, 8000);
    return () => clearInterval(interval);
  }, []);

  return (
    <div className={`chat-empty-hints${fading ? ' fading' : ''}`}>
      {HINT_GROUPS[groupIdx].map(h => (
        <div key={h.key} className="chat-empty-hint">
          <kbd>{h.key}</kbd>
          <span>{h.label}</span>
        </div>
      ))}
    </div>
  );
}

const FAKE_ERROR_VARIANTS = {
  '': { status: 400, type: 'invalid_request_error', message: 'Output blocked by content filtering policy' },
  'rate-limit': { status: 429, type: 'rate_limit_error', message: 'Number of request tokens has exceeded your per-minute rate limit' },
  'auth':       { status: 401, type: 'authentication_error', message: 'Invalid bearer token' },
  'permission': { status: 403, type: 'permission_error', message: 'OAuth token has been revoked' },
  'overloaded': { status: 529, type: 'overloaded_error', message: 'The Anthropic API is temporarily overloaded' },
  'server':     { status: 500, type: 'api_error', message: 'Internal server error' },
  'timeout':    { status: 504, type: 'api_error', message: 'Request timed out upstream' },
} as const;

const RENDER_CHUNK = 50; // messages to show per window
const LOAD_MORE_CHUNK = 30; // messages to load when scrolling up

export default function ChatPanel({ projectPath, permissionMode, onPermissionChange, effortLevel, onEffortChange, modelChoice, onModelChange, aiProvider, codexModel, onCodexModelChange, codexModels, codexPermission, onCodexPermissionChange, geminiModel, onGeminiModelChange, geminiModels, geminiApprovalMode, onGeminiApprovalModeChange, geminiConversationMode, onGeminiConversationModeChange, geminiLoadingPhrases, initialMessages, onMessagesChange, onTurnComplete, onClaudeSessionId, onGeminiSessionId, onCodexSessionId, activeFilePath, onFileOpen, isActive, messageQueue = [], onQueueAdd, onQueueRemove, onQueueShift, sessionId, terminalTabs = [], onSlashCommandsUpdate }: ChatPanelProps) {
  const [messages, setMessagesRaw] = useState<ChatMessageType[]>(initialMessages || []);
  const messagesRef = useRef<ChatMessageType[]>(initialMessages || []);
  const setMessages = useCallback((updater: ChatMessageType[] | ((prev: ChatMessageType[]) => ChatMessageType[])) => {
    setMessagesRaw(prev => {
      const next = typeof updater === 'function' ? updater(prev) : updater;
      messagesRef.current = next;
      return next;
    });
  }, []);
  const emptyPrompt = useMemo(() => EMPTY_PROMPTS[Math.floor(Math.random() * EMPTY_PROMPTS.length)], []);
  const [isStreaming, setIsStreaming] = useState(false);
  const [turnStartIndex, setTurnStartIndex] = useState<number | null>(null);
  const thinkingTransition = useReducedMotionTransition(SPRING.pop);
  const dockTransition = useReducedMotionTransition(SPRING.dock);
  const followBtnTransition = useReducedMotionTransition(SPRING.flick);
  const turnSeqRef = useRef(0); // tracks the active turn's sequence number
  const [ready, setReady] = useState(false);
  const [slashCommands, setSlashCommands] = useState<string[]>([]);
  const [pendingApproval, setPendingApproval] = useState<PendingApproval | null>(null);
  const [fileContextEnabled, setFileContextEnabled] = useState(true);
  const [contextUsage, setContextUsage] = useState<{ used: number; total: number; inputTokens: number; cacheReadTokens: number; cacheCreationTokens: number; outputTokens: number }>({ used: 0, total: 1000000, inputTokens: 0, cacheReadTokens: 0, cacheCreationTokens: 0, outputTokens: 0 });
  const [sessionUsage, setSessionUsage] = useState<{ inputTokens: number; outputTokens: number }>({ inputTokens: 0, outputTokens: 0 });
  const [sessionCost, setSessionCost] = useState(0);
  const [autoCompactThreshold, setAutoCompactThreshold] = useState(0); // 0 = off
  const [toolCallsExpanded, setToolCallsExpanded] = useState(true);
  const autoCompactCooldownRef = useRef(0); // timestamp — don't re-compact until after this
  const [rateLimits, setRateLimits] = useState<Map<string, { rateLimitType: string; resetsAt: number; status: string; isUsingOverage: boolean; overageResetsAt: number; utilization?: number; lastUpdated: number }>>(new Map());
  const [billingMode, setBillingMode] = useState<'subscription' | 'api'>('subscription');
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const chatContainerRef = useRef<HTMLDivElement>(null);
  const userMsgRefs = useRef<Map<string, HTMLDivElement>>(new Map());
  const isAtBottomRef = useRef(true);
  const [pinnedUserMessage, setPinnedUserMessage] = useState<ChatMessageType | null>(null);
  const [followOn, setFollowOn] = useState(true);
  const [unreadCount, setUnreadCount] = useState(0);

  // Windowed rendering: only render messages from renderStart onward
  const [renderStart, setRenderStart] = useState(0);
  const sentinelRef = useRef<HTMLDivElement>(null);
  const pendingComposerRectRef = useRef<DOMRect | null>(null);

  // Keep render window pinned to the tail when user is at bottom
  useEffect(() => {
    if (isAtBottomRef.current && messages.length > RENDER_CHUNK) {
      setRenderStart(messages.length - RENDER_CHUNK);
    } else if (messages.length <= RENDER_CHUNK) {
      setRenderStart(0);
    }
  }, [messages.length]);

  // Auto-load older messages when sentinel scrolls into view
  useEffect(() => {
    const sentinel = sentinelRef.current;
    const container = chatContainerRef.current;
    if (!sentinel || !container) return;
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting && renderStart > 0) {
          const prevScrollHeight = container.scrollHeight;
          setRenderStart(prev => Math.max(0, prev - LOAD_MORE_CHUNK));
          // Preserve scroll position after loading older messages
          requestAnimationFrame(() => {
            const newScrollHeight = container.scrollHeight;
            container.scrollTop += newScrollHeight - prevScrollHeight;
          });
        }
      },
      { root: container, threshold: 0 }
    );
    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [renderStart]);

  // Load auto-compact threshold setting
  useEffect(() => {
    window.sai.settingsGet('autoCompactThreshold', 0).then((v: number) => setAutoCompactThreshold(v));
    window.sai.settingsGet('toolCallsExpanded', true).then((v: boolean) => setToolCallsExpanded(v));
  }, []);

  // Auto-compact when context exceeds threshold
  useEffect(() => {
    if (aiProvider !== 'claude' || !autoCompactThreshold || !contextUsage.used || !contextUsage.total) return;
    if (isStreaming) return; // don't compact mid-turn
    const pct = contextUsage.used / contextUsage.total;
    if (pct < autoCompactThreshold / 100) return;
    if (Date.now() < autoCompactCooldownRef.current) return;
    // Trigger compact and set 60s cooldown
    autoCompactCooldownRef.current = Date.now() + 60_000;
    window.sai.claudeCompact(projectPath, permissionMode, effortLevel, modelChoice);
  }, [contextUsage, isStreaming]);

  // Safety: clear orphaned streaming state when effect re-runs (e.g. provider switch)
  useEffect(() => {
    setIsStreaming(false);
  }, [projectPath, aiProvider]);



  useEffect(() => {
    setReady(false);
    const startFn = aiProvider === 'gemini' ? (window.sai as any).geminiStart : aiProvider === 'codex' ? window.sai.codexStart : window.sai.claudeStart;
    startFn(projectPath || '').then((result: any) => {
      setReady(true);
      if (result?.slashCommands?.length) {
        setSlashCommands(result.slashCommands);
      }
    });

    const cleanup = window.sai.claudeOnMessage((msg: any) => {
      // Only process messages for this workspace and chat scope
      if (msg.projectPath && msg.projectPath !== projectPath) return;
      if (msg.scope && msg.scope !== 'chat') return;

      if (msg.type === 'ready') {
        setReady(true);
        return;
      }

      if (msg.type === 'session_id') {
        if (aiProvider === 'codex') {
          onCodexSessionId?.(msg.sessionId);
        } else if (aiProvider === 'claude') {
          onClaudeSessionId?.(msg.sessionId);
        } else if (aiProvider === 'gemini') {
          onGeminiSessionId?.(msg.sessionId);
        }
        return;
      }

      if (msg.type === 'streaming_start') {
        if (msg.turnSeq != null) turnSeqRef.current = msg.turnSeq;
        setTurnStartIndex(messagesRef.current.length);
        setIsStreaming(true);
        return;
      }

      // End-of-turn: clear streaming immediately for both 'result' and 'done',
      // matching App.tsx's workspace busy indicator pattern.
      if (msg.type === 'result' || msg.type === 'done') {
        // Ignore stale messages from a previous turn — e.g. when the user sends a new
        // message while the CLI is still finishing the old response, the old result/done
        // arrives tagged with the old turnSeq and should not affect the new turn's state.
        if (msg.turnSeq != null && msg.turnSeq !== turnSeqRef.current) return;
        if (msg.type === 'done') {
          turnSeqRef.current = -1;
          setTurnStartIndex(null);
          flushMessagesToParent();
          onTurnComplete?.();
        }
        setIsStreaming(false);
        setPendingApproval(null);
        // Don't return for 'result' — fall through to process usage data below
        if (msg.type === 'done') return;
      }

      if (msg.type === 'process_exit') {
        setReady(false);
        setIsStreaming(false);
        setPendingApproval(null);
        flushMessagesToParent();
        onTurnComplete?.();
        return;
      }

      if (msg.type === 'error') {
        const error = parseAiError(msg.text || 'Unknown error');
        setMessages(prev => [...prev, {
          id: Date.now().toString(),
          role: 'system',
          content: error.message,
          timestamp: Date.now(),
          error,
        }]);
        // Don't set isStreaming=false here — errors can be non-fatal stderr warnings.
        // The authoritative end-of-turn signal is 'done' or 'process_exit'.
        return;
      }

      // Capture slash commands from init
      if (msg.type === 'system' && msg.subtype === 'init' && msg.slash_commands) {
        setSlashCommands(msg.slash_commands);
        onSlashCommandsUpdate?.(msg.slash_commands);
        return;
      }

      // Capture rate limit info (may receive multiple: daily, weekly, etc.)
      // CLI events are supplementary — only update utilization when the
      // authoritative OAuth API data is stale (>60 s) or absent.
      if (msg.type === 'rate_limit_event' && msg.rate_limit_info) {
        const info = msg.rate_limit_info;
        const key = info.rateLimitType || 'unknown';
        setRateLimits(prev => {
          const next = new Map(prev);
          const existing = next.get(key);
          const now = Date.now();

          const entry = {
            rateLimitType: key,
            resetsAt: info.resetsAt || existing?.resetsAt || 0,
            status: info.status || existing?.status || 'unknown',
            isUsingOverage: !!(info.isUsingOverage ?? existing?.isUsingOverage),
            overageResetsAt: info.overageResetsAt || existing?.overageResetsAt || 0,
            utilization: existing?.utilization,
            lastUpdated: existing?.lastUpdated || now,
          };

          // Only update utilization from CLI if no API data yet or API data is stale
          const apiDataStale = !existing?.lastUpdated || (now - existing.lastUpdated) > 60_000;
          if (info.utilization !== undefined && apiDataStale) {
            entry.utilization = info.utilization;
            entry.lastUpdated = now;
          }

          next.set(key, entry);
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

      // Tool approval request from main process
      if (msg.type === 'approval_needed') {
        setPendingApproval({
          toolName: msg.toolName,
          toolUseId: msg.toolUseId,
          command: msg.command,
          description: msg.description,
          input: msg.input,
        });
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
          setPendingApproval(null);
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
                    block.name?.includes('Read') || block.name?.includes('Glob') || block.name?.includes('Grep') ? 'file_read' :
                    block.name?.includes('WebFetch') || block.name?.includes('WebSearch') ? 'web_fetch' : 'other',
              name: block.name || 'tool',
              input: typeof block.input === 'string' ? block.input :
                     typeof block.input === 'object' ? JSON.stringify(block.input, null, 2) : '',
            });
          }
        }

        const text = textParts.join('');

        if (text && tools.length === 0 && looksLikeApiError(text)) {
          const error = parseAiError(text);
          setMessages(prev => {
            const next = [...prev];
            const last = next[next.length - 1];
            if (last?.role === 'assistant' && !last.toolCalls) {
              next.pop();
            }
            next.push({
              id: `${Date.now()}-${Math.random()}`,
              role: 'system',
              content: error.message,
              timestamp: Date.now(),
              error,
            });
            return next;
          });
          return;
        }

        if (text || tools.length > 0) {
          setMessages(prev => {
            const last = prev[prev.length - 1];
            // Update the last assistant message if it's a pure text message (no tool calls).
            // Append only when the transport marks the block as a delta; otherwise replace.
            // If the last message has tool calls, always create a new message so
            // tool cards stay above the follow-up text response.
            if (last?.role === 'assistant' && text && !tools.length && !last.toolCalls) {
              const updated = [...prev];
              const shouldAppend = msg.message.content.some((block: any) => block.type === 'text' && block.delta);
              const newContent = shouldAppend ? last.content + text : text;
              updated[updated.length - 1] = { ...last, content: newContent };
              return updated;
            }
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

      // Result — usage data processing (isStreaming already cleared at top of handler)
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
        // Track session cost from CLI-reported total (cumulative per session)
        if (msg.total_cost_usd != null) {
          setSessionCost(msg.total_cost_usd);
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

    return () => {
      cleanup();
    };
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
            lastUpdated: Date.now(),
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
            lastUpdated: Date.now(),
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

  useEffect(() => {
    (window.sai as any).usageMode?.().then((mode: string) => {
      if (mode === 'subscription' || mode === 'api') {
        setBillingMode(mode);
      }
    });
  }, []);

  // Wheel events are never fired by programmatic scrolls — use them to detect user scrolling up
  useEffect(() => {
    const el = chatContainerRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      if (e.deltaY < 0) {
        isAtBottomRef.current = false;
        setFollowOn(false);
      }
    };
    el.addEventListener('wheel', onWheel, { passive: true });
    return () => el.removeEventListener('wheel', onWheel);
  }, []);

  // Scroll to bottom on mount (session switch remounts via key change)
  // Use rAF to ensure DOM has laid out messages before scrolling
  useEffect(() => {
    requestAnimationFrame(() => {
      messagesEndRef.current?.scrollIntoView({ behavior: 'instant' });
    });
  }, []);

  // Scroll to bottom when this workspace becomes the active/visible one
  useEffect(() => {
    if (isActive) {
      isAtBottomRef.current = true;
      setFollowOn(true);
      setUnreadCount(0);
      requestAnimationFrame(() => {
        messagesEndRef.current?.scrollIntoView({ behavior: 'instant' });
      });
    }
  }, [isActive]);

  // When the chat container shrinks (e.g. TodoProgress / approval panel /
  // queue chips appear and push it up), keep the bottom in view if the user
  // was already at the bottom. Without this the latest messages get hidden
  // behind the now-taller bottom strip.
  useEffect(() => {
    const el = chatContainerRef.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    let lastHeight = el.clientHeight;
    const ro = new ResizeObserver(() => {
      const h = el.clientHeight;
      if (h < lastHeight && isAtBottomRef.current) {
        el.scrollTop = el.scrollHeight;
      }
      lastHeight = h;
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  useEffect(() => {
    if (isAtBottomRef.current) {
      setFollowOn(true);
      setUnreadCount(0);
      if (chatContainerRef.current) tweenScrollToBottom(chatContainerRef.current);
    } else if (messages[messages.length - 1]?.role === 'assistant') {
      setUnreadCount(c => c + 1);
    }
  }, [messages, isStreaming, projectPath]);

  const scrollToBottom = () => {
    isAtBottomRef.current = true;
    setFollowOn(true);
    setUnreadCount(0);
    if (chatContainerRef.current) tweenScrollToBottom(chatContainerRef.current);
  };

  const userMessages = useMemo(
    () => messages.filter(m => m.role === 'user'),
    [messages]
  );

  // Track whether the last user message is out of view (reliable via IntersectionObserver)
  const lastUserOutOfView = useRef(false);
  useEffect(() => {
    const last = userMessages[userMessages.length - 1];
    const el = last ? userMsgRefs.current.get(last.id) : null;
    const container = chatContainerRef.current;
    if (!el || !container) { lastUserOutOfView.current = false; setPinnedUserMessage(null); return; }
    lastUserOutOfView.current = false;
    setPinnedUserMessage(null);
    const observer = new IntersectionObserver(
      ([entry]) => {
        lastUserOutOfView.current = !entry.isIntersecting;
        if (entry.isIntersecting) {
          setPinnedUserMessage(null);
        } else {
          // Initial trigger — pin the last user message; handleScroll refines from here
          setPinnedUserMessage(last);
        }
      },
      { root: container, threshold: 0 }
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, [userMessages[userMessages.length - 1]?.id]);

  const handleScroll = () => {
    const el = chatContainerRef.current;
    if (!el) return;
    const atBottom = el.scrollTop + el.clientHeight >= el.scrollHeight - 60;
    if (atBottom) {
      isAtBottomRef.current = true;
      setFollowOn(true);
      setUnreadCount(0);
    }
    // Update which user message is pinned as user scrolls through conversation
    if (!lastUserOutOfView.current) return;
    const containerTop = el.getBoundingClientRect().top;
    let pinTarget: ChatMessageType | null = null;
    for (let i = userMessages.length - 1; i >= 0; i--) {
      const dom = userMsgRefs.current.get(userMessages[i].id);
      if (dom && dom.getBoundingClientRect().bottom < containerTop) {
        pinTarget = userMessages[i];
        break;
      }
    }
    if (pinTarget) setPinnedUserMessage(pinTarget);
  };

  const visibleMessages = useMemo(
    () => messages.slice(renderStart),
    [messages, renderStart]
  );

  const firstAssistantOfTurnId = useMemo(() => {
    if (turnStartIndex == null) return null;
    for (let i = turnStartIndex; i < messages.length; i++) {
      if (messages[i].role === 'assistant') return messages[i].id;
    }
    return null;
  }, [messages, turnStartIndex]);
  const hasHiddenMessages = renderStart > 0;

  useEffect(() => {
    onMessagesChange?.(messages);
  }, [messages]);

  // Flush messages ref to parent synchronously before save — called by onTurnComplete
  const flushMessagesToParent = useCallback(() => {
    onMessagesChange?.(messagesRef.current);
  }, [onMessagesChange]);

  const handleApprove = (modifiedCommand?: string) => {
    if (!pendingApproval) return;
    window.sai.claudeApprove(projectPath, pendingApproval.toolUseId, true, modifiedCommand);
    setPendingApproval(null);
  };

  const handleDeny = () => {
    if (!pendingApproval) return;
    window.sai.claudeApprove(projectPath, pendingApproval.toolUseId, false);
    setPendingApproval(null);
  };

  const handleAlwaysAllow = async () => {
    if (!pendingApproval) return;
    const pattern = `${pendingApproval.toolName}(*)`;
    await window.sai.claudeAlwaysAllow(projectPath, pattern);
    window.sai.claudeApprove(projectPath, pendingApproval.toolUseId, true);
    setPendingApproval(null);
  };

  const handleFakeError = useCallback((text: string) => {
    const arg = text.replace(/^\/fake-error\s*/, '').trim() as keyof typeof FAKE_ERROR_VARIANTS;
    const variant = FAKE_ERROR_VARIANTS[arg] ?? FAKE_ERROR_VARIANTS[''];
    const requestId = `req_fake_${Math.random().toString(16).slice(2, 14)}`;
    const envelope = `API Error: ${variant.status} ${JSON.stringify({
      type: 'error',
      error: { type: variant.type, message: variant.message },
      request_id: requestId,
    })}`;
    const error = parseAiError(envelope);
    setMessages(prev => [...prev, {
      id: `${Date.now()}-${Math.random()}`,
      role: 'system',
      content: error.message,
      timestamp: Date.now(),
      error,
    }]);
  }, [setMessages]);

  const handleSend = async (text: string, images?: string[]) => {
    // Handle built-in commands locally
    if (import.meta.env.DEV && text.startsWith('/fake-error')) {
      handleFakeError(text);
      return;
    }
    if (text === '/clear') {
      setMessages([]);
      setRenderStart(0);
      pendingComposerRectRef.current = null;
      return;
    }
    if (text === '/compact' && aiProvider === 'claude') {
      window.sai.claudeCompact(projectPath, permissionMode, effortLevel, modelChoice);
      pendingComposerRectRef.current = null;
      return;
    }

    const newMessageId = Date.now().toString();

    if (text === '/help') {
      if (pendingComposerRectRef.current) {
        setFlipRect(newMessageId, pendingComposerRectRef.current);
        pendingComposerRectRef.current = null;
      }
      setMessages(prev => [...prev,
        { id: newMessageId, role: 'user', content: text, timestamp: Date.now() },
        { id: `help-${Date.now()}`, role: 'system', content:
          buildHelpMessage(aiProvider, slashCommands),
          timestamp: Date.now() },
      ]);
      return;
    }

    isAtBottomRef.current = true;
    if (pendingComposerRectRef.current) {
      setFlipRect(newMessageId, pendingComposerRectRef.current);
      pendingComposerRectRef.current = null;
    }
    setMessages(prev => [...prev, {
      id: newMessageId,
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

    const prompt = activeFilePath && fileContextEnabled ? `[File: ${activeFilePath}]\n\n${text}` : text;
    if (aiProvider === 'gemini') {
      (window.sai as any).geminiSend(projectPath, prompt, imagePaths, geminiApprovalMode, geminiConversationMode, geminiModel, 'chat');
    } else if (aiProvider === 'codex') {
      window.sai.codexSend(projectPath, prompt, imagePaths, codexPermission, codexModel);
    } else {
      window.sai.claudeSend(projectPath, prompt, imagePaths, permissionMode, effortLevel, modelChoice);
    }
  };

  const handleRetry = useCallback((errorMessageId: string) => {
    if (isStreaming) return;
    const all = messagesRef.current;
    const idx = all.findIndex(m => m.id === errorMessageId);
    if (idx < 0) return;
    let lastUser: ChatMessageType | undefined;
    for (let i = idx - 1; i >= 0; i--) {
      if (all[i].role === 'user') { lastUser = all[i]; break; }
    }
    if (!lastUser) return;
    handleSend(lastUser.content, lastUser.images);
  }, [isStreaming]);

  const handleClearContext = useCallback(() => {
    setMessages([]);
    setRenderStart(0);
    pendingComposerRectRef.current = null;
  }, [setMessages]);

  const handleQueue = (text: string, fullText: string, images?: string[], attachments?: { images: number; files: number; terminal: boolean }) => {
    if (sessionId && onQueueAdd) {
      onQueueAdd(sessionId, text, fullText, images, attachments);
    }
  };

  const prevStreamingRef = useRef(false);
  useEffect(() => {
    if (prevStreamingRef.current && !isStreaming && messageQueue.length > 0 && onQueueShift && sessionId) {
      const next = messageQueue[0];
      onQueueShift(sessionId);
      setTimeout(() => handleSend(next.fullText, next.images), 300);
    }
    prevStreamingRef.current = isStreaming;
  }, [isStreaming]);

  return (
    <div className="chat-panel">
      <motion.div
        className="pinned-prompt-bar"
        layoutId={pinnedUserMessage ? `pinned-${pinnedUserMessage.id}` : undefined}
        data-layout-id={pinnedUserMessage ? `pinned-${pinnedUserMessage.id}` : undefined}
        animate={{ height: pinnedUserMessage ? 32 : 0, opacity: pinnedUserMessage ? 1 : 0 }}
        transition={dockTransition}
        style={{ overflow: 'hidden' }}
      >
        {pinnedUserMessage && (
          <>
            <div className="pinned-prompt-accent" />
            <span className="pinned-prompt-label">You</span>
            <span className="pinned-prompt-text">{pinnedUserMessage.content}</span>
            <button
              className="pinned-prompt-jump"
              onClick={() => {
                isAtBottomRef.current = false;
                const el = userMsgRefs.current.get(pinnedUserMessage.id);
                el?.scrollIntoView({ behavior: 'smooth', block: 'center' });
              }}
              title="Jump to message"
            >
              <CornerLeftUp size={11} strokeWidth={2.5} />
              <span>Jump</span>
            </button>
          </>
        )}
      </motion.div>
      <div className="chat-messages" ref={chatContainerRef} onScroll={handleScroll}>
        {messages.length === 0 ? (
          <div className="chat-empty">
            <img src="svg/sai.svg" alt="SAI" className="chat-empty-logo chat-empty-logo-float" />
            <div className="chat-empty-title">SAI</div>
            <div className="chat-empty-subtitle">
              {projectPath ? emptyPrompt : 'Select a project to get started'}
            </div>
            {projectPath && <CyclingHints />}
          </div>
        ) : (
          <>
            <div className="chat-messages-spacer" aria-hidden="true" />
            {hasHiddenMessages && (
              <div ref={sentinelRef} className="chat-load-sentinel">
                <span className="chat-load-sentinel-text">Loading earlier messages...</span>
              </div>
            )}
            {visibleMessages.map(msg => msg.role === 'user'
                ? (
                  <div
                    key={msg.id}
                    ref={el => { if (el) userMsgRefs.current.set(msg.id, el); else userMsgRefs.current.delete(msg.id); }}
                    data-layout-id={`pinned-${msg.id}`}
                  >
                    <ChatMessage
                      message={msg}
                      projectPath={projectPath}
                      onFileOpen={onFileOpen}
                      aiProvider={aiProvider}
                      toolCallsExpanded={toolCallsExpanded}
                      pinnedLayoutId={`pinned-${msg.id}`}
                      isFirstAssistantOfTurn={msg.id === firstAssistantOfTurnId}
                    />
                  </div>
                )
                : <ChatMessage key={msg.id} message={msg} projectPath={projectPath} onFileOpen={onFileOpen} aiProvider={aiProvider} toolCallsExpanded={toolCallsExpanded} onRetry={msg.error ? () => handleRetry(msg.id) : undefined} onClearContext={msg.error ? handleClearContext : undefined} isFirstAssistantOfTurn={msg.id === firstAssistantOfTurnId} />
              )}
          </>
        )}
        <MotionPresence>
          {isStreaming && !firstAssistantOfTurnId && (
            <motion.div
              key="thinking"
              initial={{ opacity: 0, y: DISTANCE.lift }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0 }}
              transition={thinkingTransition}
            >
              {aiProvider === 'gemini' ? <GeminiThinkingAnimation loadingPhrases={geminiLoadingPhrases} />
                : aiProvider === 'codex' ? <CodexThinkingAnimation />
                : <ThinkingAnimation />}
            </motion.div>
          )}
        </MotionPresence>
        <div ref={messagesEndRef} />
      </div>
      <div className="follow-btn-anchor">
        <AnimatePresence>
          {!followOn && (
            <motion.button
              data-testid="follow-btn"
              className="follow-btn"
              initial={{ opacity: 0, y: 6, scale: 0.85 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: 6, scale: 0.85 }}
              transition={followBtnTransition}
              onClick={scrollToBottom}
              title="Jump to latest"
            >
              <ChevronDown size={16} />
              {unreadCount > 0 && (
                <span data-testid="follow-btn-unread" className="follow-btn-unread" aria-label={`${unreadCount} new`} />
              )}
            </motion.button>
          )}
        </AnimatePresence>
      </div>
      <LayoutGroup>
        <div data-testid="chat-bottom-strip" className="chat-bottom-strip">
          <MessageQueue
            queue={messageQueue}
            onRemove={(id) => sessionId && onQueueRemove?.(sessionId, id)}
          />
          <ChatInput
            onSend={handleSend}
            onBeforeSend={(rect) => { pendingComposerRectRef.current = rect; }}
            disabled={!ready}
            slashCommands={slashCommands}
            onQueue={handleQueue}
            queueCount={messageQueue.length}
            pendingApproval={pendingApproval}
            onApprove={handleApprove}
            onDeny={handleDeny}
            onAlwaysAllow={handleAlwaysAllow}
            isStreaming={isStreaming}
            messages={messages}
            onStop={() => aiProvider === 'gemini' ? (window.sai as any).geminiStop(projectPath) : aiProvider === 'codex' ? window.sai.codexStop(projectPath) : window.sai.claudeStop?.(projectPath)}
            permissionMode={permissionMode}
            onPermissionChange={onPermissionChange}
            effortLevel={effortLevel}
            onEffortChange={onEffortChange}
            modelChoice={modelChoice}
            onModelChange={onModelChange}
            contextUsage={contextUsage}
            sessionUsage={sessionUsage}
            sessionCost={sessionCost}
            rateLimits={rateLimits}
            billingMode={billingMode}
            activeFilePath={activeFilePath}
            fileContextEnabled={fileContextEnabled}
            onFileContextToggle={() => setFileContextEnabled(prev => !prev)}
            aiProvider={aiProvider}
            codexModel={codexModel}
            codexModels={codexModels}
            onCodexModelChange={onCodexModelChange}
            codexPermission={codexPermission}
            onCodexPermissionChange={onCodexPermissionChange}
            geminiModel={geminiModel}
            geminiModels={geminiModels}
            onGeminiModelChange={onGeminiModelChange}
            geminiApprovalMode={geminiApprovalMode}
            onGeminiApprovalModeChange={onGeminiApprovalModeChange}
            geminiConversationMode={geminiConversationMode}
            onGeminiConversationModeChange={onGeminiConversationModeChange}
            terminalTabs={terminalTabs}
          />
        </div>
      </LayoutGroup>
      <style>{`
        .chat-panel {
          flex: 1;
          display: flex;
          flex-direction: column;
          min-height: 0;
          overflow: hidden;
        }
        .chat-bottom-strip {
          display: flex;
          flex-direction: column;
        }
        .follow-btn-anchor {
          position: relative;
          flex-shrink: 0;
          height: 0;
          z-index: 10;
        }
        .follow-btn {
          position: absolute;
          right: 12px;
          bottom: 12px;
          z-index: 10;
          display: flex;
          align-items: center;
          justify-content: center;
          width: 32px;
          height: 32px;
          padding: 0;
          border-radius: 50%;
          border: 1px solid var(--border);
          background: var(--bg-secondary);
          color: var(--accent);
          cursor: pointer;
          box-shadow: 0 2px 12px rgba(0, 0, 0, 0.3);
          transition: background 0.15s, border-color 0.15s;
        }
        .follow-btn:hover {
          background: color-mix(in srgb, var(--bg-secondary) 70%, var(--accent) 10%);
          border-color: color-mix(in srgb, var(--border) 60%, var(--accent) 40%);
        }
        .follow-btn-unread {
          position: absolute;
          top: 4px;
          right: 4px;
          width: 6px;
          height: 6px;
          border-radius: 50%;
          background: var(--accent);
          box-shadow: 0 0 0 2px var(--bg-secondary);
        }
        @media (prefers-reduced-motion: no-preference) {
          @keyframes follow-btn-unread-pulse {
            0%   { transform: scale(1); opacity: 1; }
            50%  { transform: scale(1.4); opacity: 0.7; }
            100% { transform: scale(1); opacity: 1; }
          }
          .follow-btn-unread {
            animation: follow-btn-unread-pulse 1.4s ease-in-out infinite;
          }
        }
        .pinned-prompt-bar {
          flex-shrink: 0;
          padding: 0 16px 0 0;
          border-bottom: 1px solid var(--border);
          background: color-mix(in srgb, var(--bg-secondary) 80%, transparent);
          backdrop-filter: blur(12px);
          -webkit-backdrop-filter: blur(12px);
          display: flex;
          align-items: baseline;
          gap: 8px;
          min-width: 0;
        }
        .pinned-prompt-accent {
          width: 3px;
          align-self: stretch;
          background: var(--accent);
          border-radius: 0 2px 2px 0;
          opacity: 0.7;
          flex-shrink: 0;
        }
        .pinned-prompt-label {
          flex-shrink: 0;
          font-size: 11px;
          font-weight: 600;
          text-transform: uppercase;
          letter-spacing: 0.06em;
          line-height: 32px;
          color: var(--accent);
          opacity: 0.8;
          font-family: 'Geist Mono', 'JetBrains Mono', monospace;
          padding-left: 4px;
        }
        .pinned-prompt-text {
          flex: 1;
          font-size: 11px;
          line-height: 32px;
          color: var(--text-secondary);
          opacity: 0.7;
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
          font-family: 'Geist Mono', 'JetBrains Mono', monospace;
          min-width: 0;
        }
        .pinned-prompt-jump {
          flex-shrink: 0;
          background: none;
          border: 1px solid transparent;
          color: var(--text-muted);
          cursor: pointer;
          padding: 3px 8px;
          margin-left: auto;
          display: flex;
          align-items: center;
          gap: 4px;
          border-radius: 6px;
          font-size: 10px;
          font-weight: 500;
          font-family: 'Geist Mono', 'JetBrains Mono', monospace;
          letter-spacing: 0.02em;
          transition: all 0.15s ease;
        }
        .pinned-prompt-jump:hover {
          color: var(--accent);
          background: color-mix(in srgb, var(--accent) 10%, transparent);
          border-color: color-mix(in srgb, var(--accent) 25%, transparent);
        }
        .chat-messages {
          flex: 1;
          overflow-y: auto;
          padding: 16px;
          min-height: 0;
          display: flex;
          flex-direction: column;
        }
        .chat-messages-spacer {
          flex: 1 1 auto;
          min-height: 0;
        }
        .chat-load-sentinel {
          display: flex;
          justify-content: center;
          padding: 12px 0;
        }
        .chat-load-sentinel-text {
          font-size: 11px;
          color: var(--text-muted);
          opacity: 0.5;
          font-family: 'Geist Mono', 'JetBrains Mono', monospace;
        }
        .chat-empty {
          display: flex;
          flex-direction: column;
          align-items: center;
          justify-content: center;
          height: 100%;
          gap: 12px;
          animation: empty-fade 0.5s ease-out;
        }
        @keyframes empty-fade {
          from { opacity: 0; transform: scale(0.97); }
          to   { opacity: 1; transform: scale(1); }
        }
        .chat-empty-logo {
          width: 48px;
          height: 48px;
          opacity: 0.25;
          margin-bottom: 4px;
        }
        @media (prefers-reduced-motion: no-preference) {
          @keyframes chat-empty-logo-float {
            0%, 100% { transform: translateY(0); }
            50%      { transform: translateY(-2px); }
          }
          .chat-empty-logo-float {
            animation: chat-empty-logo-float 4s ease-in-out infinite;
          }
        }
        .chat-empty-title {
          font-size: 32px;
          font-weight: 700;
          color: var(--accent);
          letter-spacing: 4px;
          font-family: 'Geist Mono', 'JetBrains Mono', monospace;
        }
        .chat-empty-subtitle {
          font-size: 14px;
          color: var(--text-muted);
          font-style: italic;
        }
        .chat-empty-hints {
          display: flex;
          gap: 20px;
          margin-top: 16px;
          transition: opacity 0.5s ease;
        }
        .chat-empty-hints.fading {
          opacity: 0;
        }
        .chat-empty-hint {
          display: flex;
          align-items: center;
          gap: 8px;
          color: var(--text-muted);
          font-size: 12px;
        }
        .chat-empty-hint kbd {
          background: var(--bg-input);
          border: 1px solid var(--border);
          border-radius: 4px;
          padding: 2px 7px;
          font-family: 'Geist Mono', 'JetBrains Mono', monospace;
          font-size: 11px;
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
        @media (prefers-reduced-motion: no-preference) {
          @keyframes thinking-cursor-breathe {
            0%, 100% { transform: scaleY(1.0); }
            50%      { transform: scaleY(1.08); }
          }
          .thinking-cursor-breathing {
            display: inline-block;
            transform-origin: bottom;
            animation: thinking-cursor-breathe 1.6s ease-in-out infinite;
          }
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
        @media (prefers-reduced-motion: no-preference) {
          @keyframes codex-working-wave {
            0%, 100% { transform: translateY(0); }
            50%      { transform: translateY(-0.5px); }
          }
          .codex-working-wave > span {
            display: inline-block;
            animation: codex-working-wave 1.4s ease-in-out infinite;
          }
        }
        .gemini-thinking {
          display: flex;
          align-items: center;
          gap: 8px;
          padding: 8px 0;
          margin-bottom: 12px;
        }
        .gemini-spinner {
          font-size: 18px;
          line-height: 1;
          flex-shrink: 0;
        }
        .gemini-hint {
          font-size: 13px;
          font-style: italic;
          color: var(--text);
        }
      `}</style>
    </div>
  );
}
