import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { ChevronDown, LocateFixed } from 'lucide-react';
import ThinkingAnimation from '../ThinkingAnimation';

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
      <span className="gemini-hint">{hints.length > 0 ? hints[hintIndex] : 'Thinking...'}</span>
    </div>
  );
}

import ChatMessage from './ChatMessage';
import ChatInput from './ChatInput';
import MessageQueue from './MessageQueue';
import type { ChatMessage as ChatMessageType, ToolCall, PendingApproval, QueuedMessage, TerminalTab } from '../../types';

type CodexPermission = 'auto' | 'read-only' | 'full-access';

interface ChatPanelProps {
  projectPath: string;
  permissionMode: 'default' | 'bypass';
  onPermissionChange: (mode: 'default' | 'bypass') => void;
  effortLevel: 'low' | 'medium' | 'high' | 'max';
  onEffortChange: (level: 'low' | 'medium' | 'high' | 'max') => void;
  modelChoice: 'sonnet' | 'opus' | 'haiku';
  onModelChange: (model: 'sonnet' | 'opus' | 'haiku') => void;
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
  activeFilePath?: string | null;
  onFileOpen?: (path: string, line?: number) => void;
  isActive?: boolean;
  messageQueue?: QueuedMessage[];
  onQueueAdd?: (sessionId: string, text: string, fullText: string, images?: string[], attachments?: { images: number; files: number; terminal: boolean }) => void;
  onQueueRemove?: (sessionId: string, id: string) => void;
  onQueueShift?: (sessionId: string) => void;
  sessionId?: string;
  terminalTabs?: TerminalTab[];
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

const RENDER_CHUNK = 50; // messages to show per window
const LOAD_MORE_CHUNK = 30; // messages to load when scrolling up

export default function ChatPanel({ projectPath, permissionMode, onPermissionChange, effortLevel, onEffortChange, modelChoice, onModelChange, aiProvider, codexModel, onCodexModelChange, codexModels, codexPermission, onCodexPermissionChange, geminiModel, onGeminiModelChange, geminiModels, geminiApprovalMode, onGeminiApprovalModeChange, geminiConversationMode, onGeminiConversationModeChange, geminiLoadingPhrases, initialMessages, onMessagesChange, onTurnComplete, onClaudeSessionId, activeFilePath, onFileOpen, isActive, messageQueue = [], onQueueAdd, onQueueRemove, onQueueShift, sessionId, terminalTabs = [] }: ChatPanelProps) {
  const [messages, setMessages] = useState<ChatMessageType[]>(initialMessages || []);
  const emptyPrompt = useMemo(() => EMPTY_PROMPTS[Math.floor(Math.random() * EMPTY_PROMPTS.length)], []);
  const [isStreaming, setIsStreaming] = useState(false);
  const turnSeqRef = useRef(0); // tracks the active turn's sequence number
  const [ready, setReady] = useState(false);
  const [slashCommands, setSlashCommands] = useState<string[]>([]);
  const [pendingApproval, setPendingApproval] = useState<PendingApproval | null>(null);
  const [fileContextEnabled, setFileContextEnabled] = useState(true);
  const [contextUsage, setContextUsage] = useState<{ used: number; total: number; inputTokens: number; cacheReadTokens: number; cacheCreationTokens: number; outputTokens: number }>({ used: 0, total: 1000000, inputTokens: 0, cacheReadTokens: 0, cacheCreationTokens: 0, outputTokens: 0 });
  const [sessionUsage, setSessionUsage] = useState<{ inputTokens: number; outputTokens: number }>({ inputTokens: 0, outputTokens: 0 });
  const [sessionCost, setSessionCost] = useState(0);
  const [autoCompactThreshold, setAutoCompactThreshold] = useState(0); // 0 = off
  const autoCompactCooldownRef = useRef(0); // timestamp — don't re-compact until after this
  const [rateLimits, setRateLimits] = useState<Map<string, { rateLimitType: string; resetsAt: number; status: string; isUsingOverage: boolean; overageResetsAt: number; utilization?: number }>>(new Map());
  const [billingMode, setBillingMode] = useState<'subscription' | 'api'>('subscription');
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const chatContainerRef = useRef<HTMLDivElement>(null);
  const lastUserMsgRef = useRef<HTMLDivElement>(null);
  const isAtBottomRef = useRef(true);
  const [showPinnedPrompt, setShowPinnedPrompt] = useState(false);
  const [showNewMessages, setShowNewMessages] = useState(false);

  // Windowed rendering: only render messages from renderStart onward
  const [renderStart, setRenderStart] = useState(0);
  const sentinelRef = useRef<HTMLDivElement>(null);

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
        onClaudeSessionId?.(msg.sessionId);
        return;
      }

      if (msg.type === 'streaming_start') {
        if (msg.turnSeq != null) turnSeqRef.current = msg.turnSeq;
        setIsStreaming(true);
        return;
      }

      // Process exited — turn is fully complete
      if (msg.type === 'done') {
        // Ignore stale 'done' from a previous turn (e.g. buffered result flushed late)
        if (msg.turnSeq != null && msg.turnSeq !== turnSeqRef.current) return;
        // Consume the turnSeq so a duplicate done (e.g. from exit handler) is rejected
        turnSeqRef.current = -1;
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
        // Don't set isStreaming=false here — errors can be non-fatal stderr warnings.
        // The authoritative end-of-turn signal is 'done' or 'process_exit'.
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

        if (text || tools.length > 0) {
          setMessages(prev => {
            const last = prev[prev.length - 1];
            // Append text to the last assistant message only if it's a pure text message
            // (no tool calls). This handles streaming deltas from Gemini.
            // If the last message has tool calls, always create a new message so
            // tool cards stay above the follow-up text response.
            if (last?.role === 'assistant' && text && !tools.length && !last.toolCalls) {
              const updated = [...prev];
              updated[updated.length - 1] = { ...last, content: last.content + text };
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

      // Result — final answer for this turn, also has usage data.
      // Treat result as the authoritative end-of-turn: clear streaming immediately
      // so the UI doesn't stay stuck if the subsequent 'done' message is lost.
      if (msg.type === 'result') {
        setIsStreaming(false);
        onTurnComplete?.();
        turnSeqRef.current = -1;
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
      if (e.deltaY < 0) isAtBottomRef.current = false;
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
      setShowNewMessages(false);
      requestAnimationFrame(() => {
        messagesEndRef.current?.scrollIntoView({ behavior: 'instant' });
      });
    }
  }, [isActive]);

  useEffect(() => {
    if (isAtBottomRef.current) {
      setShowNewMessages(false);
      messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    } else if (messages[messages.length - 1]?.role === 'assistant') {
      setShowNewMessages(true);
    }
  }, [messages, isStreaming, projectPath]);

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

  const visibleMessages = useMemo(
    () => messages.slice(renderStart),
    [messages, renderStart]
  );
  const hasHiddenMessages = renderStart > 0;

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
      setRenderStart(0);
      return;
    }
    if (text === '/compact' && aiProvider === 'claude') {
      window.sai.claudeCompact(projectPath, permissionMode, effortLevel, modelChoice);
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

    const prompt = activeFilePath && fileContextEnabled ? `[File: ${activeFilePath}]\n\n${text}` : text;
    if (aiProvider === 'gemini') {
      (window.sai as any).geminiSend(projectPath, prompt, imagePaths, geminiApprovalMode, geminiConversationMode, geminiModel);
    } else if (aiProvider === 'codex') {
      window.sai.codexSend(projectPath, prompt, imagePaths, codexPermission, codexModel);
    } else {
      window.sai.claudeSend(projectPath, prompt, imagePaths, permissionMode, effortLevel, modelChoice);
    }
  };

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
      {showPinnedPrompt && lastUserMessage && (
        <div className="pinned-prompt-bar">
          <span className="pinned-prompt-text">{lastUserMessage.content}</span>
          <button
            className="pinned-prompt-jump"
            onClick={() => { isAtBottomRef.current = false; lastUserMsgRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' }); }}
            title="Jump to message"
          >
            <LocateFixed size={12} />
          </button>
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
          <>
            {hasHiddenMessages && (
              <div ref={sentinelRef} className="chat-load-sentinel">
                <span className="chat-load-sentinel-text">Loading earlier messages...</span>
              </div>
            )}
            {visibleMessages.map(msg => msg.id === lastUserMessage?.id
              ? <div key={msg.id} ref={lastUserMsgRef}><ChatMessage message={msg} projectPath={projectPath} onFileOpen={onFileOpen} aiProvider={aiProvider} /></div>
              : <ChatMessage key={msg.id} message={msg} projectPath={projectPath} onFileOpen={onFileOpen} aiProvider={aiProvider} />
            )}
          </>
        )}
        {isStreaming && (aiProvider === 'gemini'
          ? <GeminiThinkingAnimation loadingPhrases={geminiLoadingPhrases} />
          : aiProvider === 'codex'
          ? <CodexThinkingAnimation />
          : <ThinkingAnimation />
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
          flex: 1;
          font-size: 12px;
          color: var(--text-muted);
          opacity: 0.6;
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
          font-family: 'JetBrains Mono', monospace;
        }
        .pinned-prompt-jump {
          flex-shrink: 0;
          background: none;
          border: none;
          color: var(--text-muted);
          opacity: 0.4;
          cursor: pointer;
          padding: 2px;
          margin-left: 8px;
          display: flex;
          align-items: center;
          border-radius: 3px;
          transition: opacity 0.15s;
        }
        .pinned-prompt-jump:hover {
          opacity: 1;
          color: var(--accent);
        }
        .chat-messages {
          flex: 1;
          overflow-y: auto;
          padding: 16px;
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
          font-family: 'JetBrains Mono', monospace;
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
