import { useState, useEffect, useRef, useCallback, useLayoutEffect, useMemo, type MutableRefObject } from 'react';
import { ChevronDown, CornerLeftUp, ArrowDownToLine } from 'lucide-react';
import ThinkingAnimation from '../ThinkingAnimation';
import { dbGetMessagesRange } from '../../chatDb';

function ChatScrollDebugHud({
  scrollerRef,
  followingRef,
  isAtBottomRef,
  showNewMessages,
  isStreaming,
  messageCount,
}: {
  scrollerRef: MutableRefObject<HTMLElement | Window | null>;
  followingRef: MutableRefObject<boolean>;
  isAtBottomRef: MutableRefObject<boolean>;
  showNewMessages: boolean;
  isStreaming: boolean;
  messageCount: number;
}) {
  const [tick, setTick] = useState(0);
  useEffect(() => {
    let raf = 0;
    const loop = () => { setTick(t => (t + 1) % 1_000_000); raf = requestAnimationFrame(loop); };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, []);
  const el = scrollerRef.current instanceof HTMLElement ? scrollerRef.current : null;
  const gap = el ? el.scrollHeight - el.scrollTop - el.clientHeight : 0;
  const stuck = showNewMessages && gap < 8;
  return (
    <div
      data-tick={tick}
      style={{
        position: 'absolute',
        bottom: 4,
        right: 8,
        zIndex: 50,
        font: '10px/1.35 ui-monospace, SFMono-Regular, monospace',
        background: stuck ? 'rgba(180, 60, 40, 0.92)' : 'rgba(0, 0, 0, 0.62)',
        color: '#fff',
        padding: '4px 7px',
        borderRadius: 4,
        pointerEvents: 'none',
        whiteSpace: 'pre',
      }}
    >
      {`follow=${followingRef.current ? 'Y' : 'N'}  atBot=${isAtBottomRef.current ? 'Y' : 'N'}  newMsg=${showNewMessages ? 'Y' : 'N'}\n`}
      {`gap=${gap}px  msgs=${messageCount}  stream=${isStreaming ? 'Y' : 'N'}${stuck ? '  ⚠ STUCK' : ''}`}
    </div>
  );
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
      <span className="codex-working">Working</span>
    </div>
  );
}

const BRAILLE_FRAMES = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];

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
  const [hintIndex, setHintIndex] = useState(() => hints.length > 0 ? Math.floor(Math.random() * hints.length) : 0);

  // Braille spinner at 80ms
  useEffect(() => {
    const interval = setInterval(() => setFrame(f => (f + 1) % BRAILLE_FRAMES.length), 80);
    return () => clearInterval(interval);
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
      <span className="gemini-spinner">{BRAILLE_FRAMES[frame]}</span>
      <span className="gemini-hint">{hints.length > 0 ? hints[hintIndex] : 'Thinking...'}</span>
    </div>
  );
}

import ChatMessage from './ChatMessage';
import ChatInput from './ChatInput';
import MessageQueue from './MessageQueue';
import TodoProgress from './TodoProgress';
import { motion, AnimatePresence } from 'motion/react';
import type { ChatMessage as ChatMessageType, ToolCall, PendingApproval, QueuedMessage, TerminalTab } from '../../types';
import { buildHelpMessage } from './helpText';
import { parseAiError } from './parseAiError';

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
  initialFirstLoadedIdx?: number;
  pageSize?: number;
  onFirstLoadedIdxChange?: (idx: number) => void;
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


export default function ChatPanel({ projectPath, permissionMode, onPermissionChange, effortLevel, onEffortChange, modelChoice, onModelChange, aiProvider, codexModel, onCodexModelChange, codexModels, codexPermission, onCodexPermissionChange, geminiModel, onGeminiModelChange, geminiModels, geminiApprovalMode, onGeminiApprovalModeChange, geminiConversationMode, onGeminiConversationModeChange, geminiLoadingPhrases, initialMessages, initialFirstLoadedIdx = 0, pageSize = 100, onFirstLoadedIdxChange, onMessagesChange, onTurnComplete, onClaudeSessionId, onGeminiSessionId, onCodexSessionId, activeFilePath, onFileOpen, isActive, messageQueue = [], onQueueAdd, onQueueRemove, onQueueShift, sessionId, terminalTabs = [], onSlashCommandsUpdate }: ChatPanelProps) {
  const [messages, setMessagesRaw] = useState<ChatMessageType[]>(initialMessages || []);
  const messagesRef = useRef<ChatMessageType[]>(initialMessages || []);
  const setMessages = useCallback((updater: ChatMessageType[] | ((prev: ChatMessageType[]) => ChatMessageType[])) => {
    setMessagesRaw(prev => {
      const next = typeof updater === 'function' ? updater(prev) : updater;
      messagesRef.current = next;
      return next;
    });
  }, []);

  const scrollerRef = useRef<HTMLElement | Window | null>(null);
  // Ref to the inner content wrapper so the streaming ResizeObserver can watch
  // content-size growth (the scroller itself only reports its own box size).
  const messagesInnerRef = useRef<HTMLDivElement | null>(null);
  // Per-message DOM refs keyed by message id, used for jump-to-message scrollIntoView
  // and for cheap visibleStartIdx computation on scroll.
  const messageElsRef = useRef<Map<string, HTMLDivElement>>(new Map());
  const setMessageEl = useCallback((id: string, el: HTMLDivElement | null) => {
    if (el) messageElsRef.current.set(id, el);
    else messageElsRef.current.delete(id);
  }, []);
  // Sentinel at the top of the message list. IntersectionObserver triggers
  // pagination when it scrolls into view.
  const topSentinelRef = useRef<HTMLDivElement | null>(null);
  const isAtBottomRef = useRef(true);
  // followingRef is the user's *intent* to follow output. It only flips false
  // from a user-initiated scroll up (wheel/touch), and flips true when the
  // user reaches the bottom or clicks the indicator. Programmatic scrolls
  // never toggle it, so streaming auto-scroll won't accidentally pause itself.
  const followingRef = useRef(true);
  const snapToBottom = useCallback(() => {
    const el = scrollerRef.current as HTMLElement | null;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
  }, []);

  // Wheel/touch events are never fired by programmatic scrolls, so they're a
  // clean signal of user intent to scroll up (whereas atBottom flips during
  // the scrollTop animation we drive ourselves during streaming).
  const wheelHandlersAttachedRef = useRef<HTMLElement | null>(null);
  const touchYRef = useRef(0);
  // Set true while a programmatic scroll-away (e.g. Jump-to-message) is in
  // flight. Suppresses the safety-net scroll listener and the streaming
  // ResizeObserver so they don't drag the user back to the bottom mid-jump.
  const programmaticScrollRef = useRef(false);
  // While the user is following, any growth of the scroll content (streaming
  // text, tool-call expansions, image loads) should immediately re-anchor to
  // the bottom. ResizeObserver fires on every layout change, which is finer-
  // grained than streaming flushes — fixes the "hangs behind during render"
  // case where content grows between flushes.
  const resizeObserverRef = useRef<ResizeObserver | null>(null);
  const attachContentResizeObserver = useCallback((scroller: HTMLElement) => {
    if (typeof ResizeObserver === 'undefined') return;
    resizeObserverRef.current?.disconnect();
    // Coalesce multiple layout changes within a single frame into one scroll
    // snap. During heavy bursts (markdown re-tokenization, highlight.js,
    // typewriter ticks) the observer can fire 5-10× per frame, and snapping
    // every time forces synchronous layout reads that stall the next paint.
    let rafScheduled = false;
    const ro = new ResizeObserver(() => {
      if (programmaticScrollRef.current) return;
      if (!followingRef.current) return;
      if (rafScheduled) return;
      rafScheduled = true;
      requestAnimationFrame(() => {
        rafScheduled = false;
        if (programmaticScrollRef.current || !followingRef.current) return;
        scroller.scrollTop = scroller.scrollHeight;
      });
    });
    // Observe the messages-inner wrapper (or fall back to the first child if
    // the ref isn't set yet) — its height tracks total content height, which
    // is what drives bottom-pinning during streaming.
    const target = messagesInnerRef.current ?? (scroller.firstElementChild as HTMLElement | null);
    if (target) ro.observe(target);
    resizeObserverRef.current = ro;
  }, []);
  useEffect(() => () => resizeObserverRef.current?.disconnect(), []);

  const attachUserScrollListeners = useCallback((el: HTMLElement) => {
    if (wheelHandlersAttachedRef.current === el) return;
    wheelHandlersAttachedRef.current = el;
    // Threshold filters trackpad bounce/jitter (~0.5–1.5px) while still
    // registering any deliberate flick as scroll-up intent. The safety-net
    // scroll listener below restores follow as soon as the user lands back
    // at the bottom, so we don't need an at-bottom guard here.
    el.addEventListener('wheel', (e: WheelEvent) => {
      if (e.deltaY < -3) {
        followingRef.current = false;
        setFollowing(false);
      }
    }, { passive: true });
    el.addEventListener('touchstart', (e: TouchEvent) => {
      touchYRef.current = e.touches[0]?.clientY ?? 0;
    }, { passive: true });
    el.addEventListener('touchmove', (e: TouchEvent) => {
      const y = e.touches[0]?.clientY ?? 0;
      if (y - touchYRef.current > 3) {
        followingRef.current = false;
        setFollowing(false);
      }
      touchYRef.current = y;
    }, { passive: true });
    // Native scroll is the source of truth for at-bottom + visibleStartIdx.
    // rAF-coalesce so a flurry of scroll events doesn't spam layout reads.
    let scrollRafScheduled = false;
    el.addEventListener('scroll', () => {
      if (scrollRafScheduled) return;
      scrollRafScheduled = true;
      requestAnimationFrame(() => {
        scrollRafScheduled = false;
        if (programmaticScrollRef.current) return;
        const gap = el.scrollHeight - el.scrollTop - el.clientHeight;
        const atBottom = gap < 8;
        const msgs = messagesRef.current;
        if (atBottom) {
          if (!isAtBottomRef.current) isAtBottomRef.current = true;
          if (!followingRef.current) {
            followingRef.current = true;
            setFollowing(true);
          }
          setShowNewMessages(false);
        } else {
          if (isAtBottomRef.current) isAtBottomRef.current = false;
          if (msgs[msgs.length - 1]?.role === 'assistant') setShowNewMessages(true);
        }
        // Compute the topmost visible message index for the pinned-prompt bar.
        const scTop = el.getBoundingClientRect().top;
        const items = messageElsRef.current;
        for (let i = 0; i < msgs.length; i++) {
          const itemEl = items.get(msgs[i].id);
          if (!itemEl) continue;
          const r = itemEl.getBoundingClientRect();
          if (r.bottom >= scTop) {
            setVisibleStartIdx(i);
            return;
          }
        }
      });
    }, { passive: true });
  }, []);

  // Coalesce streaming text deltas: highlight.js re-tokenizes the entire
  // message body on each chunk, so flushing every IPC event is wasteful.
  const streamBufferRef = useRef<{ pending: string; timer: ReturnType<typeof setTimeout> | null }>({ pending: '', timer: null });
  const flushStreamBuffer = useCallback(() => {
    const buf = streamBufferRef.current;
    if (buf.timer) { clearTimeout(buf.timer); buf.timer = null; }
    if (!buf.pending) return;
    const text = buf.pending;
    buf.pending = '';
    setMessages(prev => {
      const last = prev[prev.length - 1];
      if (last?.role === 'assistant' && !last.toolCalls) {
        const updated = [...prev];
        updated[updated.length - 1] = { ...last, content: last.content + text };
        return updated;
      }
      return prev;
    });
    // followOutput only fires on count changes; streaming grows the last
    // item in place, so re-anchor manually while the user is at the bottom.
    if (followingRef.current) {
      requestAnimationFrame(snapToBottom);
    }
  }, [setMessages, snapToBottom]);
  useEffect(() => () => {
    if (streamBufferRef.current.timer) clearTimeout(streamBufferRef.current.timer);
  }, []);
  const emptyPrompt = useMemo(() => EMPTY_PROMPTS[Math.floor(Math.random() * EMPTY_PROMPTS.length)], []);
  const [isStreaming, setIsStreaming] = useState(false);
  const turnSeqRef = useRef(0); // tracks the active turn's sequence number
  // Watchdog for sends that vanish into the void (CLI in approval-wait, dying
  // process whose stdin write succeeds silently, etc.). Cleared when the
  // backend acknowledges with streaming_start or terminates the turn.
  const sendWatchdogRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const clearSendWatchdog = useCallback(() => {
    if (sendWatchdogRef.current) {
      clearTimeout(sendWatchdogRef.current);
      sendWatchdogRef.current = null;
    }
  }, []);
  useEffect(() => () => clearSendWatchdog(), [clearSendWatchdog]);
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
  const [following, setFollowing] = useState(true);
  const [pinnedUserMessage, setPinnedUserMessage] = useState<ChatMessageType | null>(null);
  const [showNewMessages, setShowNewMessages] = useState(false);
  const [visibleStartIdx, setVisibleStartIdx] = useState(0);
  // Pagination: messages[0] corresponds to absolute index `firstLoadedIdx` in
  // the full session. When 0, the entire session is loaded.
  const [firstLoadedIdx, setFirstLoadedIdx] = useState(initialFirstLoadedIdx);
  const loadingOlderRef = useRef(false);
  // When older messages prepend, scrollHeight jumps; useLayoutEffect picks
  // up this snapshot and offsets scrollTop by the delta so the user's anchor
  // message stays put visually instead of being yanked down with the new
  // history above it.
  const prependPreserveRef = useRef<{ scrollTop: number; scrollHeight: number } | null>(null);
  const handleLoadOlder = useCallback(() => {
    if (loadingOlderRef.current) return;
    if (firstLoadedIdx <= 0) return;
    if (!sessionId) return;
    loadingOlderRef.current = true;
    const wantStart = Math.max(0, firstLoadedIdx - pageSize);
    const wantCount = firstLoadedIdx - wantStart;
    dbGetMessagesRange(sessionId, wantStart, wantCount)
      .then(older => {
        if (older.length === 0) {
          setFirstLoadedIdx(0);
          onFirstLoadedIdxChange?.(0);
          return;
        }
        const sc = scrollerRef.current as HTMLElement | null;
        if (sc) {
          prependPreserveRef.current = { scrollTop: sc.scrollTop, scrollHeight: sc.scrollHeight };
        }
        setMessages(prev => [...older, ...prev]);
        const nextIdx = Math.max(0, firstLoadedIdx - older.length);
        setFirstLoadedIdx(nextIdx);
        onFirstLoadedIdxChange?.(nextIdx);
      })
      .catch(() => {})
      .finally(() => { loadingOlderRef.current = false; });
  }, [firstLoadedIdx, pageSize, sessionId, onFirstLoadedIdxChange]);
  useLayoutEffect(() => {
    const snap = prependPreserveRef.current;
    if (!snap) return;
    prependPreserveRef.current = null;
    const sc = scrollerRef.current as HTMLElement | null;
    if (!sc) return;
    sc.scrollTop = snap.scrollTop + (sc.scrollHeight - snap.scrollHeight);
  }, [messages]);

  // IntersectionObserver on the top sentinel triggers pagination when the user
  // scrolls within ~600px of the top of the loaded window.
  useEffect(() => {
    const sentinel = topSentinelRef.current;
    const sc = scrollerRef.current;
    if (!sentinel || !(sc instanceof HTMLElement)) return;
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some(e => e.isIntersecting)) handleLoadOlder();
      },
      { root: sc, rootMargin: '600px 0px 0px 0px', threshold: 0 }
    );
    io.observe(sentinel);
    return () => io.disconnect();
  }, [handleLoadOlder, firstLoadedIdx]);

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
        clearSendWatchdog();
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
        clearSendWatchdog();
        flushStreamBuffer();
        if (msg.type === 'done') {
          turnSeqRef.current = -1;
          flushMessagesToParent();
          onTurnComplete?.();
        }
        setIsStreaming(false);
        setPendingApproval(null);
        // Don't return for 'result' — fall through to process usage data below
        if (msg.type === 'done') return;
      }

      if (msg.type === 'process_exit') {
        clearSendWatchdog();
        flushStreamBuffer();
        setReady(false);
        setIsStreaming(false);
        setPendingApproval(null);
        flushMessagesToParent();
        onTurnComplete?.();
        return;
      }

      if (msg.type === 'error') {
        clearSendWatchdog();
        flushStreamBuffer();
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
        flushStreamBuffer();
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
          flushStreamBuffer();
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

        if (text || tools.length > 0) {
          const shouldAppend = !!text && !tools.length && msg.message.content.some((block: any) => block.type === 'text' && block.delta);
          const last = messagesRef.current[messagesRef.current.length - 1];
          const canAppendToLast = last?.role === 'assistant' && !last.toolCalls;

          if (shouldAppend && canAppendToLast) {
            // Hot path: buffer the delta, flush at most every ~33ms.
            streamBufferRef.current.pending += text;
            if (!streamBufferRef.current.timer) {
              streamBufferRef.current.timer = setTimeout(flushStreamBuffer, 33);
            }
          } else {
            // Anything else (tool calls, replace, new message) needs ordering with
            // any in-flight buffered text.
            flushStreamBuffer();
            setMessages(prev => {
              const last = prev[prev.length - 1];
              if (last?.role === 'assistant' && text && !tools.length && !last.toolCalls) {
                const updated = [...prev];
                updated[updated.length - 1] = { ...last, content: text };
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
          flushStreamBuffer();
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

  // Scroll to bottom when this workspace becomes the active/visible one
  useEffect(() => {
    if (isActive) {
      isAtBottomRef.current = true;
      followingRef.current = true;
      setFollowing(true);
      setShowNewMessages(false);
      requestAnimationFrame(() => {
        requestAnimationFrame(snapToBottom);
      });
    }
  }, [isActive, snapToBottom]);


  const scrollToBottom = () => {
    isAtBottomRef.current = true;
    followingRef.current = true;
    setFollowing(true);
    setShowNewMessages(false);
    requestAnimationFrame(() => {
      requestAnimationFrame(snapToBottom);
    });
  };

  // Scroll on a newly-appended last message. Distinguishes append (user send,
  // assistant turn) from prepend (pagination loading older history) by tracking
  // the last message id rather than messages.length.
  const lastIdRef = useRef<string | undefined>(messages[messages.length - 1]?.id);
  useEffect(() => {
    const last = messages[messages.length - 1];
    if (!last || last.id === lastIdRef.current) return;
    lastIdRef.current = last.id;
    if (last.role === 'user') {
      isAtBottomRef.current = true;
      followingRef.current = true;
      setFollowing(true);
      setShowNewMessages(false);
      requestAnimationFrame(() => {
        requestAnimationFrame(snapToBottom);
      });
    } else if (followingRef.current || isAtBottomRef.current) {
      // If we're at the bottom, treat it as still following — wheel/touch can
      // flip followingRef false without ever leaving the bottom (e.g. trackpad
      // jitter, or a scroll-up while already pinned), and atBottomStateChange
      // won't re-fire to clear it.
      followingRef.current = true;
      setFollowing(true);
      setShowNewMessages(false);
      requestAnimationFrame(() => {
        requestAnimationFrame(snapToBottom);
      });
    } else if (last.role === 'assistant') {
      setShowNewMessages(true);
    }
  }, [messages]);

  const userMessages = useMemo(
    () => messages.filter(m => m.role === 'user'),
    [messages]
  );

  // Pin the most-recent user message that has scrolled above the viewport.
  // Driven by the rAF-throttled scroll handler → visibleStartIdx.
  useEffect(() => {
    if (userMessages.length === 0) { setPinnedUserMessage(null); return; }
    const lastUser = userMessages[userMessages.length - 1];
    const lastUserIdx = messages.lastIndexOf(lastUser);
    if (lastUserIdx < 0 || lastUserIdx >= visibleStartIdx) {
      setPinnedUserMessage(null);
      return;
    }
    // Find the rightmost user message at or above the visible range start
    for (let i = userMessages.length - 1; i >= 0; i--) {
      const idx = messages.lastIndexOf(userMessages[i]);
      if (idx >= 0 && idx <= visibleStartIdx) {
        setPinnedUserMessage(userMessages[i]);
        return;
      }
    }
    setPinnedUserMessage(null);
  }, [visibleStartIdx, userMessages, messages]);

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

  const handleSend = async (text: string, images?: string[]) => {
    // Handle built-in commands locally
    if (text === '/clear') {
      setMessages([]);
      setFirstLoadedIdx(0);
      onFirstLoadedIdxChange?.(0);
      return;
    }
    if (text === '/compact' && aiProvider === 'claude') {
      window.sai.claudeCompact(projectPath, permissionMode, effortLevel, modelChoice);
      return;
    }
    if (text === '/help') {
      setMessages(prev => [...prev,
        { id: Date.now().toString(), role: 'user', content: text, timestamp: Date.now() },
        { id: `help-${Date.now()}`, role: 'system', content:
          buildHelpMessage(aiProvider, slashCommands),
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

    // Optimistically show the thinking indicator so the user gets immediate
    // feedback that the send was received, even before the backend's
    // streaming_start IPC arrives. The backend will keep this in sync —
    // streaming_start re-confirms it, and done/result/error/process_exit
    // turn it off.
    setIsStreaming(true);

    // Watchdog: if we don't hear back from the backend within a generous
    // window, surface an error instead of leaving the user staring at a
    // permanent thinking spinner. CLI startup can be slow on cold spawns,
    // so keep this generous.
    clearSendWatchdog();
    sendWatchdogRef.current = setTimeout(() => {
      sendWatchdogRef.current = null;
      setIsStreaming(false);
      setMessages(prev => [...prev, {
        id: `watchdog-${Date.now()}`,
        role: 'system',
        content: 'No response from the CLI. The message may not have been received — try sending again, or restart the workspace if this keeps happening.',
        timestamp: Date.now(),
      }]);
    }, 15000);

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

  const handleQueue = (text: string, fullText: string, images?: string[], attachments?: { images: number; files: number; terminal: boolean }) => {
    if (sessionId && onQueueAdd) {
      onQueueAdd(sessionId, text, fullText, images, attachments);
    }
  };

  // Drain the queue whenever we're idle and have something to send. Depending on
  // both isStreaming and the queue length covers the case where a queue update
  // races the streaming-flag flip (e.g., a `result`/`done` event lands before
  // the new queue prop propagates from App), and the case where streaming never
  // started at all (immediate error). drainingRef prevents back-to-back drains
  // for multi-item queues — it resets when isStreaming flips true again.
  const drainingRef = useRef(false);
  useEffect(() => {
    if (isStreaming) { drainingRef.current = false; return; }
    if (drainingRef.current) return;
    if (messageQueue.length === 0) return;
    if (!onQueueShift || !sessionId) return;
    drainingRef.current = true;
    const next = messageQueue[0];
    onQueueShift(sessionId);
    setTimeout(() => handleSend(next.fullText, next.images), 300);
  }, [isStreaming, messageQueue.length, sessionId]);

  return (
    <div className="chat-panel">
      {import.meta.env.DEV && (
        <ChatScrollDebugHud
          scrollerRef={scrollerRef}
          followingRef={followingRef}
          isAtBottomRef={isAtBottomRef}
          showNewMessages={showNewMessages}
          isStreaming={isStreaming}
          messageCount={messages.length}
        />
      )}
      {pinnedUserMessage && (
        <div className="pinned-prompt-bar" key={pinnedUserMessage.id}>
          <div className="pinned-prompt-accent" />
          <span className="pinned-prompt-label">You</span>
          <span className="pinned-prompt-text">{pinnedUserMessage.content}</span>
          <button
            className="pinned-prompt-jump"
            onClick={() => {
              // Disengage follow and suppress the safety-net + ResizeObserver
              // for the duration of the smooth scroll, otherwise the gap-< 8
              // check at the start re-engages follow and snaps us back.
              isAtBottomRef.current = false;
              followingRef.current = false;
              setFollowing(false);
              programmaticScrollRef.current = true;
              setTimeout(() => { programmaticScrollRef.current = false; }, 900);
              const target = messageElsRef.current.get(pinnedUserMessage.id);
              target?.scrollIntoView({ behavior: 'smooth', block: 'center' });
            }}
            title="Jump to message"
          >
            <CornerLeftUp size={11} strokeWidth={2.5} />
            <span>Jump</span>
          </button>
        </div>
      )}
      {messages.length === 0 ? (
        <div className="chat-messages">
          <div className="chat-empty">
            <img src="svg/sai.svg" alt="SAI" className="chat-empty-logo" />
            <div className="chat-empty-title">SAI</div>
            <div className="chat-empty-subtitle">
              {projectPath ? emptyPrompt : 'Select a project to get started'}
            </div>
            {projectPath && <CyclingHints />}
          </div>
        </div>
      ) : (
        <div
          className="chat-messages"
          ref={(el) => {
            scrollerRef.current = el;
            if (el) {
              attachUserScrollListeners(el);
              attachContentResizeObserver(el);
            }
          }}
        >
          <div ref={messagesInnerRef} className="chat-messages-inner">
            <div style={{ height: 16 }} />
            {firstLoadedIdx > 0 && (
              <div ref={topSentinelRef} className="chat-load-sentinel">
                <span className="chat-load-sentinel-text">Loading older messages…</span>
              </div>
            )}
            {messages.map((msg, i) => {
              const lastMsg = messages[messages.length - 1];
              const isLastAssistantStreaming = isStreaming && msg.role === 'assistant' && lastMsg?.id === msg.id;
              return (
                <div
                  key={msg.id}
                  ref={(el) => setMessageEl(msg.id, el)}
                  data-msg-idx={i}
                >
                  {msg.role === 'user'
                    ? <ChatMessage message={msg} projectPath={projectPath} onFileOpen={onFileOpen} aiProvider={aiProvider} toolCallsExpanded={toolCallsExpanded} />
                    : <ChatMessage message={msg} projectPath={projectPath} onFileOpen={onFileOpen} aiProvider={aiProvider} toolCallsExpanded={toolCallsExpanded} onRetry={msg.error ? () => handleRetry(msg.id) : undefined} isStreaming={isLastAssistantStreaming} />}
                </div>
              );
            })}
            {isStreaming && (
              <motion.div
                style={{ padding: '0 16px' }}
                initial={{ opacity: 0, y: 4 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.25, ease: [0.22, 1, 0.36, 1] }}
              >
                {aiProvider === 'gemini'
                  ? <GeminiThinkingAnimation loadingPhrases={geminiLoadingPhrases} />
                  : aiProvider === 'codex'
                  ? <CodexThinkingAnimation />
                  : <ThinkingAnimation />}
              </motion.div>
            )}
          </div>
        </div>
      )}
      <div className="new-messages-anchor">
        <AnimatePresence>
          {showNewMessages && (
            <motion.button
              key="new-messages-btn"
              className="new-messages-btn"
              onClick={scrollToBottom}
              initial={{ opacity: 0, y: 6, scale: 0.94 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: 6, scale: 0.94 }}
              transition={{ type: 'spring', stiffness: 460, damping: 32 }}
            >
              <ChevronDown size={12} />
              new messages
            </motion.button>
          )}
        </AnimatePresence>
        <button
          className={`follow-indicator ${following ? 'is-following' : ''}`}
          onClick={scrollToBottom}
          title={following ? 'Following output' : 'Click to resume following'}
          aria-label={following ? 'Following output' : 'Resume following output'}
        >
          <ArrowDownToLine size={12} />
        </button>
      </div>
      <TodoProgress messages={messages} isStreaming={isStreaming} />
      <MessageQueue
        queue={messageQueue}
        onRemove={(id) => sessionId && onQueueRemove?.(sessionId, id)}
      />
      <ChatInput
        onSend={handleSend}
        disabled={!ready}
        slashCommands={slashCommands}
        onQueue={handleQueue}
        queueCount={messageQueue.length}
        pendingApproval={pendingApproval}
        onApprove={handleApprove}
        onDeny={handleDeny}
        onAlwaysAllow={handleAlwaysAllow}
        isStreaming={isStreaming}
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
      <style>{`
        .chat-panel {
          flex: 1;
          display: flex;
          flex-direction: column;
          min-height: 0;
          overflow: hidden;
          position: relative;
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
          font-family: 'Geist Mono', 'JetBrains Mono', monospace;
          padding: 4px 12px;
          cursor: pointer;
          box-shadow: 0 2px 12px rgba(0,0,0,0.3);
          white-space: nowrap;
          transition: color 0.15s;
        }
        .new-messages-btn:hover {
          color: var(--text);
        }
        .follow-indicator {
          position: absolute;
          bottom: 8px;
          right: 12px;
          z-index: 10;
          display: flex;
          align-items: center;
          justify-content: center;
          width: 22px;
          height: 22px;
          background: var(--bg-secondary);
          border: 1px solid var(--border);
          border-radius: 50%;
          color: var(--text-muted);
          opacity: 0.55;
          cursor: pointer;
          transition: color 0.15s ease, border-color 0.15s ease, opacity 0.15s ease;
        }
        .follow-indicator:hover {
          opacity: 1;
          color: var(--text);
        }
        .follow-indicator.is-following {
          color: var(--accent);
          border-color: color-mix(in srgb, var(--accent) 50%, transparent);
          opacity: 1;
        }
        @keyframes pinned-slide-in {
          from { opacity: 0; transform: translateY(-100%); }
          to   { opacity: 1; transform: translateY(0); }
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
          height: 32px;
          animation: pinned-slide-in 0.2s ease-out;
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
          overflow-x: hidden;
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
          color: #D7AFFF;
          animation: gemini-color-cycle 4s linear infinite;
          will-change: color;
        }
        @keyframes gemini-color-cycle {
          0%   { color: #D7AFFF; }
          17%  { color: #87AFFF; }
          33%  { color: #87D7D7; }
          50%  { color: #D7FFD7; }
          67%  { color: #FFFFAF; }
          83%  { color: #FF87AF; }
          100% { color: #D7AFFF; }
        }
        .gemini-hint {
          font-size: 13px;
          font-style: italic;
          color: var(--text);
          opacity: 0.85;
          animation: gemini-hint-fade 5s ease-in-out infinite;
        }
        @keyframes gemini-hint-fade {
          0% { opacity: 0; }
          8% { opacity: 0.85; }
          88% { opacity: 0.85; }
          100% { opacity: 0; }
        }
      `}</style>
    </div>
  );
}
