import { Fragment, useState, useEffect, useLayoutEffect, useRef, useCallback, useMemo } from 'react';
import { createPortal } from 'react-dom';
import { ChevronDown, CornerLeftUp } from 'lucide-react';
import { stampTaskTags } from './tasks/taskTags';
import { motion, AnimatePresence, LayoutGroup } from 'motion/react';
import { setFlipRect } from './flipRegistry';
import { useLoadGuard } from '../../hooks/useLoadGuard';
import LoadGuardBanner from './LoadGuardBanner';
import ThinkingAnimation from '../ThinkingAnimation';
import SaiLogo from '../SaiLogo';
import { SPRING, DISTANCE, EASING, useReducedMotionTransition } from './motion';
import { useSaiAnimationPref } from './useSaiAnimationPref';
import { markRevealed } from './revealRegistry';
import { useChatLog } from '../../hooks/useChatLog';
import { reduceChat, persistableState } from '../../lib/chat/reducer';
import type { ChatLogEntry, ChatSettings, ChatState } from '../../lib/chat/types';
import { effectiveChatSettings, settingsSeed } from '../../lib/chat/composerSettings';
import { isChatImported } from '../../lib/chat/migrateToLog';
import { itemKey } from './tasks/declaredCards';
import { buildPendingQuestionAnswer } from '../../lib/pendingQuestionAnswer';
import { normalizeSlashCommands, type SlashCommandInfo } from '../../lib/slashCommands';
import WaitingIndicator from './WaitingIndicator';
import FollowUpIndicator from './FollowUpIndicator';
import UserInputRequestPanel from './UserInputRequestPanel';
import McpElicitationPanel from './McpElicitationPanel';

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
const NO_CHIPS: Map<string, TaskChipInfo> = new Map();
const NO_LABELS: Map<string, MessageTaskLabels> = new Map();
const HIDDEN_STYLE = { display: 'none' } as const;
const EMPTY_MESSAGES: ChatMessageType[] = [];

/** Re-applies task tags stamped on earlier renders (the log never carries them). */
function applyTaskStamps(messages: ChatMessageType[], stamps: Map<string, string | null>): ChatMessageType[] {
  if (stamps.size === 0) return messages;
  let changed = false;
  const out = messages.map(m => {
    let nm = m;
    const own = stamps.get(itemKey(m.id));
    if (own !== undefined && m.taskId === undefined) nm = { ...nm, taskId: own };
    if (m.toolCalls) {
      let calls = m.toolCalls;
      m.toolCalls.forEach((tc, i) => {
        const tag = stamps.get(itemKey(m.id, tc.id, i));
        if (tag === undefined || tc.taskId !== undefined) return;
        if (calls === m.toolCalls) calls = [...m.toolCalls];
        calls[i] = { ...tc, taskId: tag };
      });
      if (calls !== m.toolCalls) nm = { ...nm, toolCalls: calls };
    }
    if (nm !== m) changed = true;
    return nm;
  });
  return changed ? out : messages;
}

function recordTaskStamps(messages: ChatMessageType[], stamps: Map<string, string | null>): void {
  for (const m of messages) {
    if (m.taskId !== undefined) stamps.set(itemKey(m.id), m.taskId);
    m.toolCalls?.forEach((tc, i) => {
      if (tc.taskId !== undefined) stamps.set(itemKey(m.id, tc.id, i), tc.taskId);
    });
  }
}

function newClientId(): string {
  return crypto.randomUUID();
}

/** Text-only assistant output (not an API-error envelope): the stream-idle gate's activity signal. */
function isStreamingText(ev: Record<string, any>): boolean {
  if (ev.type !== 'assistant' || !Array.isArray(ev.message?.content)) return false;
  let text = '';
  for (const b of ev.message.content) {
    if (b?.type === 'tool_use') return false;
    if (b?.type === 'text' && typeof b.text === 'string') text += b.text;
  }
  return !!text && !looksLikeApiError(text);
}
import ChatInput, { type ContextItem } from './ChatInput';
import type { ChatMessage as ChatMessageType, ToolCall, PendingApproval, PendingSudoPrompt, PendingCodexUserInput, PendingCodexMcpElicitation, QueuedMessage, TerminalTab } from '../../types';
import type { MetaWorkspaceRuntime, CodexEffort, CodexModelOption } from '../../types';
import type { WaitMeta } from '../../../electron/services/waitClassifier';
import { buildHelpMessage } from './helpText';
import McpAuthNudge from './McpAuthNudge';
import { buildTaskRegistry, TaskRegistryContext } from './taskRegistry';
import { parseAiError, looksLikeApiError } from './parseAiError';
import { useTaskBoard } from './tasks/useTaskBoard';
import { TaskTabs, TASK_TABS_SLOT_ID } from './tasks/TaskTabs';
import { TaskFeedView } from './tasks/TaskFeedView';
import { TaskChip } from './tasks/TaskChip';
import { taskChips, taskLabels, directAtTask, type TaskChipInfo, type MessageTaskLabels } from './tasks/taskFeed';
import { useTaskTagsPref } from './useTaskTagsPref';
import type { TaskCard } from './tasks/types';
import './tasks/tasks.css';
import type { BackgroundTaskDetail } from '../../../electron/services/claudeBackend/backgroundTasks';
import { buildMetaPreamble } from '../../lib/metaSystemPrompt';
import { normalizeCodexEffort } from '../../lib/codexEffort';
import {
  claudeRateLimitsToViews,
  codexRateLimitsToViews,
  contextUsageFromCodex,
  resolveEffectiveContextWindow,
  type ContextUsageView,
  type UsageLimitView,
  type ClaudeRateLimitRecord,
  type CodexRateLimitsSnapshot,
} from '../../lib/composerTelemetry';

type CodexPermission = 'auto' | 'read-only' | 'full-access';

export type OverlayMode = 'on' | 'off' | 'persist';

interface ChatPanelProps {
  projectPath: string;
  /** When set, renders the focus-overlay mode control under the input
   *  (present only while the overlay setting is enabled). */
  overlayControl?: { mode: OverlayMode; onChange: (m: OverlayMode) => void };
  permissionMode: 'default' | 'bypass';
  onPermissionChange: (mode: 'default' | 'bypass') => void;
  effortLevel: 'low' | 'medium' | 'high' | 'xhigh' | 'max';
  onEffortChange: (level: 'low' | 'medium' | 'high' | 'xhigh' | 'max' | null) => void;
  modelChoice: 'default' | 'best' | 'sonnet' | 'opus' | 'haiku' | 'sonnet[1m]' | 'opus[1m]' | 'opusplan' | (string & {});
  onModelChange: (model: 'default' | 'best' | 'sonnet' | 'opus' | 'haiku' | 'sonnet[1m]' | 'opus[1m]' | 'opusplan' | (string & {}) | null) => void;
  availableModels?: { id: string; label: string; description: string; recommended?: boolean; oneM?: boolean; extra?: boolean }[];
  claudeOverrideState?: {
    modelOverridden: boolean;
    effortOverridden: boolean;
    globalModel: 'default' | 'best' | 'sonnet' | 'opus' | 'haiku' | 'sonnet[1m]' | 'opus[1m]' | 'opusplan' | (string & {});
    globalEffort: 'low' | 'medium' | 'high' | 'xhigh' | 'max';
  };
  aiProvider: 'claude' | 'codex' | 'gemini' | 'kimi';
  codexModel: string;
  onCodexModelChange: (model: string) => void;
  codexModels: CodexModelOption[];
  onCodexModelsRefresh?: () => void;
  codexPermission: CodexPermission;
  onCodexPermissionChange: (perm: CodexPermission) => void;
  codexEffort?: CodexEffort;
  onCodexEffortChange?: (effort: CodexEffort) => void;
  geminiModel: string;
  onGeminiModelChange: (model: string) => void;
  geminiModels: { id: string; name: string }[];
  geminiApprovalMode: 'default' | 'auto_edit' | 'yolo' | 'plan';
  onGeminiApprovalModeChange: (mode: 'default' | 'auto_edit' | 'yolo' | 'plan') => void;
  geminiConversationMode: 'planning' | 'fast';
  onGeminiConversationModeChange: (mode: 'planning' | 'fast') => void;
  kimiModel: string;
  onKimiModelChange: (m: string) => void;
  kimiModels: { id: string; name: string }[];
  kimiApprovalMode: 'default' | 'auto_edit' | 'yolo' | 'plan';
  onKimiApprovalModeChange: (m: 'default' | 'auto_edit' | 'yolo' | 'plan') => void;
  /** The chat's messages (from the log) for the parent's IndexedDB mirror; persistable state at turn end. */
  onMessagesChange?: (messages: ChatMessageType[]) => void;
  onTurnComplete?: () => void;
  onClaudeSessionId?: (sessionId: string) => void;
  onGeminiSessionId?: (sessionId: string) => void;
  onKimiSessionId?: (sessionId: string) => void;
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
  sessionId?: string;
  /**
   * Optional: populated with a callback that sends text into this chat the
   * way the composer does (App's command palette). A busy chat queues it.
   */
  sendTextRef?: React.MutableRefObject<((text: string) => void) | null>;
  terminalTabs?: TerminalTab[];
  onSlashCommandsUpdate?: (commands: SlashCommandInfo[]) => void;
  /**
   * IPC scope to use for claude:start / send / stop / message routing.
   * Defaults to 'chat' (the workspace's default chat scope); App passes the
   * session id so each chat gets its own backend process.
   */
  claudeScope?: string;
  /** Opens the MCP sidebar (chat sign-in nudge "Review"). */
  onOpenMcpPanel?: () => void;
  /**
   * Optional: override how individual tool calls in messages are rendered.
   * Return `null` to fall back to the default `<ToolCallCard>`. App uses it to
   * mount SAI render-tool cards.
   */
  /** See ChatMessage: `seedGrow` marks this call's card as born from the tail
   *  thinking row — mount it with the grow-in entry (seedGrow.ts). */
  renderToolCall?: (tc: ToolCall, defaultExpanded: boolean, seedGrow?: boolean, ctx?: { isNewestModel: boolean }) => React.ReactNode | null;
  /**
   * Optional: active meta-workspace runtime. When set (and its syntheticRoot
   * matches projectPath), the meta-workspace preamble is injected into the
   * AI system prompt on start.
   */
  activeMetaRuntime?: MetaWorkspaceRuntime | null;
  /**
   * Optional: ref that will be populated with a mention-insert callback by
   * ChatInput. Pass this from App.tsx so the accordion bar can trigger
   * mention insertion without going through ChatPanel's internal state.
   */
  mentionInsertRef?: React.MutableRefObject<((linkName: string) => void) | null>;
  /**
   * Optional: waiting state for this scope. Set when a turn ends with a
   * wait classification (background_requested / scheduled) rather than a
   * real completion. Consumed by Task 9 to render a waiting pill/indicator.
   */
  waiting?: { wait: WaitMeta; startedAtMs: number } | null;
  /** Follow-up judge state for this scope (Claude only): the AI promised to pick back up. */
  followUp?: { state: 'following' | 'resuming' | 'stalled'; waitingFor: string | null } | null;
  onDismissFollowUp?: () => void;
  /** Background-work sidebar plumbing, passed straight to the wait pill. */
  liveBackgroundTaskCount?: number;
  onToggleBackgroundTasks?: () => void;
  backgroundTasksOpen?: boolean;
  /** Task tabs: App sets this for Claude SDK chats only. */
  taskUiEnabled?: boolean;
  /** This chat's background task snapshots (App's sidebar tasks for the scope). */
  backgroundTasks?: BackgroundTaskDetail[];
  onStopBackgroundTask?(taskId: string): Promise<boolean>;
  /** Claude CLI session id; subagent transcripts are stored under it. */
  claudeSessionId?: string;
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

// Shared motion props for the tail thinking rows.
// - Enter must NOT animate height to 'auto': framer resolves 'auto' by
//   measuring at animation start, and the row's content (typewriter text
//   starts empty) can measure ~8px — the value then freezes as inline height
//   under overflow:hidden = an invisible row. Exit DOES collapse height: it
//   measures the real current height, so the transcript slides smoothly when
//   the row yields to a card.
// - flexShrink 0: the messages column is a flex container and crushes this
//   wrapper otherwise — with overflow:hidden (needed for the exit collapse)
//   the crush becomes an actual clip.
const THINKING_ROW_MOTION = {
  initial: { opacity: 0, y: DISTANCE.lift },
  animate: { opacity: 1, y: 0 },
  exit: { opacity: 0, height: 0 },
  style: { overflow: 'hidden', flexShrink: 0 },
} as const;
const LOAD_MORE_CHUNK = 30; // messages to load when scrolling up
/** A log turn still open with App idle is checked against the backend this often (App's reconcile cadence). */
const LOG_TURN_RECONCILE_MS = 20_000;


export default function ChatPanel({ projectPath, overlayControl, permissionMode: defaultPermissionMode, onPermissionChange: onDefaultPermissionChange, effortLevel: defaultEffortLevel, onEffortChange: onDefaultEffortChange, modelChoice: defaultModelChoice, onModelChange: onDefaultModelChange, availableModels, claudeOverrideState: workspaceOverrideState, aiProvider, codexModel: defaultCodexModel, onCodexModelChange: onDefaultCodexModelChange, codexModels, onCodexModelsRefresh, codexPermission: defaultCodexPermission, onCodexPermissionChange: onDefaultCodexPermissionChange, codexEffort: defaultCodexEffort, onCodexEffortChange: onDefaultCodexEffortChange, geminiModel: defaultGeminiModel, onGeminiModelChange: onDefaultGeminiModelChange, geminiModels, geminiApprovalMode: defaultGeminiApprovalMode, onGeminiApprovalModeChange: onDefaultGeminiApprovalModeChange, geminiConversationMode: defaultGeminiConversationMode, onGeminiConversationModeChange: onDefaultGeminiConversationModeChange, kimiModel: defaultKimiModel, onKimiModelChange: onDefaultKimiModelChange, kimiModels, kimiApprovalMode: defaultKimiApprovalMode, onKimiApprovalModeChange: onDefaultKimiApprovalModeChange, onMessagesChange, onTurnComplete, onClaudeSessionId, onGeminiSessionId, onKimiSessionId, onCodexSessionId, activeFilePath, onFileOpen, isActive, isStreaming = false, awaitingQuestion = false, initialDraft, onDraftChange, initialContextItems, onContextItemsChange, sessionId, sendTextRef, terminalTabs = [], onSlashCommandsUpdate, claudeScope = 'chat', onOpenMcpPanel, renderToolCall, activeMetaRuntime, mentionInsertRef: mentionInsertRefProp, waiting = null, followUp = null, onDismissFollowUp, liveBackgroundTaskCount, onToggleBackgroundTasks, backgroundTasksOpen, taskUiEnabled = false, backgroundTasks, onStopBackgroundTask, claudeSessionId }: ChatPanelProps) {
  // The chat renders from the durable main-process log (useChatLog): every
  // provider stamps the chat id as scope; the legacy 'chat' scope stands for
  // the session main binds it to (bindLegacyScope below).
  const chatId = claudeScope !== 'chat' ? claudeScope : (sessionId ?? null);
  const fallbackSettings = useMemo<ChatSettings>(() => ({ provider: aiProvider }), [aiProvider]);
  const { state: logState, lastApplied, error: logError } = useChatLog(chatId, fallbackSettings);

  // Composer settings are the chat's own (state.settings in main's log, shared
  // with the phone). The parent's values are the workspace defaults: they fill
  // what the chat never set and seed a new chat's first settings_changed.
  const workspaceDefaults = useMemo<ChatSettings>(() => {
    const base: ChatSettings = aiProvider === 'codex'
      ? {
        provider: 'codex', model: defaultCodexModel, permMode: defaultCodexPermission,
        effort: normalizeCodexEffort(defaultCodexEffort ?? 'high', codexModels.find(m => m.id === defaultCodexModel)),
      }
      : aiProvider === 'gemini'
        ? { provider: 'gemini', model: defaultGeminiModel, approvalMode: defaultGeminiApprovalMode, conversationMode: defaultGeminiConversationMode }
        : aiProvider === 'kimi'
          ? { provider: 'kimi', model: defaultKimiModel, approvalMode: defaultKimiApprovalMode }
          : { provider: 'claude', model: defaultModelChoice, permMode: defaultPermissionMode, effort: defaultEffortLevel };
    for (const k of Object.keys(base) as Array<keyof ChatSettings>) if (base[k] === undefined) delete base[k];
    return base;
  }, [aiProvider, defaultCodexModel, defaultCodexPermission, defaultCodexEffort, codexModels, defaultGeminiModel, defaultGeminiApprovalMode, defaultGeminiConversationMode, defaultKimiModel, defaultKimiApprovalMode, defaultModelChoice, defaultPermissionMode, defaultEffortLevel]);
  const chatSettings = useMemo(() => effectiveChatSettings(logState?.settings, workspaceDefaults), [logState?.settings, workspaceDefaults]);
  const settingsFor = (p: ChatSettings['provider']) => (aiProvider === p ? chatSettings : null);
  const permissionMode = (settingsFor('claude')?.permMode ?? defaultPermissionMode) as ChatPanelProps['permissionMode'];
  const effortLevel = (settingsFor('claude')?.effort ?? defaultEffortLevel) as ChatPanelProps['effortLevel'];
  const modelChoice = (settingsFor('claude')?.model ?? defaultModelChoice) as ChatPanelProps['modelChoice'];
  const codexModel = settingsFor('codex')?.model ?? defaultCodexModel;
  const codexPermission = (settingsFor('codex')?.permMode ?? defaultCodexPermission) as CodexPermission;
  const codexEffort = (settingsFor('codex')?.effort ?? defaultCodexEffort) as CodexEffort | undefined;
  const geminiModel = settingsFor('gemini')?.model ?? defaultGeminiModel;
  const geminiApprovalMode = (settingsFor('gemini')?.approvalMode ?? defaultGeminiApprovalMode) as ChatPanelProps['geminiApprovalMode'];
  const geminiConversationMode = (settingsFor('gemini')?.conversationMode ?? defaultGeminiConversationMode) as ChatPanelProps['geminiConversationMode'];
  const kimiModel = settingsFor('kimi')?.model ?? defaultKimiModel;
  const kimiApprovalMode = (settingsFor('kimi')?.approvalMode ?? defaultKimiApprovalMode) as ChatPanelProps['kimiApprovalMode'];
  // The override dot marks a chat that runs off the workspace default, whatever set it.
  const claudeOverrideState = workspaceOverrideState && {
    ...workspaceOverrideState,
    modelOverridden: workspaceOverrideState.modelOverridden || modelChoice !== defaultModelChoice,
    effortOverridden: workspaceOverrideState.effortOverridden || effortLevel !== defaultEffortLevel,
  };
  // The message queue is the chat's, in main's log; the strip shows it as-is.
  const logQueue = logState?.queue;
  const messageQueue = useMemo<QueuedMessage[]>(() => (logQueue ?? []).map(q => ({
    id: q.clientId, text: q.label ?? q.text, fullText: q.text,
    ...(q.images?.length ? { images: q.images, attachments: { images: q.images.length, files: 0, terminal: false } } : {}),
  })), [logQueue]);
  const settingsSeedRef = useRef<() => Partial<ChatSettings> | null>(() => null);
  settingsSeedRef.current = () => settingsSeed(logState?.settings, workspaceDefaults);

  const chatIdRef = useRef(chatId);
  chatIdRef.current = chatId;
  useEffect(() => {
    if (claudeScope === 'chat' && projectPath && sessionId) {
      void window.sai.chatlog?.bindLegacyScope(projectPath, sessionId);
    }
  }, [claudeScope, projectPath, sessionId]);
  const logMessages = logState?.messages ?? EMPTY_MESSAGES;
  const historyLoaded = !chatId || logState != null;
  // Persist task tags on first arrival (display-only): the log never carries
  // them, so stamps are kept per item and re-applied to every new list.
  const tagStampsRef = useRef<{ prev: ChatMessageType[]; stamps: Map<string, string | null> }>({ prev: [], stamps: new Map() });
  const messages = useMemo(() => {
    if (!taskUiEnabled) return logMessages;
    const memo = tagStampsRef.current;
    const carried = applyTaskStamps(logMessages, memo.stamps);
    const next = stampTaskTags(memo.prev, carried);
    recordTaskStamps(next, memo.stamps);
    memo.prev = next;
    return next;
  }, [logMessages, taskUiEnabled]);
  // Anything present when the history first loads is history, not a fresh
  // arrival — a workspace/chat swap must never replay typing/reveal
  // animations for it. (A reply still streaming keeps going live; see
  // StreamingAssistantHead's liveShown seeding.)
  const revealedForRef = useRef<string | null | undefined>(undefined);
  if (logState && revealedForRef.current !== chatId) {
    revealedForRef.current = chatId;
    for (const m of logState.messages) {
      if (m.role === 'assistant' && m.content) markRevealed(m.id);
    }
  }
  const taskRegistry = useMemo(() => buildTaskRegistry(messages), [messages]);
  // Latest rendered list, for callbacks that must not re-subscribe per message.
  const messagesRef = useRef<ChatMessageType[]>(messages);
  messagesRef.current = messages;
  // "Newest" model card = the last sai_render_model call in this chat. Read from
  // the ref at card-render time (only matters at card mount: it decides
  // who claims the single live WebGL viewer), so the wrapper stays stable and
  // doesn't invalidate memoized ChatMessages.
  const renderToolCallRef = useRef(renderToolCall);
  renderToolCallRef.current = renderToolCall;
  const renderToolCallWrapped = useMemo<ChatPanelProps['renderToolCall']>(() => (renderToolCall ? (tc, expanded, seedGrow) => {
    let isNewestModel = false;
    if ((tc.name || '').endsWith('sai_render_model')) {
      outer: for (let i = messagesRef.current.length - 1; i >= 0; i--) {
        const tcs = messagesRef.current[i].toolCalls;
        if (!tcs) continue;
        for (let j = tcs.length - 1; j >= 0; j--) {
          if ((tcs[j].name || '').endsWith('sai_render_model')) {
            // Position-based: the last model call in the list, matched by object
            // reference (tc.id restarts per turn / may be absent).
            const last = tcs[j];
            isNewestModel = last === tc || (last.startedAt != null && last.startedAt === tc.startedAt && last.input === tc.input);
            break outer;
          }
        }
      }
    }
    return renderToolCallRef.current?.(tc, expanded, seedGrow, { isNewestModel }) ?? null;
  } : undefined), [!!renderToolCall]);

  // Stream-idle gate for the in-flight last assistant bubble. While true, the
  // bubble renders as plain text; flips to true (settled) when no delta has
  // arrived for STREAM_IDLE_MS, letting markdown/highlight render mid-turn
  // instead of waiting for end-of-turn.
  const STREAM_IDLE_MS = 250;
  const [streamSettled, setStreamSettled] = useState(true);
  // Post-settle hold: set at each text-settle edge, auto-cleared shortly after
  // (or at the next turn boundary). While held, the pending tail row stays
  // hidden — the settle of the FINAL reply is normally followed within ~1s by
  // the turn's result frame, and remounting a thinking row under a finished
  // reply for that wrap-up gap read as "still thinking" after the response was
  // done. A genuine mid-turn pause (model composing its next tool call)
  // outlives the hold and gets its row back.
  const SETTLE_HOLD_MS = 800;
  const [postSettleHold, setPostSettleHold] = useState(false);
  useEffect(() => {
    if (!postSettleHold) return;
    const t = window.setTimeout(() => setPostSettleHold(false), SETTLE_HOLD_MS);
    return () => window.clearTimeout(t);
  }, [postSettleHold]);
  // Transcript-side live state comes from the log; only the SDK login hint is
  // panel-local (auth_status is not a transcript event).
  const [authHint, setAuthHint] = useState<string | null>(null);
  const streamHint = logState?.streamHint ?? authHint;
  const promptSuggestionFromLog = logState?.promptSuggestion ?? null;
  // The chip's ×: hides this suggestion until the log offers another one.
  const [dismissedSuggestion, setDismissedSuggestion] = useState<string | null>(null);
  const promptSuggestion = promptSuggestionFromLog && promptSuggestionFromLog !== dismissedSuggestion ? promptSuggestionFromLog : null;
  const activeSubagents = useMemo(
    () => new Map(Object.entries(logState?.activeSubagents ?? {}).map(([id, a]) => [id, a.summary])),
    [logState?.activeSubagents],
  );
  const saiAnimationEnabled = useSaiAnimationPref();
  const streamIdleTimerRef = useRef<number | null>(null);
  // Mark the assistant bubble as actively streaming and (re)arm the idle timer
  // so markdown renders mid-turn on a pause and the thinking head stays in its
  // thinking phase.
  const markStreamingActive = useCallback(() => {
    setStreamSettled(s => s ? false : s);
    // Drop while streaming so the settle below is always a fresh
    // false→true edge (re-arming the hold effect's timer).
    setPostSettleHold(h => h ? false : h);
    if (streamIdleTimerRef.current != null) clearTimeout(streamIdleTimerRef.current);
    streamIdleTimerRef.current = window.setTimeout(() => {
      streamIdleTimerRef.current = null;
      setStreamSettled(true);
      setPostSettleHold(true);
    }, STREAM_IDLE_MS);
  }, []);
  useEffect(() => () => {
    if (streamIdleTimerRef.current != null) clearTimeout(streamIdleTimerRef.current);
  }, []);
  const emptyPrompt = useMemo(() => EMPTY_PROMPTS[Math.floor(Math.random() * EMPTY_PROMPTS.length)], []);
  // The turn's first message index (null between turns) — the reducer owns it.
  const turnStartIndex = logState?.turn.startIndex ?? null;
  // Height collapse/grow for the tail thinking rows: a tween, not a spring —
  // overshoot on height reads as a bounce of the whole transcript tail.
  const rowTransition = useReducedMotionTransition({ duration: 0.22, ease: EASING.out });
  // Fresh AnimatePresence key per appearance of the tail rows. Re-entering with
  // the key of a previously-exited child can resurrect its exit state (stuck at
  // height 0 / opacity 0 — an invisible thinking row on the next turn); a new
  // key guarantees a clean enter animation every time.
  const rowSeqRef = useRef(0);
  const prevRowShownRef = useRef(false);
  const dockTransition = useReducedMotionTransition(SPRING.dock);
  const followBtnTransition = useReducedMotionTransition(SPRING.flick);
  const [ready, setReady] = useState(false);
  // True from the moment a queued follow-up is shifted for sending until the new
  // turn's `streaming_start` arrives. Bridges the gap where the prior turn's
  // `done` has flipped isStreaming false but the next turn hasn't begun, so the
  // Stop button and thinking animation don't flicker back to "idle" mid-handoff.
  const [drainInFlight, setDrainInFlight] = useState(false);
  const drainBackstopRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  /** Main is draining the next queued item: hold the Stop button until its turn starts (8s backstop). */
  const bridgeDrain = useCallback((on: boolean) => {
    if (drainBackstopRef.current) { clearTimeout(drainBackstopRef.current); drainBackstopRef.current = null; }
    setDrainInFlight(on);
    if (on) {
      drainBackstopRef.current = setTimeout(() => {
        drainBackstopRef.current = null;
        setDrainInFlight(false);
      }, 8000);
    }
  }, []);
  const [slashCommands, setSlashCommands] = useState<SlashCommandInfo[]>([]);
  const slashCommandsRef = useRef<SlashCommandInfo[]>([]);
  /** Single ingest point for every slash-command source (start cache, init
   *  frame, commands_changed, on-demand refresh). `keepDescriptions` is for
   *  the names-only init frame, which must not wipe descriptions a structured
   *  source already supplied. */
  const applySlashCommands = useCallback((input: unknown, opts?: { keepDescriptions?: boolean }) => {
    const incoming = normalizeSlashCommands(input);
    if (incoming.length === 0) return;
    const byName = new Map(slashCommandsRef.current.map(c => [c.name, c]));
    const next = opts?.keepDescriptions
      ? incoming.map(c => {
          const prev = byName.get(c.name);
          return prev ? { ...prev, ...c, description: c.description || prev.description } : c;
        })
      : incoming;
    slashCommandsRef.current = next;
    setSlashCommands(next);
    onSlashCommandsUpdate?.(next);
  }, [onSlashCommandsUpdate]);
  /** Throttle for the composer's on-demand refresh (fires per slash token). */
  const lastSlashRefreshRef = useRef(0);
  const refreshSlashCommands = useCallback(() => {
    if (aiProvider !== 'claude' || !projectPath) return;
    const now = Date.now();
    if (now - lastSlashRefreshRef.current < 5000) return;
    lastSlashRefreshRef.current = now;
    const pending = (window.sai as any).claudeRefreshSlashCommands?.(projectPath, claudeScope);
    if (!pending?.then) return;
    pending
      .then((cmds: unknown) => applySlashCommands(cmds))
      .catch(() => { /* backend unavailable — cached list stands */ });
  }, [aiProvider, projectPath, claudeScope, applySlashCommands]);
  // Pending prompts come from the log. A local dismissal hides a card the
  // user already answered until its resolution event lands in the log (and
  // keeps a stale request from flashing back on a late re-render).
  const [dismissedPrompts, setDismissedPrompts] = useState<ReadonlySet<string>>(() => new Set());
  const dismissPrompt = useCallback((key: string) => {
    setDismissedPrompts(prev => (prev.has(key) ? prev : new Set(prev).add(key)));
  }, []);
  useEffect(() => {
    setDismissedPrompts(prev => (prev.size === 0 ? prev : new Set()));
    setDismissedSuggestion(null);
  }, [chatId]);
  const approvalKey = (a: PendingApproval) => `approval:${a.requestHandle ?? a.toolUseId}`;
  const logApproval = logState?.pendingApproval ?? null;
  const pendingApproval: PendingApproval | null = logApproval && !dismissedPrompts.has(approvalKey(logApproval)) ? logApproval : null;
  const logUserInput = logState?.pendingCodexUserInput ?? null;
  const pendingCodexUserInput: PendingCodexUserInput | null = logUserInput && !dismissedPrompts.has(`input:${logUserInput.requestHandle}`) ? logUserInput : null;
  const logElicitation = logState?.pendingCodexMcpElicitation ?? null;
  const pendingCodexMcpElicitation: PendingCodexMcpElicitation | null = logElicitation && !dismissedPrompts.has(`elicit:${logElicitation.requestHandle}`) ? logElicitation : null;
  // A logged sudo prompt only counts while the broker still holds it: the
  // broker's prompts die with the app (and time out), the log's copy does not.
  const logSudo = logState?.pendingSudo ?? null;
  const logSudoId = logSudo?.promptId ?? null;
  useEffect(() => {
    if (!logSudoId) return;
    let cancelled = false;
    const check = (window.sai as any).claudeSudoPending;
    if (typeof check !== 'function') return;
    void Promise.resolve(check(projectPath, claudeScope)).then((p: { promptId?: string } | null) => {
      if (!cancelled && p?.promptId !== logSudoId) dismissPrompt(`sudo:${logSudoId}`);
    }).catch(() => {});
    return () => { cancelled = true; };
  }, [logSudoId, projectPath, claudeScope, dismissPrompt]);
  const pendingSudoPrompt: PendingSudoPrompt | null = logSudo && !dismissedPrompts.has(`sudo:${logSudo.promptId}`) ? logSudo : null;
  const [fileContextEnabled, setFileContextEnabled] = useState(true);
  // Provider-neutral telemetry state. Null/empty until a provider actually
  // reports real numbers — never seed Claude-shaped defaults for Codex/Gemini,
  // and never let one provider's data leak into another provider's chat.
  const [contextUsage, setContextUsage] = useState<ContextUsageView | null>(null);
  const [sessionUsage, setSessionUsage] = useState<{ inputTokens: number; outputTokens: number } | null>(null);
  const [sessionCost, setSessionCost] = useState(0);
  const [autoCompactThreshold, setAutoCompactThreshold] = useState(0); // 0 = off
  const [toolCallsExpanded, setToolCallsExpanded] = useState(true);
  const autoCompactCooldownRef = useRef(0); // timestamp — don't re-compact until after this
  const [claudeRateLimits, setClaudeRateLimits] = useState<Map<string, ClaudeRateLimitRecord>>(new Map());
  const [codexUsageLimits, setCodexUsageLimits] = useState<UsageLimitView[]>([]);
  const usageLimits = useMemo(
    () => aiProvider === 'claude' ? claudeRateLimitsToViews(claudeRateLimits) : codexUsageLimits,
    [aiProvider, claudeRateLimits, codexUsageLimits],
  );
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
  const [renderStart, setRenderStart] = useState(0);
  // Start the window at the tail the moment history first loads, so the
  // first render doesn't mount the entire history before the effect runs.
  const windowedForRef = useRef<string | null | undefined>(undefined);
  if (logState && windowedForRef.current !== chatId) {
    windowedForRef.current = chatId;
    const tail = logState.messages.length > RENDER_CHUNK ? logState.messages.length - RENDER_CHUNK : 0;
    if (tail !== renderStart) setRenderStart(tail);
  }
  const sentinelRef = useRef<HTMLDivElement>(null);
  // True while a user-initiated "jump to message" smooth scroll is in flight.
  // The load-more sentinel must not rewrite scrollTop during this window or it
  // cancels the smooth scroll (the jump appears to do nothing). pendingJumpRef
  // holds a target id when we had to expand the window to mount it first.
  const jumpingRef = useRef(false);
  const pendingJumpRef = useRef<string | null>(null);
  const pendingComposerRectRef = useRef<DOMRect | null>(null);
  const localMentionInsertRef = useRef<((linkName: string) => void) | null>(null);
  const draftRestoreRef = useRef<((text: string) => void) | null>(null);
  const mentionInsertRef = mentionInsertRefProp ?? localMentionInsertRef;

  // Task tabs (display-only). The hook is a no-op when disabled.
  const [openTaskId, setOpenTaskId] = useState<string | null>(null);
  const taskBoard = useTaskBoard({
    enabled: taskUiEnabled, messages, claudeSessionId, backgroundTasks, isStreaming, awaitingQuestion,
    pendingApprovalToolUseId: pendingApproval?.toolUseId ?? null,
  });
  // Tabs, chips and the tab bar exist only for tasks the model declared; runtime
  // (bg shells, undeclared agents) and TodoWrite fallback cards never make tabs.
  const allCards = taskBoard.board.cards;
  const taskCards = useMemo(() => allCards.filter(c => c.source === 'declared'), [allCards]);
  const tabBoard = useMemo(() => ({ ...taskBoard.board, cards: taskCards, allDone: taskCards.every(c => c.status === 'done' || c.status === 'failed') }), [taskBoard.board, taskCards]);
  const showTaskUi = taskUiEnabled && taskCards.length > 0;
  // Task chips in All (display-only): above the first message of each task run.
  // "Tag messages with their task" setting: every reply and tool call gets its
  // own chip, which replaces the run-boundary chips above.
  const tagEveryItem = useTaskTagsPref();
  const chipBefore = useMemo(
    () => (showTaskUi && !tagEveryItem ? taskChips(messages, taskCards, taskBoard.tags) : NO_CHIPS),
    [showTaskUi, tagEveryItem, messages, taskCards, taskBoard.tags],
  );
  const labelsByMessage = useMemo(
    () => (showTaskUi && tagEveryItem ? taskLabels(messages, taskCards, taskBoard.tags) : NO_LABELS),
    [showTaskUi, tagEveryItem, messages, taskCards, taskBoard.tags],
  );
  const openTaskCard = openTaskId ? taskCards.find(c => c.id === openTaskId) ?? null : null;
  // The tabs live in the host's Chat accordion bar rather than a bar of their
  // own. Only the visible panel claims the slot — background workspaces keep
  // their ChatPanel mounted and would otherwise portal their tabs over ours.
  const wantsBarSlot = showTaskUi;
  const [tabsSlot, setTabsSlot] = useState<HTMLElement | null>(null);
  useLayoutEffect(() => {
    setTabsSlot(wantsBarSlot && isActive === true ? document.getElementById(TASK_TABS_SLOT_ID) : null);
  }, [wantsBarSlot, isActive]);
  useEffect(() => { setOpenTaskId(null); }, [sessionId]);
  useEffect(() => {
    if (openTaskId && !openTaskCard) setOpenTaskId(null);
  }, [openTaskId, openTaskCard]);
  // A new batch may reuse ids: never let the open tab jump to the new task.
  const batchStartedAt = taskBoard.board.batchStartedAt;
  useEffect(() => { setOpenTaskId(null); }, [batchStartedAt]);
  // The message list is display:none while a stream is open, which drops its
  // scroll offset; remember it on open and put it back on return.
  const listScrollRef = useRef<number | null>(null);
  const openTaskStream = useCallback((id: string | null) => {
    if (id && listScrollRef.current === null) listScrollRef.current = chatContainerRef.current?.scrollTop ?? null;
    setOpenTaskId(id);
  }, []);
  const streamOpen = !!openTaskCard;
  useLayoutEffect(() => {
    if (streamOpen) return;
    const el = chatContainerRef.current;
    const saved = listScrollRef.current;
    listScrollRef.current = null;
    if (el && saved !== null && !isAtBottomRef.current) el.scrollTop = saved;
  }, [streamOpen]);

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
    if (aiProvider !== 'claude' || !autoCompactThreshold || !contextUsage?.used || !contextUsage.total) return;
    if (isStreaming) return; // don't compact mid-turn
    const pct = contextUsage.used / contextUsage.total;
    if (pct < autoCompactThreshold / 100) return;
    if (Date.now() < autoCompactCooldownRef.current) return;
    // Trigger compact and set 60s cooldown
    autoCompactCooldownRef.current = Date.now() + 60_000;
    window.sai.claudeCompact(projectPath, permissionMode, effortLevel, modelChoice, claudeScope);
  }, [contextUsage, isStreaming]);

  // Refs mirroring the latest Codex model selection so the long-lived message
  // handler effect below can read the current catalog entry without needing
  // to resubscribe (and potentially drop buffered frames) every time the
  // model list or selection changes.
  const codexModelRef = useRef(codexModel);
  useEffect(() => { codexModelRef.current = codexModel; }, [codexModel]);
  const codexModelsRef = useRef(codexModels);
  useEffect(() => { codexModelsRef.current = codexModels; }, [codexModels]);

  // Last applied snapshot's fetchedAt — guards against the forced post-turn
  // codexUsageFetch(true) racing the 60s poll and letting a late-resolving
  // OLDER snapshot clobber fresher data already applied.
  const lastAppliedCodexFetchedAtRef = useRef(0);
  // Applies a Codex rate-limit snapshot to isolated Codex-only state. Never
  // touches claudeRateLimits — Codex and Claude limits are never shared.
  const applyCodexLimits = useCallback((snapshot: CodexRateLimitsSnapshot | null) => {
    if (snapshot?.provider === 'codex') {
      if (snapshot.fetchedAt < lastAppliedCodexFetchedAtRef.current) return;
      lastAppliedCodexFetchedAtRef.current = snapshot.fetchedAt;
      setCodexUsageLimits(codexRateLimitsToViews(snapshot));
    }
  }, []);

  useEffect(() => {
    setReady(false);
    const startFn = aiProvider === 'gemini' ? (window.sai as any).geminiStart
      : aiProvider === 'kimi' ? (window.sai as any).kimiStart
      : aiProvider === 'codex' ? window.sai.codexStart : window.sai.claudeStart;
    const metaPreamble = buildMetaPreamble(activeMetaRuntime ? {
      name: activeMetaRuntime.meta.name,
      syntheticRoot: activeMetaRuntime.syntheticRoot,
      projects: activeMetaRuntime.projects,
    } : null);
    const startArgs: any[] = aiProvider === 'claude' || aiProvider === 'codex'
      ? [projectPath || '', claudeScope, undefined /* scopeCwd */, metaPreamble, aiProvider === 'codex' && activeMetaRuntime
        ? [...new Set(activeMetaRuntime.projects.filter(project => project.status === 'ok' && project.path.trim()).map(project => project.path))]
        : undefined]
      : [projectPath || '', metaPreamble];
    startFn(...startArgs).then((result: any) => {
      setReady(true);
      if (result?.slashCommands?.length) applySlashCommands(result.slashCommands);

      // One-shot brainstorm seed consumption. Server-side read+delete avoids
      // the renderer ever calling fs:readFile on a missing path (which would
      // log a noisy ENOENT in the main process). The seed goes through the
      // chat's send command so the user sees it as their first message.
      if (aiProvider === 'claude' && projectPath && !consumedBrainstormSeeds.has(projectPath)) {
        consumedBrainstormSeeds.add(projectPath);
        (window.sai as any).brainstormConsumeSeed(projectPath).then((r: { ok: boolean; content?: string }) => {
          if (!r?.ok || !r.content) return;
          const seedContent = r.content.trim();
          if (!seedContent) return;
          void sendToLogRef.current(seedContent, { clientId: newClientId() });
        }).catch(() => { /* ignore */ });
      }
    });

    // Side effects only: transcript content (messages, pending prompts,
    // streaming state, subagents, hints) is rendered from the chat log.
    const onMessage = (msg: any) => {
      // Load-guard cards are transcript content (logged); nothing to do here.
      if (msg.type === 'load_guard') return;
      // Only process messages for this workspace and chat scope.
      // Every provider uses the chat id as scope, so parallel sessions cannot
      // consume each other's events.
      if (msg.projectPath && msg.projectPath !== projectPath) return;
      // Commands dispatch with the chat id as scope, so a legacy 'chat' panel
      // also owns events stamped with its bound chat id.
      if (msg.scope && msg.scope !== claudeScope && msg.scope !== chatIdRef.current) return;

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
        } else if (aiProvider === 'kimi') {
          onKimiSessionId?.(msg.sessionId);
        }
        return;
      }

      if (msg.type === 'streaming_start' || msg.type === 'done') {
        setAuthHint(null);
        return;
      }

      if (msg.type === 'process_exit') {
        setReady(false);
        setAuthHint(null);
        return;
      }

      // Mid-session slash-command changes (dynamically discovered skills).
      if (msg.type === 'system' && msg.subtype === 'commands_changed' && Array.isArray(msg.commands)) {
        // REPLACE, not merge: supportedCommands() is captured at initialize and
        // never revised, so this frame is the whole truth about the list.
        applySlashCommands(msg.commands);
        return;
      }

      // Login flow in progress on the SDK subprocess.
      if (msg.type === 'auth_status') {
        setAuthHint(msg.isAuthenticating ? 'authenticating…' : null);
        return;
      }

      // Authoritative context accounting from the runtime (getContextUsage) —
      // replaces the usage-sum estimate computed from result frames.
      if (aiProvider === 'claude' && msg.type === 'context_usage') {
        if (typeof msg.totalTokens === 'number' && typeof msg.maxTokens === 'number' && msg.maxTokens > 0) {
          setContextUsage(prev => prev
            ? { ...prev, used: msg.totalTokens, total: msg.maxTokens }
            : { used: msg.totalTokens, total: msg.maxTokens, inputTokens: 0, cachedInputTokens: 0, cacheCreationTokens: 0, outputTokens: 0 });
        }
        return;
      }

      // Capture slash commands from init
      if (msg.type === 'system' && msg.subtype === 'init' && msg.slash_commands) {
        // Names only. Keep any descriptions a supportedCommands() refresh
        // already recorded for the same names — mirrors the main-process cache.
        applySlashCommands(msg.slash_commands, { keepDescriptions: true });
        return;
      }

      // Capture rate limit info (may receive multiple: daily, weekly, etc.)
      // CLI events are supplementary — only update utilization when the
      // authoritative OAuth API data is stale (>60 s) or absent.
      if (aiProvider === 'claude' && msg.type === 'rate_limit_event' && msg.rate_limit_info) {
        const info = msg.rate_limit_info;
        const key = info.rateLimitType || 'unknown';
        setClaudeRateLimits(prev => {
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

      // Result — usage data processing (the transcript side lives in the reducer).
      if (msg.type === 'result') {
        if (msg.usage && aiProvider === 'codex') {
          // Codex: prefer the static catalog's context window (from the model
          // picker's metadata) but let an explicit, smaller runtime-reported
          // window win — the SDK sometimes narrows the effective window mid
          // session. Never fall back to a fake 1M default: absent both a
          // catalog entry and a runtime value, total stays null so ChatInput
          // renders no ring rather than a bogus one.
          const catalogWindow = codexModelsRef.current.find((model) => model.id === codexModelRef.current)?.effectiveContextWindow;
          const runtimeWindow = Object.values(msg.modelUsage ?? {})
            .map((value: any) => value?.contextWindow)
            .find((value): value is number => typeof value === 'number' && value > 0);
          const view = contextUsageFromCodex(
            msg.usage,
            resolveEffectiveContextWindow(catalogWindow, runtimeWindow),
          );
          setContextUsage(view);
          setSessionUsage(previous => ({
            inputTokens: (previous?.inputTokens ?? 0) + view.inputTokens,
            outputTokens: (previous?.outputTokens ?? 0) + view.outputTokens,
          }));
          // A completed Codex turn is the most reliable moment to refresh the
          // account-level rate limits — force past the service's cache.
          void window.sai.codexUsageFetch?.(true).then(applyCodexLimits).catch(() => {});
        } else if (aiProvider === 'claude' && msg.usage) {
          const inputTokens = msg.usage.input_tokens || 0;
          const cachedInputTokens = msg.usage.cache_read_input_tokens || 0;
          const cacheCreationTokens = msg.usage.cache_creation_input_tokens || 0;
          const outputTokens = msg.usage.output_tokens || 0;
          const used = inputTokens + cachedInputTokens + cacheCreationTokens + outputTokens;
          // Use the CLI-reported context window, but fall back to known model sizes
          // since the CLI may report incorrect values (e.g., 200K for 1M-context models)
          const modelUsage = msg.modelUsage || {};
          const modelKey = Object.keys(modelUsage)[0];
          let total = modelKey ? modelUsage[modelKey].contextWindow || 0 : 0;
          // If reported total seems wrong (used exceeds it), use a sensible default
          if (!total || used > total) {
            total = 1000000; // Default to 1M for extended context models
          }
          setContextUsage({ used, total, inputTokens, cachedInputTokens, cacheCreationTokens, outputTokens });
          setSessionUsage(prev => ({
            inputTokens: (prev?.inputTokens ?? 0) + inputTokens + cachedInputTokens + cacheCreationTokens,
            outputTokens: (prev?.outputTokens ?? 0) + outputTokens,
          }));
        }
        // Track session cost from CLI-reported total (cumulative per session)
        if (msg.total_cost_usd != null) {
          setSessionCost(msg.total_cost_usd);
        }
      }
    };
    const cleanup = window.sai.claudeOnMessage(onMessage);

    return () => {
      cleanup();
    };
  }, [projectPath, aiProvider, activeMetaRuntime, claudeScope, applyCodexLimits]);

  // Side effects of newly applied log entries (never of loaded history): the
  // stream-idle gate, the parent's turn-end callbacks and its IndexedDB
  // mirror. lastApplied accumulates until drained here; each entry is replayed
  // through the reducer from the previous state so turn edges are judged by
  // the reducer's own turnSeq rules, never re-derived.
  const prevLogStateRef = useRef<ChatState | null>(null);
  const turnEndRef = useRef<() => void>(() => {});
  useEffect(() => {
    const drained: ChatLogEntry[] = lastApplied.current;
    lastApplied.current = [];
    const before = prevLogStateRef.current;
    prevLogStateRef.current = logState;
    if (!logState || drained.length === 0) return;
    let turnEnded = false;
    let cardAdded = false;
    if (!before) {
      // Live entries applied in the same batch as the initial history: no
      // prior state to replay from, so judge by the entries and the result.
      for (const entry of drained) {
        const ev = entry.ev as Record<string, any>;
        if (isStreamingText(ev)) markStreamingActive();
        if ((ev.type === 'done' || ev.type === 'process_exit') && !logState.turn.streaming) turnEnded = true;
        if (ev.type === 'load_guard') cardAdded = true;
      }
      if (turnEnded) turnEndRef.current();
      else if (cardAdded) flushMessagesToParentRef.current();
      return;
    }
    let s = before;
    let drainHandoff = false;
    for (const entry of drained) {
      const next = reduceChat(s, entry);
      const ev = entry.ev as Record<string, any>;
      if (ev.type === 'streaming_start') {
        // A fresh turn (or a wait-resume re-arm) must show its thinking row
        // immediately — never inherit the previous reply's post-settle hold.
        setPostSettleHold(h => h ? false : h);
      } else if (isStreamingText(ev)) {
        markStreamingActive();
      }
      if ((s.turn.streaming && !next.turn.streaming)
        || ((ev.type === 'done' || ev.type === 'process_exit') && next.turn !== s.turn)) {
        turnEnded = true;
      }
      // A command/service kill has no done of its own: persist its card now.
      if (ev.type === 'load_guard' && next.messages.length > s.messages.length) cardAdded = true;
      // Main sent a queued item whose turn hasn't started yet (async providers).
      if (ev.type === 'queue_removed' && ev.sent === true && !next.turn.streaming) drainHandoff = true;
      s = next;
    }
    // A turn ended with items waiting: main drains the next one now.
    if (turnEnded && s.queue.length > 0 && !loadPausedRef.current) drainHandoff = true;
    if (drainHandoff && !s.turn.streaming) bridgeDrain(true);
    if (turnEnded) turnEndRef.current();
    else if (cardAdded) flushMessagesToParentRef.current();
  }, [logState, chatId, lastApplied, markStreamingActive, bridgeDrain]);

  // Real utilization percentages arrive on usage:update from two sources:
  // the main-process OAuth poller (60s) and the SDK backend's post-turn
  // get_usage fetch. Both send per-window { utilization: 0-100, resets_at: ISO }.
  useEffect(() => {
    // This is Claude account telemetry (Anthropic OAuth usage), never Codex's
    // — Codex has its own isolated polling effect below. Gate strictly so a
    // Codex or Gemini chat can never pick up Claude's rate limits, even
    // though the underlying IPC channel is process-global.
    if (aiProvider !== 'claude') return;
    // five_hour → Current session; seven_day → All models; seven_day_* →
    // per-model weekly buckets (labeled "<Model> only" by ChatInput).
    const WINDOW_KEYS = ['five_hour', 'seven_day', 'seven_day_opus', 'seven_day_sonnet', 'seven_day_oauth_apps'];
    const handleUsage = (data: any) => {
      if (!data) return;
      setClaudeRateLimits(prev => {
        const next = new Map(prev);
        for (const key of WINDOW_KEYS) {
          const w = data[key];
          // null windows (SDK sends them for unprovisioned buckets) must not
          // zero a bar that has real data — skip anything non-numeric.
          if (!w || typeof w.utilization !== 'number') continue;
          const existing = next.get(key) || {
            rateLimitType: key,
            resetsAt: 0,
            status: 'unknown',
            isUsingOverage: false,
            overageResetsAt: 0,
          };
          next.set(key, {
            ...existing,
            utilization: w.utilization / 100, // API returns 0-100, we use 0-1
            ...(w.resets_at ? { resetsAt: Math.floor(new Date(w.resets_at).getTime() / 1000) } : {}),
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
  }, [aiProvider]);

  useEffect(() => {
    if (aiProvider !== 'claude') return;
    (window.sai as any).usageMode?.().then((mode: string) => {
      if (mode === 'subscription' || mode === 'api') {
        setBillingMode(mode);
      }
    });
  }, [aiProvider]);

  // Codex rate-limit telemetry: provider-scoped 60s polling of the account's
  // Codex usage windows (primary/secondary), independent of Claude's
  // onUsageUpdate subscription above. Only mounts/polls while this is a
  // Codex chat and the workspace is the active one.
  useEffect(() => {
    if (aiProvider !== 'codex' || !isActive) return;
    let cancelled = false;
    const refresh = (force = false) => window.sai.codexUsageFetch?.(force).then((snapshot: CodexRateLimitsSnapshot | null) => {
      if (!cancelled) applyCodexLimits(snapshot ?? null);
    }).catch(() => {});
    void refresh(false);
    const timer = window.setInterval(() => void refresh(false), 60_000);
    return () => { cancelled = true; window.clearInterval(timer); };
  }, [aiProvider, isActive, applyCodexLimits]);

  // On a session switch, clear the per-conversation context/session token
  // counters (they belong to the old conversation) but keep any already
  // fetched Codex account-level rate limits — those are account-wide, not
  // tied to a specific chat session.
  useEffect(() => {
    setContextUsage(null);
    setSessionUsage(null);
  }, [sessionId]);

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
    if (!last || !container) { lastUserOutOfView.current = false; setPinnedUserMessage(null); return; }
    if (!el) {
      // The message exists but isn't mounted: the render window advanced past
      // it (long AI turn pushed it out of the 50-message tail). Off-window is
      // by definition out of view — keep the header pinned; the renderStart
      // dep re-runs this when the window re-mounts it (scroll up / jump).
      lastUserOutOfView.current = true;
      setPinnedUserMessage(last);
      return;
    }
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userMessages[userMessages.length - 1]?.id, renderStart]);

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
  const subagentThinking = activeSubagents.size > 0;
  const subagentHint = useMemo(() => {
    const entries = [...activeSubagents.values()];
    if (entries.length === 0) return null;
    const more = entries.length > 1 ? ` (+${entries.length - 1} more)` : '';
    return `agent · ${entries[0]}${more}`;
  }, [activeSubagents]);
  const thinkingHint = subagentHint ?? streamHint;
  // The log's turn is authoritative for this chat (it survives remounts and
  // reloads); App's busy flag still covers the gap before the log catches up.
  const logTurnOpen = logState?.turn.streaming ?? false;
  const turnLive = isStreaming || logTurnOpen;
  // Backend-truth reconciliation for a turn only the log still holds open
  // (App's busy flag is off, so App's own 20s reconcile poll skips it): ask
  // the provider every LOG_TURN_RECONCILE_MS; an idle backend answers with an
  // unstick done(turnSeq:null), which is logged and closes the turn. Gemini
  // and Kimi have no reconciler; their Stop (interrupt) still ends the turn.
  const reconcileLogTurn = !!chatId && logTurnOpen && !isStreaming;
  useEffect(() => {
    if (!reconcileLogTurn || !chatId) return;
    const reconcile = aiProvider === 'claude' ? window.sai.claudeReconcileScope
      : aiProvider === 'codex' ? window.sai.codexReconcileScope : undefined;
    if (typeof reconcile !== 'function') return;
    const t = window.setInterval(() => {
      window.sai.devlog?.('chatPanel.reconcileLogTurn', { chatId, provider: aiProvider });
      reconcile(projectPath, chatId);
    }, LOG_TURN_RECONCILE_MS);
    return () => window.clearInterval(t);
  }, [reconcileLogTurn, chatId, aiProvider, projectPath]);
  // A turn ending with items queued keeps the Stop button up through main's
  // drain handoff (drainInFlight), not for as long as anything is queued.
  const streamingForDisplay = turnLive || drainInFlight || subagentThinking;
  useEffect(() => { if (turnLive) bridgeDrain(false); }, [turnLive, bridgeDrain]);
  const isWaiting = !!waiting && waiting.wait.kind !== 'none';
  // While waiting we are NOT thinking — suppress the thinking indicator.
  const showThinking = streamingForDisplay && !awaitingQuestion && !isWaiting;
  const isSaiProvider = true; // All providers use the SAI animation system
  const saiMorphActive = isSaiProvider && saiAnimationEnabled;
  const lastMsg = messages[messages.length - 1];
  // A segment head shows the thinking row only while it is ACTIVELY streaming text
  // (`!streamSettled`). Once it settles — text revealed, or a tool is running, or it's
  // between segments — the head goes quiet, so the trailing pending row must take over
  // to keep a thinking indicator alive while the turn continues (e.g. during a tool
  // call after a typed response). The first-text-delta no longer leaves a stale window
  // here because the slow path now clears streamSettled when it creates a text segment.
  // Entries this render applied but the side-effect pass hasn't drained yet:
  // judged here too, so the first delta's render already hides the tail row
  // (no one-frame thinking flash before the effect flips the gate).
  const undrained = lastApplied.current;
  const pendingText = undrained.some(e => isStreamingText(e.ev as Record<string, any>));
  const pendingStart = undrained.some(e => e.ev.type === 'streaming_start');
  const textSettled = streamSettled && !pendingText;
  const settleHold = postSettleHold && !pendingText && !pendingStart;
  const hasStreamingAssistantSegment = !textSettled && lastMsg?.role === 'assistant';
  // A live reasoning card is already the working signal (shimmering label, its
  // own elapsed timer) — a thinking row below it would be a duplicate spinner.
  const hasLiveReasoning = lastMsg?.role === 'assistant' && !!lastMsg.reasoningLive;
  // Same rule for a running tool: its card shimmers with a pulsing badge, so the
  // tail row yields to it. An active native subagent is separate concurrent work,
  // however, so keep the row visible with its agent hint in that case.
  const hasRunningTailTool = lastMsg?.role === 'assistant' && !!lastMsg.toolCalls?.some(tc => tc.output == null);
  // SAI morph path: only a pending tail row when no segment head is actively thinking.
  // postSettleHold keeps it hidden for a beat right after text settles, so the
  // end-of-turn wrap-up (result frame in flight) doesn't flash a thinking row
  // under a reply the user just watched finish.
  const showPendingSaiThinking = showThinking && saiMorphActive && !hasStreamingAssistantSegment
    && !hasLiveReasoning && (!hasRunningTailTool || subagentThinking) && (!settleHold || subagentThinking);
  // Detached banner: non-SAI providers, OR SAI with the animation pref off (today's
  // fallback). No grow-in here, so it only yields to the reasoning card, keeping the
  // legacy always-on banner during tool runs.
  const showDetachedBanner = showThinking && !saiMorphActive && !hasLiveReasoning;
  // The message whose newborn card (live reasoning / running tool) replaces the
  // row this commit — that card mounts with the grow-in entry.
  const seedGrowMsgId = saiMorphActive && streamingForDisplay && (hasLiveReasoning || hasRunningTailTool)
    ? lastMsg?.id : undefined;
  // Bump the row key on each hidden→shown edge (see rowSeqRef above).
  const rowShown = showPendingSaiThinking || showDetachedBanner;
  if (rowShown && !prevRowShownRef.current) rowSeqRef.current++;
  prevRowShownRef.current = rowShown;
  const hasHiddenMessages = renderStart > 0;

  // The parent mirrors the chat into IndexedDB (session rows, search, export,
  // titles) — always from log state, never the other way round.
  // Before history loads this hands [] (never a previous chat's list).
  useEffect(() => {
    onMessagesChange?.(messages);
  }, [messages]);

  // Persistable log state (live reasoning collapsed, live tool output
  // settled) for the mirror — at turn end, on unmount, and for a kill card.
  const flushMessagesToParent = useCallback(() => {
    if (!historyLoaded) return;
    const base = logState ?? prevLogStateRef.current;
    if (!base) return;
    onMessagesChange?.(persistableState({ ...base, messages: messagesRef.current }).messages);
  }, [onMessagesChange, historyLoaded, logState]);
  const flushMessagesToParentRef = useRef(flushMessagesToParent);
  flushMessagesToParentRef.current = flushMessagesToParent;
  turnEndRef.current = () => { flushMessagesToParent(); onTurnComplete?.(); };

  // Unmount flush: a hidden panel can unmount between a turn's result (which
  // clears the workspace's busy flag) and its done. Hand App the latest
  // rendered state on the way out; anything still in flight is in the log,
  // and App mirrors a background chat's turn end from there.
  useEffect(() => () => flushMessagesToParentRef.current(), []);

  // GitHubWatcherCard dispatches a snapshot event on phase transitions. We attach
  // the snapshot to the owning message so it persists with chat history and cards
  // resume from their last-known state when the chat is reopened.
  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent<{ messageId: string; snapshot: import('../../types').GitHubWatcherSnapshot }>).detail;
      if (!detail?.messageId || !detail.snapshot || !chatId) return;
      // Only the chat that owns the message records it; the reducer skips an unchanged phase.
      if (!messagesRef.current.some(m => m.id === detail.messageId)) return;
      const prior = messagesRef.current.find(m => m.id === detail.messageId)?.githubWatchers?.find(w => w.url === detail.snapshot.url);
      if (prior && prior.phase === detail.snapshot.phase) return;
      void window.sai.chatlog?.appendClient(chatId, { type: 'watcher_snapshot', messageId: detail.messageId, snapshot: detail.snapshot })
        .catch(() => { /* chat not logged (yet): the card re-dispatches on its next phase */ });
    };
    window.addEventListener('sai-github-watcher-snapshot', handler);
    return () => window.removeEventListener('sai-github-watcher-snapshot', handler);
  }, [chatId]);

  // ─── Commands: every send, answer, approval and stop goes through main's
  // idempotent chat command path (which logs and dispatches), never straight
  // to a provider.
  type ChatCommandInput = Parameters<NonNullable<typeof window.sai.chatlog>['command']>[0];
  const runCommand = useCallback(async (cmd: ChatCommandInput) => {
    const api = window.sai.chatlog;
    if (!api) throw new Error('chat log unavailable');
    const res = await api.command(cmd);
    if (!res?.ok) {
      window.sai.devlog?.('chatPanel.commandFailed', { kind: cmd.kind, chatId: cmd.chatId, error: res?.error ?? null });
      throw new Error(res?.error ?? `${cmd.kind} failed`);
    }
    return res;
  }, []);

  /**
   * The pickers write the chat's settings in main's log (one command per
   * change; a chat with gaps is seeded from the workspace defaults first). The
   * parent's handler still runs, so the pick also becomes the workspace
   * preference new chats start from.
   */
  const updateChatSettings = useCallback((patch: Partial<ChatSettings>) => {
    if (!chatId || !projectPath) return;
    const seed = settingsSeedRef.current();
    void runCommand({
      kind: 'settings', chatId, clientId: newClientId(), settings: { ...(seed ?? {}), ...patch }, origin: 'desktop',
      // Creates the chat in the log if this is its first entry (settled only
      // once its IndexedDB history is known to be in the log).
      projectPath, settled: isChatImported(chatId),
    }).catch(() => { /* devlogged */ });
  }, [chatId, projectPath, runCommand]);
  const onPermissionChange = (mode: ChatPanelProps['permissionMode']) => {
    onDefaultPermissionChange(mode);
    updateChatSettings({ permMode: mode });
  };
  const onEffortChange = (level: ChatPanelProps['effortLevel'] | null) => {
    onDefaultEffortChange(level);
    // null = follow the app-wide default.
    updateChatSettings({ effort: level ?? workspaceOverrideState?.globalEffort ?? defaultEffortLevel });
  };
  const onModelChange = (model: ChatPanelProps['modelChoice'] | null) => {
    onDefaultModelChange(model);
    updateChatSettings({ model: model ?? workspaceOverrideState?.globalModel ?? defaultModelChoice });
  };
  const onCodexModelChange = (model: string) => {
    onDefaultCodexModelChange(model);
    const effort = normalizeCodexEffort(codexEffort ?? 'high', codexModels.find(m => m.id === model));
    updateChatSettings({ model, ...(effort ? { effort } : {}) });
  };
  const onCodexPermissionChange = (perm: CodexPermission) => {
    onDefaultCodexPermissionChange(perm);
    updateChatSettings({ permMode: perm });
  };
  const onCodexEffortChange = (effort: CodexEffort) => {
    onDefaultCodexEffortChange?.(effort);
    const normalized = normalizeCodexEffort(effort, codexModels.find(m => m.id === codexModel));
    if (normalized) updateChatSettings({ effort: normalized });
  };
  const onGeminiModelChange = (model: string) => {
    onDefaultGeminiModelChange(model);
    updateChatSettings({ model });
  };
  const onGeminiApprovalModeChange = (mode: ChatPanelProps['geminiApprovalMode']) => {
    onDefaultGeminiApprovalModeChange(mode);
    updateChatSettings({ approvalMode: mode });
  };
  const onGeminiConversationModeChange = (mode: ChatPanelProps['geminiConversationMode']) => {
    onDefaultGeminiConversationModeChange(mode);
    updateChatSettings({ conversationMode: mode });
  };
  const onKimiModelChange = (model: string) => {
    onDefaultKimiModelChange(model);
    updateChatSettings({ model });
  };
  const onKimiApprovalModeChange = (mode: ChatPanelProps['kimiApprovalMode']) => {
    onDefaultKimiApprovalModeChange(mode);
    updateChatSettings({ approvalMode: mode });
  };

  /**
   * Send through the chat's command (main logs the user_message — the bubble —
   * then dispatches or queues). A chat whose settings have gaps (new, or on
   * another provider) is seeded from the workspace defaults first, so the
   * dispatch runs with what the composer shows.
   */
  const sendToLog = async (text: string, opts: { clientId: string; images?: string[]; imagePaths?: string[]; prompt?: string; taskId?: string; now?: boolean; label?: string }): Promise<boolean> => {
    if (!chatId || !projectPath) return false;
    const seed = settingsSeedRef.current();
    try {
      if (seed) {
        await runCommand({ kind: 'settings', chatId, clientId: newClientId(), settings: seed, origin: 'desktop', projectPath, settled: isChatImported(chatId) });
      }
      await runCommand({
        kind: 'send', chatId, clientId: opts.clientId, text, origin: 'desktop',
        // The workspace's own path spelling: main keys backends by it.
        projectPath, provider: aiProvider,
        // A send that creates the log settles it only if ensureChatInLog verified the chat.
        settled: isChatImported(chatId),
        ...(opts.images?.length ? { images: opts.images } : {}),
        ...(opts.imagePaths?.length ? { imagePaths: opts.imagePaths } : {}),
        ...(opts.prompt !== undefined && opts.prompt !== text ? { promptOverride: opts.prompt } : {}),
        ...(opts.taskId ? { taskId: opts.taskId } : {}),
        ...(opts.now ? { now: true } : {}),
        ...(opts.label && opts.label !== text ? { label: opts.label } : {}),
      });
      return true;
    } catch (err) {
      // Devlogged by runCommand. Tell the user; the caller restores the text.
      window.dispatchEvent(new CustomEvent('sai-chat-error', {
        detail: { message: `Message not sent: ${err instanceof Error ? err.message : String(err)}` },
      }));
      return false;
    }
  };
  const sendToLogRef = useRef(sendToLog);
  sendToLogRef.current = sendToLog;

  /** Appends a client event (creating the chat in the log if it isn't there yet). */
  const appendToLog = useCallback((ev: { type: string; [k: string]: unknown }) => {
    if (!chatId || !window.sai.chatlog) return Promise.resolve(null);
    return window.sai.chatlog.appendClient(chatId, ev, projectPath ? { projectPath, provider: aiProvider } : undefined)
      .catch((err: unknown) => {
        window.sai.devlog?.('chatPanel.appendFailed', { type: ev.type, chatId, error: err instanceof Error ? err.message : String(err) });
        return null;
      });
  }, [chatId, projectPath, aiProvider]);

  const submitCodexApproval = async (approval: NonNullable<typeof pendingApproval>, decision: import('../../../electron/services/codexBackend').CodexApprovalDecision) => {
    // App Server decisions (permissions, session-wide, amendments) are richer
    // than the approve command's yes/no, so they keep their own bridge; the
    // server's approval_resolved clears the logged card.
    try {
      const result = await window.sai.codexAppServerApprove?.(
        projectPath,
        claudeScope,
        approval.requestHandle ?? approval.toolUseId,
        decision,
      );
      // Keyed by the request: a late completion never dismisses a newer card.
      if (result?.ok) dismissPrompt(approvalKey(approval));
    } catch {
      // Keep the card actionable if the preview process is no longer reachable.
    }
  };

  const approveViaLog = (approval: PendingApproval, approved: boolean, modifiedCommand?: string) => {
    if (!chatId) return;
    dismissPrompt(approvalKey(approval));
    return runCommand({
      kind: 'approve', chatId, clientId: newClientId(), toolUseId: approval.toolUseId, approved,
      ...(modifiedCommand !== undefined ? { modifiedCommand } : {}),
    }).catch(() => { /* devlogged */ });
  };

  const handleApprove = async (modifiedCommand?: string) => {
    if (!pendingApproval) return;
    if (pendingApproval.provider === 'codex') {
      await submitCodexApproval(pendingApproval, pendingApproval.kind === 'permissions'
        ? { type: 'permissions', permissions: pendingApproval.requestedPermissions ?? [], scope: 'turn' }
        : { type: 'decision', value: 'accept' });
      return;
    }
    await approveViaLog(pendingApproval, true, modifiedCommand);
  };

  const handleDeny = async () => {
    if (!pendingApproval) return;
    if (pendingApproval.provider === 'codex') {
      if (pendingApproval.kind === 'permissions') {
        await submitCodexApproval(pendingApproval, { type: 'permissions', permissions: [], scope: 'turn' });
        return;
      }
      const value = pendingApproval.availableDecisions?.includes('decline') ? 'decline' : 'cancel';
      await submitCodexApproval(pendingApproval, { type: 'decision', value });
      return;
    }
    await approveViaLog(pendingApproval, false);
  };

  const handleAlwaysAllow = async () => {
    if (!pendingApproval) return;
    if (pendingApproval.provider === 'codex') {
      await submitCodexApproval(pendingApproval, pendingApproval.kind === 'permissions'
        ? { type: 'permissions', permissions: pendingApproval.requestedPermissions ?? [], scope: 'session' }
        : { type: 'decision', value: 'acceptForSession' });
      return;
    }
    // ACP providers don't support always-allow patterns — just approve this instance.
    if (aiProvider === 'claude') await window.sai.claudeAlwaysAllow(projectPath, `${pendingApproval.toolName}(*)`);
    await approveViaLog(pendingApproval, true);
  };

  const handleCodexAmendment = async (execpolicyAmendment: string[]) => {
    if (!pendingApproval || pendingApproval.provider !== 'codex') return;
    await submitCodexApproval(pendingApproval, {
      type: 'command-amendment', execpolicyAmendment,
    });
  };

  const submitCodexUserInput = async (request: PendingCodexUserInput, response: import('../../../electron/services/codexBackend').CodexUserInputResponse) => {
    try {
      const result = await window.sai.codexAppServerAnswerUserInput?.(projectPath, claudeScope, request.requestHandle, response);
      if (result?.ok) dismissPrompt(`input:${request.requestHandle}`);
    } catch {
      // Keep the request actionable when the App Server preview is unavailable.
    }
  };

  const resolveCodexMcpElicitation = async (request: PendingCodexMcpElicitation, decision: import('../../../electron/services/codexBackend').CodexMcpElicitationDecision) => {
    try {
      const result = await window.sai.codexAppServerResolveMcpElicitation?.(projectPath, claudeScope, request.requestHandle, decision);
      if (result?.ok) dismissPrompt(`elicit:${request.requestHandle}`);
    } catch {
      // Keep the request actionable when the App Server preview is unavailable.
    }
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
    void appendToLog({ type: 'local_note', noteId: `fake-error-${newClientId()}`, content: error.message, error });
  }, [appendToLog]);

  const loadGuard = useLoadGuard();
  // Only an enabled, paused guard holds sends back; everything else is unchanged.
  const loadPaused = loadGuard.enabled && loadGuard.paused;
  const loadPausedRef = useRef(loadPaused);
  loadPausedRef.current = loadPaused;

  const interruptViaLog = useCallback(() => {
    if (!chatId) return;
    return runCommand({ kind: 'interrupt', chatId, clientId: newClientId() }).catch(() => { /* devlogged */ });
  }, [chatId, runCommand]);

  // `opts.taskCard` is passed only by the composer's own send; every other
  // caller (retry, queue, suggestions) sends untagged and unprefixed.
  // `opts.queue` (Ctrl+Enter) never interrupts; `opts.now` (send-now from the
  // queue strip) always does.
  // `opts.label` is the short text the queue strip shows (Ctrl+Enter).
  const handleSend = async (text: string, images?: string[], opts?: { taskCard?: TaskCard | null; queue?: boolean; now?: boolean; label?: string }) => {
    // Slash commands must reach the command handler as typed, so they are never redirected.
    const directCard = taskUiEnabled && !text.trim().startsWith('/') && opts?.taskCard?.source === 'declared' ? opts.taskCard : null;
    // Handle built-in commands locally
    if (import.meta.env.DEV && text.startsWith('/fake-error')) {
      handleFakeError(text);
      pendingComposerRectRef.current = null;
      return;
    }
    // Type-to-answer: when a Claude AskUserQuestion card is awaiting an answer,
    // a normal typed message is the user's free-text ("Other") answer to the
    // pending question(s), not a new turn. Route it to the answer channel and
    // skip provider dispatch.
    if (aiProvider === 'claude' && awaitingQuestion) {
      const pending = buildPendingQuestionAnswer(messagesRef.current, text);
      if (pending) {
        void handleAnswerQuestion(pending.toolUseId, pending.answers).catch(() => {});
        pendingComposerRectRef.current = null;
        return;
      }
    }

    if (text === '/clear') {
      handleClearContext();
      return;
    }
    // /compact needs the live agent: while paused — or, for a queued send
    // (palette, Ctrl+Enter), while a turn runs or items wait — it falls
    // through and waits in main's queue like any send.
    const compactWaits = loadPausedRef.current || (!!opts?.queue && (turnLive || messageQueue.length > 0));
    if (text === '/compact' && aiProvider === 'claude' && !compactWaits) {
      window.sai.claudeCompact(projectPath, permissionMode, effortLevel, modelChoice, claudeScope);
      pendingComposerRectRef.current = null;
      return;
    }

    // The bubble is the logged user_message, keyed by this id: the FLIP rect
    // from the composer flies into it.
    const clientId = newClientId();
    const keepFlipRect = () => {
      if (pendingComposerRectRef.current) {
        setFlipRect(clientId, pendingComposerRectRef.current);
        pendingComposerRectRef.current = null;
      }
    };

    if (text === '/help') {
      keepFlipRect();
      await appendToLog({ type: 'user_message', clientId, text, origin: 'desktop' });
      await appendToLog({ type: 'local_note', noteId: `help-${clientId}`, content: buildHelpMessage(aiProvider, slashCommands) });
      return;
    }

    // Everything below goes through main's send command, which queues it while
    // the chat is busy, items are waiting or the load guard is paused.
    // Bypass-queue-on-enter: when streaming AND the queue has items, plain
    // Enter signals "send this now" — main interrupts the current turn first
    // (its end doesn't drain), then dispatches immediately. The queue stays
    // untouched and resumes draining after this turn ends.
    const now = opts?.now ?? (!opts?.queue && turnLive && messageQueue.length > 0);

    isAtBottomRef.current = true;
    // A send that will wait in the queue has no bubble to fly into yet.
    if (!now && (turnLive || loadPausedRef.current || messageQueue.length > 0)) pendingComposerRectRef.current = null;
    keepFlipRect();

    // Save images to temp files and get paths
    let imagePaths: string[] | undefined;
    if (images && images.length > 0) {
      imagePaths = await Promise.all(
        images.map(data => window.sai.saveImage(data))
      );
    }

    const builtPrompt = activeFilePath && fileContextEnabled ? `[File: ${activeFilePath}]\n\n${text}` : text;
    const prompt = directCard ? directAtTask(builtPrompt, directCard.title) : builtPrompt;
    const sent = await sendToLog(text, {
      clientId, images, imagePaths, prompt, now, label: opts?.label,
      // A message typed on a task tab belongs to that task; stamping keeps an explicit tag.
      ...(directCard ? { taskId: directCard.tag } : {}),
    });
    // The composer already cleared: give the text back so nothing is lost.
    if (!sent) draftRestoreRef.current?.(text);
  };

  const handleCancelWait = () => {
    void interruptViaLog();
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
    void appendToLog({ type: 'cleared' });
    setRenderStart(0);
    pendingComposerRectRef.current = null;
  }, [appendToLog]);

  const handleAnswerQuestion = useCallback(async (toolUseId: string, answers: Record<string, string | string[]>) => {
    if (aiProvider !== 'claude' || !projectPath || !chatId) return;
    await runCommand({ kind: 'answer', chatId, clientId: newClientId(), toolUseId, answers });
  }, [aiProvider, projectPath, chatId, runCommand]);

  const handleAnswerPlanReview = useCallback(async (toolUseId: string, approved: boolean) => {
    if (aiProvider !== 'claude' || !projectPath || !chatId) return;
    // The plan card's buttons don't await this: a failure is devlogged, never unhandled.
    await runCommand({ kind: 'planReview', chatId, clientId: newClientId(), toolUseId, approved }).catch(() => {});
  }, [aiProvider, projectPath, chatId, runCommand]);

  const handleTaskStop = useCallback((card: TaskCard) => {
    const taskId = card.agent?.taskId;
    if (taskId) void onStopBackgroundTask?.(taskId);
  }, [onStopBackgroundTask]);
  const renderTaskMessage = (m: ChatMessageType) => (
    <ChatMessage message={m} projectPath={projectPath} onFileOpen={onFileOpen} aiProvider={aiProvider} toolCallsExpanded={toolCallsExpanded} renderToolCall={renderToolCallWrapped} metaRuntime={activeMetaRuntime} onAnswerQuestion={handleAnswerQuestion} onAnswerPlanReview={handleAnswerPlanReview} />
  );

  // The queue lives in main's log (state.queue): Ctrl+Enter is a plain send
  // that main queues behind the running turn and drains one per turn end.
  const handleQueue = (text: string, fullText: string, images?: string[]) => {
    void handleSend(fullText, images, { queue: true, label: text });
  };

  const handleQueueRemove = (id: string) => {
    if (!chatId) return;
    void runCommand({ kind: 'queueRemove', chatId, clientId: newClientId(), target: id }).catch(() => { /* devlogged */ });
  };

  const handleQueuePromote = (id: string) => {
    if (!chatId) return;
    void runCommand({ kind: 'queuePromote', chatId, clientId: newClientId(), target: id }).catch(() => { /* devlogged */ });
  };

  const handleQueueSendNow = async (id: string) => {
    const item = messageQueue.find(m => m.id === id);
    if (!item || !chatId) return;
    // Paused: leave it queued and don't interrupt the running turn.
    if (loadPausedRef.current) return;
    // Same semantics as bypass-queue-on-enter: main interrupts the current
    // turn and dispatches immediately; the rest of the queue resumes after.
    // Main refuses when the item already left the queue (drained meanwhile):
    // then it was sent, and must not go a second time.
    try {
      await runCommand({ kind: 'queueRemove', chatId, clientId: newClientId(), target: id });
    } catch { return; /* devlogged */ }
    await handleSend(item.fullText, item.images, { now: true });
  };

  // App's command palette sends into the active chat like the composer does.
  const handleSendRef = useRef(handleSend);
  handleSendRef.current = handleSend;
  useEffect(() => {
    if (!sendTextRef) return;
    // Like the old palette queue: behind a running turn, never interrupting it.
    const send = (text: string) => { void handleSendRef.current(text, undefined, { queue: true }); };
    sendTextRef.current = send;
    return () => { if (sendTextRef.current === send) sendTextRef.current = null; };
  }, [sendTextRef]);

  // Unmount-only: the drain handoff backstop must not fire into an unmounted panel.
  useEffect(() => () => {
    if (drainBackstopRef.current) clearTimeout(drainBackstopRef.current);
  }, []);

  return (
    <div className="chat-panel">
      <LoadGuardBanner state={loadGuard} />
      {wantsBarSlot && (() => {
        const content = <TaskTabs board={tabBoard} activeId={openTaskCard?.id ?? null} onSelect={openTaskStream} />;
        // No slot (another host, or a background workspace): keep the old
        // in-panel strip rather than dropping the control entirely.
        return tabsSlot ? createPortal(content, tabsSlot) : <div className="task-tabs-fallback">{content}</div>;
      })()}
      <motion.div
        className="pinned-prompt-bar"
        layoutId={pinnedUserMessage ? `pinned-${pinnedUserMessage.id}` : undefined}
        data-layout-id={pinnedUserMessage ? `pinned-${pinnedUserMessage.id}` : undefined}
        animate={{ height: pinnedUserMessage ? 32 : 0, opacity: pinnedUserMessage ? 1 : 0 }}
        transition={dockTransition}
        style={openTaskCard ? { overflow: 'hidden', display: 'none' } : { overflow: 'hidden' }}
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
      {openTaskCard && (
        <TaskFeedView
          card={openTaskCard}
          feed={taskBoard.feed(openTaskCard)}
          fallback={taskBoard.streamFallback(openTaskCard)}
          onBack={() => setOpenTaskId(null)}
          renderMessage={renderTaskMessage}
          onStop={handleTaskStop}
        />
      )}
      {/* Hidden, not unmounted, while a task stream is open: the scroll
          observers attach to this container once on mount. */}
      <div className="chat-messages" ref={chatContainerRef} onScroll={handleScroll} style={openTaskCard ? HIDDEN_STYLE : undefined}>
        <LayoutGroup id="sai-brand">
          {messages.length === 0 ? (
            <div className="chat-empty">
              <motion.div layoutId="sai-brand-logo" layout="position" transition={{ duration: 0.35, ease: [0.4, 0, 0.2, 1] }}>
                <SaiLogo mode="idle" size={64} className="chat-empty-logo" ariaLabel="SAI" />
              </motion.div>
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
                  {logError ? (
                    <div className="chat-empty-subtitle chat-log-error" role="alert">
                      {logError}. Chats can't be loaded or sent until SAI restarts.
                    </div>
                  ) : (
                    <div className="chat-empty-subtitle">
                      {projectPath ? emptyPrompt : 'Select a project to get started'}
                    </div>
                  )}
                  {projectPath && !logError && <CyclingHints />}
                </motion.div>
              </AnimatePresence>
            </div>
          ) : (
            <div className="chat-conversation-header">
              <motion.div layoutId="sai-brand-logo" layout="position" transition={{ duration: 0.35, ease: [0.4, 0, 0.2, 1] }}>
                <SaiLogo mode="idle" size={64} className="chat-empty-logo" ariaLabel="SAI" />
              </motion.div>
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
            {visibleMessages.map(msg => {
              const chip = chipBefore.get(msg.id);
              return (
                <Fragment key={msg.id}>
                  {chip && <TaskChip title={chip.title} colorIndex={chip.colorIndex} />}
                  {msg.role === 'user'
                    ? (
                      <div
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
                          renderToolCall={renderToolCallWrapped}
                          metaRuntime={activeMetaRuntime}
                          onAnswerQuestion={handleAnswerQuestion}
                          onAnswerPlanReview={handleAnswerPlanReview}
                        />
                      </div>
                    )
                    : <ChatMessage message={msg} projectPath={projectPath} onFileOpen={onFileOpen} aiProvider={aiProvider} toolCallsExpanded={toolCallsExpanded} onRetry={msg.error ? () => handleRetry(msg.id) : undefined} onClearContext={msg.error ? handleClearContext : undefined} isFirstAssistantOfTurn={msg.id === firstAssistantOfTurnId} isStreaming={turnLive && msg.id === lastAssistantId && !textSettled} seedGrow={msg.id === seedGrowMsgId} renderToolCall={renderToolCallWrapped} metaRuntime={activeMetaRuntime} onAnswerQuestion={handleAnswerQuestion} onAnswerPlanReview={handleAnswerPlanReview} watcherUrlAllowlist={watcherUrlsByMessageId.get(msg.id) ?? EMPTY_URL_SET} taskLabels={labelsByMessage.get(msg.id)} />}
                </Fragment>
              );
            })}
            </TaskRegistryContext.Provider>
            {isWaiting && waiting && (
              <div className="chat-waiting-row">
                <WaitingIndicator wait={waiting.wait} startedAtMs={waiting.startedAtMs} onCancel={handleCancelWait} liveTaskCount={liveBackgroundTaskCount} onToggleTasks={onToggleBackgroundTasks} tasksOpen={backgroundTasksOpen} label={followUp?.state === 'following' ? `Waiting on ${followUp.waitingFor ?? 'this'}` : undefined} />
              </div>
            )}
            {followUp && !isWaiting && !streamingForDisplay && (
              <div className="chat-waiting-row">
                <FollowUpIndicator
                  state={followUp.state}
                  waitingFor={followUp.waitingFor}
                  onDismiss={onDismissFollowUp}
                  onCheckNow={() => { void handleSend(followUp.waitingFor ? `Check on ${followUp.waitingFor} and continue where you left off.` : 'Check on what you were waiting for and continue where you left off.'); }}
                />
              </div>
            )}
          </>
        )}
        {/* mode="sync" (not popLayout): the exiting row keeps its place in
            layout while its height collapses, so the transcript above/below
            slides smoothly instead of snapping when the row swaps with a
            newborn card or a streaming head. */}
        <AnimatePresence mode="sync" initial={false}>
          {showDetachedBanner && (
            <motion.div
              key={`thinking-${rowSeqRef.current}`}
              {...THINKING_ROW_MOTION}
              className="thinking-row-wrap"
              transition={rowTransition}
            >
              <ThinkingAnimation hint={thinkingHint} />
            </motion.div>
          )}
          {showPendingSaiThinking && (
            <motion.div
              key={`thinking-pending-${rowSeqRef.current}`}
              {...THINKING_ROW_MOTION}
              className="thinking-row-wrap"
              transition={rowTransition}
            >
              <ThinkingAnimation hint={thinkingHint} />
            </motion.div>
          )}
        </AnimatePresence>
        <div ref={messagesEndRef} />
      </div>
      <div className="follow-btn-anchor" style={openTaskCard ? HIDDEN_STYLE : undefined}>
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
          {/* The WaitingIndicator pill in the transcript owns the waiting
              affordance; the composer keeps its stop button live instead of
              growing a second cancel row here. */}
          {promptSuggestion && !streamingForDisplay && !isWaiting && (
            <div className="chat-suggestion-row">
              <button
                data-testid="prompt-suggestion-chip"
                className="chat-suggestion-chip"
                onClick={() => { const s = promptSuggestion; setDismissedSuggestion(s); void handleSend(s); }}
                title="Send suggested prompt"
              >
                <span className="chat-suggestion-arrow">↳</span>
                <span className="chat-suggestion-text">
                  {promptSuggestion.length > 90 ? `${promptSuggestion.slice(0, 90)}…` : promptSuggestion}
                </span>
              </button>
              <button
                className="chat-suggestion-dismiss"
                onClick={() => setDismissedSuggestion(promptSuggestion)}
                title="Dismiss suggestion"
                aria-label="Dismiss suggestion"
              >
                ×
              </button>
            </div>
          )}
          {pendingCodexUserInput && aiProvider === 'codex' && (
            <UserInputRequestPanel
              request={pendingCodexUserInput}
              onSubmit={(answers) => { void submitCodexUserInput(pendingCodexUserInput, { type: 'answers', answers }); }}
              onCancel={() => { void submitCodexUserInput(pendingCodexUserInput, { type: 'cancel' }); }}
            />
          )}
          {pendingCodexMcpElicitation && aiProvider === 'codex' && (
            <McpElicitationPanel
              request={pendingCodexMcpElicitation}
              onResolve={(decision) => { void resolveCodexMcpElicitation(pendingCodexMcpElicitation, decision); }}
            />
          )}
          {aiProvider === 'claude' && projectPath && (
            <McpAuthNudge projectPath={projectPath} scope={claudeScope} onOpenMcpPanel={onOpenMcpPanel} />
          )}
          <ChatInput
            projectPath={projectPath}
            onSend={(text: string, images?: string[]) => handleSend(text, images, { taskCard: openTaskCard })}
            overlayControl={overlayControl}
            onBeforeSend={(rect) => { pendingComposerRectRef.current = rect; }}
            disabled={!ready}
            slashCommands={slashCommands}
            onSlashRefresh={refreshSlashCommands}
            onQueue={handleQueue}
            sendsQueued={loadPaused}
            loadGuard={loadGuard}
            queueCount={messageQueue.length}
            pendingApproval={pendingApproval}
            pendingSudoPrompt={pendingSudoPrompt}
            onApprove={handleApprove}
            onDeny={handleDeny}
            onAlwaysAllow={handleAlwaysAllow}
            onAmend={handleCodexAmendment}
            isStreaming={streamingForDisplay}
            waiting={isWaiting}
            awaitingQuestion={awaitingQuestion}
            messages={messages}
            todos={taskBoard.todos}
            onStop={() => { void interruptViaLog(); }}
            permissionMode={permissionMode}
            onPermissionChange={onPermissionChange}
            effortLevel={effortLevel}
            onEffortChange={onEffortChange}
            modelChoice={modelChoice}
            onModelChange={onModelChange}
            availableModels={availableModels}
            claudeOverrideState={claudeOverrideState}
            contextUsage={contextUsage ?? undefined}
            sessionUsage={sessionUsage ?? undefined}
            sessionCost={sessionCost}
            usageLimits={usageLimits}
            billingMode={aiProvider === 'codex' ? 'subscription' : billingMode}
            activeFilePath={activeFilePath}
            fileContextEnabled={fileContextEnabled}
            onFileContextToggle={() => setFileContextEnabled(prev => !prev)}
            aiProvider={aiProvider}
            codexModel={codexModel}
            codexModels={codexModels}
            onCodexModelChange={onCodexModelChange}
            onCodexModelsRefresh={onCodexModelsRefresh}
            codexPermission={codexPermission}
            onCodexPermissionChange={onCodexPermissionChange}
            codexEffort={codexEffort ?? 'high'}
            onCodexEffortChange={onCodexEffortChange}
            geminiModel={geminiModel}
            geminiModels={geminiModels}
            onGeminiModelChange={onGeminiModelChange}
            geminiApprovalMode={geminiApprovalMode}
            onGeminiApprovalModeChange={onGeminiApprovalModeChange}
            geminiConversationMode={geminiConversationMode}
            onGeminiConversationModeChange={onGeminiConversationModeChange}
            kimiModel={kimiModel}
            kimiModels={kimiModels}
            onKimiModelChange={onKimiModelChange}
            kimiApprovalMode={kimiApprovalMode}
            onKimiApprovalModeChange={onKimiApprovalModeChange}
            terminalTabs={terminalTabs}
            messageQueue={messageQueue}
            onQueueRemove={handleQueueRemove}
            onQueuePromote={handleQueuePromote}
            onQueueSendNow={handleQueueSendNow}
            initialDraft={initialDraft}
            onDraftChange={onDraftChange}
            initialContextItems={initialContextItems}
            onContextItemsChange={onContextItemsChange}
            metaRuntime={activeMetaRuntime}
            mentionInsertRef={mentionInsertRef}
            draftRestoreRef={draftRestoreRef}
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
          /* Long unbreakable tokens (URLs, hashes) must never scroll the whole
             transcript sideways; pre/table opt into their own overflow-x. */
          overflow-x: hidden;
          padding: 16px;
          min-height: 0;
          display: flex;
          flex-direction: column;
        }
        .chat-messages-spacer {
          flex: 1 1 auto;
          min-height: 0;
        }
        .chat-waiting-row {
          display: flex;
          justify-content: flex-start;
          padding: 8px 16px 4px;
        }
        .chat-composer-cancel-row {
          display: flex;
          justify-content: center;
          padding: 4px 16px;
        }
        /* Prompt-suggestion chip: aligned to the composer's 15% inset (matches
           .input-wrapper) and themed like the surrounding chips. */
        .chat-suggestion-row {
          display: flex;
          align-items: center;
          gap: 6px;
          padding: 6px 15% 0;
          min-width: 0;
        }
        .chat-suggestion-chip {
          display: inline-flex;
          align-items: center;
          gap: 7px;
          min-width: 0;
          padding: 4px 12px;
          border-radius: var(--radius-sm);
          font-size: 12px;
          font-family: inherit;
          cursor: pointer;
          background: var(--surface-2);
          border: 1px solid var(--border-subtle);
          color: var(--text-secondary);
          transition: background 0.15s, border-color 0.15s, color 0.15s;
        }
        .chat-suggestion-chip:hover {
          border-color: color-mix(in srgb, var(--accent) 45%, transparent);
          background: color-mix(in srgb, var(--accent) 8%, var(--surface-2));
          color: var(--text);
        }
        .chat-suggestion-arrow {
          color: var(--accent);
          flex-shrink: 0;
          font-weight: 600;
        }
        .chat-suggestion-text {
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
        }
        .chat-suggestion-dismiss {
          background: none;
          border: none;
          color: var(--text-muted);
          cursor: pointer;
          font-size: 13px;
          line-height: 1;
          padding: 3px 5px;
          border-radius: var(--radius-sm);
          flex-shrink: 0;
          transition: color 0.15s, background 0.15s;
        }
        .chat-suggestion-dismiss:hover {
          color: var(--text);
          background: rgba(255, 255, 255, 0.06);
        }
        .chat-composer-cancel {
          background: var(--red);
          color: #fff;
          border: none;
          cursor: pointer;
          padding: 5px 12px;
          border-radius: var(--radius-sm);
          font-size: 12px;
          font-weight: 600;
          opacity: 0.85;
        }
        .chat-composer-cancel:hover { opacity: 1; }
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
