import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { ChevronDown, CornerLeftUp } from 'lucide-react';
import { motion, AnimatePresence, LayoutGroup } from 'motion/react';
import { setFlipRect } from './flipRegistry';
import ThinkingAnimation from '../ThinkingAnimation';
import SaiLogo from '../SaiLogo';
import MotionPresence from './MotionPresence';
import { SPRING, DISTANCE, EASING, useReducedMotionTransition } from './motion';
import { useSaiAnimationPref } from './useSaiAnimationPref';
import { parseToolResultBlocks } from '../../lib/toolResultContent';
import { buildPendingQuestionAnswer } from '../../lib/pendingQuestionAnswer';

// Projects whose brainstorm seed has already been consumed (or attempted) in
// this renderer process. The seed is one-shot, but the chat start-effect can
// re-run on config changes (model/scope/permission). Without this guard we'd
// re-probe (and log a noisy ENOENT) on every re-run.
const consumedBrainstormSeeds = new Set<string>();

function tweenScrollToBottom(container: HTMLElement, durationMs = 280) {
  if (typeof window === 'undefined') return;
  if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) {
    container.scrollTop = container.scrollHeight;
    return;
  }
  const start = container.scrollTop;
  const initialTarget = container.scrollHeight - container.clientHeight;
  if (initialTarget <= start) return;
  const t0 = performance.now();
  // Approximate ease-out cubic-bezier with a power curve: 1 - (1-t)^p
  const p = 1 / (EASING.out[3] || 1);
  const ease = (t: number) => 1 - Math.pow(1 - t, p);
  const step = (t: number) => {
    const k = Math.min(1, (t - t0) / durationMs);
    // Recompute target each frame so we follow content that grows mid-tween
    // (e.g. tool output cards expanding via a height animation).
    const target = container.scrollHeight - container.clientHeight;
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
        <circle cx="11" cy="11" r={radius} fill="none" stroke="var(--border-hairline)" strokeWidth="2.5" />
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


import ChatMessage from './ChatMessage';
import { watchTargetsFromMessage } from './githubRunResolver';

const EMPTY_URL_SET: Set<string> = new Set();
import ChatInput, { type ContextItem } from './ChatInput';
import type { ChatMessage as ChatMessageType, ToolCall, PendingApproval, QueuedMessage, TerminalTab } from '../../types';
import type { MetaWorkspaceRuntime } from '../../types';
import { buildHelpMessage } from './helpText';
import { buildTaskRegistry, TaskRegistryContext } from './taskRegistry';
import { parseAiError, looksLikeApiError } from './parseAiError';
import { buildMetaPreamble } from '../../lib/metaSystemPrompt';

type CodexPermission = 'auto' | 'read-only' | 'full-access';

export type OverlayMode = 'on' | 'off' | 'persist';

interface ChatPanelProps {
  projectPath: string;
  /** When set, renders the focus-overlay mode control under the input
   *  (present only while the overlay setting is enabled). */
  overlayControl?: { mode: OverlayMode; onChange: (m: OverlayMode) => void };
  permissionMode: 'default' | 'bypass';
  onPermissionChange: (mode: 'default' | 'bypass') => void;
  effortLevel: 'low' | 'medium' | 'high' | 'max';
  onEffortChange: (level: 'low' | 'medium' | 'high' | 'max' | null) => void;
  modelChoice: 'default' | 'best' | 'sonnet' | 'opus' | 'haiku' | 'sonnet[1m]' | 'opus[1m]' | 'opusplan' | (string & {});
  onModelChange: (model: 'default' | 'best' | 'sonnet' | 'opus' | 'haiku' | 'sonnet[1m]' | 'opus[1m]' | 'opusplan' | (string & {}) | null) => void;
  availableModels?: { id: string; label: string; description: string; recommended?: boolean; oneM?: boolean; extra?: boolean }[];
  claudeOverrideState?: {
    modelOverridden: boolean;
    effortOverridden: boolean;
    globalModel: 'default' | 'best' | 'sonnet' | 'opus' | 'haiku' | 'sonnet[1m]' | 'opus[1m]' | 'opusplan' | (string & {});
    globalEffort: 'low' | 'medium' | 'high' | 'max';
  };
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
  initialMessages?: ChatMessageType[];
  onMessagesChange?: (messages: ChatMessageType[]) => void;
  onTurnComplete?: () => void;
  onClaudeSessionId?: (sessionId: string) => void;
  onGeminiSessionId?: (sessionId: string) => void;
  onCodexSessionId?: (sessionId: string) => void;
  activeFilePath?: string | null;
  onFileOpen?: (path: string, line?: number) => void;
  isActive?: boolean;
  isStreaming?: boolean;
  awaitingQuestion?: boolean;
  initialDraft?: string;
  onDraftChange?: (draft: string) => void;
  initialContextItems?: ContextItem[];
  onContextItemsChange?: (items: ContextItem[]) => void;
  messageQueue?: QueuedMessage[];
  onQueueAdd?: (sessionId: string, text: string, fullText: string, images?: string[], attachments?: { images: number; files: number; terminal: boolean }) => void;
  onQueueRemove?: (sessionId: string, id: string) => void;
  onQueueShift?: (sessionId: string) => void;
  onQueuePromote?: (sessionId: string, id: string) => void;
  sessionId?: string;
  terminalTabs?: TerminalTab[];
  onSlashCommandsUpdate?: (commands: string[]) => void;
  onInterceptSend?: (text: string) => Promise<boolean | { handled: boolean; reply?: string }>;
  /**
   * IPC scope to use for claude:start / send / stop / message routing.
   * Defaults to 'chat' (the workspace's default chat scope). Pass the
   * orchestrator's session id when this ChatPanel is mounted for an
   * orchestrator session — otherwise its messages and tool args go to
   * the wrong process.
   */
  claudeScope?: string;
  /** Optional: seed the pending-approval state on mount. Lets App.tsx hand off
   *  an already-pending approval when the user swaps into a session that
   *  fired approval_needed while its ChatPanel was unmounted. */
  initialPendingApproval?: PendingApproval | null;
  /** Optional: pass 'orchestrator' to start the Claude process in orchestrator mode. */
  claudeKind?: 'chat' | 'task' | 'orchestrator';
  /** Optional: orchestrator prompt context (only used when claudeKind === 'orchestrator'). */
  claudeOrchestratorContext?: any;
  /**
   * Optional: override how individual tool calls in messages are rendered.
   * Return `null` to fall back to the default `<ToolCallCard>`. Used by the
   * orchestrator chat to swap in purpose-built swarm cards.
   */
  renderToolCall?: (tc: ToolCall, defaultExpanded: boolean) => React.ReactNode | null;
  /**
   * Optional: override how an entire message is rendered. Return `null` to
   * fall back to the default render. Used by the orchestrator chat to render
   * inline approval cards in place of synthetic system messages.
   */
  renderMessage?: (message: ChatMessageType) => React.ReactNode | null;
  /**
   * Optional: active meta-workspace runtime. When set (and its syntheticRoot
   * matches projectPath), the meta-workspace preamble is injected into the
   * AI system prompt on start.
   */
  activeMetaRuntime?: MetaWorkspaceRuntime | null;
  /**
   * Optional: replace the default SAI-logo empty state with custom content.
   * Used by the orchestrator chat to render a swarm-of-logos cluster instead
   * of the single solo logo.
   */
  emptyStateVisual?: React.ReactNode;
  /**
   * Optional: replace the default SAI-logo conversation header (rendered
   * once the first message lands) with custom content. Pair with
   * emptyStateVisual to keep brand continuity across the empty/active
   * transition (e.g., a smaller version of the swarm cluster).
   */
  conversationHeaderVisual?: React.ReactNode;
  /**
   * Optional: ref that will be populated with a mention-insert callback by
   * ChatInput. Pass this from App.tsx so the accordion bar can trigger
   * mention insertion without going through ChatPanel's internal state.
   */
  mentionInsertRef?: React.MutableRefObject<((linkName: string) => void) | null>;
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

export default function ChatPanel({ projectPath, overlayControl, permissionMode, onPermissionChange, effortLevel, onEffortChange, modelChoice, onModelChange, availableModels, claudeOverrideState, aiProvider, codexModel, onCodexModelChange, codexModels, codexPermission, onCodexPermissionChange, geminiModel, onGeminiModelChange, geminiModels, geminiApprovalMode, onGeminiApprovalModeChange, geminiConversationMode, onGeminiConversationModeChange, initialMessages, onMessagesChange, onTurnComplete, onClaudeSessionId, onGeminiSessionId, onCodexSessionId, activeFilePath, onFileOpen, isActive, isStreaming = false, awaitingQuestion = false, initialDraft, onDraftChange, initialContextItems, onContextItemsChange, messageQueue = [], onQueueAdd, onQueueRemove, onQueueShift, onQueuePromote, sessionId, terminalTabs = [], onSlashCommandsUpdate, onInterceptSend, claudeScope = 'chat', claudeKind = 'chat', claudeOrchestratorContext, initialPendingApproval = null, renderToolCall, renderMessage, activeMetaRuntime, emptyStateVisual, conversationHeaderVisual, mentionInsertRef: mentionInsertRefProp }: ChatPanelProps) {
  const [messages, setMessagesRaw] = useState<ChatMessageType[]>(initialMessages || []);
  const taskRegistry = useMemo(() => buildTaskRegistry(messages), [messages]);
  const messagesRef = useRef<ChatMessageType[]>(initialMessages || []);
  const setMessages = useCallback((updater: ChatMessageType[] | ((prev: ChatMessageType[]) => ChatMessageType[])) => {
    setMessagesRaw(prev => {
      const next = typeof updater === 'function' ? updater(prev) : updater;
      messagesRef.current = next;
      return next;
    });
  }, []);

  // Coalesce streaming text-delta appends to one React state update per animation
  // frame. Per-chunk setMessages triggered re-tokenization of the entire growing
  // assistant message on every stdout chunk and was the main driver of RAM spikes
  // while Claude is coding. Non-delta events (tool calls, new bubbles, errors,
  // result/done) flush the pending buffer before mutating state to preserve order.
  const streamPendingRef = useRef<string>('');
  const streamRafRef = useRef<number | null>(null);
  // Stream-idle gate for the in-flight last assistant bubble. While true, the
  // bubble renders as plain text; flips to true (settled) when no delta has
  // arrived for STREAM_IDLE_MS, letting markdown/highlight render mid-turn
  // instead of waiting for end-of-turn.
  const STREAM_IDLE_MS = 250;
  const [streamSettled, setStreamSettled] = useState(true);
  const saiAnimationEnabled = useSaiAnimationPref();
  const streamIdleTimerRef = useRef<number | null>(null);
  const flushStreamingText = useCallback(() => {
    if (streamRafRef.current != null) {
      cancelAnimationFrame(streamRafRef.current);
      streamRafRef.current = null;
    }
    const pending = streamPendingRef.current;
    if (!pending) return;
    streamPendingRef.current = '';
    setMessages(prev => {
      const last = prev[prev.length - 1];
      if (!last || last.role !== 'assistant' || last.toolCalls) return prev;
      const updated = [...prev];
      updated[updated.length - 1] = { ...last, content: (last.content || '') + pending };
      return updated;
    });
  }, [setMessages]);
  const emptyPrompt = useMemo(() => EMPTY_PROMPTS[Math.floor(Math.random() * EMPTY_PROMPTS.length)], []);
  const [turnStartIndex, setTurnStartIndex] = useState<number | null>(null);
  const thinkingTransition = useReducedMotionTransition(SPRING.pop);
  const dockTransition = useReducedMotionTransition(SPRING.dock);
  const followBtnTransition = useReducedMotionTransition(SPRING.flick);
  const turnSeqRef = useRef(0); // tracks the active turn's sequence number
  const [ready, setReady] = useState(false);
  // True from the moment a queued follow-up is shifted for sending until the new
  // turn's `streaming_start` arrives. Bridges the gap where the prior turn's
  // `done` has flipped isStreaming false but the next turn hasn't begun, so the
  // Stop button and thinking animation don't flicker back to "idle" mid-handoff.
  const [drainInFlight, setDrainInFlight] = useState(false);
  const [slashCommands, setSlashCommands] = useState<string[]>([]);
  const [pendingApproval, setPendingApproval] = useState<PendingApproval | null>(initialPendingApproval);
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

  // Windowed rendering: only render messages from renderStart onward.
  // Initialize to the tail so the first render after mount doesn't pay the
  // cost of rendering the entire history before the windowing effect runs.
  const [renderStart, setRenderStart] = useState(() => {
    const len = initialMessages?.length ?? 0;
    return len > RENDER_CHUNK ? len - RENDER_CHUNK : 0;
  });
  const sentinelRef = useRef<HTMLDivElement>(null);
  // True while a user-initiated "jump to message" smooth scroll is in flight.
  // The load-more sentinel must not rewrite scrollTop during this window or it
  // cancels the smooth scroll (the jump appears to do nothing). pendingJumpRef
  // holds a target id when we had to expand the window to mount it first.
  const jumpingRef = useRef(false);
  const pendingJumpRef = useRef<string | null>(null);
  const pendingComposerRectRef = useRef<DOMRect | null>(null);
  const localMentionInsertRef = useRef<((linkName: string) => void) | null>(null);
  const mentionInsertRef = mentionInsertRefProp ?? localMentionInsertRef;

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
        // Don't expand the window mid-jump — the scrollTop rewrite below would
        // cancel the in-flight smooth scroll and the jump would "do nothing".
        if (jumpingRef.current) return;
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
    let cancelled = false;
    window.sai.settingsGet('autoCompactThreshold', 0).then((v: number) => { if (!cancelled) setAutoCompactThreshold(v); });
    window.sai.settingsGet('toolCallsExpanded', true).then((v: boolean) => { if (!cancelled) setToolCallsExpanded(v); });
    return () => { cancelled = true; };
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
    window.sai.claudeCompact(projectPath, permissionMode, effortLevel, modelChoice, claudeScope);
  }, [contextUsage, isStreaming]);


  useEffect(() => {
    setReady(false);
    const startFn = aiProvider === 'gemini' ? (window.sai as any).geminiStart : aiProvider === 'codex' ? window.sai.codexStart : window.sai.claudeStart;
    const metaPreamble = buildMetaPreamble(activeMetaRuntime ? {
      name: activeMetaRuntime.meta.name,
      syntheticRoot: activeMetaRuntime.syntheticRoot,
      projects: activeMetaRuntime.projects,
    } : null);
    const startArgs: any[] = aiProvider === 'claude'
      ? [projectPath || '', claudeScope, claudeKind, claudeOrchestratorContext, undefined /* scopeCwd */, metaPreamble]
      : [projectPath || '', metaPreamble];
    startFn(...startArgs).then((result: any) => {
      setReady(true);
      if (result?.slashCommands?.length) {
        setSlashCommands(result.slashCommands);
      }

      // One-shot brainstorm seed consumption. Server-side read+delete avoids
      // the renderer ever calling fs:readFile on a missing path (which would
      // log a noisy ENOENT in the main process). We push the seed into the
      // chat transcript so the user sees it as their first message — just
      // calling claudeSend would deliver it to the model invisibly.
      if (aiProvider === 'claude' && projectPath && !consumedBrainstormSeeds.has(projectPath)) {
        consumedBrainstormSeeds.add(projectPath);
        (window.sai as any).brainstormConsumeSeed(projectPath).then((r: { ok: boolean; content?: string }) => {
          if (!r?.ok || !r.content) return;
          const seedContent = r.content.trim();
          if (!seedContent) return;
          const seedMessageId = `seed-${Date.now()}`;
          setMessages(prev => [...prev, {
            id: seedMessageId,
            role: 'user',
            content: seedContent,
            timestamp: Date.now(),
          }]);
          window.sai.claudeSend(
            projectPath,
            seedContent,
            undefined,
            permissionMode,
            effortLevel,
            modelChoice,
            claudeScope,
          );
        }).catch(() => { /* ignore */ });
      }
    });

    const cleanup = window.sai.claudeOnMessage((msg: any) => {
      // Only process messages for this workspace and chat scope.
      // Claude uses session UUIDs as scopes for multi-scope isolation.
      // Gemini and Codex use 'chat' as a fixed scope — match on projectPath only.
      if (msg.projectPath && msg.projectPath !== projectPath) return;
      const expectedScope = aiProvider === 'claude' ? claudeScope : 'chat';
      if (msg.scope && msg.scope !== expectedScope) return;

      // Flush any buffered streaming text before processing a non-delta event,
      // so the pending content is committed to state in the correct order.
      const isPureTextDelta = msg.type === 'assistant'
        && Array.isArray(msg.message?.content)
        && msg.message.content.length > 0
        && msg.message.content.every((b: any) => b.type === 'text' && b.delta && typeof b.text === 'string');
      if (!isPureTextDelta) flushStreamingText();

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
        if (turnStartedAtRef.current === null) {
          turnStartedAtRef.current = Date.now();
        }
        nextSegmentStartRef.current = Date.now();
        return;
      }

      // Mobile remote: append the user bubble for phone-originated prompts.
      // Desktop-originated prompts already do an optimistic add in the send path,
      // so only echo when origin === 'remote'.
      if (msg.type === 'user_message' && msg.origin === 'remote') {
        setMessages(prev => [...prev, {
          id: crypto.randomUUID(),
          role: 'user',
          content: msg.text ?? '',
          timestamp: Date.now(),
        }]);
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
        setPendingApproval(null);
        // Don't return for 'result' — fall through to process usage data below
        if (msg.type === 'done') return;
      }

      if (msg.type === 'process_exit') {
        setReady(false);
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

      // AskUserQuestion answered — merge answers into the matching tool call's input JSON
      if (msg.type === 'question_answered') {
        const { toolUseId, answers } = msg;
        setMessages(prev => prev.map(m => {
          if (m.role !== 'assistant' || !m.toolCalls) return m;
          let touched = false;
          const newToolCalls = m.toolCalls.map(tc => {
            if (tc.id !== toolUseId) return tc;
            try {
              const parsed = JSON.parse(tc.input || '{}');
              const merged = { ...parsed, answers };
              touched = true;
              return { ...tc, input: JSON.stringify(merged, null, 2) };
            } catch {
              return tc;
            }
          });
          return touched ? { ...m, toolCalls: newToolCalls } : m;
        }));
        return;
      }

      // ExitPlanMode answered — stamp resolved state into the tool call's output
      // so PlanReviewCard re-renders in its collapsed resolved state.
      if (msg.type === 'plan_review_answered') {
        const { toolUseId, approved } = msg;
        setMessages(prev => prev.map(m => {
          if (m.role !== 'assistant' || !m.toolCalls) return m;
          let touched = false;
          const newToolCalls = m.toolCalls.map(tc => {
            if (tc.id !== toolUseId) return tc;
            touched = true;
            return { ...tc, output: approved ? 'Plan approved' : 'Plan rejected' };
          });
          return touched ? { ...m, toolCalls: newToolCalls } : m;
        }));
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

      // Approval was resolved (possibly from the mobile remote). For local
      // tools the follow-up tool_result clears the card too, but for MCP /
      // CLI-retried tools the retry can take seconds — clear immediately so
      // the desktop card doesn't sit stale when mobile already decided.
      if (msg.type === 'approval_resolved') {
        setPendingApproval(null);
        return;
      }

      // Skip system noise
      if (msg.type === 'system' || msg.type === 'rate_limit_event') {
        return;
      }

      // Tool results come back as user messages with tool_result content blocks
      if (msg.type === 'user' && msg.message?.content) {
        const results: Array<{ tool_use_id: string; output: string; images?: import('../../types').ToolResultImage[] }> = [];
        for (const block of msg.message.content) {
          if (block.type === 'tool_result' && block.tool_use_id) {
            const { text, images } = parseToolResultBlocks(block.content);
            results.push({ tool_use_id: block.tool_use_id, output: text, images });
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
                const now = Date.now();
                const newToolCalls = msg.toolCalls.map(tc => {
                  const result = results.find(r => r.tool_use_id === tc.id);
                  if (result) {
                    updated = true;
                    const durationMs = typeof tc.startedAt === 'number' ? now - tc.startedAt : undefined;
                    return {
                      ...tc,
                      output: result.output,
                      ...(result.images ? { resultImages: result.images } : {}),
                      ...(durationMs != null ? { durationMs } : {}),
                    };
                  }
                  return tc;
                });
                if (updated) { next[i] = { ...msg, toolCalls: newToolCalls }; }
              }
            }
            return next;
          });
          nextSegmentStartRef.current = Date.now();
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
              type: block.name?.includes('Edit') || block.name === 'Write' ? 'file_edit' :
                    block.name?.includes('Bash') ? 'terminal_command' :
                    block.name?.includes('Glob') || block.name?.includes('Grep') || block.name === 'ToolSearch' ? 'file_search' :
                    block.name?.includes('Read') ? 'file_read' :
                    block.name?.includes('WebFetch') || block.name?.includes('WebSearch') ? 'web_fetch' :
                    block.name === 'TodoWrite' ? 'todo' :
                    block.name === 'Agent' || block.name === 'SendUserMessage' ? 'agent' :
                    block.name?.includes('Notebook') ? 'notebook' :
                    block.name === 'AskUserQuestion' ? 'question' :
                    block.name === 'EnterPlanMode' || block.name === 'ExitPlanMode' ? 'plan' :
                    block.name === 'EnterWorktree' || block.name === 'ExitWorktree' ? 'worktree' :
                    block.name === 'Skill' ? 'skill' :
                    block.name === 'Monitor' || block.name === 'ScheduleWakeup' || block.name?.startsWith('Cron') ? 'schedule' :
                    block.name === 'TaskOutput' || block.name === 'TaskStop' || block.name === 'RemoteTrigger' ? 'task' :
                    block.name?.startsWith('mcp__') ? 'mcp' : 'other',
              name: block.name || 'tool',
              input: typeof block.input === 'string' ? block.input :
                     typeof block.input === 'object' ? JSON.stringify(block.input, null, 2) : '',
              startedAt: Date.now(),
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
          // Streaming text-delta fast path: buffer into the rAF accumulator and
          // skip the setMessages entirely. Only applies when the last message is
          // already a pure-text assistant bubble we can append to.
          const lastNow = messagesRef.current[messagesRef.current.length - 1];
          // Mark the assistant bubble as actively streaming and (re)arm the idle timer
          // so markdown renders mid-turn on a pause and the thinking head stays in its
          // thinking phase. Used by both the fast path and the slow path's text branch.
          const markStreamingActive = () => {
            setStreamSettled(s => s ? false : s);
            if (streamIdleTimerRef.current != null) {
              clearTimeout(streamIdleTimerRef.current);
            }
            streamIdleTimerRef.current = window.setTimeout(() => {
              streamIdleTimerRef.current = null;
              setStreamSettled(true);
            }, STREAM_IDLE_MS);
          };
          if (
            isPureTextDelta
            && tools.length === 0
            && lastNow?.role === 'assistant'
            && !lastNow.toolCalls
          ) {
            streamPendingRef.current += text;
            if (streamRafRef.current == null) {
              streamRafRef.current = requestAnimationFrame(() => {
                streamRafRef.current = null;
                flushStreamingText();
              });
            }
            markStreamingActive();
            return;
          }
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
            // Before pushing a new assistant message, stamp durationMs on the most recent
            // unstamped assistant text bubble so each bubble records its own duration.
            const turnStart = turnStartedAtRef.current ?? Date.now();
            const stamped = [...prev];
            for (let i = stamped.length - 1; i >= 0; i--) {
              const m = stamped[i];
              if (m.role === 'assistant' && m.content && m.content.length > 0 && typeof m.durationMs !== 'number') {
                stamped[i] = { ...m, durationMs: Date.now() - turnStart };
                break;
              }
            }
            const startedAt = nextSegmentStartRef.current ?? Date.now();
            nextSegmentStartRef.current = null;
            return [...stamped, {
              id: `${Date.now()}-${Math.random()}`,
              role: 'assistant',
              content: text,
              timestamp: Date.now(),
              startedAt,
              toolCalls: tools.length > 0 ? tools : undefined,
            }];
          });
          // A text segment created/updated via the slow path (e.g. the first delta of a
          // turn, or follow-up text after a tool) must also flip streamSettled=false so
          // its head stays in the thinking phase — otherwise the head reveals the first
          // chunk prematurely and the pending row briefly double-shows. Tool-only events
          // (no text) intentionally leave streamSettled alone so the pending row keeps a
          // thinking indicator alive while the tool runs.
          if (text && tools.length === 0) markStreamingActive();
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
            const startedAt = nextSegmentStartRef.current ?? Date.now();
            nextSegmentStartRef.current = null;
            return [...prev, {
              id: `result-${Date.now()}`,
              role: 'assistant',
              content: text,
              timestamp: Date.now(),
              startedAt,
            }];
          });
        }
      }
    });

    return () => {
      flushStreamingText();
      if (streamIdleTimerRef.current != null) {
        clearTimeout(streamIdleTimerRef.current);
        streamIdleTimerRef.current = null;
      }
      cleanup();
    };
  }, [projectPath, aiProvider, activeMetaRuntime, flushStreamingText]);

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
        // The user took over scrolling — release any in-flight jump guard.
        jumpingRef.current = false;
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
  //
  // Also follow content that grows asynchronously after a render — e.g. tool
  // output cards animating their height open. The tween fires once when the
  // message updates and would otherwise stop short of the new bottom.
  useEffect(() => {
    const el = chatContainerRef.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    let lastClient = el.clientHeight;
    let lastScroll = el.scrollHeight;
    const ro = new ResizeObserver(() => {
      const client = el.clientHeight;
      const scroll = el.scrollHeight;
      if (isAtBottomRef.current && (client < lastClient || scroll > lastScroll)) {
        el.scrollTop = el.scrollHeight;
      }
      lastClient = client;
      lastScroll = scroll;
    });
    ro.observe(el);
    // Observe direct children too — RO on the container alone won't fire when
    // overflow content grows past clientHeight.
    const mo = new MutationObserver(() => {
      for (const child of Array.from(el.children)) ro.observe(child);
    });
    for (const child of Array.from(el.children)) ro.observe(child);
    mo.observe(el, { childList: true });
    return () => { ro.disconnect(); mo.disconnect(); };
  }, []);

  // Tween on incremental updates within the same project; snap instantly
  // when the project changes (otherwise the recompute-each-frame tween
  // visibly chases the still-laying-out content on workspace switch).
  const lastTweenProjectRef = useRef<string | null | undefined>(undefined);
  useEffect(() => {
    if (isAtBottomRef.current) {
      setFollowOn(true);
      setUnreadCount(0);
      const el = chatContainerRef.current;
      if (el) {
        if (lastTweenProjectRef.current !== projectPath) {
          el.scrollTop = el.scrollHeight;
        } else {
          tweenScrollToBottom(el);
        }
      }
    } else if (messages[messages.length - 1]?.role === 'assistant') {
      setUnreadCount(c => c + 1);
    }
    lastTweenProjectRef.current = projectPath;
  }, [messages, isStreaming, projectPath]);

  const scrollToBottom = () => {
    isAtBottomRef.current = true;
    setFollowOn(true);
    setUnreadCount(0);
    if (chatContainerRef.current) tweenScrollToBottom(chatContainerRef.current);
  };

  // Smooth-scroll a mounted message into view, holding the jump guard until the
  // scroll settles so the load-more sentinel can't cancel it.
  const beginJumpScroll = (el: HTMLElement) => {
    jumpingRef.current = true;
    el.scrollIntoView({ behavior: 'smooth', block: 'center' });
    const container = chatContainerRef.current;
    const done = () => {
      jumpingRef.current = false;
      container?.removeEventListener('scrollend', done);
    };
    // 'scrollend' is the precise signal; the timeout is a fallback for browsers
    // (and jsdom) that don't fire it.
    container?.addEventListener('scrollend', done, { once: true } as AddEventListenerOptions);
    setTimeout(done, 1000);
  };

  // Jump to a user message. If it's outside the render window it isn't mounted
  // (no ref), so expand the window to include it and finish the scroll once it
  // mounts (see the pending-jump effect below).
  const jumpToUserMessage = (id: string) => {
    isAtBottomRef.current = false;
    setFollowOn(false);
    const el = userMsgRefs.current.get(id);
    if (el) { beginJumpScroll(el); return; }
    const idx = messages.findIndex(m => m.id === id);
    if (idx < 0) return;
    pendingJumpRef.current = id;
    // Leave a small buffer above the target so the sentinel isn't adjacent.
    setRenderStart(prev => Math.min(prev, Math.max(0, idx - 5)));
  };

  // Finish a jump that was waiting on the target message to mount.
  useEffect(() => {
    const id = pendingJumpRef.current;
    if (!id) return;
    const el = userMsgRefs.current.get(id);
    if (!el) return;
    pendingJumpRef.current = null;
    beginJumpScroll(el);
  }, [renderStart]);

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
  const lastAssistantId = useMemo(() => {
    if (turnStartIndex == null) return null;
    for (let i = messages.length - 1; i >= turnStartIndex; i--) {
      if (messages[i].role === 'assistant') return messages[i].id;
    }
    return null;
  }, [messages, turnStartIndex]);

  // Each watcher URL renders on the first message that mentions it. A reply that
  // re-quotes the URL (or a tool call that re-fetches the run) would otherwise spawn
  // a duplicate card lower in the chat.
  const watcherUrlsByMessageId = useMemo(() => {
    const owner = new Map<string, Set<string>>();
    const seen = new Set<string>();
    for (const m of messages) {
      const targets = watchTargetsFromMessage(m);
      if (targets.length === 0) continue;
      const owned = new Set<string>();
      for (const t of targets) {
        if (seen.has(t.url)) continue;
        seen.add(t.url);
        owned.add(t.url);
      }
      if (owned.size > 0) owner.set(m.id, owned);
    }
    return owner;
  }, [messages]);
  // Display-only streaming state: stays true across the queue-drain handoff so the
  // Stop button and thinking animation don't flicker to "idle" when the user sends
  // a follow-up right as the current turn finishes. The real `isStreaming` prop
  // still drives the turn/drain logic — only presentation uses this.
  const streamingForDisplay = isStreaming || drainInFlight || messageQueue.length > 0;
  const showThinking = streamingForDisplay && !awaitingQuestion;
  const isSaiProvider = true; // All providers use the SAI animation system
  const saiMorphActive = isSaiProvider && saiAnimationEnabled;
  const lastMsg = messages[messages.length - 1];
  // A segment head shows the thinking row only while it is ACTIVELY streaming text
  // (`!streamSettled`). Once it settles — text revealed, or a tool is running, or it's
  // between segments — the head goes quiet, so the trailing pending row must take over
  // to keep a thinking indicator alive while the turn continues (e.g. during a tool
  // call after a typed response). The first-text-delta no longer leaves a stale window
  // here because the slow path now clears streamSettled when it creates a text segment.
  const hasStreamingAssistantSegment = !streamSettled && lastMsg?.role === 'assistant';
  // SAI morph path: only a pending tail row when no segment head is actively thinking.
  const showPendingSaiThinking = showThinking && saiMorphActive && !hasStreamingAssistantSegment;
  // Detached banner: non-SAI providers, OR SAI with the animation pref off (today's fallback).
  const showDetachedBanner = showThinking && !saiMorphActive;
  const hasHiddenMessages = renderStart > 0;

  useEffect(() => {
    onMessagesChange?.(messages);
  }, [messages]);

  // Flush messages ref to parent synchronously before save — called by onTurnComplete
  const flushMessagesToParent = useCallback(() => {
    onMessagesChange?.(messagesRef.current);
  }, [onMessagesChange]);

  // GitHubWatcherCard dispatches a snapshot event on phase transitions. We attach
  // the snapshot to the owning message so it persists with chat history and cards
  // resume from their last-known state when the chat is reopened.
  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent<{ messageId: string; snapshot: import('../../types').GitHubWatcherSnapshot }>).detail;
      if (!detail?.messageId || !detail.snapshot) return;
      setMessages(prev => {
        let changed = false;
        const next = prev.map(m => {
          if (m.id !== detail.messageId) return m;
          const existing = m.githubWatchers ?? [];
          const otherUrls = existing.filter(s => s.url !== detail.snapshot.url);
          // Skip the write when the phase hasn't actually changed (defensive — the card already
          // dedupes, but stale events from remounts could otherwise churn the message ref).
          const prior = existing.find(s => s.url === detail.snapshot.url);
          if (prior && prior.phase === detail.snapshot.phase) return m;
          changed = true;
          return { ...m, githubWatchers: [...otherUrls, detail.snapshot] };
        });
        return changed ? next : prev;
      });
    };
    window.addEventListener('sai-github-watcher-snapshot', handler);
    return () => window.removeEventListener('sai-github-watcher-snapshot', handler);
  }, []);

  const handleApprove = (modifiedCommand?: string) => {
    if (!pendingApproval) return;
    if (aiProvider === 'gemini') {
      (window.sai as any).geminiApprove?.(projectPath, pendingApproval.toolUseId, true, modifiedCommand, 'chat');
    } else {
      window.sai.claudeApprove(projectPath, pendingApproval.toolUseId, true, modifiedCommand, claudeScope);
    }
    setPendingApproval(null);
  };

  const handleDeny = () => {
    if (!pendingApproval) return;
    if (aiProvider === 'gemini') {
      (window.sai as any).geminiApprove?.(projectPath, pendingApproval.toolUseId, false, undefined, 'chat');
    } else {
      window.sai.claudeApprove(projectPath, pendingApproval.toolUseId, false, undefined, claudeScope);
    }
    setPendingApproval(null);
  };

  const handleAlwaysAllow = async () => {
    if (!pendingApproval) return;
    if (aiProvider === 'gemini') {
      // Gemini doesn't support always-allow patterns — just approve this instance
      (window.sai as any).geminiApprove?.(projectPath, pendingApproval.toolUseId, true, undefined, 'chat');
    } else {
      const pattern = `${pendingApproval.toolName}(*)`;
      await window.sai.claudeAlwaysAllow(projectPath, pattern);
      window.sai.claudeApprove(projectPath, pendingApproval.toolUseId, true, undefined, claudeScope);
    }
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
    // Dev-only: messages containing sai://fake-* render the watcher card without
    // round-tripping to the LLM. Synthesizes a watch_github_run tool call (the
    // card now mounts from tool calls, not text detection).
    if (import.meta.env.DEV && /sai:\/\/fake-run\//.test(text)) {
      const url = text.match(/sai:\/\/fake-run\/[^\s)"'<]*/)![0];
      const runId = url.replace(/^sai:\/\/fake-run\//, '').split('?')[0];
      const ts = Date.now();
      setMessages(prev => [...prev,
        { id: `fake-watcher-user-${ts}`, role: 'user', content: text, timestamp: ts, images },
        {
          id: `fake-watcher-${ts}`, role: 'assistant', content: '', timestamp: ts + 1,
          toolCalls: [{
            id: `fake-watch-${ts}`, type: 'mcp', name: 'mcp__swarm__sai_watch_github_run',
            input: JSON.stringify({ url }),
            output: JSON.stringify({ owner: 'fake', repo: 'fake', runId, url, status: 'in_progress' }),
          }],
        },
      ]);
      flushMessagesToParent();
      return;
    }
    // Slash-command interception (orchestrator chat). When the parent provides
    // onInterceptSend and reports the message as handled, we add the user msg
    // and a synthetic assistant reply locally and skip provider dispatch.
    if (onInterceptSend) {
      try {
        const outcome = await onInterceptSend(text);
        const handled = outcome === true || (typeof outcome === 'object' && outcome !== null && (outcome as any).handled);
        if (handled) {
          const userId = `slash-user-${Date.now()}`;
          const userTs = Date.now();
          const reply = typeof outcome === 'object' && outcome !== null ? (outcome as any).reply : '';
          setMessages(prev => [...prev, { id: userId, role: 'user', content: text, timestamp: userTs }]);
          if (reply) {
            const replyId = `slash-reply-${Date.now()}`;
            setMessages(prev => [...prev, { id: replyId, role: 'assistant', content: String(reply), timestamp: userTs + 1 }]);
          }
          // Flush to parent so onTurnComplete-style persistence picks these up.
          flushMessagesToParent();
          onTurnComplete?.();
          return;
        }
      } catch (err) {
        console.error('onInterceptSend error', err);
      }
    }
    // Type-to-answer: when a Claude AskUserQuestion card is awaiting an answer,
    // a normal typed message is the user's free-text ("Other") answer to the
    // pending question(s), not a new turn. Route it to the answer channel and
    // skip provider dispatch.
    if (aiProvider === 'claude' && awaitingQuestion) {
      const pending = buildPendingQuestionAnswer(messagesRef.current, text);
      if (pending) {
        handleAnswerQuestion(pending.toolUseId, pending.answers);
        pendingComposerRectRef.current = null;
        return;
      }
    }

    if (text === '/clear') {
      setMessages([]);
      setRenderStart(0);
      pendingComposerRectRef.current = null;
      return;
    }
    if (text === '/compact' && aiProvider === 'claude') {
      window.sai.claudeCompact(projectPath, permissionMode, effortLevel, modelChoice, claudeScope);
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

    // Bypass-queue-on-enter: when streaming AND the queue has items, plain
    // Enter signals "send this now" — interrupt the current turn first, then
    // dispatch immediately. The queue stays untouched and resumes draining
    // after this turn ends.
    if (isStreaming && messageQueue.length > 0) {
      // The stop will cause the CLI to emit `done`, which flips isStreaming
      // false and would otherwise wake the drain useEffect to shift a queued
      // item. Suppress that one drain so only the user's new message runs.
      suppressNextDrainRef.current = true;
      if (aiProvider === 'gemini') (window.sai as any).geminiStop?.(projectPath);
      else if (aiProvider === 'codex') window.sai.codexStop?.(projectPath);
      else window.sai.claudeStop?.(projectPath, claudeScope);
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
      window.sai.claudeSend(projectPath, prompt, imagePaths, permissionMode, effortLevel, modelChoice, claudeScope);
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

  const handleAnswerQuestion = useCallback((toolUseId: string, answers: Record<string, string | string[]>) => {
    if (aiProvider !== 'claude' || !projectPath) return Promise.resolve();
    return window.sai.claudeAnswerQuestion(projectPath, toolUseId, answers, claudeScope).then(() => undefined);
  }, [aiProvider, projectPath, claudeScope]);

  const handleAnswerPlanReview = useCallback((toolUseId: string, approved: boolean) => {
    if (aiProvider !== 'claude' || !projectPath) return Promise.resolve();
    return window.sai.claudeAnswerPlanReview(projectPath, toolUseId, approved, claudeScope).then(() => undefined);
  }, [aiProvider, projectPath, claudeScope]);

  const handleQueue = (text: string, fullText: string, images?: string[], attachments?: { images: number; files: number; terminal: boolean }) => {
    if (sessionId && onQueueAdd) {
      onQueueAdd(sessionId, text, fullText, images, attachments);
    }
  };

  const handleQueueSendNow = (id: string) => {
    const item = messageQueue.find(m => m.id === id);
    if (!item || !sessionId) return;
    onQueueRemove?.(sessionId, id);
    // Same semantics as bypass-queue-on-enter: interrupt the current turn and
    // dispatch immediately; the rest of the queue resumes draining afterwards.
    if (isStreaming) {
      suppressNextDrainRef.current = true;
      if (aiProvider === 'gemini') (window.sai as any).geminiStop?.(projectPath);
      else if (aiProvider === 'codex') window.sai.codexStop?.(projectPath);
      else window.sai.claudeStop?.(projectPath, claudeScope);
    }
    handleSend(item.fullText, item.images);
  };

  const prevStreamingRef = useRef(false);
  const prevQueueLenRef = useRef(messageQueue.length);
  const suppressNextDrainRef = useRef(false);
  const drainPendingRef = useRef(false);
  const turnStartedAtRef = useRef<number | null>(null);
  const nextSegmentStartRef = useRef<number | null>(null);
  const autoSendTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const drainBackstopRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Drives queue draining. Keyed on BOTH isStreaming and messageQueue because a
  // drain can be triggered two ways:
  //   1. A turn ends (isStreaming true->false) with items already queued.
  //   2. An item lands in the queue when we're ALREADY idle — the hit-or-miss
  //      race where the user queues a message in the same instant the turn is
  //      wrapping up, so `done` flips isStreaming false a render before the
  //      queued item arrives. An edge-only effect never woke for that item.
  useEffect(() => {
    const wasStreaming = prevStreamingRef.current;
    const prevQueueLen = prevQueueLenRef.current;
    prevStreamingRef.current = isStreaming;
    prevQueueLenRef.current = messageQueue.length;

    const turnJustEnded = wasStreaming && !isStreaming;
    // Item(s) appeared while we were already settled and idle.
    const queueGrewWhileIdle = !isStreaming && !wasStreaming && messageQueue.length > prevQueueLen;

    // A real turn started — clear the in-flight guard so the next end can drain.
    if (isStreaming) {
      drainPendingRef.current = false;
      setDrainInFlight(false);
      if (drainBackstopRef.current) { clearTimeout(drainBackstopRef.current); drainBackstopRef.current = null; }
    }

    if (turnJustEnded) {
      // Stamp durationMs on every unstamped assistant text bubble in the current
      // turn. Each bubble gets cumulative time from turn start so the displayed
      // value monotonically grows across a multi-bubble turn.
      const turnStart = turnStartedAtRef.current;
      setMessages(prev => {
        const startIdx = turnStartIndex ?? 0;
        const now = Date.now();
        let changed = false;
        const next = prev.map((m, i) => {
          if (
            i >= startIdx &&
            m.role === 'assistant' &&
            m.content && m.content.length > 0 &&
            typeof m.durationMs !== 'number'
          ) {
            changed = true;
            return { ...m, durationMs: now - (turnStart ?? m.startedAt ?? m.timestamp) };
          }
          return m;
        });
        return changed ? next : prev;
      });
      if (turnStartedAtRef.current !== null) {
        turnStartedAtRef.current = null;
      }
    }

    if (!isStreaming && (turnJustEnded || queueGrewWhileIdle)) {
      // suppressNextDrainRef is set right before an interrupting stop (bypass /
      // send-now). It must only ever consume the turn-end edge it was set for —
      // not a queue-grew-while-idle wake — otherwise it could swallow an
      // unrelated drain.
      if (suppressNextDrainRef.current && turnJustEnded) {
        suppressNextDrainRef.current = false;
      } else if (
        !suppressNextDrainRef.current &&
        !drainPendingRef.current &&
        !autoSendTimerRef.current &&
        messageQueue.length > 0 && onQueueShift && sessionId
      ) {
        const next = messageQueue[0];
        drainPendingRef.current = true;
        setDrainInFlight(true);
        onQueueShift(sessionId);
        autoSendTimerRef.current = setTimeout(() => {
          autoSendTimerRef.current = null;
          handleSend(next.fullText, next.images);
        }, 300);
        // Safety: if the follow-up never produces a streaming_start (e.g. a spawn
        // error), don't leave the Stop button stuck — release the bridge.
        if (drainBackstopRef.current) clearTimeout(drainBackstopRef.current);
        drainBackstopRef.current = setTimeout(() => {
          drainBackstopRef.current = null;
          setDrainInFlight(false);
        }, 8000);
      }
    }
  }, [isStreaming, messageQueue]);

  // Unmount-only: a pending queue-drain send must not fire into an unmounted
  // panel. Not cleared on isStreaming changes — that would drop a message the
  // queue has already shifted.
  useEffect(() => () => {
    if (autoSendTimerRef.current) clearTimeout(autoSendTimerRef.current);
    if (drainBackstopRef.current) clearTimeout(drainBackstopRef.current);
  }, []);

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
              onClick={() => jumpToUserMessage(pinnedUserMessage.id)}
              title="Jump to message"
            >
              <CornerLeftUp size={11} strokeWidth={2.5} />
              <span>Jump</span>
            </button>
          </>
        )}
      </motion.div>
      <div className="chat-messages" ref={chatContainerRef} onScroll={handleScroll}>
        <LayoutGroup id="sai-brand">
          {messages.length === 0 ? (
            <div className="chat-empty">
              {emptyStateVisual ? (
                emptyStateVisual
              ) : (
                <motion.div layoutId="sai-brand-logo" layout="position" transition={{ duration: 0.35, ease: [0.4, 0, 0.2, 1] }}>
                  <SaiLogo mode="idle" size={64} className="chat-empty-logo" ariaLabel="SAI" />
                </motion.div>
              )}
              <motion.div layoutId="sai-brand-title" layout="position" transition={{ duration: 0.35, ease: [0.4, 0, 0.2, 1] }} className="chat-empty-title">SAI</motion.div>
              <AnimatePresence>
                <motion.div
                  key="empty-extras"
                  className="chat-empty-extras"
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  transition={{ duration: 0.25 }}
                >
                  <div className="chat-empty-subtitle">
                    {projectPath ? emptyPrompt : 'Select a project to get started'}
                  </div>
                  {projectPath && <CyclingHints />}
                </motion.div>
              </AnimatePresence>
            </div>
          ) : (
            <div className="chat-conversation-header">
              {conversationHeaderVisual ? (
                conversationHeaderVisual
              ) : (
                <motion.div layoutId="sai-brand-logo" layout="position" transition={{ duration: 0.35, ease: [0.4, 0, 0.2, 1] }}>
                  <SaiLogo mode="idle" size={64} className="chat-empty-logo" ariaLabel="SAI" />
                </motion.div>
              )}
              <motion.div layoutId="sai-brand-title" layout="position" transition={{ duration: 0.35, ease: [0.4, 0, 0.2, 1] }} className="chat-empty-title">SAI</motion.div>
            </div>
          )}
        </LayoutGroup>
        {messages.length > 0 && (
          <>
            <div className="chat-messages-spacer" aria-hidden="true" />
            {hasHiddenMessages && (
              <div ref={sentinelRef} className="chat-load-sentinel">
                <span className="chat-load-sentinel-text">Loading earlier messages...</span>
              </div>
            )}
            <TaskRegistryContext.Provider value={taskRegistry}>
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
                      renderToolCall={renderToolCall}
                      renderMessage={renderMessage}
                      metaRuntime={activeMetaRuntime}
                      onAnswerQuestion={handleAnswerQuestion}
                      onAnswerPlanReview={handleAnswerPlanReview}
                    />
                  </div>
                )
                : <ChatMessage key={msg.id} message={msg} projectPath={projectPath} onFileOpen={onFileOpen} aiProvider={aiProvider} toolCallsExpanded={toolCallsExpanded} onRetry={msg.error ? () => handleRetry(msg.id) : undefined} onClearContext={msg.error ? handleClearContext : undefined} isFirstAssistantOfTurn={msg.id === firstAssistantOfTurnId} isStreaming={isStreaming && msg.id === lastAssistantId && !streamSettled} renderToolCall={renderToolCall} renderMessage={renderMessage} metaRuntime={activeMetaRuntime} onAnswerQuestion={handleAnswerQuestion} onAnswerPlanReview={handleAnswerPlanReview} watcherUrlAllowlist={watcherUrlsByMessageId.get(msg.id) ?? EMPTY_URL_SET} />
              )}
            </TaskRegistryContext.Provider>
          </>
        )}
        <MotionPresence>
          {showDetachedBanner && (
            <motion.div
              key="thinking"
              initial={{ opacity: 0, y: DISTANCE.lift }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0 }}
              transition={thinkingTransition}
            >
              <ThinkingAnimation />
            </motion.div>
          )}
          {showPendingSaiThinking && (
            <motion.div
              key="thinking-pending"
              initial={{ opacity: 0, y: DISTANCE.lift }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0 }}
              transition={thinkingTransition}
            >
              <ThinkingAnimation />
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
          <ChatInput
            onSend={handleSend}
            overlayControl={overlayControl}
            onBeforeSend={(rect) => { pendingComposerRectRef.current = rect; }}
            disabled={!ready}
            slashCommands={slashCommands}
            onQueue={handleQueue}
            queueCount={messageQueue.length}
            pendingApproval={pendingApproval}
            onApprove={handleApprove}
            onDeny={handleDeny}
            onAlwaysAllow={handleAlwaysAllow}
            isStreaming={streamingForDisplay}
            awaitingQuestion={awaitingQuestion}
            messages={messages}
            onStop={() => aiProvider === 'gemini' ? (window.sai as any).geminiStop(projectPath) : aiProvider === 'codex' ? window.sai.codexStop(projectPath) : window.sai.claudeStop?.(projectPath, claudeScope)}
            permissionMode={permissionMode}
            onPermissionChange={onPermissionChange}
            effortLevel={effortLevel}
            onEffortChange={onEffortChange}
            modelChoice={modelChoice}
            onModelChange={onModelChange}
            availableModels={availableModels}
            claudeOverrideState={claudeOverrideState}
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
            messageQueue={messageQueue}
            onQueueRemove={(id) => sessionId && onQueueRemove?.(sessionId, id)}
            onQueuePromote={(id) => sessionId && onQueuePromote?.(sessionId, id)}
            onQueueSendNow={handleQueueSendNow}
            initialDraft={initialDraft}
            onDraftChange={onDraftChange}
            initialContextItems={initialContextItems}
            onContextItemsChange={onContextItemsChange}
            metaRuntime={activeMetaRuntime}
            mentionInsertRef={mentionInsertRef}
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
          border: 1px solid var(--border-subtle);
          background: var(--surface-2);
          color: var(--accent);
          cursor: pointer;
          box-shadow: 0 2px 12px rgba(0, 0, 0, 0.3);
          transition: background 0.15s, border-color 0.15s;
        }
        .follow-btn:hover {
          background: color-mix(in srgb, var(--surface-2) 70%, var(--accent) 10%);
          border-color: color-mix(in srgb, var(--border-subtle) 60%, var(--accent) 40%);
        }
        .follow-btn-unread {
          position: absolute;
          top: 4px;
          right: 4px;
          width: 6px;
          height: 6px;
          border-radius: 50%;
          background: var(--accent);
          box-shadow: 0 0 0 2px var(--surface-2);
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
          border-bottom: 1px solid var(--border-hairline);
          background: color-mix(in srgb, var(--surface-2) 80%, transparent);
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
        .chat-conversation-header {
          display: flex;
          flex-direction: column;
          align-items: center;
          gap: 12px;
          padding: 24px 0;
        }
        .chat-empty-extras {
          display: flex;
          flex-direction: column;
          align-items: center;
          gap: 12px;
        }
        @keyframes empty-fade {
          from { opacity: 0; transform: scale(0.97); }
          to   { opacity: 1; transform: scale(1); }
        }
        .chat-empty-logo {
          margin-bottom: 8px;
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
          background: var(--surface-2);
          border: 1px solid var(--border-hairline);
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
          padding: 12px 14px;
          min-height: 40px;
        }
        .thinking-icon {
          color: var(--accent);
          flex-shrink: 0;
        }
        .thinking-text {
          font-family: 'Departure Mono', 'Geist Mono', 'JetBrains Mono', monospace;
          font-size: 13px;
          line-height: 1;
          color: var(--accent);
          font-weight: 400;
          letter-spacing: 0.4px;
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
        .thinking-clock {
          font-family: 'Geist Mono', 'JetBrains Mono', monospace;
          font-variant-numeric: tabular-nums;
          font-size: 11px;
          color: #6b6253;
          letter-spacing: 0.04em;
          margin-right: 2px;
          flex-shrink: 0;
        }
        .thinking-cursor-block {
          display: inline-block;
          width: 0.55em;
          height: 1em;
          background: currentColor;
          vertical-align: -0.15em;
          margin-left: 3px;
          animation: thinking-cursor-blink 1s steps(1) infinite;
        }
        @keyframes thinking-cursor-blink {
          0%, 49% { opacity: 1; }
          50%, 100% { opacity: 0; }
        }
        @media (prefers-reduced-motion: reduce) {
          .thinking-cursor-block { animation: none; opacity: 1; }
        }
      `}</style>
    </div>
  );
}
