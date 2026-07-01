import { useState, useCallback, useEffect, useRef, useMemo } from 'react';
import NavBar from './components/NavBar';
import ChatPanel from './components/Chat/ChatPanel';
import TerminalPanel from './components/Terminal/TerminalPanel';
import GitSidebar from './components/Git/GitSidebar';
import { MetaGitSidebar } from './components/Git/MetaGitSidebar';
import FileExplorerSidebar from './components/FileExplorer/FileExplorerSidebar';
import SearchPanel from './components/SearchPanel/SearchPanel';
import TitleBar from './components/TitleBar';
import CodePanel from './components/CodePanel/CodePanel';
import { extractEditToolUses, successfulToolResultIds } from './components/CodePanel/detectFileEdits';
import UnsavedChangesModal from './components/UnsavedChangesModal';
import WorkspaceToast, { type ToastTone } from './components/WorkspaceToast';
import { computeChatToasts } from './lib/chatToasts';
import { computeChatNotificationCount, computeCompletedWorkspaces, isTurnErrored } from './lib/chatActivity';
import CommandPalette from './components/CommandPalette';
import { useWhatsNew } from './hooks/useWhatsNew';
import { useKeybinding } from './hooks/useKeybinding';
import WhatsNewModal from './components/WhatsNewModal';
import NewProjectModal from './components/NewProjectModal';
import { setActiveWorkspace, updateTerminalName } from './terminalBuffer';
import { basename } from './utils/pathUtils';
import { createSession, generateSmartTitle } from './sessions';
import { computeUnmountFlushes, computeQuitFlushes } from './workspaceFlush';
import { buildOverlayPayload, truncateSnippet, updateRecentDone, type OverlayRow, type OverlayTailItem } from './lib/overlayFeed';
import { toolCallDetail } from './lib/toolCallDetail';
import { findLatestTodos } from './components/Chat/TodoProgress';
import { dbGetSessions, dbGetAllSessions, dbGetMessages, dbGetMessagesTail, dbPatchSessionMeta, dbPurgeExpired, migrateFromLocalStorage } from './chatDb';
import { queueSaveSession } from './lib/sessionSaveQueue';
import type { ChatSession, ChatMessage, GitFile, OpenFile, WorkspaceContext, QueuedMessage, TerminalTab, PendingApproval, SwarmTask, ApprovalPolicy, SwarmApproval, EffortLevel, ModelChoice, ClaudeModelOption } from './types';
import type { MetaWorkspaceListItem, MetaWorkspaceRuntime } from './types';
import { THEMES, applyTheme, type ThemeId, HIGHLIGHT_THEMES, setActiveHighlightTheme, type HighlightThemeId } from './themes';
import ApprovalBanner from './components/ApprovalBanner';
import { MessageSquare, TerminalSquare, Code2, ChevronRight, MessageCirclePlus } from 'lucide-react';
import { IncludedProjectsControl } from './components/MetaWorkspace/IncludedProjectsControl';
import ChatHistorySidebar from './components/Chat/ChatHistorySidebar';
import PluginsSidebar from './components/Plugins/PluginsSidebar';
import McpSidebar from './components/MCP/McpSidebar';
import SwarmSidebar from './components/Swarm/SwarmSidebar';
import NewTaskPopover from './components/Swarm/NewTaskPopover';
import SwarmTaskHeader from './components/Swarm/SwarmTaskHeader';
import SwarmDiffModal from './components/Swarm/SwarmDiffModal';
import OrchestratorView from './components/Swarm/OrchestratorView';
import SwarmLogoCluster from './components/Swarm/SwarmLogoCluster';
import SwarmToolCardSelector from './components/Swarm/cards/SwarmToolCardSelector';
import { bucketToolCalls, trimEvents, pushRing, type TimedEvent } from './lib/swarmActivityHistory';
import InlineApprovalCard from './components/Swarm/cards/InlineApprovalCard';
import QuitSwarmConfirmModal from './components/Swarm/QuitSwarmConfirmModal';
import { swarmInit, swarmGetApprovals, swarmResolveApproval, swarmCreateApproval, swarmCreateTask, swarmDeleteTask, swarmGetApproval, swarmDeleteApprovalsByTask } from './swarmDb';
import { approvalRoutingTarget } from './lib/swarmApprovalRouting';
import { diffSwarmTasks } from './lib/swarmPersistenceDiff';
import { hydrateWorkspaceSwarm } from './lib/swarmHydrate';
import { SwarmScheduler, isLikelyReadOnlyPrompt, findStaleTasks } from './lib/swarmScheduler';
import { runSwarmTask } from './lib/swarmTaskRunner';
import { landTask, discardTask, rebaseRetry } from './lib/swarmLanding';
import { ensureOrchestratorSession } from './lib/swarmOrchestratorSession';
import { handleSwarmToolRequest, type SwarmHost } from './lib/swarmOrchestratorDispatcher';
import { handleRenderToolRequest } from './render/handleRenderToolRequest';
import { resolveThemedSurface, sanitizeCssColor } from './render/renderSizing';
import { resolveWatchRun } from './components/Chat/githubRunResolver';
import { registeredComponentKeys } from './render/componentRegistry';
import { renderMermaidToSvg } from './render/renderMermaid';
import { handleSaiQueryToolRequest } from './render/saiQueryTools';
import { handleSaiNativeToolRequest, type PickFileOpts } from './render/saiNativeTools';
import { buildChartHtml, buildDiffHtml, type ChartInput, type DiffInput } from './render/builtinRenderers';
import { registerPendingForm } from './render/formBridge';
import { formTimeoutMs } from './render/formTimeout';
import { RenderToolCallCard } from './components/Chat/RenderToolCallCard';
import { executeSlashCommand } from './lib/orchestratorSlashCommands';
import { isOrchestratorToolDrift, describeToolDrift } from './lib/orchestratorToolDrift';
import { resolveTaskRef } from './lib/swarmRef';
import { installRemoteProxyHandler } from './lib/remoteProxyClient';
import { applyQuestionEvent } from './lib/awaitingQuestionTracker';
import { turnEndIsStale } from './lib/turnSeqGuard';
import { resolveClaudeConfig, setWorkspaceOverride, sanitizeOverrideMap, type ClaudeOverrideMap } from './lib/claudeWorkspaceConfig';
import type { WaitMeta } from '../electron/services/waitClassifier';

const SWARM_DEFAULT_CAP = 5;
const SWARM_STALE_THRESHOLD_MS = 30 * 60 * 1000; // 30 min of no activity → presumed dead. Heartbeats (deriveSwarmMirror) refresh activity on any stream traffic; this headroom covers a single silent long-running tool/sub-agent.
const SWARM_WATCHDOG_INTERVAL_MS = 60 * 1000;    // sweep cadence
import { swarmBranchName } from './lib/swarmSlug';
import { shouldRequireApproval } from './lib/swarmApprovalPolicy';
import { deriveSwarmMirror, applySwarmPatch } from './lib/swarmStatusMirror';
import { convertAssistantEnvelope, appendAssistantChunk, mergePersistedWithBuffer } from './lib/swarmTaskMessageBuffer';
import { isImageFile } from './utils/imageFiles';
import { getMonacoEditorFor } from './utils/monacoEditorRegistry';
import * as monaco from 'monaco-editor';
import { motion, AnimatePresence } from 'motion/react';
import { getCapabilities } from './providers/capabilities';

declare global {
  interface Window {
    __saiTest?: {
      setWorkspaceBusy(id: string): void;
      setWorkspaceDone(id: string): void;
      setWorkspaceIdle(id: string): void;
      clearWorkspaces(): void;
      getOverallStatus(): 'done' | 'busy' | 'busy-done' | null;
      getState(): { busyWorkspaces: string[]; completedWorkspaces: string[] };
    };
  }
}

function applyEditsClientSide(content: string, edits: { line: number; column: number; length: number; replacement: string }[]): string {
  const sorted = [...edits].sort((a, b) => b.line - a.line || b.column - a.column);
  const lines = content.split('\n');
  for (const e of sorted) {
    const idx = e.line - 1;
    if (idx < 0 || idx >= lines.length) continue;
    const line = lines[idx];
    lines[idx] = line.slice(0, e.column - 1) + e.replacement + line.slice(e.column - 1 + e.length);
  }
  return lines.join('\n');
}

type PermissionMode = 'default' | 'bypass';
// EffortLevel, ModelChoice, and ClaudeModelOption are imported from ./types
// Persisted model can be a known alias or an account-specific id (e.g. Fable);
// the CLI validates it, so accept any non-empty string here.
const isModelChoice = (v: unknown): v is ModelChoice => typeof v === 'string' && v.length > 0;
const isEffortLevel = (v: unknown): v is EffortLevel => v === 'low' || v === 'medium' || v === 'high' || v === 'max';

// Cap the in-memory active-session message window. Older messages stay in
// IndexedDB and are paginated in via ChatPanel's startReached callback.
const MESSAGE_TAIL_LIMIT = 100;
const MESSAGE_PAGE_SIZE = 100;
type AIProvider = 'claude' | 'codex' | 'gemini';
type GeminiApprovalMode = 'default' | 'auto_edit' | 'yolo' | 'plan';
type GeminiConversationMode = 'planning' | 'fast';
type CodexPermission = 'auto' | 'read-only' | 'full-access';
type PanelId = 'chat' | 'editor' | 'terminal';

function WelcomeTypewriter() {
  const full = 'Welcome to Simply AI';
  const final = 'Welcome to SAI';
  const [text, setText] = useState('');
  const shared = 'Welcome to S';
  const [phase, setPhase] = useState<'typing' | 'deleting' | 'retyping' | 'done' | 'hidden'>('typing');

  useEffect(() => {
    let timeout: ReturnType<typeof setTimeout>;
    if (phase === 'typing') {
      if (text.length < full.length) {
        timeout = setTimeout(() => setText(full.slice(0, text.length + 1)), 60);
      } else {
        timeout = setTimeout(() => setPhase('deleting'), 1500);
      }
    } else if (phase === 'deleting') {
      if (text.length > shared.length) {
        timeout = setTimeout(() => setText(text.slice(0, -1)), 40);
      } else {
        setPhase('retyping');
      }
    } else if (phase === 'retyping') {
      if (text.length < final.length) {
        timeout = setTimeout(() => setText(final.slice(0, text.length + 1)), 60);
      } else {
        timeout = setTimeout(() => setPhase('done'), 0);
      }
    } else if (phase === 'done') {
      timeout = setTimeout(() => setPhase('hidden'), 2000);
    }
    return () => clearTimeout(timeout);
  }, [text, phase]);

  return (
    <span style={{ fontSize: 24, fontWeight: 600, color: 'var(--accent)' }}>
      {text}
      {phase !== 'hidden' && <span style={{
        display: 'inline-block',
        width: 2,
        height: '1em',
        background: 'var(--accent)',
        marginLeft: 2,
        verticalAlign: 'text-bottom',
        animation: 'cursor-blink 1s step-start infinite',
      }} />}
      <style>{`
        @keyframes cursor-blink {
          0% { opacity: 1; }
          50% { opacity: 0; }
        }
      `}</style>
    </span>
  );
}

export default function App() {
  const [sidebarOpen, setSidebarOpen] = useState<string | null>(null);
  const sidebarOpenRef = useRef<string | null>(null);
  const sidebarByWsRef = useRef<Map<string, string | null>>(new Map());
  const swarmSelectedByWsRef = useRef<Map<string, string>>(new Map());

  const [activeProjectPath, setActiveProjectPath] = useState<string>('');
  const [metaWorkspaces, setMetaWorkspaces] = useState<MetaWorkspaceListItem[]>([]);
  const [activeMetaRuntime, setActiveMetaRuntime] = useState<MetaWorkspaceRuntime | null>(null);
  const [permissionMode, setPermissionMode] = useState<PermissionMode>('default');
  const [effortLevel, setEffortLevel] = useState<EffortLevel>('high');
  const [modelChoice, setModelChoice] = useState<ModelChoice>('sonnet');
  const [claudeWsOverrides, setClaudeWsOverrides] = useState<ClaudeOverrideMap>({});
  const [editorFontSize, setEditorFontSize] = useState(13);
  const [editorMinimap, setEditorMinimap] = useState(true);
  const [aiProvider, setAiProvider] = useState<AIProvider>('claude');
  const [aiTitleGeneration, setAiTitleGeneration] = useState(false);
  const [titleGeneratingIds, setTitleGeneratingIds] = useState<Set<string>>(new Set());
  const [commitMessageProvider, setCommitMessageProvider] = useState<AIProvider>('claude');
  const [codexModel, setCodexModel] = useState('');
  const [codexModels, setCodexModels] = useState<{ id: string; name: string }[]>([]);
  const [claudeModels, setClaudeModels] = useState<ClaudeModelOption[]>([]);
  const [codexPermission, setCodexPermission] = useState<CodexPermission>('auto');
  const [geminiModel, setGeminiModel] = useState('auto-gemini-3');
  const [geminiModels, setGeminiModels] = useState<{ id: string; name: string }[]>([]);
  const [geminiApprovalMode, setGeminiApprovalMode] = useState<GeminiApprovalMode>('default');
  const [geminiConversationMode, setGeminiConversationMode] = useState<GeminiConversationMode>('planning');
  const [workspaces, setWorkspaces] = useState<Map<string, WorkspaceContext>>(new Map());
  const [swarmTasksByWs, setSwarmTasksByWs] = useState<Map<string, SwarmTask[]>>(new Map());
  const [swarmApprovalsByWs, setSwarmApprovalsByWs] = useState<Map<string, SwarmApproval[]>>(new Map());
  const [swarmSelected, setSwarmSelected] = useState<'overview' | string>('overview');
  const [swarmDiffStats, setSwarmDiffStats] = useState<Map<string, { additions: number; deletions: number }>>(new Map());
  const [orchestratorSessionIdByWs, setOrchestratorSessionIdByWs] = useState<Map<string, string>>(new Map());
  const [showNewTaskPopover, setShowNewTaskPopover] = useState(false);
  const [messageQueues, setMessageQueues] = useState<Map<string, QueuedMessage[]>>(new Map());
  const [pendingClose, setPendingClose] = useState<string | null>(null);
  // Ref to hold latest messages per workspace without triggering re-renders during streaming
  const wsMessagesRef = useRef<Map<string, ChatMessage[]>>(new Map());
  // Session IDs we've already persisted on first-user-message. Lets the
  // onMessagesChange handler write once per session as soon as the user sends
  // their first message, without re-writing on every subsequent token.
  const firstUserPersistRef = useRef<Set<string>>(new Set());
  // When the ApprovalBanner asks to switch to another workspace AND a
  // specific session, stash the session id here. The session-load effect
  // picks it up once `sessions` is populated and selects it.
  const pendingSessionAfterSwitchRef = useRef<{ projectPath: string; sessionId: string } | null>(null);
  // Latest orchestrator-session messages, keyed by orchestrator session id, so
  // the regular wsMessagesRef (keyed by wsPath) doesn't get clobbered by the
  // orchestrator ChatPanel's onMessagesChange.
  const orchMessagesRef = useRef<Map<string, ChatMessage[]>>(new Map());
  // Mounted-mirror of orchMessagesRef so React re-renders trigger a fresh
  // initialMessages prop when ChatPanel remounts (e.g. user navigates from
  // overview → focused task → back). Without this, ChatPanel mounts with
  // initialMessages=[] because ws.sessions stores messageless rows.
  const [orchMessagesByWs, setOrchMessagesByWs] = useState<Map<string, ChatMessage[]>>(new Map());
  // Pending debounced save timer per orchestrator session id.
  const orchSaveTimerRef = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());
  // Absolute index in the full session of messages[0] for the workspace's
  // currently-loaded message window. 0 means the full session is loaded.
  // Saves use this so paginated tails don't clobber older DB messages.
  const wsFirstLoadedIdxRef = useRef<Map<string, number>>(new Map());
  const [externallyModified, setExternallyModified] = useState<Set<string>>(new Set());
  const [completedWorkspaces, setCompletedWorkspaces] = useState<Set<string>>(new Set());
  const [busyWorkspaces, setBusyWorkspaces] = useState<Set<string>>(new Set());
  const [awaitingQuestionWorkspaces, setAwaitingQuestionWorkspaces] = useState<Set<string>>(new Set());
  // Workspaces with an in-flight chat turn. Distinct from busyWorkspaces, which
  // also counts terminal-scope activity. Lifted out of ChatPanel so the panel's
  // streaming indicator survives remounts (e.g. session/key swaps).
  const [chatStreamingWorkspaces, setChatStreamingWorkspaces] = useState<Set<string>>(new Set());
  // Tracks streaming state per (workspace, scope) so non-chat scopes (e.g. the
  // orchestrator's own session id) can drive the ChatPanel thinking animation.
  // Keys are `${projectPath}:${scope}` — scope defaults to 'chat'.
  const [streamingScopes, setStreamingScopes] = useState<Set<string>>(new Set());
  const streamingScopesRef = useRef<Set<string>>(new Set());
  streamingScopesRef.current = streamingScopes;
  const [waitingScopes, setWaitingScopes] = useState<Map<string, { wait: WaitMeta; startedAtMs: number }>>(new Map());
  // Unsent draft text and attached context per workspace, persisted across
  // workspace switches and session-key remounts so partial messages survive
  // navigation.
  const chatDraftsRef = useRef(new Map<string, string>());
  const chatContextItemsRef = useRef(new Map<string, unknown[]>());
  const handleDraftChange = useCallback((wsPath: string, draft: string) => {
    if (draft) chatDraftsRef.current.set(wsPath, draft);
    else chatDraftsRef.current.delete(wsPath);
  }, []);
  const handleContextItemsChange = useCallback((wsPath: string, items: unknown[]) => {
    if (items.length) chatContextItemsRef.current.set(wsPath, items);
    else chatContextItemsRef.current.delete(wsPath);
  }, []);
  const [approvalSessions, setApprovalSessions] = useState<Map<string, Map<string, PendingApproval>>>(new Map());
  // Sessions whose Claude scope has been reaped by the idle sweep. Cleared on
  // the next streaming_start for that scope (process respawned). Keyed by
  // `${projectPath}:${scope}` to match streamingScopes.
  const [suspendedScopes, setSuspendedScopes] = useState<Set<string>>(new Set());
  const [notificationCounts, setNotificationCounts] = useState<Map<string, number>>(new Map());
  const wsTurnSeqRef = useRef<Map<string, number>>(new Map());
  const [focusedChat, setFocusedChat] = useState(false);
  const [overlayEnabled, setOverlayEnabled] = useState(false);
  // Session-scoped overlay mode from the inline control under the chat input.
  const [overlayMode, setOverlayMode] = useState<'on' | 'off' | 'persist'>('on');
  const handleOverlayModeChange = useCallback((m: 'on' | 'off' | 'persist') => {
    setOverlayMode(m);
    // settings:set persists AND drives overlayManager.setMode in main.
    void window.sai.settingsSet('overlayMode', m);
  }, []);
  const [commandPaletteOpen, setCommandPaletteOpen] = useState(false);
  const [fileIndex, setFileIndex] = useState<string[]>([]);
  const [toast, setToast] = useState<{ message: string; key: number; tone?: 'success' | 'error' } | null>(null);
  interface ChatToastEntry {
    id: string;
    sessionId: string;
    message: string;
    tone: ToastTone;
  }
  const [chatToasts, setChatToasts] = useState<ChatToastEntry[]>([]);
  const dismissChatToast = useCallback((id: string) => {
    setChatToasts(prev => prev.filter(t => t.id !== id));
  }, []);
  const { isOpen: whatsNewOpen, version: whatsNewVersion, releases, fetchStatus, openWhatsNew, closeWhatsNew } = useWhatsNew();
  const [showNewProject, setShowNewProject] = useState(false);
  const [quitConfirmTasks, setQuitConfirmTasks] = useState<{ id: string; title: string }[] | null>(null);
  const [swarmDiffModal, setSwarmDiffModal] = useState<
    | { title: string; branch: string; baseBranch: string; diff: string; loading: boolean; error?: string }
    | null
  >(null);
  const slashCommandsRef = useRef<string[]>([]);
  // Shared mention-insert ref: populated by ChatInput, consumed by the
  // accordion-bar IncludedProjectsControl so both share the same callback.
  const mentionInsertRef = useRef<((linkName: string) => void) | null>(null);
  const workspacesRef = useRef(workspaces);
  const workspaceStatusRef = useRef<{ busy: Set<string>; streaming: Set<string>; completed: Set<string>; approval: Set<string>; awaitingQuestion: Set<string> }>({
    busy: new Set(), streaming: new Set(), completed: new Set(), approval: new Set(), awaitingQuestion: new Set(),
  });
  const activeProjectPathRef = useRef(activeProjectPath);
  const swarmTasksByWsRef = useRef(swarmTasksByWs);
  const swarmDiffStatsRef = useRef(swarmDiffStats);
  // Dedupe synthetic completion/failure card emissions. claude.ts emits both
  // 'result' and 'done' at end of turn — both hit the status mirror before
  // the ref re-syncs, so without this guard the same task fires task_completed
  // twice (visible as duplicate inline cards).
  const emittedLifecycleRef = useRef<Set<string>>(new Set());
  // tool_use_ids of in-flight AI file edits, awaiting their tool_result so we can
  // hot-reload open files the instant an edit completes.
  const pendingEditsRef = useRef<Set<string>>(new Set());
  // Per-workspace activity ring buffers powering the orchestrator sparklines.
  // - tools: timed tool_use events (filtered per task for SpawnTaskCard)
  // - activeBuckets: 12-element ring of `streaming+queued+awaiting_approval`
  //   counts sampled every 5s for the StatStrip ACTIVE background sparkline.
  const activityHistoryRef = useRef<Map<string, { tools: TimedEvent[]; activeBuckets: number[] }>>(new Map());
  // Bumped whenever we want consumers (StatStrip / SpawnTaskCard sparklines)
  // to pick up the freshest snapshot of activityHistoryRef.
  const [activityTick, setActivityTick] = useState(0);
  // Per-workspace batch detection state for end-of-batch wrap-up cards.
  // - activeCount: previous tick's active count (>0 means an active window is open)
  // - startedAt: timestamp when the active window opened
  // - startCount: total tasks observed in this active window
  // - completionEvents: per-task completion timestamps (for the bar-chart sparkline)
  // - knownTaskIds: ids we've already counted toward startCount
  // - landedAtStart / failedAtStart / discardedAtStart: snapshots so we report
  //   only deltas accumulated within this batch window.
  const batchStateRef = useRef<Map<string, {
    activeCount: number;
    startedAt: number;
    startCount: number;
    completionEvents: number[];
    knownTaskIds: Set<string>;
    landedAtStart: number;
    failedAtStart: number;
    discardedAtStart: number;
    countersAtStart: { landed: number; failed: number; discarded: number };
  }>>(new Map());
  const orchestratorSessionIdByWsRef = useRef(orchestratorSessionIdByWs);
  // Tracks the last swarm task we routed the active session to, to avoid
  // re-firing the session-switch effect on every state update.
  const lastSwarmRoutedRef = useRef<string | null>(null);
  // Per-workspace memory of the regular (non-task) session that was active
  // before the user clicked into a swarm task row. Restored when leaving
  // swarm (sidebar change or back to overview) so the chat panel doesn't
  // keep showing the task's chat outside the swarm view.
  const preSwarmSessionByWsRef = useRef<Map<string, string>>(new Map());
  // Workspaces whose persisted swarm tasks have already been hydrated this
  // session (so we don't re-load and clobber live in-memory state).
  const hydratedWorkspacesRef = useRef<Set<string>>(new Set());
  // Workspaces whose hydrate is currently running, to guard against the effect
  // re-entering before the first load completes.
  const hydrationInFlightRef = useRef<Set<string>>(new Set());
  // Approval ids currently being resolved, to make approve/deny idempotent
  // against double-clicks / approve-then-deny.
  const resolvingApprovalsRef = useRef<Set<string>>(new Set());
  // Last task list persisted per workspace, for diffing on change.
  const persistedTasksRef = useRef<Map<string, SwarmTask[]>>(new Map());
  // FIFO so overlapping persistence flushes don't interleave IndexedDB txns.
  const persistQueueRef = useRef<Promise<unknown>>(Promise.resolve());
  const lastEmittedWorkspaceStatusRef = useRef<Map<string, {
    busy: boolean;
    streaming: boolean;
    completed: boolean;
    approval: boolean;
    awaitingQuestion: boolean;
    streamingSessionId: string | null;
    streamingSessionIds: string[];
    suspendedSessionIds: string[];
    awaitingSessionIds: string[];
  }>>(new Map());
  // sessionId of the chat turn that's currently streaming on each workspace.
  // Set on streaming_start (sessionId carried by claude.ts); cleared on result.
  // Lets mobile distinguish a lingering prior-session turn from the freshly
  // switched-into session so the thinking indicator follows the right session.
  const chatStreamingSessionRef = useRef<Map<string, string | null>>(new Map());

  // Update taskbar badge count when notifications are pending
  useEffect(() => {
    let total = 0;
    for (const count of notificationCounts.values()) total += count;
    window.sai.setBadgeCount(total);
  }, [notificationCounts]);

  // Always-current snapshot of the active workspace+session for the proxy.
  const activeSessionRef = useRef<{ projectPath: string; scope: string; sessionId: string } | null>(null);

  // Remote proxy: handle chatDb read requests forwarded from paired devices
  useEffect(() => {
    const off = installRemoteProxyHandler({
      getActiveSession: () => activeSessionRef.current,
      listWorkspaces: async () => {
        type Row = {
          projectPath: string;
          name: string;
          kind: 'project' | 'meta';
          members?: { projectPath: string; name: string }[];
          status?: { busy?: boolean; streaming?: boolean; completed?: boolean; approval?: boolean; awaitingQuestion?: boolean };
          state?: 'active' | 'open' | 'suspended' | 'recent';
        };
        const sai = (window as any).sai;
        const metaByPath = new Map<string, MetaWorkspaceListItem>();
        for (const m of metaWorkspaces) {
          if (m.syntheticRoot) metaByPath.set(m.syntheticRoot, m);
        }
        const statusFor = (projectPath: string) => {
          const busy = workspaceStatusRef.current.busy.has(projectPath);
          const streaming = workspaceStatusRef.current.streaming.has(projectPath);
          const completed = workspaceStatusRef.current.completed.has(projectPath);
          const approval = workspaceStatusRef.current.approval.has(projectPath);
          const awaitingQuestion = workspaceStatusRef.current.awaitingQuestion.has(projectPath);
          if (!busy && !streaming && !completed && !approval && !awaitingQuestion) return undefined;
          return { busy, streaming, completed, approval, awaitingQuestion };
        };
        const out: Row[] = [];
        const seen = new Set<string>();

        // 1. Active + suspended workspaces from the SAI workspace registry
        const allWorkspaces: Array<{ projectPath: string; status: 'active' | 'suspended' | 'recent' }> =
          (await sai?.workspaceGetAll?.()) ?? [];
        const activePath = activeProjectPathRef.current;
        for (const w of allWorkspaces) {
          if (seen.has(w.projectPath)) continue;
          seen.add(w.projectPath);
          const meta = metaByPath.get(w.projectPath);
          const state: Row['state'] = w.projectPath === activePath
            ? 'active'
            : w.status === 'suspended'
            ? 'suspended'
            : w.status === 'recent'
            ? 'recent'
            : 'open';
          if (meta) {
            out.push({
              projectPath: w.projectPath,
              name: meta.name,
              kind: 'meta',
              members: meta.projects.map((p) => ({ projectPath: p.path, name: p.linkName })),
              status: statusFor(w.projectPath),
              state,
            });
          } else {
            const base = w.projectPath.split('/').filter(Boolean).pop() ?? w.projectPath;
            out.push({ projectPath: w.projectPath, name: base, kind: 'project', status: statusFor(w.projectPath), state });
          }
        }

        // 2. Recent projects (paths only) not already represented
        const recentPaths: string[] = (await sai?.getRecentProjects?.()) ?? [];
        for (const p of recentPaths) {
          if (seen.has(p)) continue;
          seen.add(p);
          const meta = metaByPath.get(p);
          if (meta) {
            out.push({
              projectPath: p,
              name: meta.name,
              kind: 'meta',
              members: meta.projects.map((mp) => ({ projectPath: mp.path, name: mp.linkName })),
              state: 'recent',
            });
          } else {
            const base = p.split('/').filter(Boolean).pop() ?? p;
            out.push({ projectPath: p, name: base, kind: 'project', state: 'recent' });
          }
        }

        return out;
      },
      setActiveWorkspace: (path) => {
        setActiveProjectPath(path);
        setCompletedWorkspaces(prev => {
          if (!prev.has(path)) return prev;
          const next = new Set(prev);
          next.delete(path);
          return next;
        });
        setNotificationCounts(prev => {
          if (!prev.has(path)) return prev;
          const next = new Map(prev);
          next.delete(path);
          return next;
        });
      },
    });
    return off;
  }, [metaWorkspaces]);

  useEffect(() => { workspacesRef.current = workspaces; }, [workspaces]);
  useEffect(() => {
    workspaceStatusRef.current = {
      busy: new Set(busyWorkspaces),
      streaming: new Set(chatStreamingWorkspaces),
      completed: new Set(completedWorkspaces),
      approval: new Set(approvalSessions.keys()),
      awaitingQuestion: new Set(awaitingQuestionWorkspaces),
    };
    // Emit per-workspace deltas to the remote bus so mobile sees live status.
    const all = new Set<string>([
      ...busyWorkspaces, ...chatStreamingWorkspaces, ...completedWorkspaces, ...approvalSessions.keys(),
      ...awaitingQuestionWorkspaces,
      ...lastEmittedWorkspaceStatusRef.current.keys(),
    ]);
    // Derive per-workspace session activity arrays from the global scope sets
    // so the PWA can render per-row status indicators in its chat list.
    const sessionIdsByWorkspace = (path: string) => {
      const prefix = `${path}:`;
      const streamingIds: string[] = [];
      for (const k of streamingScopes) if (k.startsWith(prefix)) streamingIds.push(k.slice(prefix.length));
      const suspendedIds: string[] = [];
      for (const k of suspendedScopes) if (k.startsWith(prefix)) suspendedIds.push(k.slice(prefix.length));
      const awaitingIds = Array.from(approvalSessions.get(path)?.keys() ?? []);
      return { streamingIds, suspendedIds, awaitingIds };
    };
    const arraysEqual = (a: readonly string[] | undefined, b: readonly string[]) => {
      if (!a) return false;
      if (a.length !== b.length) return false;
      for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
      return true;
    };
    for (const projectPath of all) {
      const streaming = chatStreamingWorkspaces.has(projectPath);
      const { streamingIds, suspendedIds, awaitingIds } = sessionIdsByWorkspace(projectPath);
      streamingIds.sort(); suspendedIds.sort(); awaitingIds.sort();
      const next = {
        busy: busyWorkspaces.has(projectPath),
        streaming,
        completed: completedWorkspaces.has(projectPath),
        approval: approvalSessions.has(projectPath),
        awaitingQuestion: awaitingQuestionWorkspaces.has(projectPath),
        streamingSessionId: streaming ? (chatStreamingSessionRef.current.get(projectPath) ?? null) : null,
        streamingSessionIds: streamingIds,
        suspendedSessionIds: suspendedIds,
        awaitingSessionIds: awaitingIds,
      };
      const prev = lastEmittedWorkspaceStatusRef.current.get(projectPath);
      if (!prev
          || prev.busy !== next.busy
          || prev.streaming !== next.streaming
          || prev.completed !== next.completed
          || prev.approval !== next.approval
          || prev.awaitingQuestion !== next.awaitingQuestion
          || prev.streamingSessionId !== next.streamingSessionId
          || !arraysEqual(prev.streamingSessionIds, next.streamingSessionIds)
          || !arraysEqual(prev.suspendedSessionIds, next.suspendedSessionIds)
          || !arraysEqual(prev.awaitingSessionIds, next.awaitingSessionIds)) {
        lastEmittedWorkspaceStatusRef.current.set(projectPath, next);
        void (window.sai as any).remoteEmitWorkspaceStatus?.(projectPath, next);
      }
    }
  }, [busyWorkspaces, chatStreamingWorkspaces, completedWorkspaces, approvalSessions, awaitingQuestionWorkspaces, streamingScopes, suspendedScopes]);
  useEffect(() => { swarmTasksByWsRef.current = swarmTasksByWs; }, [swarmTasksByWs]);
  useEffect(() => { swarmDiffStatsRef.current = swarmDiffStats; }, [swarmDiffStats]);
  useEffect(() => { orchestratorSessionIdByWsRef.current = orchestratorSessionIdByWs; }, [orchestratorSessionIdByWs]);

  // Task 26: Quit confirmation when swarm tasks are still streaming.
  useEffect(() => {
    const sai = window.sai as any;
    if (!sai?.onRequestQuit) return;
    const cleanup = sai.onRequestQuit(() => {
      const streaming: { id: string; title: string }[] = [];
      for (const tasks of swarmTasksByWsRef.current.values()) {
        for (const t of tasks) {
          if (t.status === 'streaming') streaming.push({ id: t.id, title: t.title });
        }
      }
      if (streaming.length === 0) {
        // Persist chat state before letting the window close — beforeunload
        // alone can't guarantee the IndexedDB writes flush in time.
        void flushAllSessionsRef.current().finally(() => sai.confirmQuit?.());
        return;
      }
      setQuitConfirmTasks(streaming);
    });
    return cleanup;
  }, []);

  // Initialize the swarm IndexedDB once.
  useEffect(() => {
    (async () => {
      try {
        await swarmInit();
      } catch {
        /* best-effort: ignore init failures */
      }
    })();
  }, []);

  // Hydrate persisted swarm tasks for a workspace the first time it becomes
  // active: load tasks, reconcile zombie (streaming/awaiting_approval) tasks to
  // paused, prune approvals whose task is gone, then seed in-memory state.
  // The workspace is marked hydrated only AFTER its persistence baseline is set
  // (and an in-flight guard prevents re-entry), so the persistence effect —
  // which skips non-hydrated workspaces — never runs against an empty baseline
  // mid-load.
  useEffect(() => {
    const ws = activeProjectPath;
    if (!ws || hydratedWorkspacesRef.current.has(ws) || hydrationInFlightRef.current.has(ws)) return;
    hydrationInFlightRef.current.add(ws);
    let cancelled = false;
    (async () => {
      try {
        const { tasks, liveApprovals } = await hydrateWorkspaceSwarm(ws);
        if (cancelled) return;
        // Establish the persistence baseline and mark hydrated together, before
        // seeding state, so the persistence effect only ever sees a correct
        // baseline for this workspace.
        persistedTasksRef.current.set(ws, tasks);
        hydratedWorkspacesRef.current.add(ws);
        setSwarmTasksByWs(prev => {
          const m = new Map(prev);
          // Don't clobber any tasks spawned before hydrate resolved.
          const existing = m.get(ws) ?? [];
          const existingIds = new Set(existing.map(t => t.id));
          const merged = [...existing, ...tasks.filter(t => !existingIds.has(t.id))];
          m.set(ws, merged);
          return m;
        });
        setSwarmApprovalsByWs(prev => {
          const m = new Map(prev);
          m.set(ws, liveApprovals);
          return m;
        });
      } catch (err) {
        // best-effort: a hydrate failure shouldn't crash the workspace. Leaving
        // the ws un-hydrated lets a later activation retry.
        console.error('swarm: hydrate failed', err);
      } finally {
        hydrationInFlightRef.current.delete(ws);
      }
    })();
    return () => { cancelled = true; };
  }, [activeProjectPath]);

  // Keep sidebarOpenRef in sync so workspace-switch can read the current value.
  useEffect(() => { sidebarOpenRef.current = sidebarOpen; }, [sidebarOpen]);

  // Close provider-specific sidebars when switching to a provider that doesn't support them.
  useEffect(() => {
    const caps = getCapabilities(aiProvider);
    setSidebarOpen(prev => {
      if (prev === 'mcp' && !caps.hasMcp) return null;
      if (prev === 'plugins' && !caps.hasPlugins) return null;
      if (prev === 'swarm' && !caps.hasOrchestrator) return null;
      return prev;
    });
  }, [aiProvider]);
  const swarmSelectedRef = useRef<string>('overview');
  useEffect(() => { swarmSelectedRef.current = swarmSelected; }, [swarmSelected]);

  useEffect(() => {
    // Save the outgoing workspace's sidebar tab and swarm selection so we
    // can restore them when the user switches back. Without this, returning
    // to a workspace with an active swarm would reset to Overview and
    // trigger the "leaving swarm" routing branch — which calls
    // handleSelectSession on the wrong workspace, wiping messages.
    const prev = activeProjectPathRef.current;
    if (prev) {
      sidebarByWsRef.current.set(prev, sidebarOpenRef.current);
      swarmSelectedByWsRef.current.set(prev, swarmSelectedRef.current);
    }
    // Restore the incoming workspace's sidebar tab and swarm selection.
    // Use functional updates to avoid unnecessary re-renders when the
    // restored value matches the current state.
    const restored = sidebarByWsRef.current.get(activeProjectPath) ?? null;
    const restoredSwarm = swarmSelectedByWsRef.current.get(activeProjectPath) ?? 'overview';
    if (prev) {
      setSidebarOpen(prev => prev === restored ? prev : restored);
      setSwarmSelected(prev => prev === restoredSwarm ? prev : restoredSwarm);
    }

    activeProjectPathRef.current = activeProjectPath;
    setActiveWorkspace(activeProjectPath);
    window.sai.workspaceSetActive(activeProjectPath);
  }, [activeProjectPath]);

  // Refresh approvals whenever tasks change (status transitions to/from awaiting_approval)
  // or when the active workspace changes.
  useEffect(() => {
    if (!activeProjectPath) return;
    let cancelled = false;
    swarmGetApprovals(activeProjectPath).then(approvals => {
      if (cancelled) return;
      setSwarmApprovalsByWs(prev => {
        const m = new Map(prev);
        m.set(activeProjectPath, approvals);
        return m;
      });
    }).catch(() => { /* ignore */ });
    return () => { cancelled = true; };
  }, [activeProjectPath, swarmTasksByWs]);

  // Persist swarm task changes. All ~dozen setSwarmTasksByWs sites funnel here:
  // we diff the new map against the last-persisted snapshot per workspace and
  // upsert changed tasks / delete removed ones. Writes are serialized via a
  // FIFO. The full task object is persisted (put), so there is no partial-patch
  // read-modify-write race.
  useEffect(() => {
    const snapshot = swarmTasksByWs;
    persistQueueRef.current = persistQueueRef.current.then(async () => {
      for (const [ws, nextTasks] of snapshot.entries()) {
        // Only persist workspaces that have been hydrated, so the diff baseline
        // is correct (avoids deleting persisted tasks before they're loaded).
        if (!hydratedWorkspacesRef.current.has(ws)) continue;
        const prevTasks = persistedTasksRef.current.get(ws) ?? [];
        const { upserts, deletes } = diffSwarmTasks(prevTasks, nextTasks);
        for (const task of upserts) {
          try { await swarmCreateTask(task); } catch (err) { console.error('swarm: persist upsert failed', task.id, err); }
        }
        for (const id of deletes) {
          try { await swarmDeleteTask(id); } catch (err) { console.error('swarm: persist delete failed', id, err); }
        }
        persistedTasksRef.current.set(ws, nextTasks);
      }
    }).catch(() => { /* keep the queue alive on error */ });
  }, [swarmTasksByWs]);

  // Poll active task counts every 5s into a 12-element ring buffer per
  // workspace so the StatStrip ACTIVE card can render a 60s background
  // sparkline. The poller drives both an "is active now" sample and a
  // re-render bump for sparkline consumers.
  useEffect(() => {
    const tick = () => {
      let changed = false;
      for (const [ws, tasks] of swarmTasksByWsRef.current.entries()) {
        const active = tasks.filter(t =>
          t.status === 'streaming' || t.status === 'queued' || t.status === 'awaiting_approval'
        ).length;
        const entry = activityHistoryRef.current.get(ws) ?? { tools: [], activeBuckets: [] };
        entry.activeBuckets = pushRing(entry.activeBuckets, active, 12);
        activityHistoryRef.current.set(ws, entry);
        changed = true;
      }
      if (changed) setActivityTick(t => t + 1);
    };
    const id = setInterval(tick, 5000);
    return () => clearInterval(id);
  }, []);

  // End-of-batch wrap-up card detection. We watch swarmTasksByWs and, per
  // workspace, treat the period during which active count (streaming+queued
  // +awaiting_approval) > 0 as a "batch window". When the window closes
  // (active returns to 0) AND the batch had >= 2 tasks total, emit a
  // synthetic batch_complete card summarizing landed/discarded/failed +
  // a completion-bucket bar chart.
  useEffect(() => {
    const now = Date.now();
    for (const [ws, tasks] of swarmTasksByWs.entries()) {
      const active = tasks.filter(t =>
        t.status === 'streaming' || t.status === 'queued' || t.status === 'awaiting_approval'
      ).length;
      const landed = tasks.filter(t => t.status === 'landed').length;
      const failed = tasks.filter(t => t.status === 'failed').length;
      const discarded = tasks.filter(t => t.status === 'discarded').length;
      const state = batchStateRef.current.get(ws);
      if (!state) {
        batchStateRef.current.set(ws, {
          activeCount: active,
          startedAt: active > 0 ? now : 0,
          startCount: active,
          completionEvents: [],
          knownTaskIds: new Set(tasks.filter(t =>
            t.status === 'streaming' || t.status === 'queued' || t.status === 'awaiting_approval'
          ).map(t => t.id)),
          landedAtStart: landed,
          failedAtStart: failed,
          discardedAtStart: discarded,
          countersAtStart: { landed, failed, discarded },
        });
        continue;
      }
      // Window opens: 0 → 1+
      if (state.activeCount === 0 && active > 0) {
        state.startedAt = now;
        state.startCount = active;
        state.completionEvents = [];
        state.knownTaskIds = new Set(tasks.filter(t =>
          t.status === 'streaming' || t.status === 'queued' || t.status === 'awaiting_approval'
        ).map(t => t.id));
        state.countersAtStart = { landed, failed, discarded };
      } else if (active > 0) {
        // Window open: discover any newly added active tasks
        for (const t of tasks) {
          if ((t.status === 'streaming' || t.status === 'queued' || t.status === 'awaiting_approval')
              && !state.knownTaskIds.has(t.id)) {
            state.knownTaskIds.add(t.id);
            state.startCount += 1;
          }
        }
        // Track completion timestamps for the bar chart sparkline
        for (const t of tasks) {
          if ((t.status === 'done' || t.status === 'landed' || t.status === 'failed' || t.status === 'discarded')
              && state.knownTaskIds.has(t.id)) {
            // Use lastActivityAt as a proxy for completion time. Dedup by
            // pushing only once per task — track via knownTaskIds removal.
            // We piggy-back on the task lifecycle + a separate completed set.
          }
        }
      }
      // Window closes: > 0 → 0
      if (state.activeCount > 0 && active === 0) {
        const totalTasks = state.startCount;
        if (totalTasks >= 2) {
          const batchLanded = Math.max(0, landed - state.countersAtStart.landed);
          const batchFailed = Math.max(0, failed - state.countersAtStart.failed);
          const batchDiscarded = Math.max(0, discarded - state.countersAtStart.discarded);
          // Build completion buckets from per-task lastActivityAt within window
          const completionTimes: number[] = [];
          for (const t of tasks) {
            if (state.knownTaskIds.has(t.id)
                && (t.status === 'done' || t.status === 'landed' || t.status === 'failed' || t.status === 'discarded')) {
              completionTimes.push(t.lastActivityAt);
            }
          }
          const durationMs = Math.max(0, now - state.startedAt);
          const bucketMs = Math.max(1000, Math.ceil(durationMs / 12));
          const buckets = bucketToolCalls(
            completionTimes.map(ts => ({ ts })),
            now,
            12,
            bucketMs,
          );
          const input = {
            totalTasks,
            landed: batchLanded,
            discarded: batchDiscarded,
            failed: batchFailed,
            durationMs,
            completionBuckets: buckets,
          };
          void (window.sai as any).swarmEmitCard?.(ws, 'batch_complete', input)
            .then((r: { id: string } | null) => {
              if (r?.id) {
                (window.sai as any).swarmEmitCardResult?.(ws, r.id, { ok: true });
              }
            })
            .catch(() => { /* best-effort */ });
          const orchSessionId2 = orchestratorSessionIdByWsRef.current.get(ws);
          if (orchSessionId2) {
            const lines: string[] = [];
            lines.push(`[swarm-status] batch complete.`);
            lines.push(`  totals: ${totalTasks} task(s) in ${Math.round(durationMs / 1000)}s`);
            lines.push(`  landed: ${batchLanded}, discarded: ${batchDiscarded}, failed: ${batchFailed}`);
            lines.push(`  All dispatched tasks have reached a terminal state. Summarize the outcome for the user, or stay silent if you already reported it.`);
            try {
              (window.sai as any).claudeSend?.(
                ws,
                lines.join('\n'),
                undefined,
                'default',
                undefined,
                undefined,
                orchSessionId2,
              );
            } catch { /* best-effort */ }
          }
        }
        state.startCount = 0;
        state.startedAt = 0;
        state.knownTaskIds = new Set();
        state.completionEvents = [];
      }
      state.activeCount = active;
    }
  }, [swarmTasksByWs]);

  const swarmSchedulers = useRef<Map<string, SwarmScheduler>>(new Map());
  // Bump to force OrchestratorView re-render after mutating swarmSettingsRef
  // in place (e.g. when the orchestrator model picker writes a new selection).
  const [swarmSettingsTick, setSwarmSettingsTick] = useState(0);
  void swarmSettingsTick;
  const swarmSettingsRef = useRef<{
    concurrencyCap: number;
    defaultApprovalPolicy: ApprovalPolicy;
    defaultTaskProvider: AIProvider | null;
    defaultTaskModel: string;
    orchestratorProvider: AIProvider | null;
    orchestratorModel: string | null;
    worktreeRoot: string;
    notifyOnComplete: boolean;
    notifyOnApproval: boolean;
  }>({
    concurrencyCap: SWARM_DEFAULT_CAP,
    defaultApprovalPolicy: 'auto-read',
    defaultTaskProvider: null,
    defaultTaskModel: '',
    orchestratorProvider: null,
    orchestratorModel: null,
    worktreeRoot: '',
    notifyOnComplete: false,
    notifyOnApproval: false,
  });

  useEffect(() => {
    const sai = window.sai as any;
    if (!sai?.settingsGet) return;
    Promise.all([
      sai.settingsGet('swarm.concurrencyCap', SWARM_DEFAULT_CAP),
      sai.settingsGet('swarm.defaultApprovalPolicy', 'auto-read'),
      sai.settingsGet('swarm.defaultTaskProvider', null),
      sai.settingsGet('swarm.defaultTaskModel', ''),
      sai.settingsGet('swarm.worktreeRoot', ''),
      sai.settingsGet('swarm.notifyOnComplete', false),
      sai.settingsGet('swarm.notifyOnApproval', false),
      sai.settingsGet('swarm.orchestratorProvider', null),
      sai.settingsGet('swarm.orchestratorModel', null),
    ]).then(([cap, policy, provider, model, root, notifyComplete, notifyApproval, orchProvider, orchModel]) => {
      swarmSettingsRef.current = {
        concurrencyCap: typeof cap === 'number' && cap > 0 ? cap : SWARM_DEFAULT_CAP,
        defaultApprovalPolicy: (policy === 'auto' || policy === 'auto-read' || policy === 'always-ask') ? policy : 'auto-read',
        defaultTaskProvider: (provider === 'claude' || provider === 'codex' || provider === 'gemini') ? provider : null,
        defaultTaskModel: typeof model === 'string' ? model : '',
        orchestratorProvider: (orchProvider === 'claude' || orchProvider === 'codex' || orchProvider === 'gemini') ? orchProvider : null,
        orchestratorModel: typeof orchModel === 'string' && orchModel ? orchModel : null,
        worktreeRoot: typeof root === 'string' ? root : '',
        notifyOnComplete: !!notifyComplete,
        notifyOnApproval: !!notifyApproval,
      };
      // Propagate cap to any already-created schedulers.
      swarmSchedulers.current.forEach(s => s.setCap(swarmSettingsRef.current.concurrencyCap));
      // Request notification permission once if any swarm notification is enabled.
      if ((swarmSettingsRef.current.notifyOnComplete || swarmSettingsRef.current.notifyOnApproval)
        && typeof Notification !== 'undefined' && Notification.permission === 'default') {
        try { Notification.requestPermission().catch(() => {}); } catch {}
      }
    }).catch(() => { /* ignore */ });
  }, []);

  // The scheduler's start callback. Stable so every per-workspace scheduler
  // shares one implementation. On any failure it throws/rejects *after* cleanup
  // so the scheduler releases the reserved cap slot (see SwarmScheduler.launch).
  const makeSwarmOnStart = useCallback(() => async (task: SwarmTask) => {
    const now = Date.now();
    setSwarmTasksByWs(prev => {
      const m = new Map(prev);
      const list = (m.get(task.workspaceId) ?? []).map(t =>
        t.id === task.id ? { ...t, status: 'streaming' as const, lastActivityAt: now } : t
      );
      m.set(task.workspaceId, list);
      return m;
    });
    const removeFromList = () => {
      setSwarmTasksByWs(prev => {
        const m = new Map(prev);
        m.set(task.workspaceId, (m.get(task.workspaceId) ?? []).filter(t => t.id !== task.id));
        return m;
      });
    };
    // Eager worktree materialization for likely-write tasks.
    let effectiveWorktreePath: string | null = task.worktreePath;
    if (!isLikelyReadOnlyPrompt(task.prompt) && !task.worktreePath) {
      try {
        const wt = await (window.sai as any).swarm.worktreeAdd(task.projectPath ?? task.workspaceId, task.id, task.branch, task.baseBranch);
        effectiveWorktreePath = wt;
        setSwarmTasksByWs(prev => {
          const m = new Map(prev);
          const list = (m.get(task.workspaceId) ?? []).map(t =>
            t.id === task.id ? { ...t, worktreePath: wt } : t
          );
          m.set(task.workspaceId, list);
          return m;
        });
      } catch (err) {
        console.error('swarm: worktree materialization failed', err);
        removeFromList();
        throw err; // free the scheduler slot
      }
    }
    // Kick off the provider runner for the task's session.
    // Today only Claude is supported (codex/gemini IPC don't yet thread scope/kind through start).
    try {
      const sai = window.sai as any;
      const dispatched = await runSwarmTask(
        { ...task, worktreePath: effectiveWorktreePath },
        {
          claudeStart: sai.claudeStart,
          claudeSend: sai.claudeSend,
        },
      );
      if (!dispatched) {
        console.warn(`swarm: provider '${task.provider}' is not yet supported for task runner; marking failed`);
        try {
          void (window.sai as any).swarmEmitCard?.(task.workspaceId, 'task_failed', {
            taskId: task.id,
            title: task.title,
            branch: task.branch,
            prompt: task.prompt,
            reason: 'Task runner currently supports Claude only. Codex / Gemini support is a planned follow-up.',
          });
        } catch { /* best-effort */ }
        removeFromList();
        throw new Error(`unsupported provider: ${task.provider}`); // free the slot
      }
    } catch (err) {
      console.error('swarm: provider runner failed to start', err);
      removeFromList();
      throw err; // free the scheduler slot
    }
  }, []);

  const ensureSwarmScheduler = useCallback((ws: string): SwarmScheduler => {
    let s = swarmSchedulers.current.get(ws);
    if (!s) {
      s = new SwarmScheduler({
        cap: swarmSettingsRef.current.concurrencyCap,
        onStart: makeSwarmOnStart(),
      });
      swarmSchedulers.current.set(ws, s);
    }
    return s;
  }, [makeSwarmOnStart]);

  useEffect(() => {
    // Ensure every workspace that has tasks has a scheduler, and feed each its
    // current task list. Ticking all workspaces (not just the active one) lets
    // queued tasks in background workspaces start under the cap.
    for (const [ws, tasks] of swarmTasksByWs.entries()) {
      ensureSwarmScheduler(ws).setTasks(tasks);
    }
  }, [swarmTasksByWs, ensureSwarmScheduler]);

  // Watchdog: periodically fail streaming tasks that have gone silent (provider
  // died without emitting a terminal event), reclaiming their cap slots. Reads
  // tasks via a ref to avoid resetting the interval on every state change.
  useEffect(() => {
    const id = setInterval(() => {
      const now = Date.now();
      let changed = false;
      const next = new Map(swarmTasksByWsRef.current);
      for (const [ws, tasks] of next.entries()) {
        const stale = findStaleTasks(tasks, now, SWARM_STALE_THRESHOLD_MS);
        if (stale.length === 0) continue;
        const staleIds = new Set(stale.map(t => t.id));
        next.set(ws, tasks.map(t =>
          staleIds.has(t.id) ? { ...t, status: 'failed' as const, lastActivityAt: now } : t
        ));
        changed = true;
      }
      if (changed) setSwarmTasksByWs(next);
    }, SWARM_WATCHDOG_INTERVAL_MS);
    return () => clearInterval(id);
  }, []);

  // Fetch diff stats for ready (done) tasks in the active workspace
  useEffect(() => {
    if (!activeProjectPath) return;
    const readyTasks = (swarmTasksByWs.get(activeProjectPath) ?? []).filter(t => t.status === 'done');
    if (readyTasks.length === 0) return;
    let cancelled = false;
    const sai = window.sai as any;
    for (const task of readyTasks) {
      if (swarmDiffStats.has(task.id)) continue;
      if (!sai.swarm?.diffStats) continue;
      sai.swarm.diffStats(task.projectPath ?? task.workspaceId, task.baseBranch, task.branch)
        .then((stats: { additions: number; deletions: number }) => {
          if (cancelled) return;
          setSwarmDiffStats(prev => {
            const m = new Map(prev);
            m.set(task.id, stats);
            return m;
          });
        })
        .catch(() => { /* ignore fetch errors */ });
    }
    return () => { cancelled = true; };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeProjectPath, swarmTasksByWs]);

  async function spawnSwarmTask(input: { prompt: string; provider: AIProvider; model: string; approvalPolicy: ApprovalPolicy; projectPath?: string; projectLinkName?: string }): Promise<SwarmTask> {
    if (!activeProjectPath) throw new Error('no active workspace');
    const id = crypto.randomUUID();
    const sessionId = crypto.randomUUID();
    const title = input.prompt.split('\n')[0].slice(0, 60) || 'task';
    const branch = swarmBranchName(title, id);
    let baseBranch = 'main';
    try {
      const branchInfo = await (window.sai as any).gitBranches?.(input.projectPath ?? activeProjectPath);
      if (branchInfo?.current) baseBranch = branchInfo.current;
    } catch {
      // fall back to 'main'
    }

    const now = Date.now();
    // Synthesize a user message so the task chat panel shows what's being
    // worked on the moment the user clicks the task row — without this the
    // panel renders empty until Claude streams its first reply (~10s).
    const userMsg: ChatMessage = {
      id: crypto.randomUUID(),
      role: 'user',
      content: input.prompt,
      timestamp: now,
    };
    await queueSaveSession(activeProjectPath, {
      id: sessionId,
      title,
      messages: [userMsg],
      aiProvider: input.provider,
      projectPath: activeProjectPath,
      pinned: false,
      messageCount: 1,
      kind: 'task',
      swarmTaskId: id,
      createdAt: now,
      updatedAt: now,
    } as any);

    const task: SwarmTask = {
      id,
      workspaceId: activeProjectPath,
      sessionId,
      title,
      prompt: input.prompt,
      provider: input.provider,
      model: input.model,
      approvalPolicy: input.approvalPolicy,
      status: 'queued',
      branch,
      baseBranch,
      worktreePath: null,
      projectPath: input.projectPath,
      projectLinkName: input.projectLinkName,
      createdAt: now,
      lastActivityAt: now,
      costEstimate: 0,
      toolCallCount: 0,
    };
    setSwarmTasksByWs(prev => {
      const m = new Map(prev);
      m.set(activeProjectPath, [task, ...(m.get(activeProjectPath) ?? [])]);
      return m;
    });
    return task;
  }

  const swarmHost = useMemo<SwarmHost>(() => {
    const ws = activeProjectPath ?? '';

    const wsTasks = () => swarmTasksByWs.get(ws) ?? [];

    // updateTask is a no-op here: task persistence is handled centrally by the
    // diff effect, which deletes a task's row when it's filtered out of the
    // in-memory list (e.g. on land/discard). Local list mutations in the call
    // sites below drive both the UI and that persistence.
    const noopUpdateTask = async () => { /* persistence handled by the diff effect */ };
    const landDeps = {
      canFastForward: (cwd: string, src: string, tgt: string) =>
        (window.sai as any).swarm.canFastForward(cwd, src, tgt),
      ffMerge: async (cwd: string, src: string) => {
        // ffMerge IPC now returns { ok, reason } instead of throwing on
        // diverging branches (so electron doesn't log it as a handler error).
        // Translate ok:false back into a rejection so landTask's existing
        // catch + retry-with-rebase path still fires.
        const r = await (window.sai as any).swarm.ffMerge(cwd, src);
        if (r && typeof r === 'object' && r.ok === false) {
          throw new Error(r.detail || 'ff-merge: diverging branches');
        }
      },
      worktreeRemove: (cwd: string, wt: string, br: string) =>
        (window.sai as any).swarm.worktreeRemove(cwd, wt, br),
      updateTask: noopUpdateTask,
      rebase: (worktreePath: string, baseBranch: string) =>
        (window.sai as any).gitRebase(worktreePath, baseBranch),
      rebaseAbort: (worktreePath: string) =>
        (window.sai as any).gitRebaseAbort(worktreePath),
    };
    const discardDeps = {
      worktreeRemove: (cwd: string, wt: string, br: string) =>
        (window.sai as any).swarm.worktreeRemove(cwd, wt, br),
      updateTask: noopUpdateTask,
    };

    function byRef(ref: string) {
      const t = resolveTaskRef(wsTasks(), ref);
      if (!t) throw new Error(`task not found: ${ref}`);
      return t;
    }

    function stopProvider(task: SwarmTask) {
      const p = task.provider;
      if (p === 'codex') return (window.sai as any).codexStop?.(ws);
      if (p === 'gemini') return (window.sai as any).geminiStop?.(ws);
      return (window.sai as any).claudeStop?.(ws);
    }

    const spawnTask = async (i: { prompt: string; title?: string; provider?: string; model?: string; approvalPolicy?: string; project?: string }) => {
      const cfg = swarmSettingsRef.current;
      const provider = (i.provider as AIProvider) ?? cfg.defaultTaskProvider ?? aiProvider;
      const model = i.model ?? (cfg.defaultTaskModel || undefined) ?? modelChoice;
      const approvalPolicy = (i.approvalPolicy as ApprovalPolicy) ?? cfg.defaultApprovalPolicy ?? 'auto-read';
      let projectPath: string | undefined;
      let projectLinkName: string | undefined;
      if (activeMetaRuntime) {
        if (!i.project) {
          throw new Error(`Meta workspace "${activeMetaRuntime.meta.name}" requires a project. Available: ${activeMetaRuntime.projects.filter(p => p.status === 'ok').map(p => p.linkName).join(', ')}`);
        }
        const match = activeMetaRuntime.projects.find(p => p.linkName === i.project && p.status === 'ok');
        if (!match) {
          throw new Error(`Unknown or unavailable project "${i.project}". Available: ${activeMetaRuntime.projects.filter(p => p.status === 'ok').map(p => p.linkName).join(', ')}`);
        }
        projectPath = match.path;
        projectLinkName = match.linkName;
      }
      const created = await spawnSwarmTask({
        prompt: i.prompt,
        provider,
        model,
        approvalPolicy,
        projectPath,
        projectLinkName,
      });
      return { id: created.id, title: created.title };
    };

    // Resolve an approval by id, routed to the approval's OWN workspace (not
    // the active one), idempotent against double-resolution.
    const resolveApproval = async (approvalId: string, approved: boolean) => {
      if (resolvingApprovalsRef.current.has(approvalId)) return;
      resolvingApprovalsRef.current.add(approvalId);
      try {
        const a = await swarmGetApproval(approvalId);
        if (!a) return;
        const { workspaceId, task, toolUseId } = approvalRoutingTarget(a, swarmTasksByWsRef.current);
        if (task) {
          const scope = task.sessionId;
          const p = task.provider;
          if (p === 'codex') (window.sai as any).codexApprove?.(workspaceId, toolUseId, approved, undefined, scope);
          else if (p === 'gemini') (window.sai as any).geminiApprove?.(workspaceId, toolUseId, approved, undefined, scope);
          else (window.sai as any).claudeApprove?.(workspaceId, toolUseId, approved, undefined, scope);
        }
        await swarmResolveApproval(a.id);
        setSwarmApprovalsByWs(prev => {
          const m = new Map(prev);
          m.set(workspaceId, (m.get(workspaceId) ?? []).filter(x => x.id !== approvalId));
          return m;
        });
        if (task) {
          setApprovalSessions(prev => {
            const inner = prev.get(workspaceId);
            if (!inner || !inner.has(task.sessionId)) return prev;
            const next = new Map(prev);
            const innerNext = new Map(inner);
            innerNext.delete(task.sessionId);
            if (innerNext.size === 0) next.delete(workspaceId);
            else next.set(workspaceId, innerNext);
            return next;
          });
        }
      } finally {
        resolvingApprovalsRef.current.delete(approvalId);
      }
    };

    const host: SwarmHost = {
      spawnTask,
      spawnTasks: async (prompts, projects) => Promise.all(prompts.map((p, idx) => spawnTask({ prompt: p, project: projects?.[idx] }))),
      snapshot: async () => {
        const tasks = wsTasks();
        return {
          active: tasks.filter(t => t.status === 'streaming').length,
          approvals: tasks.filter(t => t.status === 'awaiting_approval').length,
          ready: tasks.filter(t => t.status === 'done').length,
          tasks: tasks.map(t => ({ id: t.id, title: t.title, status: t.status })),
        };
      },
      pause: async (ref) => {
        const t = byRef(ref);
        await stopProvider(t);
        setSwarmTasksByWs(prev => {
          const m = new Map(prev);
          m.set(ws, (m.get(ws) ?? []).map(x => x.id === t.id ? { ...x, status: 'paused' as const } : x));
          return m;
        });
      },
      resume: async (ref) => {
        const t = byRef(ref);
        setSwarmTasksByWs(prev => {
          const m = new Map(prev);
          m.set(ws, (m.get(ws) ?? []).map(x => x.id === t.id ? { ...x, status: 'queued' as const } : x));
          return m;
        });
      },
      approve: async (approvalId) => { await resolveApproval(approvalId, true); },
      deny: async (approvalId) => { await resolveApproval(approvalId, false); },
      land: async (ref) => {
        const t = byRef(ref);
        const r = await landTask(t, landDeps);
        if (r.ok) {
          // Terminal state: drop the card from the sidebar. The underlying
          // ChatSession remains in chat history.
          setSwarmTasksByWs(prev => {
            const m = new Map(prev);
            m.set(ws, (m.get(ws) ?? []).filter(x => x.id !== t.id));
            return m;
          });
          void swarmDeleteApprovalsByTask(t.id).catch(() => { /* best-effort prune */ });
          setSwarmApprovalsByWs(prev => {
            const m = new Map(prev);
            m.set(ws, (m.get(ws) ?? []).filter(x => x.taskId !== t.id));
            return m;
          });
        }
        return r;
      },
      discard: async (ref) => {
        const t = byRef(ref);
        await discardTask(t, discardDeps);
        // Terminal state: drop the card from the sidebar.
        setSwarmTasksByWs(prev => {
          const m = new Map(prev);
          m.set(ws, (m.get(ws) ?? []).filter(x => x.id !== t.id));
          return m;
        });
        void swarmDeleteApprovalsByTask(t.id).catch(() => { /* best-effort prune */ });
        setSwarmApprovalsByWs(prev => {
          const m = new Map(prev);
          m.set(ws, (m.get(ws) ?? []).filter(x => x.taskId !== t.id));
          return m;
        });
      },
    };
    return host;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeProjectPath, activeMetaRuntime, swarmTasksByWs, swarmApprovalsByWs, aiProvider, modelChoice]);

  // Keep a ref to swarmHost so the IPC handler installed once (below) always
  // dispatches against the current host instance, not a stale closure.
  const swarmHostRef = useRef(swarmHost);
  // Serialize land operations across the whole renderer so concurrent clicks
  // (e.g., user fires Land on three TaskCompletedCards in a row) don't race
  // git's main checkout. Each landWithCard call chains onto this promise.
  const landQueueRef = useRef<Promise<unknown>>(Promise.resolve());
  useEffect(() => { swarmHostRef.current = swarmHost; }, [swarmHost]);

  // Inline-card emission for user-initiated swarm actions. Orchestrator-driven
  // tool calls (via MCP) already get synthetic cards from main; these wrappers
  // mirror that behavior for direct UI actions so the orchestrator chat reads
  // as a unified live activity feed.
  const landWithCard = useCallback(async (taskRef: string) => {
    const ws = activeProjectPath ?? '';
    const tasks = swarmTasksByWs.get(ws) ?? [];
    const t = tasks.find(x => x.id === taskRef);
    const sai = (window.sai as any) ?? {};
    // Chain onto the queue so concurrent callers serialize. The emit-card and
    // swarmHost.land sit inside the chained closure to keep the per-land work
    // atomic from git's perspective.
    const next = landQueueRef.current.then(async () => {
      let cardId: string | undefined;
      try {
        const r = await sai.swarmEmitCard?.(ws, 'land', {
          taskRef,
          title: t?.title,
          branch: t?.branch,
        });
        cardId = r?.id;
      } catch { /* noop */ }
      try {
        const result = await swarmHost.land(taskRef);
        if (cardId) {
          try {
            sai.swarmEmitCardResult?.(ws, cardId, {
              ok: result.ok !== false,
              reason: (result as any).reason,
              branch: t?.branch,
              additions: swarmDiffStats.get(taskRef)?.additions ?? 0,
              deletions: swarmDiffStats.get(taskRef)?.deletions ?? 0,
            }, result.ok === false);
          } catch { /* noop */ }
        }
        return result;
      } catch (err) {
        if (cardId) {
          try { sai.swarmEmitCardResult?.(ws, cardId, { ok: false, reason: String(err) }, true); } catch { /* noop */ }
        }
        throw err;
      }
    });
    // Always release the queue even if this land throws, so a single failure
    // doesn't permanently block subsequent lands.
    landQueueRef.current = next.catch(() => {});
    return next;
  }, [activeProjectPath, swarmTasksByWs, swarmHost, swarmDiffStats]);

  const discardWithCard = useCallback(async (taskRef: string) => {
    const ws = activeProjectPath ?? '';
    const tasks = swarmTasksByWs.get(ws) ?? [];
    const t = tasks.find(x => x.id === taskRef);
    const sai = (window.sai as any) ?? {};
    let cardId: string | undefined;
    try {
      const r = await sai.swarmEmitCard?.(ws, 'discard', {
        taskRef,
        title: t?.title,
        branch: t?.branch,
      });
      cardId = r?.id;
    } catch { /* noop */ }
    try {
      await swarmHost.discard(taskRef);
      if (cardId) {
        try { sai.swarmEmitCardResult?.(ws, cardId, { ok: true, branch: t?.branch }, false); } catch { /* noop */ }
      }
    } catch (err) {
      if (cardId) {
        try { sai.swarmEmitCardResult?.(ws, cardId, { ok: false, reason: String(err) }, true); } catch { /* noop */ }
      }
      throw err;
    }
  }, [activeProjectPath, swarmTasksByWs, swarmHost]);

  // Bridge tool calls from the orchestrator MCP socket (main process) into
  // dispatchSwarmTool here in the renderer, then return the result over IPC.
  //
  // Dispatch MCP swarm tool requests from main to the renderer-side host.
  // The synthetic tool_use card injection is now handled in the main process,
  // which emits a synthetic claude:message tagged with the orchestrator's
  // scope. ChatPanel's existing message handler renders it inline.
  useEffect(() => {
    const sai = window.sai as any;
    if (typeof sai?.onSwarmToolRequest !== 'function') return; // mocks / tests

    const unsub = sai.onSwarmToolRequest((req: { id: string; tool: string; input: any; workspace: string }) => {
      if (req.tool === 'inspect_element' || req.tool === 'capture_app') {
        const saiAny = sai as { captureRegion?: (r: { x: number; y: number; width: number; height: number }) => Promise<string | null> };
        void handleSaiQueryToolRequest(
          { tool: req.tool, input: req.input },
          { captureRegion: saiAny.captureRegion },
        ).then(
          (result) =>
            result === null
              ? sai.respondSwarmToolError(req.id, `unhandled query tool: ${req.tool}`)
              : sai.respondSwarmTool(req.id, result),
          (err) => sai.respondSwarmToolError(req.id, err instanceof Error ? err.message : String(err)),
        );
        return;
      }

      if (req.tool === 'capture_window') {
        if (req.input?.display === true) {
          sai.respondSwarmTool(req.id, { ok: false, message: 'Whole-display capture is not supported yet; omit `display` to capture a window.' });
          return;
        }
        const saiAny = sai as { captureWindow?: (o: { target?: string; workspace?: string }) => Promise<{ ok: boolean; [k: string]: unknown }> };
        if (typeof saiAny.captureWindow !== 'function') {
          sai.respondSwarmToolError(req.id, 'capture_window is unavailable in this build');
          return;
        }
        void saiAny.captureWindow({ target: req.input?.target, workspace: req.workspace }).then(
          (result) => sai.respondSwarmTool(req.id, result),
          (err) => sai.respondSwarmToolError(req.id, err instanceof Error ? err.message : String(err)),
        );
        return;
      }

      if (req.tool === 'watch_github_run') {
        const saiAny = sai as { githubApiGet?: (p: string) => Promise<{ ok: boolean; status: number; body: any }> };
        void resolveWatchRun(req.input ?? {}, saiAny.githubApiGet).then(
          (result) => sai.respondSwarmTool(req.id, result),
          (err) => sai.respondSwarmToolError(req.id, err instanceof Error ? err.message : String(err)),
        );
        return;
      }

      if (req.tool === 'render_mermaid') {
        const saiAny = sai as { renderCaptureHtml?: (a: { html: string; width?: number; background?: string }) => Promise<string | null> };
        const diagram = typeof req.input?.diagram === 'string' ? req.input.diagram : '';
        const deps = diagram && typeof saiAny.renderCaptureHtml === 'function'
          ? {
              captureRenderRegion: async () => {
                const svg = await renderMermaidToSvg(diagram);
                const b64 = await saiAny.renderCaptureHtml!({
                  html: svg,
                  width: typeof req.input?.width === 'number' ? req.input.width : undefined,
                  background: (typeof req.input?.background === 'string' && sanitizeCssColor(req.input.background)) || resolveThemedSurface(),
                });
                if (!b64) throw new Error('capture returned no image');
                return { base64: b64, mimeType: 'image/png' as const };
              },
            }
          : {};
        void handleRenderToolRequest(
          { tool: req.tool, input: req.input, renderId: req.id },
          deps,
        ).then(
          (result) => sai.respondSwarmTool(req.id, result),
          (err) => sai.respondSwarmToolError(req.id, err instanceof Error ? err.message : String(err)),
        );
        return;
      }

      if (req.tool === 'render_component' || req.tool === 'render_theme') {
        const saiAny = sai as { renderCaptureComponent?: (a: { component?: string; components?: string[]; props?: Record<string, unknown>; vars?: Record<string, string>; width?: number }) => Promise<string | null> };
        const deps = typeof saiAny.renderCaptureComponent === 'function'
          ? {
              captureRenderRegion: async () => {
                const b64 = await saiAny.renderCaptureComponent!({
                  component: typeof req.input?.component === 'string' ? req.input.component : undefined,
                  components: Array.isArray(req.input?.components) && req.input.components.length > 0
                    ? req.input.components
                    : (req.tool === 'render_theme' ? registeredComponentKeys() : undefined),
                  props: req.input?.props && typeof req.input.props === 'object' ? req.input.props : undefined,
                  vars: req.input?.vars && typeof req.input.vars === 'object' ? req.input.vars : undefined,
                  width: typeof req.input?.width === 'number' ? req.input.width : undefined,
                });
                if (!b64) throw new Error('capture returned no image');
                return { base64: b64, mimeType: 'image/png' as const };
              },
            }
          : {};
        void handleRenderToolRequest(
          { tool: req.tool, input: req.input, renderId: req.id },
          deps,
        ).then(
          (result) => sai.respondSwarmTool(req.id, result),
          (err) => sai.respondSwarmToolError(req.id, err instanceof Error ? err.message : String(err)),
        );
        return;
      }

      if (req.tool === 'pick_file' || req.tool === 'notify' || req.tool === 'clipboard') {
        const saiAny = sai as {
          pickFile?: (o: PickFileOpts) => Promise<string[] | null>;
          notify?: (a: { title: string; body?: string }) => Promise<boolean>;
          clipboardWrite?: (t: string) => Promise<boolean>;
        };
        void handleSaiNativeToolRequest(
          { tool: req.tool, input: req.input },
          { pickFile: saiAny.pickFile, notify: saiAny.notify, clipboardWrite: saiAny.clipboardWrite },
        ).then(
          (result) =>
            result === null
              ? sai.respondSwarmToolError(req.id, `unhandled native tool: ${req.tool}`)
              : sai.respondSwarmTool(req.id, result),
          (err) => sai.respondSwarmToolError(req.id, err instanceof Error ? err.message : String(err)),
        );
        return;
      }

      if (req.tool === 'render_form' || req.tool === 'confirm' || req.tool === 'choose') {
        const { promise } = registerPendingForm(formTimeoutMs(req.input));
        void promise.then(
          (result) => sai.respondSwarmTool(req.id, result),
          (err) => sai.respondSwarmToolError(req.id, err instanceof Error ? err.message : String(err)),
        );
        return;
      }

      // SAI render tools (render_html / render_chart / render_diff) are handled in the
      // renderer: dispatch into the render store, then (for html) screenshot the
      // mock headlessly so the agent can SEE its render without opening a browser
      // tab. renderId = req.id; response goes over the swarm tool channel.
      if (typeof req.tool === 'string' && req.tool.startsWith('render_')) {
        const saiAny = sai as {
          renderCaptureHtml?: (a: { html: string; width?: number; background?: string }) => Promise<string | null>;
          renderCaptureFile?: (a: { cwd: string; path?: string; html?: string; baseDir?: string; width?: number; height?: number }) => Promise<string | null>;
        };
        let htmlInput: string | null = null;
        if (req.tool === 'render_html' && req.input && typeof req.input.html === 'string') {
          htmlInput = req.input.html as string;
        } else if (req.tool === 'render_chart') {
          try {
            htmlInput = buildChartHtml(req.input as ChartInput);
          } catch {
            htmlInput = null;
          }
        } else if (
          req.tool === 'render_diff' &&
          typeof req.input?.before === 'string' && req.input.before.length > 0 &&
          typeof req.input?.after === 'string' && req.input.after.length > 0
        ) {
          htmlInput = buildDiffHtml(req.input as DiffInput);
        }
        const isFileMode =
          req.tool === 'render_html' &&
          (typeof req.input?.path === 'string' || typeof req.input?.baseDir === 'string');
        let deps: Parameters<typeof handleRenderToolRequest>[1];
        if (isFileMode && typeof saiAny.renderCaptureFile === 'function') {
          deps = {
            captureRenderRegion: async () => {
              const b64 = await saiAny.renderCaptureFile!({
                cwd: activeProjectPathRef.current ?? '',
                path: typeof req.input?.path === 'string' ? req.input.path : undefined,
                html: typeof req.input?.html === 'string' ? req.input.html : undefined,
                baseDir: typeof req.input?.baseDir === 'string' ? req.input.baseDir : undefined,
                width: typeof req.input?.width === 'number' ? req.input.width : undefined,
                height: typeof req.input?.height === 'number' ? req.input.height : undefined,
              });
              if (!b64) throw new Error('capture returned no image');
              return { base64: b64, mimeType: 'image/png' as const };
            },
          };
        } else if (htmlInput && typeof saiAny.renderCaptureHtml === 'function') {
          deps = {
            captureRenderRegion: async () => {
              const b64 = await saiAny.renderCaptureHtml!({
                html: htmlInput,
                width: typeof req.input?.width === 'number' ? req.input.width : undefined,
                background: (typeof req.input?.background === 'string' && sanitizeCssColor(req.input.background)) || resolveThemedSurface(),
              });
              if (!b64) throw new Error('capture returned no image');
              return { base64: b64, mimeType: 'image/png' as const };
            },
          };
        } else {
          deps = {};
        }
        const dispatchInput = isFileMode
          ? { ...req.input, cwd: activeProjectPathRef.current ?? '' }
          : req.input;
        void handleRenderToolRequest(
          { tool: req.tool, input: dispatchInput, renderId: req.id },
          deps,
        ).then(
          (result) => sai.respondSwarmTool(req.id, result),
          (err) => sai.respondSwarmToolError(req.id, err instanceof Error ? err.message : String(err)),
        );
        return;
      }
      void handleSwarmToolRequest(req, {
        activeWorkspace: activeProjectPathRef.current,
        host: swarmHostRef.current,
        responder: {
          respond: (id, result) => sai.respondSwarmTool(id, result),
          respondError: (id, error) => sai.respondSwarmToolError(id, error),
        },
      });
    });
    return unsub;
  }, []);

  // Track which workspaces are currently mounted in the chat panel render.
  // When a workspace transitions out of the mounted set (no longer active
  // and no longer busy), persist its in-flight messages into session state
  // so the next remount restores them via initialMessages, then drop the
  // ref entry to free memory.
  const mountedChatRef = useRef<Set<string>>(new Set());
  useEffect(() => {
    const next = new Set<string>();
    workspaces.forEach((_, wsPath) => {
      if (wsPath === activeProjectPath || busyWorkspaces.has(wsPath)) next.add(wsPath);
    });
    const flushes = computeUnmountFlushes({
      prevMounted: mountedChatRef.current,
      nextMounted: next,
      workspaces: workspacesRef.current,
      wsMessages: wsMessagesRef.current,
      wsFirstLoadedIdx: wsFirstLoadedIdxRef.current,
      focusedPath: activeProjectPath,
    });
    for (const { wsPath, session, fromIdx } of flushes) {
      setWorkspaces(p => {
        const cur = p.get(wsPath);
        if (!cur || cur.activeSession.messages === session.messages) return p;
        const updated = new Map(p);
        updated.set(wsPath, { ...cur, activeSession: session });
        return updated;
      });
      queueSaveSession(wsPath, session, fromIdx).catch(() => {});
    }
    for (const wsPath of mountedChatRef.current) {
      if (!next.has(wsPath)) {
        wsMessagesRef.current.delete(wsPath);
        wsFirstLoadedIdxRef.current.delete(wsPath);
      }
    }
    mountedChatRef.current = next;
  }, [activeProjectPath, busyWorkspaces, workspaces]);

  useEffect(() => {
    setExternallyModified(new Set());
  }, [activeProjectPath]);

  // Global Ctrl+K / Cmd+K handler for command palette
  useKeybinding('palette.open', useCallback((e) => {
    e.preventDefault();
    setCommandPaletteOpen(prev => !prev);
  }, []));

  // Build file index for command palette
  useEffect(() => {
    if (!activeProjectPath) { setFileIndex([]); return; }
    let cancelled = false;
    (window as any).sai.fsWalkFiles(activeProjectPath).then((files: string[]) => {
      if (!cancelled) setFileIndex(files);
    }).catch(() => {
      if (!cancelled) setFileIndex([]);
    });
    return () => { cancelled = true; };
  }, [activeProjectPath]);

  const [paletteWorkspaces, setPaletteWorkspaces] = useState<{ projectPath: string; status?: string; lastActivity?: number }[]>([]);

  useEffect(() => {
    let cancelled = false;
    window.sai.metaWorkspaceList?.().then(list => {
      if (!cancelled) setMetaWorkspaces(list ?? []);
    }).catch(() => { if (!cancelled) setMetaWorkspaces([]); });
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    if (!commandPaletteOpen) return;
    let cancelled = false;
    (window as any).sai.workspaceGetAll().then((ws: any[]) => {
      if (!cancelled) setPaletteWorkspaces(ws);
    }).catch(() => { if (!cancelled) setPaletteWorkspaces([]); });
    return () => { cancelled = true; };
  }, [commandPaletteOpen]);

  const getWorkspace = useCallback((path: string): WorkspaceContext => {
    const existing = workspaces.get(path);
    if (existing) return existing;
    return {
      projectPath: path,
      sessions: [],
      activeSession: createSession(),
      openFiles: [],
      activeFilePath: null,
      terminalIds: [],
      terminalTabs: [],
      activeTerminalId: null,
      status: 'recent',
      lastActivity: Date.now(),
    };
  }, [workspaces]);

  const activeWorkspace = activeProjectPath ? getWorkspace(activeProjectPath) : null;

  // Broadcast active workspace+session changes to paired follower devices.
  // Broadcasts even when activeSession is null (empty sessionId) so the phone
  // can re-attach to the workspace as soon as the desktop switches, even
  // before a chat session is loaded.
  useEffect(() => {
    if (!activeWorkspace) {
      activeSessionRef.current = null;
      return;
    }
    const snapshot = {
      projectPath: activeWorkspace.projectPath,
      scope: 'chat',
      sessionId: activeWorkspace.activeSession?.id ?? '',
    };
    activeSessionRef.current = snapshot;
    void (window as any).sai?.remote?.setActiveSession?.(snapshot);
  }, [activeWorkspace?.projectPath, activeWorkspace?.activeSession?.id]);

  const updateWorkspace = useCallback((path: string, updater: (ws: WorkspaceContext) => WorkspaceContext) => {
    setWorkspaces(prev => {
      const next = new Map(prev);
      const current = next.get(path) || (() => {
        return {
        projectPath: path,
        sessions: [],
        activeSession: createSession(),
        openFiles: [],
        activeFilePath: null,
        terminalIds: [],
        terminalTabs: [],
        activeTerminalId: null,
        status: 'active' as const,
        lastActivity: Date.now(),
      };
      })();
      next.set(path, updater(current));
      return next;
    });
  }, []);

  // Apply replace edits to an open file's Monaco editor as a single undo group.
  // Looks up the live editor instance via the registry populated by MonacoEditor.
  // Falls back to rewriting OpenFile.content if no editor is mounted for this path
  // (e.g. the file is "open" in a tab but not the active tab — Monaco editors are
  // mounted per active tab in SAI's CodePanel).
  const applySearchEditsToMonaco = useCallback((filePath: string, edits: { line: number; column: number; length: number; replacement: string }[]) => {
    const editor = getMonacoEditorFor(filePath);
    if (editor) {
      const model = editor.getModel();
      if (model) {
        const ops = edits.map(e => ({
          range: new monaco.Range(e.line, e.column, e.line, e.column + e.length),
          text: e.replacement,
          forceMoveMarkers: true,
        }));
        // pushEditOperations groups all ops into a single undo unit.
        model.pushEditOperations([], ops, () => null);
        return;
      }
    }
    // Fallback: rewrite OpenFile.content in workspace state and mark dirty.
    // The next time the file's tab is shown, MonacoEditor will mount with the
    // updated content as its initial value.
    if (!activeProjectPath) return;
    updateWorkspace(activeProjectPath, ws => ({
      ...ws,
      openFiles: ws.openFiles.map(f => {
        if (f.path !== filePath || typeof f.content !== 'string') return f;
        const next = applyEditsClientSide(f.content, edits);
        return { ...f, content: next, isDirty: true };
      }),
    }));
  }, [activeProjectPath, updateWorkspace]);

  // uid is the stable identity for tabs (used for React keys, activeTerminalId).
  // id is the PTY ID assigned when the terminal process is created.
  const tabUidCounter = useRef(0);

  const handleTabCreate = useCallback(() => {
    if (!activeProjectPath) return;
    const uid = ++tabUidCounter.current;
    updateWorkspace(activeProjectPath, ws => {
      const nextOrder = ws.terminalTabs.length > 0
        ? Math.max(...ws.terminalTabs.map(t => t.order)) + 1
        : 1;
      return {
        ...ws,
        terminalTabs: [...ws.terminalTabs, { uid, id: 0, name: null, order: nextOrder }],
        activeTerminalId: uid,
      };
    });
  }, [activeProjectPath, updateWorkspace]);

  const handleTabClose = useCallback((uid: number) => {
    if (!activeProjectPath) return;
    updateWorkspace(activeProjectPath, ws => {
      const remaining = ws.terminalTabs.filter(t => t.uid !== uid);
      const renumbered = remaining.map((t, i) => ({ ...t, order: i + 1 }));
      let nextActive = ws.activeTerminalId;
      if (nextActive === uid) {
        nextActive = renumbered.length > 0 ? renumbered[renumbered.length - 1].uid : null;
      }
      return {
        ...ws,
        terminalTabs: renumbered,
        terminalIds: ws.terminalIds.filter(tid => {
          const closedTab = ws.terminalTabs.find(t => t.uid === uid);
          return closedTab ? tid !== closedTab.id : true;
        }),
        activeTerminalId: nextActive,
      };
    });
  }, [activeProjectPath, updateWorkspace]);

  const handleTabSwitch = useCallback((uid: number) => {
    if (!activeProjectPath) return;
    updateWorkspace(activeProjectPath, ws => ({
      ...ws,
      activeTerminalId: uid,
    }));
  }, [activeProjectPath, updateWorkspace]);

  const handleTabRename = useCallback((uid: number, name: string) => {
    if (!activeProjectPath) return;
    updateWorkspace(activeProjectPath, ws => {
      const tab = ws.terminalTabs.find(t => t.uid === uid);
      if (tab && tab.id > 0) updateTerminalName(tab.id, name || null);
      return {
        ...ws,
        terminalTabs: ws.terminalTabs.map(t =>
          t.uid === uid ? { ...t, name: name || null } : t
        ),
      };
    });
  }, [activeProjectPath, updateWorkspace]);

  const handleTerminalReady = useCallback((tabUid: number, ptyId: number) => {
    if (!activeProjectPath) return;
    updateWorkspace(activeProjectPath, ws => ({
      ...ws,
      terminalTabs: ws.terminalTabs.map(t => t.uid === tabUid ? { ...t, id: ptyId } : t),
      terminalIds: [...ws.terminalIds, ptyId],
    }));
  }, [activeProjectPath, updateWorkspace]);

  useEffect(() => {
    if (!activeProjectPath) return;
    const ws = getWorkspace(activeProjectPath);
    if (!ws || ws.terminalTabs.length > 0 || ws.status === 'suspended' || ws.status === 'recent') return;
    handleTabCreate();
  }, [activeProjectPath, handleTabCreate, getWorkspace]);

  const handleQueueAdd = useCallback((sessionId: string, text: string, fullText: string, images?: string[], attachments?: { images: number; files: number; terminal: boolean }) => {
    setMessageQueues(prev => {
      const queue = prev.get(sessionId) || [];
      if (queue.length >= 5) return prev;
      const next = new Map(prev);
      next.set(sessionId, [...queue, { id: `q-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`, text, fullText, images, attachments }]);
      return next;
    });
  }, []);

  const handleQueueRemove = useCallback((sessionId: string, id: string) => {
    setMessageQueues(prev => {
      const queue = prev.get(sessionId) || [];
      const next = new Map(prev);
      next.set(sessionId, queue.filter(m => m.id !== id));
      return next;
    });
  }, []);

  const handleQueueShift = useCallback((sessionId: string): void => {
    setMessageQueues(prev => {
      const queue = prev.get(sessionId) || [];
      if (queue.length === 0) return prev;
      const next = new Map(prev);
      next.set(sessionId, queue.slice(1));
      return next;
    });
  }, []);

  const handleQueuePromote = useCallback((sessionId: string, id: string) => {
    setMessageQueues(prev => {
      const queue = prev.get(sessionId) || [];
      const idx = queue.findIndex(m => m.id === id);
      if (idx <= 0) return prev;
      const next = new Map(prev);
      const reordered = [queue[idx], ...queue.slice(0, idx), ...queue.slice(idx + 1)];
      next.set(sessionId, reordered);
      return next;
    });
  }, []);

  // Derived state for the active workspace
  const projectPath = activeProjectPath;
  const sessions = activeWorkspace?.sessions ?? [];
  const activeSession = activeWorkspace?.activeSession ?? createSession();
  const openFiles = activeWorkspace?.openFiles ?? [];
  const activeFilePath = activeWorkspace?.activeFilePath ?? null;

  // Currently-focused swarm task (when swarm sidebar is open and a row is selected).
  const focusedSwarmTask = (sidebarOpen === 'swarm' && swarmSelected !== 'overview')
    ? (swarmTasksByWs.get(activeProjectPath) ?? []).find(t => t.id === swarmSelected)
    : undefined;

  // Load persisted settings from main process (file-based, works in dev+prod)
  useEffect(() => {
    // StrictMode/unmount guard: drop late IPC responses instead of setting
    // state on an unmounted (or remounted) component.
    let cancelled = false;
    const guard = <T,>(fn: (v: T) => void) => (v: T) => { if (!cancelled) fn(v); };
    window.sai.settingsGet('focusedChat', false).then(guard((v: boolean) => setFocusedChat(v)));
    window.sai.settingsGet('overlayEnabled', false).then(guard((v: boolean) => setOverlayEnabled(!!v)));
    window.sai.settingsGet('overlayMode', 'on').then(guard((v: string) => {
      if (v === 'on' || v === 'off' || v === 'persist') setOverlayMode(v);
    }));
    window.sai.settingsGet('sidebarWidth', 300).then((v: number) => {
      document.documentElement.style.setProperty('--sidebar-width', `${v}px`);
    });
    window.sai.settingsGet('editorFontSize', 13).then(guard((v: number) => setEditorFontSize(v)));
    window.sai.settingsGet('editorMinimap', true).then(guard((v: boolean) => setEditorMinimap(v)));
    window.sai.settingsGet('theme', 'default').then((v: string) => {
      if (v !== 'default' && THEMES.some(t => t.id === v)) applyTheme(v as ThemeId);
    });
    window.sai.settingsGet('roundedCorners', false).then((v: boolean) => {
      document.documentElement.classList.toggle('rounded-corners', !!v);
    });
    window.sai.settingsGet('highlightTheme', 'monokai').then(guard((v: string) => {
      if (v !== 'monokai' && HIGHLIGHT_THEMES.some(t => t.id === v)) setActiveHighlightTheme(v as HighlightThemeId);
    }));
    window.sai.settingsGet('aiProvider', 'claude').then(guard((v: string) => {
      if (v === 'claude' || v === 'codex' || v === 'gemini') setAiProvider(v as AIProvider);
    }));
    window.sai.settingsGet('commitMessageProvider', 'claude').then(guard((v: string) => {
      if (v === 'claude' || v === 'codex' || v === 'gemini') setCommitMessageProvider(v as AIProvider);
    }));
    window.sai.settingsGet('aiTitleGeneration', false).then(guard((v: boolean) => {
      setAiTitleGeneration(!!v);
    }));
    // Load nested provider settings
    window.sai.settingsGet('claude', {}).then(guard((c: any) => {
      if (isModelChoice(c.model)) setModelChoice(c.model);
      if (isEffortLevel(c.effort)) setEffortLevel(c.effort);
      if (c.permission === 'default' || c.permission === 'bypass') setPermissionMode(c.permission);
      setClaudeWsOverrides(sanitizeOverrideMap(c.workspaceOverrides, isModelChoice, isEffortLevel));
    }));
    window.sai.settingsGet('codex', {}).then(guard((c: any) => {
      if (c.model) setCodexModel(c.model);
      if (c.permission === 'auto' || c.permission === 'read-only' || c.permission === 'full-access') setCodexPermission(c.permission);
    }));
    window.sai.settingsGet('gemini', {}).then(guard((g: any) => {
      if (g.model) setGeminiModel(g.model);
      if (g.approvalMode === 'default' || g.approvalMode === 'auto_edit' || g.approvalMode === 'yolo' || g.approvalMode === 'plan') setGeminiApprovalMode(g.approvalMode);
      if (g.conversationMode === 'planning' || g.conversationMode === 'fast') setGeminiConversationMode(g.conversationMode);
    }));
    // Migrate flat keys to nested (one-time)
    Promise.all([
      window.sai.settingsGet('modelChoice', null),
      window.sai.settingsGet('effortLevel', null),
      window.sai.settingsGet('permissionMode', null),
      window.sai.settingsGet('codexModel', null),
      window.sai.settingsGet('codexPermission', null),
    ]).then(([mc, el, pm, cm, cp]) => {
      if (mc || el || pm) {
        window.sai.settingsGet('claude', {}).then((existing: any) => {
          const claude = { ...existing };
          if (mc && !claude.model) claude.model = mc;
          if (el && !claude.effort) claude.effort = el;
          if (pm && !claude.permission) claude.permission = pm;
          window.sai.settingsSet('claude', claude);
        });
      }
      if (cm || cp) {
        window.sai.settingsGet('codex', {}).then((existing: any) => {
          const codex = { ...existing };
          if (cm && !codex.model) codex.model = cm;
          if (cp && !codex.permission) codex.permission = cp;
          window.sai.settingsSet('codex', codex);
        });
      }
    });

    // Apply settings synced down from GitHub (fires on startup and after manual sync)
    const unsubApplied = window.sai.githubOnSettingsApplied((remote: Record<string, any>) => {
      if ('editorFontSize' in remote) setEditorFontSize(remote.editorFontSize);
      if ('editorMinimap' in remote) setEditorMinimap(remote.editorMinimap);
      if ('sidebarWidth' in remote) document.documentElement.style.setProperty('--sidebar-width', `${remote.sidebarWidth}px`);
      if ('theme' in remote && THEMES.some(t => t.id === remote.theme)) applyTheme(remote.theme as ThemeId);
      if ('roundedCorners' in remote) document.documentElement.classList.toggle('rounded-corners', !!remote.roundedCorners);
      if ('highlightTheme' in remote && HIGHLIGHT_THEMES.some(t => t.id === remote.highlightTheme)) setActiveHighlightTheme(remote.highlightTheme as HighlightThemeId);
      if ('aiProvider' in remote && (remote.aiProvider === 'claude' || remote.aiProvider === 'codex' || remote.aiProvider === 'gemini')) setAiProvider(remote.aiProvider);
      if ('commitMessageProvider' in remote && (remote.commitMessageProvider === 'claude' || remote.commitMessageProvider === 'codex' || remote.commitMessageProvider === 'gemini')) setCommitMessageProvider(remote.commitMessageProvider);
      if ('aiTitleGeneration' in remote) setAiTitleGeneration(!!remote.aiTitleGeneration);
      if ('claude' in remote && typeof remote.claude === 'object') {
        const c = remote.claude;
        if (isModelChoice(c.model)) setModelChoice(c.model);
        if (c.effort === 'low' || c.effort === 'medium' || c.effort === 'high' || c.effort === 'max') setEffortLevel(c.effort);
        if (c.permission === 'default' || c.permission === 'bypass') setPermissionMode(c.permission);
      }
      if ('codex' in remote && typeof remote.codex === 'object') {
        const c = remote.codex;
        if (c.model) setCodexModel(c.model);
        if (c.permission === 'auto' || c.permission === 'read-only' || c.permission === 'full-access') setCodexPermission(c.permission);
      }
      if ('gemini' in remote && typeof remote.gemini === 'object') {
        const g = remote.gemini;
        if (g.model) setGeminiModel(g.model);
        if (g.approvalMode === 'default' || g.approvalMode === 'auto_edit' || g.approvalMode === 'yolo' || g.approvalMode === 'plan') setGeminiApprovalMode(g.approvalMode);
        if (g.conversationMode === 'planning' || g.conversationMode === 'fast') setGeminiConversationMode(g.conversationMode);
      }
    });
    return () => { cancelled = true; unsubApplied(); };
  }, []);

  // Prefetch Codex models once at startup so they're ready when user switches
  useEffect(() => {
    (window.sai as any).codexModels?.().then((result: { models: { id: string; name: string }[]; defaultModel: string }) => {
      if (result?.models?.length) setCodexModels(result.models);
      if (result?.defaultModel) setCodexModel(prev => prev || result.defaultModel);
    });
  }, []);

  // Prefetch the Claude models this account/org can actually use. Orgs can
  // restrict models and 1M context is gated per-org, so we don't assume every
  // Anthropic model is available — claude:models derives the real set.
  useEffect(() => {
    (window.sai as any).claudeModels?.().then((result: { models: ClaudeModelOption[] }) => {
      if (result?.models?.length) setClaudeModels(result.models);
    }).catch(() => {});
  }, []);

  // If the selected model isn't in the account's allowed set (e.g. a persisted
  // choice whose org access was revoked), fall back to the recommended/default
  // model so we never spawn the CLI with a disallowed --model. Runs whenever the
  // detected list or the selection changes, so it covers the settings-load race.
  useEffect(() => {
    if (!claudeModels.length) return;
    if (claudeModels.some(m => m.id === modelChoice)) return;
    setModelChoice(claudeModels.find(m => m.recommended)?.id ?? claudeModels[0].id);
  }, [claudeModels, modelChoice]);

  // Prefetch Gemini models (hardcoded) at startup
  useEffect(() => {
    (window.sai as any).geminiModels?.().then((result: { models: { id: string; name: string }[]; defaultModel: string }) => {
      if (result?.models?.length) setGeminiModels(result.models);
      if (result?.defaultModel) setGeminiModel(prev => prev || result.defaultModel);
    });
  }, []);

  useEffect(() => {
    window.sai.getCwd().then((cwd: string) => {
      if (cwd) {
        setActiveProjectPath(cwd);
        setWorkspaces(new Map([[cwd, {
          projectPath: cwd,
          sessions: [],
          activeSession: createSession(),
          openFiles: [],
          activeFilePath: null,
          terminalIds: [],
          terminalTabs: [],
          activeTerminalId: null,
          status: 'active',
          lastActivity: Date.now(),
        }]]));
      }
    });
  }, []);

  // Relay GitHub watcher snapshots over the remote bus so the PWA can render
  // its own version of the card without polling the GitHub API itself. The
  // desktop watcher card already broadcasts via window event; we tee it.
  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent<{ messageId: string; snapshot: import('./types').GitHubWatcherSnapshot }>).detail;
      if (!detail?.messageId || !detail.snapshot?.url) return;
      void (window.sai as any).remoteEmitGithubWatcher?.({
        messageId: detail.messageId,
        url: detail.snapshot.url,
        snapshot: detail.snapshot,
      });
    };
    window.addEventListener('sai-github-watcher-snapshot', handler);
    return () => window.removeEventListener('sai-github-watcher-snapshot', handler);
  }, []);

  // One-shot global sweep at app boot: normalize stale `lastViewedAt < updatedAt`
  // rows across EVERY workspace, not just the active one. Earlier app versions
  // (and the unmount-flush path before its companion fix) bumped updatedAt
  // without bumping lastViewedAt, leaving previously-visited sessions in other
  // workspaces looking permanently unread until the user switched to them.
  // Treat app launch as a clean slate everywhere — any unread state generated
  // during this run is preserved because new save paths now stamp lastViewedAt
  // alongside updatedAt for the focused workspace and only bump updatedAt
  // when real message activity occurred.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const all = await dbGetAllSessions();
        if (cancelled) return;
        const stale = all.filter(
          s => s.lastViewedAt == null || s.lastViewedAt < s.updatedAt,
        );
        if (stale.length === 0) return;
        const now = Date.now();
        await Promise.all(stale.map(s => {
          const path = s.projectPath;
          if (!path) return Promise.resolve();
          return dbPatchSessionMeta(path, s.id, { lastViewedAt: s.updatedAt || now }).catch(() => {});
        }));
      } catch {
        // best-effort — don't block app boot on the sweep
      }
    })();
    return () => { cancelled = true; };
  }, []);

  // Migrate localStorage sessions to IndexedDB and load sessions for the active project
  useEffect(() => {
    if (!activeProjectPath) return;
    let cancelled = false;
    (async () => {
      await migrateFromLocalStorage();
      const retentionDays = await window.sai.settingsGet('historyRetention', 14);
      await dbPurgeExpired(retentionDays);
      const sessions = await dbGetSessions(activeProjectPath);
      // Normalize lastViewedAt on load. Two cases:
      //   1. Legacy rows with no lastViewedAt field at all.
      //   2. Rows where prior versions of the periodic-save path bumped
      //      updatedAt every 30s without touching lastViewedAt, leaving
      //      lastViewedAt < updatedAt even though the user never actually
      //      missed anything. We treat app launch as a "clean slate" — any
      //      stale unread state from prior runs is cleared. Real unread
      //      state generated during this run (background workspace turn
      //      completes while user is elsewhere) keeps lastViewedAt < updatedAt
      //      because the new save paths no longer bump updatedAt without
      //      real message activity.
      const now = Date.now();
      const needsBackfill = sessions.filter(
        s => s.lastViewedAt == null || s.lastViewedAt < s.updatedAt,
      );
      if (needsBackfill.length > 0 && !cancelled) {
        await Promise.all(
          needsBackfill.map(s =>
            dbPatchSessionMeta(activeProjectPath, s.id, { lastViewedAt: s.updatedAt || now }).catch(() => {}),
          ),
        );
        for (const s of needsBackfill) {
          s.lastViewedAt = s.updatedAt || now;
        }
      }
      if (!cancelled) {
        updateWorkspace(activeProjectPath, ws => ({ ...ws, sessions }));
        // Seed the in-memory suspendedScopes set from any persisted markers
        // so the yellow indicator survives an app restart. (The backend
        // doesn't restore live processes; sessions stay "suspended" until
        // the user sends a message that respawns them.)
        const reseed = sessions
          .filter(s => s.scopeSuspended)
          .map(s => `${activeProjectPath}:${s.id}`)
          // Don't re-add a scope that streaming_start already cleared in-flight.
          // Without this guard a stale DB read races the async scopeSuspended:false
          // patch and re-marks actively-streaming sessions as suspended.
          .filter(k => !streamingScopesRef.current.has(k));
        if (reseed.length > 0) {
          setSuspendedScopes(prev => {
            const next = new Set(prev);
            for (const k of reseed) next.add(k);
            return next;
          });
        }
      }
      // Handle a deferred "switch to this workspace AND focus this session"
      // request (currently only fired by ApprovalBanner clicks).
      const pending = pendingSessionAfterSwitchRef.current;
      if (!cancelled && pending && pending.projectPath === activeProjectPath) {
        pendingSessionAfterSwitchRef.current = null;
        const target = sessions.find(s => s.id === pending.sessionId);
        if (target) handleSelectSession(pending.sessionId);
      }
    })();
    return () => { cancelled = true; };
  }, [activeProjectPath]);

  // Flush all live sessions to IndexedDB; capped at 2s so quit can never hang
  // on a stuck transaction. Kept in a ref so the quit handlers (registered
  // once with [] deps) always see the live workspace state.
  const flushAllSessionsRef = useRef(async () => {});
  flushAllSessionsRef.current = async () => {
    const flushes = computeQuitFlushes({
      workspaces: workspacesRef.current,
      wsMessages: wsMessagesRef.current,
      wsFirstLoadedIdx: wsFirstLoadedIdxRef.current,
      focusedPath: activeProjectPathRef.current,
    });
    if (flushes.length === 0) return;
    await Promise.race([
      Promise.allSettled(flushes.map(f => queueSaveSession(f.wsPath, f.session, f.fromIdx))),
      new Promise(r => setTimeout(r, 2000)),
    ]);
  };

  // Persist active sessions to IndexedDB before the window closes. This is a
  // best-effort backstop — the awaited flush happens in the quit handshake
  // (onRequestQuit → flush → confirmQuit) before the window is allowed to close.
  useEffect(() => {
    const handleBeforeUnload = () => {
      void flushAllSessionsRef.current();
    };
    window.addEventListener('beforeunload', handleBeforeUnload);
    return () => window.removeEventListener('beforeunload', handleBeforeUnload);
  }, []);

  // Surface persistence failures (previously swallowed silently)
  useEffect(() => {
    const onPersistError = (e: Event) => {
      const detail = (e as CustomEvent).detail as { quota?: boolean; message?: string };
      setToast({
        message: detail?.quota
          ? 'Chat history could not be saved: storage is full. Delete old sessions in Settings.'
          : `Chat history could not be saved: ${detail?.message ?? 'unknown error'}`,
        key: Date.now(),
        tone: 'error',
      });
    };
    window.addEventListener('sai-persist-error', onPersistError);
    return () => window.removeEventListener('sai-persist-error', onPersistError);
  }, []);

  // Periodically persist active sessions as a safety net (every 30s)
  useEffect(() => {
    const interval = setInterval(() => {
      const focusedPath = activeProjectPathRef.current;
      workspacesRef.current.forEach((ws, wsPath) => {
        const latestMessages = wsMessagesRef.current.get(wsPath);
        if (!latestMessages || latestMessages.length === 0) return;
        // Skip the save entirely if no new messages have arrived since the
        // last persist. The earlier behaviour bumped updatedAt every 30s on
        // every workspace's active session, so on the next launch they all
        // appeared unread even though nothing had actually happened.
        if (latestMessages.length === ws.activeSession.messageCount) return;
        const now = Date.now();
        const sessionToSave = {
          ...ws.activeSession,
          messages: latestMessages,
          updatedAt: now,
          ...(wsPath === focusedPath ? { lastViewedAt: now } : {}),
          messageCount: latestMessages.length,
        };
        if (!sessionToSave.title) {
          const firstUserMsg = latestMessages.find(m => m.role === 'user');
          if (firstUserMsg) sessionToSave.title = generateSmartTitle(firstUserMsg.content);
        }
        queueSaveSession(wsPath, sessionToSave, wsFirstLoadedIdxRef.current.get(wsPath) ?? 0).then(() => {
          dbGetSessions(wsPath).then(sessions => {
            updateWorkspace(wsPath, ws2 => ({ ...ws2, sessions }));
          });
        }).catch(() => {});
      });
    }, 30_000);
    return () => clearInterval(interval);
  }, []);

  const [gitChangeCount, setGitChangeCount] = useState(0);

  useEffect(() => {
    if (!projectPath) return;
    const poll = () => {
      (window.sai.gitStatus(projectPath) as Promise<any>).then((status: any) => {
        const paths = new Set<string>();
        for (const item of [...(status.staged ?? []), ...(status.modified ?? []), ...(status.created ?? []), ...(status.deleted ?? []), ...(status.not_added ?? [])]) {
          paths.add(typeof item === 'string' ? item : item.path);
        }
        setGitChangeCount(paths.size);
      }).catch(() => {});
    };
    poll();
    const id = setInterval(poll, 5000);
    return () => clearInterval(id);
  }, [projectPath]);

  useEffect(() => {
    if (!projectPath) return;
    const id = setInterval(() => {
      (window.sai.gitFetch(projectPath) as Promise<void>).catch(() => {});
    }, 60000);
    return () => clearInterval(id);
  }, [projectPath]);

  // Reload-or-banner decision for a single open file whose on-disk content changed.
  // Clean file → swap in the new content (hot reload); dirty file → flag the conflict
  // banner so the user chooses. Shared by the 5s poll and the instant AI-edit trigger.
  const applyExternalChange = useCallback(async (projectPath: string, filePath: string) => {
    const ws = workspacesRef.current.get(projectPath);
    const file = ws?.openFiles.find(f => f.path === filePath);
    if (!file) return;
    if (file.isDirty) {
      setExternallyModified(prev => (prev.has(filePath) ? prev : new Set([...prev, filePath])));
      return;
    }
    try {
      const [content, { mtime }] = await Promise.all([
        window.sai.fsReadFile(filePath) as Promise<string>,
        window.sai.fsMtime(filePath) as Promise<{ mtime: number }>,
      ]);
      updateWorkspace(projectPath, w => ({
        ...w,
        openFiles: w.openFiles.map(f =>
          f.path === filePath
            ? { ...f, content, savedContent: content, isDirty: false, diskMtime: mtime }
            : f
        ),
      }));
    } catch {
      // File may have been deleted/moved between the signal and the read; ignore.
    }
  }, [updateWorkspace]);

  // Re-check each open editor file's mtime and hot-reload (or flag a conflict) any that
  // changed on disk. Reads each file by ITS OWN path, so it's robust to path-normalization
  // differences (e.g. a `/home` → `/var/home` home symlink) between the editor's open path
  // and whatever absolute form an external writer — including the AI — reports. Shared by
  // the 5s poll and the instant AI-edit trigger.
  const resyncOpenFiles = useCallback(async (projectPath: string) => {
    const ws = workspacesRef.current.get(projectPath);
    if (!ws) return;
    const editorFiles = ws.openFiles.filter(
      f => f.viewMode === 'editor' && f.diskMtime !== undefined
    );
    for (const file of editorFiles) {
      try {
        const { mtime } = await (window.sai.fsMtime(file.path) as Promise<{ mtime: number }>);
        if (mtime <= file.diskMtime!) continue;
        await applyExternalChange(projectPath, file.path);
      } catch {
        // File may have been deleted or moved; ignore
      }
    }
  }, [applyExternalChange]);

  // The claude:message effect subscribes once (empty deps) and reads live values via refs,
  // so expose the latest resync through a ref to avoid a stale closure.
  const resyncOpenFilesRef = useRef(resyncOpenFiles);
  resyncOpenFilesRef.current = resyncOpenFiles;

  useEffect(() => {
    if (!projectPath) return;
    const id = setInterval(() => { void resyncOpenFiles(projectPath); }, 5000);
    return () => clearInterval(id);
  }, [projectPath, resyncOpenFiles]);

  // Global Ctrl+H handler for chat history sidebar
  useKeybinding('chatHistory.toggle', useCallback((e) => {
    e.preventDefault();
    setSidebarOpen(prev => prev === 'chats' ? null : 'chats');
  }, []));

  // Global Ctrl+Shift+F / Cmd+Shift+F handler for search sidebar
  useKeybinding('search.toggle', useCallback((e) => {
    e.preventDefault();
    setSidebarOpen(prev => prev === 'search' ? null : 'search');
  }, []));

  useEffect(() => {
    const cleanup = window.sai.onWorkspaceSuspended?.((suspendedPath: string) => {
      updateWorkspace(suspendedPath, ws => ({
        ...ws,
        status: 'suspended',
        terminalIds: [], // PTYs are dead
      }));
    });
    return cleanup;
  }, [updateWorkspace]);

  useEffect(() => {
    if (!activeProjectPath) return;
    const ws = getWorkspace(activeProjectPath);
    if (!ws || ws.status !== 'suspended') return;
    // Mark as active, assign fresh uids so TerminalInstances remount, reset PTY ids
    updateWorkspace(activeProjectPath, ws => {
      const newTabs = ws.terminalTabs.map((t, i) => ({
        ...t,
        uid: ++tabUidCounter.current,
        id: 0, // PTY dead, will be reassigned by onTerminalReady
      }));
      return {
        ...ws,
        status: 'active',
        terminalTabs: newTabs,
        activeTerminalId: newTabs.length > 0 ? newTabs[0].uid : null,
      };
    });
  }, [activeProjectPath, getWorkspace, updateWorkspace]);

  // Listen for background workspace completions
  // Track busy scope count per workspace so overlapping chat+terminal don't cancel each other
  const busyScopeCountRef = useRef(new Map<string, number>());
  // Per-task assistant message buffer for background swarm tasks.
  // Keyed by task sessionId (msg.scope). Flushed to chatDb on done/result so
  // background tasks (whose ChatPanel isn't mounted) still persist Claude's
  // reply alongside the injected user prompt.
  const taskMessagesBufferRef = useRef<Map<string, ChatMessage[]>>(new Map());
  useEffect(() => {
    const cleanup = window.sai.claudeOnMessage((msg: any) => {
      if (!msg.projectPath) return;
      // Hot-reload open files the AI edits: note each edit tool_use, then when its
      // tool_result reports success, re-sync open files by mtime. We don't match the AI's
      // reported path against open files — they can differ (symlinked home, normalization);
      // the mtime resync reads each open file by its own path, which always resolves.
      // Codex sends session_id after streaming_start (it comes from the first
      // Codex output line). Update chatStreamingSessionRef so isStreaming stays
      // true — without this, isStreaming flips false the moment session_id
      // arrives because chatStreamingSessionRef still has null from streaming_start.
      if (msg.type === 'session_id' && (msg.scope || 'chat') === 'chat' && msg.sessionId) {
        chatStreamingSessionRef.current.set(msg.projectPath, msg.sessionId);
      }
      if (msg.type === 'assistant') {
        for (const { id } of extractEditToolUses(msg.message?.content, msg.projectPath)) {
          pendingEditsRef.current.add(id);
        }
      } else if (msg.type === 'user') {
        let editCompleted = false;
        for (const id of successfulToolResultIds(msg.message?.content)) {
          if (pendingEditsRef.current.delete(id)) editCompleted = true;
        }
        if (editCompleted) void resyncOpenFilesRef.current(msg.projectPath);
      }
      // Use composite key (projectPath:scope) for turnSeq tracking
      const scopeKey = `${msg.projectPath}:${msg.scope || 'chat'}`;
      // Swarm status mirror — runs for every workspace+scope so background
      // tasks (whose ChatPanel isn't mounted) still get status/tool-count
      // updates. See src/lib/swarmStatusMirror.ts.
      {
        const tasks = swarmTasksByWsRef.current.get(msg.projectPath) ?? [];
        const mirror = deriveSwarmMirror(msg, tasks);
        if (mirror) {
          const patchedTask = tasks.find(t => t.id === mirror.taskId);
          // Activity history: track tool_use bursts for the per-task
          // sparkline ornaments on SpawnTaskCard.
          if (mirror.patch.kind === 'toolCount') {
            const ws = msg.projectPath as string;
            const entry = activityHistoryRef.current.get(ws) ?? { tools: [], activeBuckets: [] };
            const now = Date.now();
            for (let i = 0; i < mirror.patch.delta; i++) {
              entry.tools.push({ taskId: mirror.taskId, ts: now });
            }
            entry.tools = trimEvents(entry.tools, now);
            activityHistoryRef.current.set(ws, entry);
            setActivityTick(t => t + 1);
          }
          setSwarmTasksByWs(prev => {
            const m = new Map(prev);
            const list = (m.get(msg.projectPath) ?? []).map(t =>
              t.id === mirror.taskId ? applySwarmPatch(t, mirror.patch) : t
            );
            m.set(msg.projectPath, list);
            return m;
          });
          // Emit a completion / failure card into the orchestrator chat so
          // background task lifecycle events appear inline as a live feed.
          if (mirror.patch.kind === 'status' && patchedTask) {
            // A task that reached a terminal status can have no actionable
            // pending approval; prune any stale rows for it.
            void swarmDeleteApprovalsByTask(patchedTask.id).catch(() => { /* best-effort prune */ });
            setSwarmApprovalsByWs(prev => {
              const list = prev.get(msg.projectPath) ?? [];
              if (!list.some(x => x.taskId === patchedTask.id)) return prev;
              const m = new Map(prev);
              m.set(msg.projectPath, list.filter(x => x.taskId !== patchedTask.id));
              return m;
            });
            const statusPatch = mirror.patch;
            const dedupeKey = `${patchedTask.id}:${statusPatch.status}`;
            // claude.ts emits both 'result' and 'done' at end of turn; both pass
            // through the mirror before the ref re-syncs, so skip the second one.
            if (!emittedLifecycleRef.current.has(dedupeKey)) {
              emittedLifecycleRef.current.add(dedupeKey);
              const kind = statusPatch.status === 'done' ? 'task_completed' : 'task_failed';
              const stats = swarmDiffStatsRef.current.get(patchedTask.id);
              const input: Record<string, unknown> = {
                taskId: patchedTask.id,
                title: patchedTask.title,
                branch: patchedTask.branch,
                toolCallCount: patchedTask.toolCallCount,
                durationMs: statusPatch.lastActivityAt - patchedTask.createdAt,
              };
              if (kind === 'task_completed' && stats) {
                input.additions = stats.additions;
                input.deletions = stats.deletions;
              }
              if (kind === 'task_failed') {
                input.prompt = patchedTask.prompt;
                if ((statusPatch as any).reason) input.reason = (statusPatch as any).reason;
              }
              void (window.sai as any).swarmEmitCard?.(msg.projectPath, kind, input)
                .then((r: { id: string } | null) => {
                  if (r?.id) {
                    (window.sai as any).swarmEmitCardResult?.(msg.projectPath, r.id, { ok: statusPatch.status === 'done' });
                  }
                })
                .catch(() => { /* best-effort */ });
              // Notify the orchestrator AI so it can react (spawn a follow-up,
              // abandon a chain, summarize, etc). The orchestrator's system
              // prompt teaches it to reply only when action is required.
              const orchSessionId = orchestratorSessionIdByWsRef.current.get(msg.projectPath);
              if (orchSessionId) {
                const outcome = statusPatch.status === 'done' ? 'completed' : 'failed';
                const lines: string[] = [];
                lines.push(`[swarm-status] task ${patchedTask.title.replace(/[\r\n]+/g, ' ').slice(0, 80)} ${outcome}.`);
                if (patchedTask.projectLinkName) lines.push(`  project: ${patchedTask.projectLinkName}`);
                lines.push(`  branch: ${patchedTask.branch}`);
                lines.push(`  duration: ${Math.round((statusPatch.lastActivityAt - patchedTask.createdAt) / 1000)}s, tools: ${patchedTask.toolCallCount}`);
                if (kind === 'task_completed' && stats) {
                  lines.push(`  diff: +${stats.additions} -${stats.deletions}`);
                }
                if (kind === 'task_failed' && (statusPatch as any).reason) {
                  lines.push(`  reason: ${(statusPatch as any).reason}`);
                }
                // Include the task's final assistant text so the orchestrator
                // can synthesize rollups across tasks. Prefer the live buffer
                // (background task) then fall back to the workspace session's
                // persisted messages (focused task). Truncated to 2000 chars.
                const TASK_OUTPUT_CAP = 2000;
                const collectTextFromMessages = (msgs: ChatMessage[] | undefined): string => {
                  if (!msgs || msgs.length === 0) return '';
                  for (let i = msgs.length - 1; i >= 0; i--) {
                    const m = msgs[i];
                    if (m.role === 'assistant' && typeof m.content === 'string' && m.content.trim()) {
                      return m.content;
                    }
                  }
                  return '';
                };
                let taskOutput = collectTextFromMessages(taskMessagesBufferRef.current.get(patchedTask.sessionId));
                if (!taskOutput) {
                  const wsForTask = workspacesRef.current.get(msg.projectPath);
                  const session = wsForTask?.sessions.find(s => s.id === patchedTask.sessionId);
                  taskOutput = collectTextFromMessages(session?.messages);
                }
                if (taskOutput) {
                  const trimmed = taskOutput.trim();
                  const clipped = trimmed.length > TASK_OUTPUT_CAP
                    ? trimmed.slice(0, TASK_OUTPUT_CAP) + `\n…[truncated, ${trimmed.length - TASK_OUTPUT_CAP} more chars]`
                    : trimmed;
                  lines.push(`  output:\n${clipped.split('\n').map(l => `    ${l}`).join('\n')}`);
                }
                lines.push('  Reply with a follow-up action if needed, otherwise just say "noted".');
                try {
                  (window.sai as any).claudeSend?.(
                    msg.projectPath,
                    lines.join('\n'),
                    undefined,
                    'default',
                    undefined,
                    undefined,
                    orchSessionId,
                  );
                } catch { /* best-effort */ }
              }
            }
          }
        }
      }
      // Background-session assistant message capture. When a session streams
      // while its ChatPanel isn't mounted (user swapped to another session, or
      // the session is a swarm task running off-screen), accumulate assistant
      // chunks here so we can flush them to chatDb on done/result. We skip when
      // the focused workspace's active session IS this scope — in that case
      // ChatPanel's own onTurnComplete handles persistence and a parallel write
      // would race / duplicate.
      if (msg.type === 'assistant' && msg.message?.content) {
        const scope = msg.scope || 'chat';
        if (scope !== 'chat') {
          const focusedWs = workspacesRef.current.get(msg.projectPath);
          const isFocusedHere =
            msg.projectPath === activeProjectPathRef.current
            && focusedWs?.activeSession.id === scope;
          // Always buffer for task scopes, even when focused. There is a race
          // window between when the session becomes active (isFocusedHere=true)
          // and when ChatPanel's useEffect registers its claudeOnMessage
          // listener — messages arriving in that gap would be lost by both
          // paths. The buffer is merged on session select and deduplicated by
          // mergePersistedWithBuffer, so double-capturing is harmless.
          const isTaskScope = (swarmTasksByWsRef.current.get(msg.projectPath) ?? []).some(t => t.sessionId === scope);
          if (!isFocusedHere || isTaskScope) {
            const converted = convertAssistantEnvelope(msg);
            if (converted) {
              const prev = taskMessagesBufferRef.current.get(scope) ?? [];
              taskMessagesBufferRef.current.set(scope, appendAssistantChunk(prev, converted));
            }
          }
        }
      }
      if (msg.type === 'scope_suspended') {
        setSuspendedScopes(prev => prev.has(scopeKey) ? prev : new Set(prev).add(scopeKey));
        // Persist so the yellow indicator survives an app restart. Regular
        // chats use scope === sessionId; the legacy 'chat' default scope
        // isn't backed by a session row and we just skip persistence.
        const scope = msg.scope || 'chat';
        if (scope !== 'chat') {
          void dbPatchSessionMeta(msg.projectPath, scope, { scopeSuspended: true }).catch(() => {});
        }
        return;
      }
      if (msg.type === 'streaming_start') {
        if (msg.turnSeq != null) wsTurnSeqRef.current.set(scopeKey, msg.turnSeq);
        const count = busyScopeCountRef.current.get(msg.projectPath) || 0;
        busyScopeCountRef.current.set(msg.projectPath, count + 1);
        setBusyWorkspaces(prev => new Set(prev).add(msg.projectPath));
        setCompletedWorkspaces(prev => {
          if (!prev.has(msg.projectPath)) return prev;
          const next = new Set(prev);
          next.delete(msg.projectPath);
          return next;
        });
        if ((msg.scope || 'chat') === 'chat') {
          chatStreamingSessionRef.current.set(msg.projectPath, (msg.sessionId ?? null) as string | null);
          setChatStreamingWorkspaces(prev => prev.has(msg.projectPath) ? prev : new Set(prev).add(msg.projectPath));
        }
        setStreamingScopes(prev => prev.has(scopeKey) ? prev : new Set(prev).add(scopeKey));
        // Clear any waiting state for this scope — the turn has resumed.
        setWaitingScopes(prev => {
          if (!prev.has(scopeKey)) return prev;
          const next = new Map(prev); next.delete(scopeKey); return next;
        });
        // Process is alive again — clear any suspended marker for this scope.
        setSuspendedScopes(prev => {
          if (!prev.has(scopeKey)) return prev;
          const next = new Set(prev);
          next.delete(scopeKey);
          return next;
        });
        const scope = msg.scope || 'chat';
        if (scope !== 'chat') {
          void dbPatchSessionMeta(msg.projectPath, scope, { scopeSuspended: false }).catch(() => {});
        }
      }
      // Orchestrator tool drift observability (Task 7).
      // claude.ts forwards assistant messages whose `content` may contain
      // tool_use blocks. With --tools "" + --strict-mcp-config the orchestrator
      // shouldn't have access to any non-swarm tool — log if one slips through.
      if (msg.type === 'assistant' && msg.message?.content && Array.isArray(msg.message.content)) {
        const orchSessionIds = orchestratorSessionIdByWsRef.current;
        const isOrchSession = Array.from(orchSessionIds.values()).includes(msg.scope);
        if (isOrchSession) {
          for (const block of msg.message.content) {
            if (block?.type === 'tool_use' && block.name && isOrchestratorToolDrift(block.name)) {
              // eslint-disable-next-line no-console
              console.warn('[orch-drift]', describeToolDrift(block.name), {
                scope: msg.scope,
                toolName: block.name,
                input: block.input,
              });
            }
          }
        }
      }
      if (msg.type === 'approval_needed') {
        // Swarm-aware interception: if this approval belongs to a swarm task
        // (msg.scope === task.sessionId), consult the task's approval policy.
        const scope = msg.scope || 'chat';
        const swarmTask = scope !== 'chat'
          ? (swarmTasksByWsRef.current.get(msg.projectPath) ?? []).find(t => t.sessionId === scope)
          : undefined;
        if (swarmTask) {
          if (!shouldRequireApproval(swarmTask.approvalPolicy, msg.toolName)) {
            // Auto-approve without surfacing UI or transitioning task state.
            try { (window.sai as any).claudeApprove(msg.projectPath, msg.toolUseId, true, undefined, scope); } catch {}
            // Emit a subtle inline auto_approved card so the orchestrator chat
            // surfaces what would otherwise be silent activity.
            try {
              void (window.sai as any).swarmEmitCard?.(msg.projectPath, 'auto_approved', {
                taskTitle: swarmTask.title,
                toolName: msg.toolName,
                branch: swarmTask.branch,
              });
            } catch { /* best-effort */ }
            return;
          }
          // Fire renderer-side notification (gated by swarm.notifyOnApproval).
          if (swarmSettingsRef.current.notifyOnApproval
            && typeof Notification !== 'undefined' && Notification.permission === 'granted') {
            try {
              new Notification(`SAI · ${swarmTask.title}`, { body: `${msg.toolName} needs approval` });
            } catch {}
          }
          // Approval required: transition the task to awaiting_approval.
          setSwarmTasksByWs(prev => {
            const next = new Map(prev);
            const list = (next.get(msg.projectPath) ?? []).map(t =>
              t.id === swarmTask.id ? { ...t, status: 'awaiting_approval' as const, lastActivityAt: Date.now() } : t
            );
            next.set(msg.projectPath, list);
            return next;
          });

          // Persist the approval so swarmHost.approve/deny can resolve it,
          // then inject an inline approval card into the orchestrator chat
          // for this workspace so the user can act without leaving the chat.
          const approvalId = (typeof crypto !== 'undefined' && crypto.randomUUID)
            ? crypto.randomUUID()
            : `appr-${Date.now()}-${Math.random().toString(36).slice(2)}`;
          const approvalRecord: SwarmApproval = {
            id: approvalId,
            taskId: swarmTask.id,
            workspaceId: msg.projectPath,
            toolName: msg.toolName,
            toolUseId: msg.toolUseId,
            command: msg.command,
            description: msg.description,
            input: msg.input,
            createdAt: Date.now(),
          };
          void swarmCreateApproval(approvalRecord)
            .then(() => {
              setSwarmApprovalsByWs(prev => {
                const m = new Map(prev);
                const list = m.get(msg.projectPath) ?? [];
                if (!list.find(a => a.id === approvalId)) {
                  m.set(msg.projectPath, [...list, approvalRecord]);
                }
                return m;
              });
            })
            .catch(() => { /* ignore — fall back to existing flow */ });

          const orchSessionId = orchestratorSessionIdByWsRef.current.get(msg.projectPath);
          if (orchSessionId) {
            const cardMsg: ChatMessage = {
              id: `appr-msg-${approvalId}`,
              role: 'system',
              content: '',
              timestamp: Date.now(),
              meta: {
                type: 'approval',
                approvalId,
                taskId: swarmTask.id,
                taskTitle: swarmTask.title,
                toolName: msg.toolName,
                command: msg.command,
                branch: swarmTask.branch,
                createdAt: Date.now(),
              },
            };
            const existing = orchMessagesRef.current.get(orchSessionId) ?? [];
            const next = [...existing, cardMsg];
            orchMessagesRef.current.set(orchSessionId, next);
            setOrchMessagesByWs(prev => {
              const m = new Map(prev);
              m.set(orchSessionId, next);
              return m;
            });
          }
        }
        const scopeForApproval = msg.scope || 'chat';
        setApprovalSessions(prev => {
          const next = new Map(prev);
          const inner = new Map(next.get(msg.projectPath) ?? new Map<string, PendingApproval>());
          inner.set(scopeForApproval, {
            toolName: msg.toolName,
            toolUseId: msg.toolUseId,
            command: msg.command,
            description: msg.description,
            input: msg.input,
          });
          next.set(msg.projectPath, inner);
          return next;
        });
        if (msg.projectPath !== activeProjectPathRef.current) {
          setNotificationCounts(p => {
            const next = new Map(p);
            next.set(msg.projectPath, (next.get(msg.projectPath) || 0) + 1);
            return next;
          });
        }
      }
      if (msg.type === 'question_needed') {
        setAwaitingQuestionWorkspaces(prev => applyQuestionEvent(prev, msg));
        if (msg.projectPath !== activeProjectPathRef.current) {
          setNotificationCounts(p => {
            const next = new Map(p);
            next.set(msg.projectPath, (next.get(msg.projectPath) || 0) + 1);
            return next;
          });
        }
      }
      if (msg.type === 'question_answered') {
        setAwaitingQuestionWorkspaces(prev => applyQuestionEvent(prev, msg));
      }
      if (msg.type === 'plan_review_needed') {
        setAwaitingQuestionWorkspaces(prev => applyQuestionEvent(prev, msg));
        if (msg.projectPath !== activeProjectPathRef.current) {
          setNotificationCounts(p => {
            const next = new Map(p);
            next.set(msg.projectPath, (next.get(msg.projectPath) || 0) + 1);
            return next;
          });
        }
      }
      if (msg.type === 'plan_review_answered') {
        setAwaitingQuestionWorkspaces(prev => applyQuestionEvent(prev, msg));
      }
      if (msg.type === 'approval_resolved') {
        const scope = msg.scope || 'chat';
        const swarmTask = scope !== 'chat'
          ? (swarmTasksByWsRef.current.get(msg.projectPath) ?? []).find(t => t.sessionId === scope)
          : undefined;
        if (swarmTask && swarmTask.status === 'awaiting_approval') {
          setSwarmTasksByWs(prev => {
            const next = new Map(prev);
            const list = (next.get(msg.projectPath) ?? []).map(t =>
              t.id === swarmTask.id ? { ...t, status: 'streaming' as const, lastActivityAt: Date.now() } : t
            );
            next.set(msg.projectPath, list);
            return next;
          });
        }
        const resolvedScope = msg.scope || 'chat';
        setApprovalSessions(prev => {
          const inner = prev.get(msg.projectPath);
          if (!inner || !inner.has(resolvedScope)) return prev;
          const next = new Map(prev);
          const innerNext = new Map(inner);
          innerNext.delete(resolvedScope);
          if (innerNext.size === 0) next.delete(msg.projectPath);
          else next.set(msg.projectPath, innerNext);
          return next;
        });
        // Collapse any unresolved inline approval cards for this workspace's
        // orchestrator session. We don't know which specific approval the
        // event corresponds to (the bridge doesn't echo toolUseId), so we
        // mark all currently-pending cards as approved — best-effort. The
        // canonical state lives in swarmDb / swarmApprovalsByWs.
        const orchId = orchestratorSessionIdByWsRef.current.get(msg.projectPath);
        if (orchId) {
          const list = orchMessagesRef.current.get(orchId) ?? [];
          let touched = false;
          const next = list.map(m => {
            if (m.meta?.type === 'approval' && !m.meta.resolved) {
              touched = true;
              return { ...m, meta: { ...m.meta, resolved: 'approved' as const } };
            }
            return m;
          });
          if (touched) {
            orchMessagesRef.current.set(orchId, next);
            setOrchMessagesByWs(prev => {
              const m = new Map(prev);
              m.set(orchId, next);
              return m;
            });
          }
        }
      }
      // Treat 'result' as authoritative end-of-turn — clear busy immediately
      // so the titlebar spinner doesn't stay stuck if the 'done' message is lost.
      if (msg.type === 'result' || msg.type === 'done') {
        setAwaitingQuestionWorkspaces(prev => applyQuestionEvent(prev, msg));
        // Ignore a turn-end message (`result` OR `done`) from a SUPERSEDED turn.
        // When a follow-up is sent mid-flight (interrupt / autonomous chaining), the
        // prior turn's `result` arrives tagged with the old turnSeq while the new turn
        // is already streaming; without this guard it would clear streamingScopes and
        // strip the Stop button + thinking indicator mid-response. `done` was already
        // guarded here; `result` now shares the same check via turnEndIsStale.
        // BUT still decrement busyScopeCountRef — the stale turn did end. Without the
        // decrement, the interrupt scenario leaves the count at 2→1 instead of 2→1→0,
        // keeping busyWorkspaces permanently set.
        if (turnEndIsStale(msg.turnSeq, wsTurnSeqRef.current.get(scopeKey))) {
          const staleCount = busyScopeCountRef.current.get(msg.projectPath) || 0;
          const staleNext = Math.max(0, staleCount - 1);
          busyScopeCountRef.current.set(msg.projectPath, staleNext);
          if (staleNext === 0) {
            setBusyWorkspaces(prev => {
              if (!prev.has(msg.projectPath)) return prev;
              const next = new Set(prev);
              next.delete(msg.projectPath);
              return next;
            });
          }
          return;
        }
        // Branch on wait classification before entering the completion path.
        const waitMeta = (msg as any).wait as WaitMeta | undefined;
        const isWait = !!waitMeta && waitMeta.kind !== 'none';
        if (isWait) {
          // A wait is NOT a completion: stop the thinking indicator but do not
          // notify, toast, or mark the workspace finished. Show the waiting state.
          setWaitingScopes(prev => {
            const next = new Map(prev);
            next.set(scopeKey, { wait: waitMeta!, startedAtMs: Date.now() });
            return next;
          });
          setStreamingScopes(prev => {
            if (!prev.has(scopeKey)) return prev;
            const next = new Set(prev); next.delete(scopeKey); return next;
          });
          if ((msg.scope || 'chat') === 'chat') {
            chatStreamingSessionRef.current.delete(msg.projectPath);
            setChatStreamingWorkspaces(prev => {
              if (!prev.has(msg.projectPath)) return prev;
              const next = new Set(prev); next.delete(msg.projectPath); return next;
            });
          }
          return; // skip the completion/notification path entirely
        }
        // Not a wait — a real end clears any lingering waiting state for this scope.
        setWaitingScopes(prev => {
          if (!prev.has(scopeKey)) return prev;
          const next = new Map(prev); next.delete(scopeKey); return next;
        });
        wsTurnSeqRef.current.set(scopeKey, -1);
        // Swarm-aware completion notification (gated by swarm.notifyOnComplete).
        {
          const scope = msg.scope || 'chat';
          if (scope !== 'chat' && swarmSettingsRef.current.notifyOnComplete) {
            const swarmTask = (swarmTasksByWsRef.current.get(msg.projectPath) ?? []).find(t => t.sessionId === scope);
            if (swarmTask && typeof Notification !== 'undefined' && Notification.permission === 'granted') {
              try {
                new Notification(`SAI · ${swarmTask.title}`, { body: 'Task complete' });
              } catch {}
            }
          }
        }
        // Flush any buffered assistant messages for this background session to
        // chatDb. Merged with the persisted prefix (user prompt + earlier turns)
        // so the session shows the full exchange when the user opens it.
        // ChatPanel's onTurnComplete handles the focused case; the buffer is
        // only populated when the session wasn't focused.
        {
          const scope = msg.scope || 'chat';
          if (scope !== 'chat') {
            const buffered = taskMessagesBufferRef.current.get(scope);
            const turnErrored = isTurnErrored(msg);
            if (buffered && buffered.length > 0) {
              taskMessagesBufferRef.current.delete(scope);
              const wsPath = msg.projectPath;
              void (async () => {
                try {
                  const existing = await dbGetMessages(scope);
                  const merged = mergePersistedWithBuffer(existing, buffered);
                  const sessions = await dbGetSessions(wsPath);
                  const targetSession = sessions.find(s => s.id === scope);
                  if (!targetSession) return;
                  await queueSaveSession(wsPath, {
                    ...targetSession,
                    messages: merged,
                    messageCount: merged.length,
                    updatedAt: Date.now(),
                    lastTurnErrored: turnErrored ? true : false,
                  }, 0);
                  // Refresh sessions list so sidebar message counts update.
                  const refreshed = await dbGetSessions(wsPath);
                  updateWorkspace(wsPath, w => ({ ...w, sessions: refreshed }));
                } catch (err) {
                  // eslint-disable-next-line no-console
                  console.error('background-session: persist messages failed', err);
                }
              })();
            } else if (turnErrored) {
              // No buffered assistant content (e.g. immediate error) — still
              // stamp the session so the sidebar shows the error indicator.
              const wsPath = msg.projectPath;
              void (async () => {
                try {
                  const sessions = await dbGetSessions(wsPath);
                  const targetSession = sessions.find(s => s.id === scope);
                  if (!targetSession) return;
                  await queueSaveSession(wsPath, {
                    ...targetSession,
                    updatedAt: Date.now(),
                    lastTurnErrored: true,
                  }, 0);
                  const refreshed = await dbGetSessions(wsPath);
                  updateWorkspace(wsPath, w => ({ ...w, sessions: refreshed }));
                } catch { /* best-effort */ }
              })();
            }
          }
        }
        if ((msg.scope || 'chat') === 'chat') {
          chatStreamingSessionRef.current.delete(msg.projectPath);
        }
        setStreamingScopes(prev => {
          if (!prev.has(scopeKey)) return prev;
          const next = new Set(prev);
          next.delete(scopeKey);
          return next;
        });
        // Decrement busy scope count
        const count = busyScopeCountRef.current.get(msg.projectPath) || 0;
        const newCount = Math.max(0, count - 1);
        busyScopeCountRef.current.set(msg.projectPath, newCount);
        // Only remove from busyWorkspaces when ALL scopes are done
        if (newCount === 0) {
          setBusyWorkspaces(prev => {
            if (!prev.has(msg.projectPath)) return prev;
            const next = new Set(prev);
            next.delete(msg.projectPath);
            if (msg.projectPath !== activeProjectPathRef.current) {
              const wsName = basename(msg.projectPath);
              setTimeout(() => {
                setCompletedWorkspaces(p => new Set(p).add(msg.projectPath));
                setNotificationCounts(p => {
                  const next = new Map(p);
                  next.set(msg.projectPath, (next.get(msg.projectPath) || 0) + 1);
                  return next;
                });
                setToast({ message: `${wsName} has finished`, key: Date.now() });
              }, 300);
            }
            return next;
          });
        }
        // Clear chatStreamingWorkspaces whenever the chat scope ends.
        // Placed after setBusyWorkspaces; React 18 auto-batches all setState
        // calls in the same synchronous handler so no extra render is produced.
        if ((msg.scope || 'chat') === 'chat') {
          setChatStreamingWorkspaces(prev => {
            if (!prev.has(msg.projectPath)) return prev;
            const next = new Set(prev);
            next.delete(msg.projectPath);
            return next;
          });
        }
      }
    });
    return cleanup;
  }, []);


  // Accordion state
  const [expanded, setExpanded] = useState<PanelId[]>(['chat', 'terminal']);
  // Split ratio: fraction of available space given to the first expanded panel (0.0–1.0)
  const [splitRatio, setSplitRatio] = useState(0.66);
  const [isDragging, setIsDragging] = useState(false);
  const mainContentRef = useRef<HTMLDivElement>(null);

  const togglePanel = useCallback((panel: PanelId) => {
    setExpanded((prev: PanelId[]) => {
      // Focused chat mode: chat stays at 66%, editor/terminal toggle in the 34% slot
      if (focusedChat) {
        if (panel === 'chat') {
          if (prev.includes('chat')) {
            const next = prev.filter(p => p !== 'chat') as PanelId[];
            return next.length === 0 ? prev : next;
          }
          return prev.includes('chat') ? prev : (['chat' as PanelId, ...prev.filter(p => p !== 'chat')].slice(0, 2) as PanelId[]);
        }
        // Editor or terminal: swap into the secondary slot alongside chat
        if (prev.includes(panel)) {
          const next = prev.filter(p => p !== panel) as PanelId[];
          return next.length === 0 ? prev : next;
        }
        if (prev.includes('chat')) {
          setSplitRatio(0.66);
          return ['chat', panel] as PanelId[];
        }
        return [...prev, panel].slice(0, 2) as PanelId[];
      }

      // Default mode
      if (prev.includes(panel)) {
        const next = prev.filter(p => p !== panel) as PanelId[];
        if (next.length === 0) return prev;
        setSplitRatio(0.66);
        return next;
      } else {
        const next = [...prev, panel] as PanelId[];
        setSplitRatio(0.66);
        return next.length > 2 ? next.slice(1) as PanelId[] : next;
      }
    });
  }, [focusedChat]);

  // Drag handling — listeners registered synchronously in onMouseDown to avoid
  // a race where mouseup fires before useEffect registers the listener.
  const hasFiles = openFiles.length > 0;
  const expandedRef = useRef(expanded);
  expandedRef.current = expanded;
  const hasFilesRef = useRef(hasFiles);
  hasFilesRef.current = hasFiles;

  const handleDragStart = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    setIsDragging(true);

    const handleMouseMove = (e: MouseEvent) => {
      if (!mainContentRef.current) return;
      const rect = mainContentRef.current.getBoundingClientRect();
      const curHasFiles = hasFilesRef.current;
      const curExpanded = expandedRef.current;
      const panels: PanelId[] = curHasFiles ? ['chat', 'editor', 'terminal'] : ['chat', 'terminal'];
      const expandedPanels = panels.filter(p => curExpanded.includes(p));
      const barHeight = panels.length * 32;
      const handleHeight = 6;
      const availableHeight = rect.height - barHeight - handleHeight;
      const mouseY = e.clientY - rect.top;

      let firstBarOffset = 0;
      for (const p of panels) {
        if (p === expandedPanels[0]) break;
        firstBarOffset += 32;
      }
      const relativeY = mouseY - firstBarOffset - 32;
      const ratio = Math.max(0.15, Math.min(0.85, relativeY / availableHeight));
      setSplitRatio(ratio);
    };

    const handleMouseUp = () => {
      setIsDragging(false);
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
    };

    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);
  }, []);

  // Determine which panels are visible and which are expanded
  const allPanels: PanelId[] = hasFiles ? ['chat', 'editor', 'terminal'] : ['chat', 'terminal'];
  const expandedPanels = allPanels.filter(p => expanded.includes(p));
  const twoExpanded = expandedPanels.length === 2;

  const handleFileClick = useCallback((file: GitFile) => {
    if (!activeProjectPath) return;
    updateWorkspace(activeProjectPath, ws => {
      const exists = ws.openFiles.some(f => f.path === file.path);
      return {
        ...ws,
        openFiles: exists ? ws.openFiles : [...ws.openFiles, { path: file.path, viewMode: 'diff', file, diffMode: 'unified' }],
        activeFilePath: file.path,
      };
    });
    setExpanded(prev => {
      if (prev.includes('editor')) return prev;
      if (focusedChat && prev.includes('chat')) {
        setSplitRatio(0.66);
        return ['chat', 'editor'];
      }
      const next = [...prev, 'editor' as PanelId];
      setSplitRatio(0.66);
      return next.length > 2 ? next.slice(1) : next;
    });
  }, [activeProjectPath, updateWorkspace, focusedChat]);

  const handleFileOpen = useCallback(async (filePath: string, line?: number) => {
    if (!activeProjectPath) return;
    try {
      if (isImageFile(filePath)) {
        const { mtime } = await window.sai.fsMtime(filePath) as { mtime: number };
        updateWorkspace(activeProjectPath, ws => {
          const exists = ws.openFiles.some(f => f.path === filePath);
          return {
            ...ws,
            openFiles: exists
              ? ws.openFiles
              : [...ws.openFiles, { path: filePath, viewMode: 'editor' as const, diskMtime: mtime }],
            activeFilePath: filePath,
          };
        });
      } else {
        const [content, { mtime }] = await Promise.all([
          window.sai.fsReadFile(filePath) as Promise<string>,
          window.sai.fsMtime(filePath) as Promise<{ mtime: number }>,
        ]);
        updateWorkspace(activeProjectPath, ws => {
          const exists = ws.openFiles.some(f => f.path === filePath);
          return {
            ...ws,
            openFiles: exists
              ? ws.openFiles.map(f => f.path === filePath ? { ...f, pendingLine: line } : f)
              : [...ws.openFiles, { path: filePath, viewMode: 'editor', content, savedContent: content, diskMtime: mtime, pendingLine: line }],
            activeFilePath: filePath,
          };
        });
      }
      setExpanded(prev => {
        if (prev.includes('editor')) return prev;
        if (focusedChat && prev.includes('chat')) {
          setSplitRatio(0.66);
          return ['chat', 'editor'];
        }
        const next = [...prev, 'editor' as PanelId];
        setSplitRatio(0.66);
        return next.length > 2 ? next.slice(1) : next;
      });
    } catch {
      // File couldn't be read
    }
  }, [activeProjectPath, updateWorkspace, focusedChat]);

  const doFileClose = useCallback((path: string) => {
    if (!activeProjectPath) return;
    updateWorkspace(activeProjectPath, ws => {
      const next = ws.openFiles.filter(f => f.path !== path);
      let newActive = ws.activeFilePath;
      if (next.length === 0) {
        newActive = null;
        setExpanded(['chat', 'terminal']);
        setSplitRatio(0.66);
      } else if (path === ws.activeFilePath) {
        const idx = ws.openFiles.findIndex(f => f.path === path);
        newActive = next[Math.min(idx, next.length - 1)].path;
      }
      return { ...ws, openFiles: next, activeFilePath: newActive };
    });
  }, [activeProjectPath, updateWorkspace]);

  const handleFileClose = useCallback((path: string) => {
    if (!activeProjectPath) return;
    const ws = workspaces.get(activeProjectPath);
    const file = ws?.openFiles.find(f => f.path === path);
    const isDirty = file?.viewMode === 'editor' && !!file.isDirty;
    if (isDirty) {
      setPendingClose(path);
    } else {
      doFileClose(path);
    }
  }, [activeProjectPath, workspaces, doFileClose]);

  const handleCloseAllFiles = useCallback(() => {
    if (!activeProjectPath) return;
    updateWorkspace(activeProjectPath, ws => ({
      ...ws,
      openFiles: [],
      activeFilePath: null,
    }));
    setExpanded(['chat', 'terminal']);
    setSplitRatio(0.66);
  }, [activeProjectPath, updateWorkspace]);

  const handleDiffModeChange = useCallback((path: string, mode: 'unified' | 'split') => {
    if (!activeProjectPath) return;
    updateWorkspace(activeProjectPath, ws => ({
      ...ws,
      openFiles: ws.openFiles.map(f => f.path === path ? { ...f, diffMode: mode } : f),
    }));
  }, [activeProjectPath, updateWorkspace]);

  const handleToggleMdPreview = useCallback((path: string) => {
    if (!activeProjectPath) return;
    updateWorkspace(activeProjectPath, ws => ({
      ...ws,
      openFiles: ws.openFiles.map(f =>
        f.path === path ? { ...f, mdPreview: !f.mdPreview } : f
      ),
    }));
  }, [activeProjectPath, updateWorkspace]);

  useKeybinding('markdownPreview.toggle', useCallback((e) => {
    e.preventDefault();
    if (!activeProjectPath) return;
    const ws = workspaces.get(activeProjectPath);
    const activePath = ws?.activeFilePath;
    if (activePath && activePath.endsWith('.md')) {
      handleToggleMdPreview(activePath);
    }
  }, [activeProjectPath, workspaces, handleToggleMdPreview]));

  // Mark a workspace's active session as viewed — bump lastViewedAt (persisted +
  // in-memory), the same signal that clears a session's unread "!". Without this,
  // visiting a workspace clears the raw completed flag but computeCompletedWorkspaces
  // re-flags it as unread (updatedAt > lastViewedAt) the moment focus moves away, so
  // the green "completed" squircle never durably clears on visit.
  const markActiveSessionViewed = useCallback((projectPath: string) => {
    const ws = workspacesRef.current.get(projectPath);
    const sid = ws?.activeSession?.id;
    if (!ws || !sid) return;
    const viewedAt = Date.now();
    void dbPatchSessionMeta(projectPath, sid, { lastViewedAt: viewedAt }).catch(() => {});
    updateWorkspace(projectPath, w => ({
      ...w,
      activeSession: { ...w.activeSession, lastViewedAt: viewedAt },
      sessions: w.sessions.map(s => s.id === sid ? { ...s, lastViewedAt: viewedAt } : s),
    }));
  }, [updateWorkspace]);

  const handleProjectSwitch = useCallback((newPath: string) => {
    setActiveMetaRuntime(null);
    if (newPath === activeProjectPath) return;
    window.sai.openRecentProject(newPath);
    setWorkspaces(prev => {
      const next = new Map(prev);
      if (!next.has(newPath)) {
        next.set(newPath, {
          projectPath: newPath,
          sessions: [],
          activeSession: createSession(),
          openFiles: [],
          activeFilePath: null,
          terminalIds: [],
          terminalTabs: [],
          activeTerminalId: null,
          status: 'active',
          lastActivity: Date.now(),
        });
      } else {
        const ws = next.get(newPath)!;
        next.set(newPath, { ...ws, status: 'active', lastActivity: Date.now() });
      }
      return next;
    });
    setActiveProjectPath(newPath);
    setCompletedWorkspaces(prev => {
      const next = new Set(prev);
      next.delete(newPath);
      return next;
    });
    setNotificationCounts(prev => {
      if (!prev.has(newPath)) return prev;
      const next = new Map(prev);
      next.delete(newPath);
      return next;
    });
    // Tie the green-squircle clear to the unread "!" mechanism: visiting marks the
    // workspace's active session viewed so it isn't re-flagged after you switch away.
    markActiveSessionViewed(newPath);
  }, [activeProjectPath, workspaces, markActiveSessionViewed]);

  const handleMetaWorkspaceActivate = useCallback(async (id: string) => {
    const runtime = await window.sai.metaWorkspaceActivate?.(id);
    if (!runtime) return;
    setActiveMetaRuntime(runtime);
    // Inline the workspace switch logic to avoid handleProjectSwitch clearing activeMetaRuntime
    if (runtime.syntheticRoot !== activeProjectPath) {
      setWorkspaces(prev => {
        const next = new Map(prev);
        if (!next.has(runtime.syntheticRoot)) {
          next.set(runtime.syntheticRoot, {
            projectPath: runtime.syntheticRoot,
            sessions: [],
            activeSession: createSession(),
            openFiles: [],
            activeFilePath: null,
            terminalIds: [],
            terminalTabs: [],
            activeTerminalId: null,
            status: 'active',
            lastActivity: Date.now(),
          });
        } else {
          const ws = next.get(runtime.syntheticRoot)!;
          next.set(runtime.syntheticRoot, { ...ws, status: 'active', lastActivity: Date.now() });
        }
        return next;
      });
      setActiveProjectPath(runtime.syntheticRoot);
    }
    setCompletedWorkspaces(prev => {
      if (!prev.has(runtime.syntheticRoot)) return prev;
      const next = new Set(prev);
      next.delete(runtime.syntheticRoot);
      return next;
    });
    setNotificationCounts(prev => {
      if (!prev.has(runtime.syntheticRoot)) return prev;
      const next = new Map(prev);
      next.delete(runtime.syntheticRoot);
      return next;
    });
    markActiveSessionViewed(runtime.syntheticRoot);
  }, [activeProjectPath, markActiveSessionViewed]);

  const handleMetaWorkspaceCreated = useCallback((runtime: MetaWorkspaceRuntime) => {
    setMetaWorkspaces(prev => {
      if (prev.some(m => m.id === runtime.meta.id)) return prev;
      return [...prev, { ...runtime.meta, syntheticRoot: runtime.syntheticRoot }];
    });
    setActiveMetaRuntime(runtime);
    if (runtime.syntheticRoot !== activeProjectPath) {
      setWorkspaces(prev => {
        const next = new Map(prev);
        if (!next.has(runtime.syntheticRoot)) {
          next.set(runtime.syntheticRoot, {
            projectPath: runtime.syntheticRoot,
            sessions: [],
            activeSession: createSession(),
            openFiles: [],
            activeFilePath: null,
            terminalIds: [],
            terminalTabs: [],
            activeTerminalId: null,
            status: 'active',
            lastActivity: Date.now(),
          });
        } else {
          const ws = next.get(runtime.syntheticRoot)!;
          next.set(runtime.syntheticRoot, { ...ws, status: 'active', lastActivity: Date.now() });
        }
        return next;
      });
      setActiveProjectPath(runtime.syntheticRoot);
    }
  }, [activeProjectPath]);

  const handleMetaWorkspaceUpdated = useCallback((runtime: MetaWorkspaceRuntime) => {
    setMetaWorkspaces(prev => prev.map(m => m.id === runtime.meta.id ? { ...runtime.meta, syntheticRoot: runtime.syntheticRoot } : m));
    setActiveMetaRuntime(prev => prev?.meta.id === runtime.meta.id ? runtime : prev);
  }, []);

  const handleMetaWorkspaceDeleted = useCallback((id: string) => {
    setMetaWorkspaces(prev => prev.filter(m => m.id !== id));
    setActiveMetaRuntime(prev => {
      if (prev?.meta.id !== id) return prev;
      // Switch away from the synthetic root
      setActiveProjectPath('');
      return null;
    });
  }, []);

  const handlePaletteCommand = useCallback((command: string) => {
    if (command === 'clear' && activeProjectPath) {
      updateWorkspace(activeProjectPath, ws => ({
        ...ws,
        sessions: ws.sessions.map(s =>
          s.id === ws.activeSession.id ? { ...s, messages: [] } : s
        ),
        activeSession: { ...ws.activeSession, messages: [] },
      }));
      return;
    }
    // Send as a slash command message to the active chat
    if (activeProjectPath) {
      const ws = getWorkspace(activeProjectPath);
      if (!ws) return;
      const sessionId = ws.activeSession.id;
      const text = `/${command}`;
      const msg: QueuedMessage = { id: `q-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`, text, fullText: text, images: [] };
      setMessageQueues(prev => {
        const next = new Map(prev);
        const queue = next.get(sessionId) || [];
        next.set(sessionId, [...queue, msg]);
        return next;
      });
    }
  }, [activeProjectPath, updateWorkspace, getWorkspace]);

  const handleEditorSave = useCallback(async (filePath: string, content: string) => {
    await window.sai.fsWriteFile(filePath, content);
    const { mtime } = await window.sai.fsMtime(filePath) as { mtime: number };
    if (activeProjectPath) {
      updateWorkspace(activeProjectPath, ws => ({
        ...ws,
        openFiles: ws.openFiles.map(f => f.path === filePath ? { ...f, savedContent: content, isDirty: false, diskMtime: mtime } : f),
      }));
    }
  }, [activeProjectPath, updateWorkspace]);

  const handleEditorContentChange = useCallback((filePath: string, content: string) => {
    if (!activeProjectPath) return;
    updateWorkspace(activeProjectPath, ws => ({
      ...ws,
      openFiles: ws.openFiles.map(f => f.path === filePath ? { ...f, content } : f),
    }));
  }, [activeProjectPath, updateWorkspace]);

  const handleEditorDirtyChange = useCallback((filePath: string, dirty: boolean) => {
    if (!activeProjectPath) return;
    updateWorkspace(activeProjectPath, ws => ({
      ...ws,
      openFiles: ws.openFiles.map(f => f.path === filePath ? { ...f, isDirty: dirty } : f),
    }));
  }, [activeProjectPath, updateWorkspace]);

  const handleReloadFile = useCallback(async (filePath: string) => {
    if (!activeProjectPath) return;
    try {
      const [content, { mtime }] = await Promise.all([
        window.sai.fsReadFile(filePath) as Promise<string>,
        window.sai.fsMtime(filePath) as Promise<{ mtime: number }>,
      ]);
      updateWorkspace(activeProjectPath, ws => ({
        ...ws,
        openFiles: ws.openFiles.map(f =>
          f.path === filePath
            ? { ...f, content, savedContent: content, isDirty: false, diskMtime: mtime }
            : f
        ),
      }));
    } catch (err) {
      const name = filePath.split('/').pop() || filePath;
      setToast({ message: `Failed to reload ${name}: ${err instanceof Error ? err.message : String(err)}`, key: Date.now(), tone: 'error' });
    }
    setExternallyModified(prev => {
      const next = new Set(prev);
      next.delete(filePath);
      return next;
    });
  }, [activeProjectPath, updateWorkspace]);

  const handleKeepMyEdits = useCallback(async (filePath: string) => {
    try {
      const { mtime } = await (window.sai.fsMtime(filePath) as Promise<{ mtime: number }>);
      if (activeProjectPath) {
        updateWorkspace(activeProjectPath, ws => ({
          ...ws,
          openFiles: ws.openFiles.map(f =>
            f.path === filePath ? { ...f, diskMtime: mtime } : f
          ),
        }));
      }
    } catch (err) {
      const name = filePath.split('/').pop() || filePath;
      setToast({ message: `Couldn't read ${name}: ${err instanceof Error ? err.message : String(err)}`, key: Date.now(), tone: 'error' });
    }
    setExternallyModified(prev => {
      const next = new Set(prev);
      next.delete(filePath);
      return next;
    });
  }, [activeProjectPath, updateWorkspace]);

  const toggleSidebar = (id: string) => {
    // Flush current chat to storage before opening history so it shows up-to-date
    if (id === 'chats' && activeProjectPath) {
      flushAndPersist(activeProjectPath);
    }
    setSidebarOpen(prev => prev === id ? null : id);
  };

  // Flush latest messages from ref into workspace state and persist to IndexedDB.
  const flushAndPersist = useCallback((wsPath: string) => {
    const ws = workspacesRef.current.get(wsPath);
    if (!ws) return;
    const latestMessages = wsMessagesRef.current.get(wsPath);
    const now = Date.now();
    const hasNewMessages = !!latestMessages
      && latestMessages.length > 0
      && latestMessages.length !== ws.activeSession.messageCount;
    const sessionToSave = hasNewMessages
      ? { ...ws.activeSession, messages: latestMessages!, updatedAt: now, lastViewedAt: now, messageCount: latestMessages!.length }
      : ws.activeSession;
    if (!sessionToSave.title && sessionToSave.messages.length > 0) {
      const firstUserMsg = sessionToSave.messages.find(m => m.role === 'user');
      if (firstUserMsg) sessionToSave.title = generateSmartTitle(firstUserMsg.content);
    }
    if (sessionToSave.messages.length > 0) {
      updateWorkspace(wsPath, ws2 => ({ ...ws2, activeSession: sessionToSave }));
      queueSaveSession(wsPath, sessionToSave, wsFirstLoadedIdxRef.current.get(wsPath) ?? 0).then(() => {
        dbGetSessions(wsPath).then(sessions => {
          updateWorkspace(wsPath, ws2 => ({ ...ws2, sessions }));
        });
      }).catch(() => {});
    }
  }, [updateWorkspace]);

  const handleNewChat = () => {
    if (!activeProjectPath) return;
    flushAndPersist(activeProjectPath);
    // Clear backend sessions so next message starts fresh
    (window.sai as any).codexSetSessionId(activeProjectPath, undefined);
    window.sai.geminiSetSessionId?.(activeProjectPath, undefined, 'chat');
    const fresh = { ...createSession(), lastViewedAt: Date.now() };
    // Surface the new session in the sidebar immediately. It won't be persisted
    // until the user sends their first message (see onMessagesChange below),
    // but having it in the in-memory `sessions` list lets the sidebar render
    // an active row right away instead of waiting for the first AI turn.
    updateWorkspace(activeProjectPath, ws => ({
      ...ws,
      activeSession: fresh,
      sessions: [{ ...fresh, aiProvider }, ...ws.sessions.filter(s => s.id !== fresh.id)],
    }));
  };

  const handleSelectSession = (id: string) => {
    if (!activeProjectPath) return;
    flushAndPersist(activeProjectPath);
    const selected = sessions.find(s => s.id === id);
    if (!selected) return;
    // Rebind the backend Claude scope to the persisted CLI session id so
    // `--resume` is passed on the next spawn. The scope cache is in-memory only
    // and empty after an app restart, so without this the CLI starts a fresh
    // conversation with no history.
    window.sai.claudeSetSessionId(activeProjectPath, selected.claudeSessionId, selected.id);
    (window.sai as any).codexSetSessionId(activeProjectPath, selected.codexSessionId);
    window.sai.geminiSetSessionId?.(activeProjectPath, selected.geminiSessionId, 'chat');
    const viewedAt = Date.now();
    // Persist lastViewedAt so a subsequent dbGetSessions refresh (triggered by
    // background-chat persistence) doesn't roll it back to undefined, leaving
    // the unread indicator perpetually off. Also patch it into the in-memory
    // sessions list so the indicator clears immediately, without waiting for
    // the refresh round-trip.
    void dbPatchSessionMeta(activeProjectPath, selected.id, { lastViewedAt: viewedAt }).catch(() => {});
    // Load the tail from IndexedDB (full messages live there, not in the sessions list).
    dbGetMessagesTail(selected.id, MESSAGE_TAIL_LIMIT).then(({ messages, totalCount }) => {
      // Merge any in-flight buffered assistant content from background streaming.
      // Without this, clicking a streaming swarm task shows blank content because
      // the buffer hasn't been flushed to IndexedDB yet.
      const buffered = taskMessagesBufferRef.current.get(selected.id);
      const merged = buffered && buffered.length > 0
        ? mergePersistedWithBuffer(messages, buffered)
        : messages;
      wsFirstLoadedIdxRef.current.set(activeProjectPath!, totalCount - messages.length);
      updateWorkspace(activeProjectPath!, ws => ({
        ...ws,
        activeSession: { ...selected, messages: merged, lastViewedAt: viewedAt },
        sessions: ws.sessions.map(s => s.id === selected.id ? { ...s, lastViewedAt: viewedAt } : s),
      }));
    });
  };

  // Route the workspace's active session to the focused swarm task's sessionId
  // when a swarm task row is selected. Guarded to avoid loops.
  useEffect(() => {
    if (!activeProjectPath) return;
    if (sidebarOpen !== 'swarm' || swarmSelected === 'overview') {
      lastSwarmRoutedRef.current = null;
      // Leaving the swarm view: if we previously swapped to a task session,
      // restore the pre-swarm regular session so the chat panel reverts.
      // Guard: only restore when the pre-swarm session belongs to THIS
      // workspace — during workspace transitions the effect can fire with a
      // stale saved ref from a different workspace, which would call
      // handleSelectSession cross-workspace and corrupt messages/queues.
      const saved = preSwarmSessionByWsRef.current.get(activeProjectPath);
      if (saved && activeSession.kind === 'task' && saved !== activeSession.id) {
        const inMemorySaved = sessions.find(s => s.id === saved);
        if (inMemorySaved) handleSelectSession(saved);
      }
      preSwarmSessionByWsRef.current.delete(activeProjectPath);
      return;
    }
    const task = (swarmTasksByWs.get(activeProjectPath) ?? []).find(t => t.id === swarmSelected);
    if (!task) return;
    if (lastSwarmRoutedRef.current === task.id) return;
    if (activeSession.id === task.sessionId) {
      lastSwarmRoutedRef.current = task.id;
      return;
    }
    // Remember the regular session we're leaving so we can restore it later.
    if (activeSession.kind !== 'task' && !preSwarmSessionByWsRef.current.has(activeProjectPath)) {
      preSwarmSessionByWsRef.current.set(activeProjectPath, activeSession.id);
    }
    lastSwarmRoutedRef.current = task.id;
    const inMemory = sessions.find(s => s.id === task.sessionId);
    if (inMemory) {
      handleSelectSession(task.sessionId);
    } else {
      // Refresh sessions from db, then select.
      dbGetSessions(activeProjectPath).then(fresh => {
        updateWorkspace(activeProjectPath, ws => ({ ...ws, sessions: fresh }));
        const selected = fresh.find(s => s.id === task.sessionId);
        if (!selected) return;
        window.sai.claudeSetSessionId(activeProjectPath, selected.claudeSessionId, selected.id);
        (window.sai as any).codexSetSessionId(activeProjectPath, selected.codexSessionId);
        window.sai.geminiSetSessionId?.(activeProjectPath, selected.geminiSessionId, 'chat');
        dbGetMessagesTail(selected.id, MESSAGE_TAIL_LIMIT).then(({ messages, totalCount }) => {
          const buffered = taskMessagesBufferRef.current.get(selected.id);
          const merged = buffered && buffered.length > 0
            ? mergePersistedWithBuffer(messages, buffered)
            : messages;
          wsFirstLoadedIdxRef.current.set(activeProjectPath, totalCount - messages.length);
          updateWorkspace(activeProjectPath, ws => ({
            ...ws,
            activeSession: { ...selected, messages: merged },
          }));
        });
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sidebarOpen, swarmSelected, activeProjectPath, swarmTasksByWs]);

  // Ensure a singleton orchestrator session exists when the swarm sidebar opens for a workspace
  useEffect(() => {
    if (sidebarOpen !== 'swarm' || !activeProjectPath) return;
    if (orchestratorSessionIdByWs.has(activeProjectPath)) return;
    ensureOrchestratorSession(activeProjectPath, aiProvider).then(session => {
      setOrchestratorSessionIdByWs(prev => new Map(prev).set(activeProjectPath, session.id));
      // Tell main about this orchestrator session so the swarm MCP host can
      // tag synthetic claude:message events (tool_use cards) with the right
      // scope. ChatPanel filters by scope, so without this the synthetic
      // tool_use blocks get dropped.
      try { (window.sai as any).swarmSetOrchestratorSession?.(activeProjectPath, session.id); } catch { /* noop */ }
      // ChatPanel mounts with claudeScope={session.id} + claudeKind='orchestrator'
      // and triggers ensureProcess on its own with the right args.
      dbGetSessions(activeProjectPath).then(fresh => {
        updateWorkspace(activeProjectPath, ws => ({ ...ws, sessions: fresh }));
      });
      // Load persisted orchestrator messages so ChatPanel mounts with prior
      // history. dbGetSessions returns sessions WITHOUT messages (the messages
      // store is separate), so we have to fetch them explicitly.
      dbGetMessages(session.id).then(msgs => {
        orchMessagesRef.current.set(session.id, msgs);
        setOrchMessagesByWs(prev => {
          const m = new Map(prev);
          m.set(session.id, msgs);
          return m;
        });
      }).catch(() => {});
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sidebarOpen, activeProjectPath]);

  const handleUpdateSessions = useCallback((updated: ChatSession[]) => {
    if (!activeProjectPath) return;
    updateWorkspace(activeProjectPath, ws => {
      // Drop firstUserPersistRef + buffered messages for any session that
      // disappeared from the list (typically: deletes from the sidebar).
      // Otherwise the Set grows unbounded as users churn through chats.
      const nextIds = new Set(updated.map(s => s.id));
      for (const id of Array.from(firstUserPersistRef.current)) {
        if (!nextIds.has(id)) firstUserPersistRef.current.delete(id);
      }
      for (const id of Array.from(taskMessagesBufferRef.current.keys())) {
        if (!nextIds.has(id)) taskMessagesBufferRef.current.delete(id);
      }
      return { ...ws, sessions: updated };
    });
  }, [activeProjectPath, updateWorkspace]);

  const saveClaudeSetting = (key: string, value: any) => {
    window.sai.settingsGet('claude', {}).then((existing: any) => {
      window.sai.settingsSet('claude', { ...existing, [key]: value });
    });
  };

  const saveCodexSetting = (key: string, value: any) => {
    window.sai.settingsGet('codex', {}).then((existing: any) => {
      window.sai.settingsSet('codex', { ...existing, [key]: value });
    });
  };

  const handlePermissionChange = (mode: PermissionMode) => {
    setPermissionMode(mode);
    saveClaudeSetting('permission', mode);
  };

  const handleEffortChange = (level: EffortLevel) => {
    setEffortLevel(level);
    saveClaudeSetting('effort', level);
  };

  const handleModelChange = (model: ModelChoice) => {
    setModelChoice(model);
    saveClaudeSetting('model', model);
  };

  // Side effects stay OUTSIDE the setState updater — StrictMode double-invokes
  // updaters in dev, which would fire duplicate settings writes.
  const handleWorkspaceModelChange = (wsPath: string, model: ModelChoice | null) => {
    const next = setWorkspaceOverride(claudeWsOverrides, wsPath, { model });
    setClaudeWsOverrides(next);
    saveClaudeSetting('workspaceOverrides', next);
  };
  const handleWorkspaceEffortChange = (wsPath: string, effort: EffortLevel | null) => {
    const next = setWorkspaceOverride(claudeWsOverrides, wsPath, { effort });
    setClaudeWsOverrides(next);
    saveClaudeSetting('workspaceOverrides', next);
  };

  const handleCodexModelChange = (model: string) => {
    setCodexModel(model);
    saveCodexSetting('model', model);
  };

  const handleCodexPermissionChange = (perm: CodexPermission) => {
    setCodexPermission(perm);
    saveCodexSetting('permission', perm);
  };

  const saveGeminiSetting = (key: string, value: any) => {
    window.sai.settingsGet('gemini', {}).then((existing: any) => {
      window.sai.settingsSet('gemini', { ...existing, [key]: value });
    });
  };

  const handleGeminiModelChange = (model: string) => {
    setGeminiModel(model);
    saveGeminiSetting('model', model);
  };

  const handleGeminiApprovalModeChange = (mode: GeminiApprovalMode) => {
    setGeminiApprovalMode(mode);
    saveGeminiSetting('approvalMode', mode);
  };

  const handleGeminiConversationModeChange = (mode: GeminiConversationMode) => {
    setGeminiConversationMode(mode);
    saveGeminiSetting('conversationMode', mode);
  };


  const chatOpen = expanded.includes('chat');
  const editorOpen = expanded.includes('editor');
  const terminalOpen = expanded.includes('terminal');

  // Compute flex values: first expanded panel gets splitRatio, second gets the rest
  const getPanelFlex = (panel: PanelId): string => {
    if (!expanded.includes(panel)) return '0 0 32px';
    if (expandedPanels.length === 1) return '1 1 0%';
    const isFirst = expandedPanels[0] === panel;
    const ratio = isFirst ? splitRatio : 1 - splitRatio;
    return `${ratio} ${ratio} 0%`;
  };

  // Should we show a drag handle after this panel?
  const showHandleAfter = (panel: PanelId): boolean => {
    if (!twoExpanded) return false;
    return panel === expandedPanels[0];
  };

  const renderPanel = (panel: PanelId) => {
    const isOpen = expanded.includes(panel);
    const providerSvg = aiProvider === 'codex' ? 'svg/codex.svg' : aiProvider === 'gemini' ? 'svg/Google-gemini-icon.svg' : 'svg/claude.svg';
    const providerColor = aiProvider === 'codex' ? 'var(--text)' : aiProvider === 'gemini' ? '#4285f4' : '#e27b4a';
    const icon = panel === 'chat'
      ? <span className="accordion-provider-icon" style={{
          maskImage: `url('${providerSvg}')`,
          WebkitMaskImage: `url('${providerSvg}')`,
          backgroundColor: providerColor,
          opacity: 1,
        }} />
      : panel === 'editor' ? <Code2 size={12} />
      : <TerminalSquare size={12} />;
    const label = panel === 'chat' ? 'Chat' : panel === 'editor' ? 'Editor' : 'Terminal';

    return (
      <div
        key={panel}
        className={`accordion-panel ${isOpen ? 'accordion-expanded' : 'accordion-collapsed'}`}
        style={{ flex: getPanelFlex(panel), transition: isDragging ? 'none' : undefined }}
      >
        <div className="accordion-bar" onClick={() => togglePanel(panel)}>
          <ChevronRight size={12} className={`accordion-chevron ${isOpen ? 'open' : ''}`} />
          {icon}
          <span>{label}</span>
          {panel === 'editor' && !isOpen && activeFilePath && (
            <span className="accordion-bar-detail">
              {basename(activeFilePath)}
            </span>
          )}
          {panel === 'chat' && (
            <div className="accordion-bar-actions">
              {activeMetaRuntime && activeMetaRuntime.syntheticRoot === activeProjectPath && (
                <IncludedProjectsControl
                  runtime={activeMetaRuntime}
                  onMentionInsert={(linkName) => mentionInsertRef.current?.(linkName)}
                />
              )}
              <button
                className="accordion-bar-btn"
                onClick={(e) => { e.stopPropagation(); handleNewChat(); }}
                title="New conversation"
              >
                <MessageCirclePlus size={12} />
              </button>
            </div>
          )}
        </div>
        <div className="accordion-body-wrapper">
          <div className="accordion-body">
            {panel === 'chat' && workspaces.size === 0 && (
              <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', flex: 1, gap: 16, color: 'var(--text-muted)', padding: 32 }}>
                <WelcomeTypewriter />
                <span style={{ fontSize: 13 }}>Open a folder to get started</span>
                <button
                  style={{ marginTop: 8, padding: '8px 20px', background: 'var(--accent)', color: '#000', border: 'none', borderRadius: 6, cursor: 'pointer', fontSize: 13, fontWeight: 500 }}
                  onClick={async () => {
                    const folder = await window.sai.selectFolder();
                    if (folder) handleProjectSwitch(folder);
                  }}
                >
                  Open Folder
                </button>
              </div>
            )}
            {panel === 'chat' && Array.from(workspaces.entries())
              .filter(([wsPath]) => wsPath === activeProjectPath || busyWorkspaces.has(wsPath))
              .map(([wsPath, ws]) => (
              <div
                key={`chat-${wsPath}`}
                style={{
                  display: wsPath === activeProjectPath ? 'flex' : 'none',
                  flexDirection: 'column',
                  flex: 1,
                  minHeight: 0,
                  overflow: 'hidden',
                }}
              >
                {wsPath === activeProjectPath && focusedSwarmTask && (
                  <SwarmTaskHeader
                    task={focusedSwarmTask}
                    onPause={() => {
                      const id = focusedSwarmTask.id;
                      const task = focusedSwarmTask;
                      // Stop the task's Claude scope so streaming actually halts.
                      try {
                        (window.sai as any).claudeStop?.(task.workspaceId, task.sessionId);
                      } catch { /* noop */ }
                      setSwarmTasksByWs(prev => {
                        const m = new Map(prev);
                        const list = (m.get(activeProjectPath) ?? []).map(t =>
                          t.id === id ? { ...t, status: 'paused' as const } : t
                        );
                        m.set(activeProjectPath, list);
                        return m;
                      });
                    }}
                    onLand={async () => {
                      if (!focusedSwarmTask) return;
                      const taskId = focusedSwarmTask.id;
                      try {
                        const r = await landWithCard(taskId);
                        if (r && (r as any).ok === false && (r as any).reason === 'rebase-needed') {
                          window.alert('Cannot fast-forward: rebase needed before landing.');
                          return;
                        }
                      } catch (err) {
                        console.error('swarm: land failed', err);
                        return;
                      }
                      // Terminal state: drop the card from the sidebar and
                      // bounce the user back to the orchestrator overview so
                      // they aren't staring at a header for a non-existent task.
                      setSwarmTasksByWs(prev => {
                        const m = new Map(prev);
                        m.set(activeProjectPath, (m.get(activeProjectPath) ?? []).filter(t => t.id !== taskId));
                        return m;
                      });
                      setSwarmSelected('overview');
                    }}
                    onDiscard={async () => {
                      if (!focusedSwarmTask) return;
                      const taskId = focusedSwarmTask.id;
                      try {
                        await discardWithCard(taskId);
                      } catch (err) {
                        console.error('swarm: discard failed', err);
                        return;
                      }
                      setSwarmTasksByWs(prev => {
                        const m = new Map(prev);
                        m.set(activeProjectPath, (m.get(activeProjectPath) ?? []).filter(t => t.id !== taskId));
                        return m;
                      });
                      setSwarmSelected('overview');
                    }}
                    onOpenDiff={async () => {
                      if (!focusedSwarmTask) return;
                      const task = focusedSwarmTask;
                      setSwarmDiffModal({
                        title: task.title,
                        branch: task.branch,
                        baseBranch: task.baseBranch,
                        diff: '',
                        loading: true,
                      });
                      try {
                        const sai = (window.sai as any) ?? {};
                        const diff: string = await sai.swarm?.branchDiff?.(task.projectPath ?? task.workspaceId, task.baseBranch, task.branch) ?? '';
                        setSwarmDiffModal({
                          title: task.title,
                          branch: task.branch,
                          baseBranch: task.baseBranch,
                          diff,
                          loading: false,
                        });
                      } catch (err) {
                        setSwarmDiffModal({
                          title: task.title,
                          branch: task.branch,
                          baseBranch: task.baseBranch,
                          diff: '',
                          loading: false,
                          error: err instanceof Error ? err.message : String(err),
                        });
                      }
                    }}
                    onResume={async () => {
                      if (!focusedSwarmTask) return;
                      const task = focusedSwarmTask;
                      // Note: Claude CLI spawns a fresh process per turn, so a
                      // true "resume" isn't possible — this re-dispatches the
                      // original prompt as a new turn. Enqueue and let the
                      // scheduler promote it under the concurrency cap rather
                      // than starting it directly (which would bypass the cap).
                      setSwarmTasksByWs(prev => {
                        const m = new Map(prev);
                        const list = (m.get(activeProjectPath) ?? []).map(t =>
                          t.id === task.id ? { ...t, status: 'queued' as const } : t
                        );
                        m.set(activeProjectPath, list);
                        return m;
                      });
                    }}
                  />
                )}
                {sidebarOpen === 'swarm' && swarmSelected === 'overview' && orchestratorSessionIdByWs.get(wsPath) ? (() => {
                  const orchSessionId = orchestratorSessionIdByWs.get(wsPath)!;
                  const orchSession = ws.sessions.find(s => s.id === orchSessionId);
                  const orchProvider: AIProvider = swarmSettingsRef.current.orchestratorProvider ?? aiProvider;
                  const orchModelRaw = swarmSettingsRef.current.orchestratorModel;
                  const orchModel: ModelChoice = isModelChoice(orchModelRaw) ? orchModelRaw : modelChoice;
                  // Prefer the live ref (set by onMessagesChange) over the
                  // mounted-mirror map; fall back to the map for first mount,
                  // and finally the stored session (which is always empty
                  // because dbGetSessions strips messages — kept as a safety).
                  const orchMessages = orchMessagesRef.current.get(orchSessionId)
                    ?? orchMessagesByWs.get(orchSessionId)
                    ?? orchSession?.messages
                    ?? [];
                  // The orchestrator's model is deliberately swarm-controlled
                  // (swarm.orchestratorModel) — it does NOT participate in
                  // per-workspace overrides, so no claudeOverrideState here.
                  const orchChatSlot = (
                    <ChatPanel
                      key={orchSessionId}
                      projectPath={wsPath}
                      permissionMode={permissionMode}
                      onPermissionChange={handlePermissionChange}
                      effortLevel={effortLevel}
                      onEffortChange={(level) => { if (level) handleEffortChange(level); }}
                      modelChoice={orchModel}
                      onModelChange={(model) => { if (model) handleModelChange(model); }}
                      availableModels={claudeModels}
                      aiProvider={orchProvider}
                      codexModel={codexModel}
                      onCodexModelChange={handleCodexModelChange}
                      codexModels={codexModels}
                      codexPermission={codexPermission}
                      onCodexPermissionChange={handleCodexPermissionChange}
                      geminiModel={geminiModel}
                      onGeminiModelChange={handleGeminiModelChange}
                      geminiModels={geminiModels}
                      geminiApprovalMode={geminiApprovalMode}
                      onGeminiApprovalModeChange={handleGeminiApprovalModeChange}
                      geminiConversationMode={geminiConversationMode}
                      onGeminiConversationModeChange={handleGeminiConversationModeChange}
                                            initialMessages={orchMessages}
                      activeFilePath={ws.activeFilePath}
                      onFileOpen={handleFileOpen}
                      isActive={wsPath === activeProjectPath}
                      isStreaming={streamingScopes.has(`${wsPath}:${orchSessionId}`)}
                      awaitingQuestion={awaitingQuestionWorkspaces.has(wsPath)}
                      initialDraft={chatDraftsRef.current.get(wsPath) || ''}
                      onDraftChange={(draft: string) => handleDraftChange(wsPath, draft)}
                      initialContextItems={(chatContextItemsRef.current.get(wsPath) as any) || []}
                      onContextItemsChange={(items: any[]) => handleContextItemsChange(wsPath, items)}
                      messageQueue={messageQueues.get(orchSessionId) || []}
                      onQueueAdd={handleQueueAdd}
                      onQueueRemove={handleQueueRemove}
                      onQueueShift={handleQueueShift}
                      onQueuePromote={handleQueuePromote}
                      sessionId={orchSessionId}
                      onMessagesChange={(messages: ChatMessage[]) => {
                        orchMessagesRef.current.set(orchSessionId, messages);
                        // Debounced persist + ws.sessions refresh so a mid-turn
                        // navigate-away doesn't lose chat history. Also keeps
                        // the mounted-mirror Map in sync so ChatPanel remounts
                        // pick up the latest initialMessages.
                        const existing = orchSaveTimerRef.current.get(orchSessionId);
                        if (existing) clearTimeout(existing);
                        orchSaveTimerRef.current.set(orchSessionId, setTimeout(() => {
                          orchSaveTimerRef.current.delete(orchSessionId);
                          const latest = orchMessagesRef.current.get(orchSessionId) || [];
                          if (latest.length === 0) return;
                          const wsNow = workspacesRef.current.get(wsPath);
                          const existingSession = wsNow?.sessions.find(s => s.id === orchSessionId);
                          if (!existingSession) return;
                          const updated = {
                            ...existingSession,
                            messages: latest,
                            updatedAt: Date.now(),
                            aiProvider: orchProvider,
                            messageCount: latest.length,
                          };
                          queueSaveSession(wsPath, updated, 0).then(() => {
                            // Mirror into orchMessagesByWs so a remount reads
                            // fresh data without an extra DB round-trip.
                            setOrchMessagesByWs(prev => {
                              const m = new Map(prev);
                              m.set(orchSessionId, latest);
                              return m;
                            });
                          }).catch(() => {});
                        }, 400));
                      }}
                      onClaudeSessionId={(sessionId: string) => {
                        updateWorkspace(wsPath, w => ({
                          ...w,
                          sessions: w.sessions.map(s => s.id === orchSessionId ? { ...s, claudeSessionId: sessionId } : s),
                        }));
                      }}
                      onGeminiSessionId={(sessionId: string) => {
                        updateWorkspace(wsPath, w => ({
                          ...w,
                          sessions: w.sessions.map(s => s.id === orchSessionId ? { ...s, geminiSessionId: sessionId } : s),
                        }));
                      }}
                      onCodexSessionId={(sessionId: string) => {
                        updateWorkspace(wsPath, w => ({
                          ...w,
                          sessions: w.sessions.map(s => s.id === orchSessionId ? { ...s, codexSessionId: sessionId } : s),
                        }));
                      }}
                      onSlashCommandsUpdate={(cmds: string[]) => { slashCommandsRef.current = cmds; }}
                      terminalTabs={ws.terminalTabs ?? []}
                      claudeScope={orchSessionId}
                      claudeKind="orchestrator"
                      activeMetaRuntime={
                        activeMetaRuntime && activeMetaRuntime.syntheticRoot === wsPath
                          ? activeMetaRuntime
                          : null
                      }
                      emptyStateVisual={<SwarmLogoCluster leadSize={96} />}
                      conversationHeaderVisual={<SwarmLogoCluster leadSize={48} followerCount={6} footprint={220} />}
                      claudeOrchestratorContext={(() => {
                        const wsName = wsPath.split(/[\\/]/).filter(Boolean).pop() || wsPath;
                        const cfg = swarmSettingsRef.current;
                        return {
                          workspaceName: wsName,
                          workspacePath: wsPath,
                          defaultProvider: cfg.defaultTaskProvider ?? aiProvider ?? 'claude',
                          defaultModel: cfg.defaultTaskModel || modelChoice || 'opus',
                          defaultApprovalPolicy: cfg.defaultApprovalPolicy ?? 'auto-read',
                          concurrencyCap: cfg.concurrencyCap ?? 5,
                        };
                      })()}
                      onInterceptSend={async (text: string) => {
                        const outcome = await executeSlashCommand(text, swarmHostRef.current);
                        return outcome.handled
                          ? { handled: true, reply: (outcome as { handled: true; reply: string }).reply }
                          : false;
                      }}
                      renderToolCall={(tc) => {
                        // Derive per-task tool_use bucket counts (last 60s)
                        // for SpawnTaskCard sparklines. We re-derive on each
                        // render — activityTick triggers re-renders so the
                        // map reflects the freshest ring buffer state.
                        void activityTick;
                        const wsHist = activityHistoryRef.current.get(wsPath);
                        const toolHistory = new Map<string, number[]>();
                        if (wsHist && wsHist.tools.length > 0) {
                          const now = Date.now();
                          const byTask = new Map<string, TimedEvent[]>();
                          for (const ev of wsHist.tools) {
                            if (!ev.taskId) continue;
                            const arr = byTask.get(ev.taskId) ?? [];
                            arr.push(ev);
                            byTask.set(ev.taskId, arr);
                          }
                          for (const [tid, evs] of byTask.entries()) {
                            toolHistory.set(tid, bucketToolCalls(evs, now));
                          }
                        }
                        return (
                        <SwarmToolCardSelector
                          toolCall={tc}
                          tasks={swarmTasksByWs.get(wsPath) ?? []}
                          approvals={swarmApprovalsByWs.get(wsPath) ?? []}
                          diffStats={swarmDiffStats}
                          toolHistory={toolHistory}
                          onLandAllGreen={async () => {
                            // Snapshot the ready ids first; each land mutates state and
                            // removes the task from the list, so iterating directly off
                            // the live array would race. Await each to surface failures.
                            const readyIds = (swarmTasksByWs.get(wsPath) ?? [])
                              .filter(t => t.status === 'done')
                              .map(t => t.id);
                            for (const id of readyIds) {
                              try { await landWithCard(id); }
                              catch (err) { console.error('swarm: landAllGreen land failed', id, err); }
                            }
                          }}
                          onFocusTask={(id) => setSwarmSelected(id)}
                          onRebaseRetry={async (taskRef) => {
                            const t = (swarmTasksByWs.get(wsPath) ?? []).find(x => x.id === taskRef);
                            if (!t || !t.worktreePath) {
                              console.warn('swarm: rebase-retry skipped, task or worktree missing', taskRef);
                              return;
                            }
                            const wt = t.worktreePath;
                            // Serialize behind the land queue so a retry never
                            // races a concurrent land. Clear any in-progress
                            // rebase first, then rebase, then land.
                            const next = landQueueRef.current.then(async () => {
                              const sai = window.sai as any;
                              const r = await rebaseRetry(wt, t.baseBranch, {
                                rebaseStatus: (p: string) => sai.gitRebaseStatus(p),
                                rebaseAbort: (p: string) => sai.gitRebaseAbort(p),
                                rebase: (p: string, base: string) => sai.gitRebase(p, base),
                              });
                              if (!r.ok) {
                                console.error('swarm: rebase failed', r.detail);
                                window.alert(`Rebase failed: ${r.detail}`);
                                return;
                              }
                              try { await landWithCard(taskRef); }
                              catch (err) { console.error('swarm: post-rebase land failed', err); }
                            });
                            landQueueRef.current = next.catch(() => {});
                            await next;
                          }}
                          onLand={(id) => { void landWithCard(id); }}
                          onDiscard={(id) => { void discardWithCard(id); }}
                          onDiff={(id) => setSwarmSelected(id)}
                          onRetry={(prompt) => {
                            void spawnSwarmTask({
                              prompt,
                              provider: aiProvider,
                              model: modelChoice,
                              approvalPolicy: swarmSettingsRef.current.defaultApprovalPolicy ?? 'auto-read',
                            }).catch(err => console.error('swarm: retry failed', err));
                          }}
                          onScrollToApproval={(taskId) => {
                            // Best-effort: scroll the orchestrator chat to the
                            // inline approval card for this task. The card has
                            // data-task-id="<id>" on InlineApprovalCard.
                            try {
                              const el = document.querySelector<HTMLElement>(
                                `[data-testid="swarm-inline-approval-card"][data-task-id="${taskId}"]`
                              );
                              el?.scrollIntoView({ behavior: 'smooth', block: 'center' });
                            } catch { /* noop */ }
                          }}
                        />
                        );
                      }}
                      renderMessage={(message) => {
                        const meta = message.meta;
                        if (!meta || meta.type !== 'approval') return null;
                        const resolveLocally = (resolved: 'approved' | 'denied') => {
                          const list = orchMessagesRef.current.get(orchSessionId) ?? [];
                          const next = list.map(m =>
                            m.id === message.id && m.meta?.type === 'approval'
                              ? { ...m, meta: { ...m.meta, resolved } }
                              : m
                          );
                          orchMessagesRef.current.set(orchSessionId, next);
                          setOrchMessagesByWs(prev => {
                            const m = new Map(prev);
                            m.set(orchSessionId, next);
                            return m;
                          });
                        };
                        return (
                          <InlineApprovalCard
                            meta={meta}
                            onApprove={(id) => { void swarmHost.approve(id); resolveLocally('approved'); }}
                            onDeny={(id) => { void swarmHost.deny(id); resolveLocally('denied'); }}
                            onView={() => setSwarmSelected(meta.taskId)}
                          />
                        );
                      }}
                      onTurnComplete={() => {
                        const latestMessages = orchMessagesRef.current.get(orchSessionId) || [];
                        if (latestMessages.length === 0) return;
                        const existing = ws.sessions.find(s => s.id === orchSessionId);
                        if (!existing) return;
                        const updated = { ...existing, messages: latestMessages, updatedAt: Date.now(), aiProvider: orchProvider, messageCount: latestMessages.length };
                        if (!updated.title) {
                          const firstUserMsg = latestMessages.find(m => m.role === 'user');
                          if (firstUserMsg) updated.title = generateSmartTitle(firstUserMsg.content);
                        }
                        // Cancel any pending debounced save — we're flushing now.
                        const pending = orchSaveTimerRef.current.get(orchSessionId);
                        if (pending) {
                          clearTimeout(pending);
                          orchSaveTimerRef.current.delete(orchSessionId);
                        }
                        queueSaveSession(wsPath, updated, 0).then(() => {
                          setOrchMessagesByWs(prev => {
                            const m = new Map(prev);
                            m.set(orchSessionId, latestMessages);
                            return m;
                          });
                          dbGetSessions(wsPath).then(sessions => {
                            updateWorkspace(wsPath, w2 => ({ ...w2, sessions }));
                          });
                        }).catch(() => {});
                      }}
                    />
                  );
                  return (
                  <OrchestratorView
                    chatSlot={orchChatSlot}
                    orchestratorSessionId={orchSessionId}
                    projectPath={wsPath}
                    projectLabel={activeMetaRuntime && activeMetaRuntime.syntheticRoot === wsPath ? activeMetaRuntime.meta.name : undefined}
                    orchestratorProvider={orchProvider}
                    orchestratorModel={orchModel}
                    onProviderModelChange={(nextProvider, nextModel) => {
                      // Persist + update ref so downstream session re-spawns pick
                      // up the new model. Provider is currently locked to claude
                      // by the picker (codex/gemini are disabled), but we still
                      // round-trip it for forward-compat.
                      try { window.sai.settingsSet('swarm.orchestratorProvider', nextProvider); } catch { /* noop */ }
                      try { window.sai.settingsSet('swarm.orchestratorModel', nextModel); } catch { /* noop */ }
                      swarmSettingsRef.current.orchestratorProvider = nextProvider;
                      swarmSettingsRef.current.orchestratorModel = nextModel;
                      // Force a re-render so the new label shows immediately.
                      setSwarmSettingsTick(t => t + 1);
                      // Restart the orchestrator Claude scope so the new
                      // --model flag takes effect on the next turn.
                      try {
                        (window.sai as any).claudeStop?.(wsPath, orchSessionId);
                      } catch { /* noop */ }
                      try {
                        const wsName = wsPath.split(/[\\/]/).filter(Boolean).pop() || wsPath;
                        const cfg = swarmSettingsRef.current;
                        const ctx = {
                          workspaceName: wsName,
                          workspacePath: wsPath,
                          defaultProvider: cfg.defaultTaskProvider ?? aiProvider ?? 'claude',
                          defaultModel: nextModel,
                          defaultApprovalPolicy: cfg.defaultApprovalPolicy ?? 'auto-read',
                          concurrencyCap: cfg.concurrencyCap ?? 5,
                        };
                        (window.sai as any).claudeStart?.(wsPath, orchSessionId, 'orchestrator', ctx);
                      } catch { /* noop */ }
                    }}
                    stats={{
                      active: (swarmTasksByWs.get(wsPath) ?? []).filter(t => t.status === 'streaming').length,
                      approvals: (swarmTasksByWs.get(wsPath) ?? []).filter(t => t.status === 'awaiting_approval').length,
                      ready: (swarmTasksByWs.get(wsPath) ?? []).filter(t => t.status === 'done').length,
                      queued: (swarmTasksByWs.get(wsPath) ?? []).filter(t => t.status === 'queued').length,
                      cap: swarmSettingsRef.current.concurrencyCap,
                      activeHistory: (() => { void activityTick; return activityHistoryRef.current.get(wsPath)?.activeBuckets; })(),
                    }}
                  />
                  );
                })() : (() => {
                  const wsClaudeCfg = resolveClaudeConfig(claudeWsOverrides, wsPath, { model: modelChoice, effort: effortLevel });
                  return (
                <ChatPanel
                  key={ws.activeSession.id}
                  projectPath={wsPath}
                  claudeScope={ws.activeSession.id}
                  claudeKind={ws.activeSession.kind === 'task' ? 'task' : 'chat'}
                  permissionMode={permissionMode}
                  onPermissionChange={handlePermissionChange}
                  effortLevel={wsClaudeCfg.effort}
                  onEffortChange={(level) => handleWorkspaceEffortChange(wsPath, level)}
                  modelChoice={wsClaudeCfg.model}
                  onModelChange={(model) => handleWorkspaceModelChange(wsPath, model)}
                  claudeOverrideState={{
                    modelOverridden: wsClaudeCfg.modelOverridden,
                    effortOverridden: wsClaudeCfg.effortOverridden,
                    globalModel: modelChoice,
                    globalEffort: effortLevel,
                  }}
                  availableModels={claudeModels}
                  renderToolCall={(tc) => {
                    const n = tc.name || '';
                    if (
                      n.endsWith('sai_render_html') ||
                      n.endsWith('sai_render_component') ||
                      n.endsWith('sai_render_chart') ||
                      n.endsWith('sai_render_diff') ||
                      n.endsWith('sai_render_mermaid') ||
                      n.endsWith('sai_render_theme') ||
                      n.endsWith('sai_render_form') ||
                      n.endsWith('sai_confirm') ||
                      n.endsWith('sai_choose')
                    ) {
                      return <RenderToolCallCard tc={tc} cwd={projectPath} />;
                    }
                    return null;
                  }}
                  aiProvider={aiProvider}
                  codexModel={codexModel}
                  onCodexModelChange={handleCodexModelChange}
                  codexModels={codexModels}
                  codexPermission={codexPermission}
                  onCodexPermissionChange={handleCodexPermissionChange}
                  geminiModel={geminiModel}
                  onGeminiModelChange={handleGeminiModelChange}
                  geminiModels={geminiModels}
                  geminiApprovalMode={geminiApprovalMode}
                  onGeminiApprovalModeChange={handleGeminiApprovalModeChange}
                  geminiConversationMode={geminiConversationMode}
                  onGeminiConversationModeChange={handleGeminiConversationModeChange}
                                    initialMessages={ws.activeSession.messages}
                  initialPendingApproval={approvalSessions.get(wsPath)?.get(ws.activeSession.id) ?? null}
                  activeFilePath={ws.activeFilePath}
                  onFileOpen={handleFileOpen}
                  isActive={wsPath === activeProjectPath}
                  isStreaming={
                    aiProvider === 'claude'
                      ? streamingScopes.has(`${wsPath}:${ws.activeSession.id}`)
                      // Gemini uses a long-lived ACP — multiple sessions can stream
                      // concurrently (New Chat keeps the background turn running).
                      // Only show the animation when the streaming ACP session matches
                      // this session's own geminiSessionId.
                      : aiProvider === 'gemini'
                        ? streamingScopes.has(`${wsPath}:chat`) &&
                          chatStreamingSessionRef.current.get(wsPath) === (ws.activeSession.geminiSessionId ?? null)
                        // Codex spawns a new process per turn and kills the previous one
                        // on each new send — only one stream is ever active per workspace.
                        // No session-ID matching needed.
                        : streamingScopes.has(`${wsPath}:chat`)
                  }
                  waiting={
                    // waits are claude-only: waitingScopes never holds gemini/codex entries
                    aiProvider === 'claude'
                      ? waitingScopes.get(`${wsPath}:${ws.activeSession.id}`) ?? null
                      : waitingScopes.get(`${wsPath}:chat`) ?? null
                  }
                  awaitingQuestion={awaitingQuestionWorkspaces.has(wsPath)}
                  initialDraft={chatDraftsRef.current.get(wsPath) || ''}
                  onDraftChange={(draft: string) => handleDraftChange(wsPath, draft)}
                  initialContextItems={(chatContextItemsRef.current.get(wsPath) as any) || []}
                  onContextItemsChange={(items: any[]) => handleContextItemsChange(wsPath, items)}
                  messageQueue={messageQueues.get(ws.activeSession.id) || []}
                  overlayControl={overlayEnabled ? { mode: overlayMode, onChange: handleOverlayModeChange } : undefined}
                  onQueueAdd={handleQueueAdd}
                  onQueueRemove={handleQueueRemove}
                  onQueueShift={handleQueueShift}
                  onQueuePromote={handleQueuePromote}
                  sessionId={ws.activeSession.id}
                  onMessagesChange={(messages: ChatMessage[]) => {
                    wsMessagesRef.current.set(wsPath, messages);
                    // First-user-message persist: as soon as the user sends
                    // their first message, persist the session so it survives
                    // a refresh and shows the right preview/messageCount in
                    // the sidebar — without waiting for the AI turn to end.
                    const sid = ws.activeSession.id;
                    if (!firstUserPersistRef.current.has(sid) && messages.some(m => m.role === 'user')) {
                      firstUserPersistRef.current.add(sid);
                      const now = Date.now();
                      const session = { ...ws.activeSession, messages, updatedAt: now, lastViewedAt: now, aiProvider, messageCount: messages.length };
                      if (!session.title) {
                        const firstUserMsg = messages.find(m => m.role === 'user');
                        if (firstUserMsg) session.title = generateSmartTitle(firstUserMsg.content);
                      }
                      queueSaveSession(wsPath, session, wsFirstLoadedIdxRef.current.get(wsPath) ?? 0).then(() => {
                        dbGetSessions(wsPath).then(refreshed => {
                          updateWorkspace(wsPath, w2 => ({ ...w2, sessions: refreshed }));
                        });
                      }).catch(() => {});
                    }
                  }}
                  onClaudeSessionId={(sessionId: string) => {
                    updateWorkspace(wsPath, w => ({
                      ...w,
                      activeSession: { ...w.activeSession, claudeSessionId: sessionId },
                    }));
                  }}
                  onGeminiSessionId={(sessionId: string) => {
                    updateWorkspace(wsPath, w => ({
                      ...w,
                      activeSession: { ...w.activeSession, geminiSessionId: sessionId },
                    }));
                  }}
                  onCodexSessionId={(sessionId: string) => {
                    updateWorkspace(wsPath, w => ({
                      ...w,
                      activeSession: { ...w.activeSession, codexSessionId: sessionId },
                    }));
                  }}
                  onSlashCommandsUpdate={(cmds: string[]) => { slashCommandsRef.current = cmds; }}
                  terminalTabs={ws.terminalTabs ?? []}
                  onTurnComplete={() => {
                    const latestMessages = wsMessagesRef.current.get(wsPath) || [];
                    if (latestMessages.length === 0) return;
                    updateWorkspace(wsPath, w => {
                      const tail = latestMessages[latestMessages.length - 1];
                      const now = Date.now();
                      // Track lastViewedAt alongside updatedAt while the user is
                      // actively viewing this session — the green unread dot
                      // should only appear after they swap away and new
                      // activity arrives.
                      const updated = { ...w.activeSession, messages: latestMessages, updatedAt: now, lastViewedAt: now, aiProvider, messageCount: latestMessages.length, lastTurnErrored: !!tail?.error };
                      if (!updated.title) {
                        const firstUserMsg = latestMessages.find(m => m.role === 'user');
                        if (firstUserMsg) updated.title = generateSmartTitle(firstUserMsg.content);
                      }

                      queueSaveSession(wsPath, updated, wsFirstLoadedIdxRef.current.get(wsPath) ?? 0).then(() => {
                        dbGetSessions(wsPath).then(sessions => {
                          updateWorkspace(wsPath, ws2 => ({ ...ws2, sessions }));
                        });
                      }).catch(() => {});

                      // Fire-and-forget AI title generation if enabled
                      if (aiTitleGeneration && !updated.titleEdited) {
                        const userMsgs = latestMessages.filter(m => m.role === 'user');
                        if (userMsgs.length === 1 && userMsgs[0]) {
                          const sessionId = updated.id;
                          setTitleGeneratingIds(prev => new Set(prev).add(sessionId));
                          window.sai.claudeGenerateTitle(wsPath, userMsgs[0].content, aiProvider)
                            .then((title: string) => {
                              if (!title) return;
                              updateWorkspace(wsPath, w2 => {
                                if (w2.activeSession.titleEdited) return w2;
                                const newSession = { ...w2.activeSession, title };
                                queueSaveSession(wsPath, newSession, wsFirstLoadedIdxRef.current.get(wsPath) ?? 0).then(() => {
                                  dbGetSessions(wsPath).then(sessions => {
                                    updateWorkspace(wsPath, ws3 => ({ ...ws3, sessions }));
                                  });
                                }).catch(() => {});
                                return { ...w2, activeSession: newSession };
                              });
                            })
                            .catch(() => { /* title generation failed, keep smart title */ })
                            .finally(() => {
                              setTitleGeneratingIds(prev => {
                                const next = new Set(prev);
                                next.delete(sessionId);
                                return next;
                              });
                            });
                        }
                      }

                      return { ...w, activeSession: updated };
                    });
                    // Note: SwarmTask status mirror lives in App.tsx's claude:message
                    // listener (see deriveSwarmMirror) so it fires for every scope,
                    // including background tasks whose ChatPanel isn't mounted.
                  }}
                  activeMetaRuntime={
                    activeMetaRuntime && activeMetaRuntime.syntheticRoot === wsPath
                      ? activeMetaRuntime
                      : null
                  }
                  mentionInsertRef={wsPath === activeProjectPath ? mentionInsertRef : undefined}
                />
                  );
                })()}
              </div>
            ))}
            {panel === 'editor' && activeFilePath && (
              <CodePanel
                openFiles={openFiles}
                activeFilePath={activeFilePath}
                projectPath={projectPath}
                editorFontSize={editorFontSize}
                editorMinimap={editorMinimap}
                onActivate={(path: string) => {
                  if (activeProjectPath) {
                    updateWorkspace(activeProjectPath, ws => ({ ...ws, activeFilePath: path }));
                  }
                }}
                onClose={handleFileClose}
                onCloseAll={handleCloseAllFiles}
                onDiffModeChange={handleDiffModeChange}
                onEditorSave={handleEditorSave}
                onEditorContentChange={handleEditorContentChange}
                onEditorDirtyChange={handleEditorDirtyChange}
                externallyModified={externallyModified}
                onReloadFile={handleReloadFile}
                onKeepMyEdits={handleKeepMyEdits}
                onToggleMdPreview={handleToggleMdPreview}
                onLineRevealed={(path: string) => {
                  if (activeProjectPath) {
                    updateWorkspace(activeProjectPath, ws => ({
                      ...ws,
                      openFiles: ws.openFiles.map(f => f.path === path ? { ...f, pendingLine: undefined } : f),
                    }));
                  }
                }}
              />
            )}
            {panel === 'terminal' && Array.from(workspaces.entries()).map(([wsPath, ws]) => (
              <div
                key={`term-${wsPath}`}
                style={{
                  display: wsPath === activeProjectPath ? 'flex' : 'none',
                  flexDirection: 'column',
                  flex: 1,
                  minHeight: 0,
                  overflow: 'hidden',
                }}
              >
                <TerminalPanel
                  projectPath={wsPath}
                  isActive={wsPath === activeProjectPath}
                  wasSuspended={ws.status === 'suspended'}
                  terminalTabs={ws.terminalTabs}
                  activeTerminalId={ws.activeTerminalId}
                  onTabCreate={handleTabCreate}
                  onTabClose={handleTabClose}
                  onTabSwitch={handleTabSwitch}
                  onTabRename={handleTabRename}
                  onTerminalReady={handleTerminalReady}
                />
              </div>
            ))}
          </div>
        </div>
      </div>
    );
  };

  const swarmApprovalCount = (swarmTasksByWs.get(activeProjectPath) ?? [])
    .filter(t => t.status === 'awaiting_approval').length;

  const streamingSessionIds = useMemo(() => {
    if (!activeProjectPath) return new Set<string>();
    const prefix = `${activeProjectPath}:`;
    const ids = new Set<string>();
    for (const k of streamingScopes) {
      if (k.startsWith(prefix)) ids.add(k.slice(prefix.length));
    }
    return ids;
  }, [streamingScopes, activeProjectPath]);

  const awaitingSessionIds = useMemo(() => {
    if (!activeProjectPath) return new Set<string>();
    return new Set(approvalSessions.get(activeProjectPath)?.keys() ?? []);
  }, [approvalSessions, activeProjectPath]);

  const suspendedSessionIds = useMemo(() => {
    if (!activeProjectPath) return new Set<string>();
    const prefix = `${activeProjectPath}:`;
    const ids = new Set<string>();
    for (const k of suspendedScopes) {
      if (k.startsWith(prefix)) ids.add(k.slice(prefix.length));
    }
    return ids;
  }, [suspendedScopes, activeProjectPath]);

  const waitingSessionIds = useMemo(() => {
    if (!activeProjectPath) return new Set<string>();
    const prefix = `${activeProjectPath}:`;
    const ids = new Set<string>();
    for (const [k, v] of waitingScopes) {
      if (k.startsWith(prefix) && v.wait.kind === 'scheduled') {
        ids.add(k.slice(prefix.length));
      }
    }
    return ids;
  }, [waitingScopes, activeProjectPath]);

  const unreadSessionIds = useMemo(() => {
    const ids = new Set<string>();
    for (const s of sessions) {
      if (s.id === activeSession?.id) continue;
      // Task sessions belong to swarm, not the chats sidebar — exclude them
      // so completed tasks don't produce a phantom badge on the Chats button.
      if ((s as any).kind === 'task') continue;
      if (s.updatedAt > (s.lastViewedAt ?? s.updatedAt)) ids.add(s.id);
    }
    return ids;
  }, [sessions, activeSession?.id]);

  const errorSessionIds = useMemo(() => {
    const ids = new Set<string>();
    for (const s of sessions) {
      if ((s as any).kind === 'task') continue;
      // Prefer the persisted flag (covers background sessions); fall back to
      // the in-memory tail message error (covers the just-active session
      // before its persist round-trip completes).
      if (s.lastTurnErrored) { ids.add(s.id); continue; }
      const tail = s.messages?.[s.messages.length - 1];
      if (tail?.error) ids.add(s.id);
    }
    return ids;
  }, [sessions]);

  // Badge total for the NavBar Chats button: unread + awaiting approval +
  // errored sessions other than the focused one. Mirrors the
  // "needs-attention-elsewhere" pattern from the workspace dropdown badge.
  const chatNotificationCount = useMemo(
    () => computeChatNotificationCount({
      unread: unreadSessionIds,
      awaiting: awaitingSessionIds,
      error: errorSessionIds,
      activeSessionId: activeSession?.id,
    }),
    [unreadSessionIds, awaitingSessionIds, errorSessionIds, activeSession?.id],
  );

  const prevStreamingRef = useRef<Set<string>>(new Set());
  const prevAwaitingRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    const seeds = computeChatToasts(
      prevStreamingRef.current,
      streamingSessionIds,
      prevAwaitingRef.current,
      awaitingSessionIds,
      sessions,
      activeSession?.id,
      Date.now(),
    );
    if (seeds.length) {
      setChatToasts(prev => [...prev, ...seeds].slice(-3));
    }
    prevStreamingRef.current = streamingSessionIds;
    prevAwaitingRef.current = awaitingSessionIds;
  }, [streamingSessionIds, awaitingSessionIds, sessions, activeSession?.id]);

  // Dev-only test bridge — lets Playwright drive workspace state directly.
  useEffect(() => {
    if (!import.meta.env.DEV) return;
    window.__saiTest = {
      setWorkspaceBusy: (id: string) => {
        setBusyWorkspaces(prev => new Set([...prev, id]));
        setCompletedWorkspaces(prev => { const n = new Set(prev); n.delete(id); return n; });
      },
      setWorkspaceDone: (id: string) => {
        setCompletedWorkspaces(prev => new Set([...prev, id]));
        setBusyWorkspaces(prev => { const n = new Set(prev); n.delete(id); return n; });
      },
      setWorkspaceIdle: (id: string) => {
        setBusyWorkspaces(prev => { const n = new Set(prev); n.delete(id); return n; });
        setCompletedWorkspaces(prev => { const n = new Set(prev); n.delete(id); return n; });
      },
      clearWorkspaces: () => {
        setBusyWorkspaces(new Set());
        setCompletedWorkspaces(new Set());
      },
      getOverallStatus: () => {
        if (busyWorkspaces.size > 0 && completedWorkspaces.size > 0) return 'busy-done';
        if (completedWorkspaces.size > 0) return 'done';
        if (busyWorkspaces.size > 0) return 'busy';
        return null;
      },
      getState: () => ({
        busyWorkspaces: [...busyWorkspaces],
        completedWorkspaces: [...completedWorkspaces],
      }),
    };
    return () => { delete window.__saiTest; };
  }, [busyWorkspaces, completedWorkspaces, setBusyWorkspaces, setCompletedWorkspaces]);

  // Surface session-level unread/error state up to the workspace level so the
  // TitleBar workspace switcher shows the green '!' even when the workspace
  // isn't actively busy. Mirrors how approvalSessions.keys() rolls per-session
  // approvals up to per-workspace badges.
  const completedWorkspacesWithUnread = useMemo(
    () => computeCompletedWorkspaces({
      completedWorkspaces,
      workspaces: Array.from(workspaces.values()),
      focusedProjectPath: activeProjectPath,
    }),
    [completedWorkspaces, workspaces, activeProjectPath],
  );

  // Feed the focus overlay (display-only mini window shown while SAI is in
  // the background — spec 2026-06-11-focus-overlay-design.md). Throttled and
  // gated on the setting so the IPC stays silent when disabled.
  const overlayThrottleRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Overlay-local done tracking (see updateRecentDone) — cleared when the
  // window regains focus: the user has seen the result.
  const overlayRecentDoneRef = useRef<Set<string>>(new Set());
  const overlayPrevBusyRef = useRef<Set<string>>(new Set());
  // Bumped on focus: clearing recent-done must also resend the payload —
  // the manager replays its LAST payload on re-show, so without a fresh send
  // a cleared unread would resurface as a stale white squircle.
  const [overlayFocusTick, setOverlayFocusTick] = useState(0);
  useEffect(() => {
    const onFocus = () => {
      overlayRecentDoneRef.current.clear();
      setOverlayFocusTick(t => t + 1);
    };
    window.addEventListener('focus', onFocus);
    return () => window.removeEventListener('focus', onFocus);
  }, []);
  useEffect(() => {
    if (!overlayEnabled || overlayMode === 'off') return;
    updateRecentDone(overlayRecentDoneRef.current, overlayPrevBusyRef.current, busyWorkspaces, completedWorkspaces);
    overlayPrevBusyRef.current = new Set(busyWorkspaces);
    const stateFor = (path: string) =>
      approvalSessions.has(path) ? 'approval' as const
      : awaitingQuestionWorkspaces.has(path) ? 'question' as const
      : busyWorkspaces.has(path) ? 'busy' as const
      // completedWorkspaces never includes the focused workspace (in-app
      // semantics) — the overlay's own recent-done tracking covers it.
      : completedWorkspaces.has(path) || overlayRecentDoneRef.current.has(path) ? 'done' as const
      : 'alive' as const;
    const tailFor = (path: string): { tail?: OverlayTailItem[]; todos?: { done: number; total: number } } => {
      const messages = wsMessagesRef.current.get(path) ?? workspaces.get(path)?.activeSession.messages ?? [];
      // Recent history (user + assistant) with tools capped per message plus
      // an elided marker — a long tool run must never trim away the text
      // segment that precedes it.
      const TOOLS_PER_MESSAGE = 4;
      const MAX_MESSAGES = 12;
      const tail: OverlayTailItem[] = [];
      for (const m of messages.slice(-MAX_MESSAGES)) {
        if (m.role === 'user') {
          if (typeof m.content === 'string' && m.content) tail.push({ kind: 'user', text: truncateSnippet(m.content, 300) });
          continue;
        }
        if (m.role !== 'assistant') continue;
        if (typeof m.content === 'string' && m.content) tail.push({ kind: 'text', text: truncateSnippet(m.content, 600) });
        const calls = m.toolCalls ?? [];
        if (calls.length > TOOLS_PER_MESSAGE) tail.push({ kind: 'elided', count: calls.length - TOOLS_PER_MESSAGE });
        for (const tc of calls.slice(-TOOLS_PER_MESSAGE)) {
          tail.push({ kind: 'tool', name: tc.name, done: tc.output != null, detail: toolCallDetail(tc) ?? undefined });
        }
      }
      const todoList = findLatestTodos(messages);
      const todos = todoList && todoList.length > 0
        ? { done: todoList.filter(t => t.status === 'completed').length, total: todoList.length }
        : undefined;
      return { tail: tail.length > 0 ? tail : undefined, todos };
    };
    const metaRoots = new Set((metaWorkspaces || []).map(m => m.syntheticRoot));
    const rows: OverlayRow[] = [];
    for (const path of workspaces.keys()) {
      if (metaRoots.has(path)) continue;
      const state = stateFor(path);
      rows.push({ path, name: basename(path), kind: 'project', state, ...(state === 'alive' ? {} : tailFor(path)) });
    }
    for (const m of metaWorkspaces || []) {
      const state = stateFor(m.syntheticRoot);
      if (state === 'alive' && !workspaces.has(m.syntheticRoot)) continue;
      rows.push({ path: m.syntheticRoot, name: m.name, kind: 'meta', state, ...(state === 'alive' ? {} : tailFor(m.syntheticRoot)) });
    }
    const send = () => {
      // Rows are rebuilt on every send: tails live in wsMessagesRef, which
      // mutates without changing any effect dependency.
      const freshRows: OverlayRow[] = rows.map(r =>
        r.state === 'alive' ? r : { ...r, ...tailFor(r.path) });
      (window.sai as any).overlayUpdate?.(buildOverlayPayload(freshRows));
    };
    if (overlayThrottleRef.current) clearTimeout(overlayThrottleRef.current);
    overlayThrottleRef.current = setTimeout(() => {
      overlayThrottleRef.current = null;
      send();
    }, 250);
    // While anything is busy, keep the tails live (tool lines + streaming
    // text churn without status transitions to retrigger this effect).
    const tick = busyWorkspaces.size > 0 ? setInterval(send, 1000) : null;
    return () => {
      if (overlayThrottleRef.current) { clearTimeout(overlayThrottleRef.current); overlayThrottleRef.current = null; }
      if (tick) clearInterval(tick);
    };
  }, [overlayEnabled, overlayMode, overlayFocusTick, busyWorkspaces, completedWorkspaces, approvalSessions, awaitingQuestionWorkspaces, workspaces, metaWorkspaces]);

  return (
    <div className="app">
      <TitleBar
        projectPath={projectPath}
        onProjectChange={handleProjectSwitch}
        completedWorkspaces={completedWorkspacesWithUnread}
        busyWorkspaces={busyWorkspaces}
        approvalWorkspaces={new Set(approvalSessions.keys())}
        awaitingQuestionWorkspaces={awaitingQuestionWorkspaces}
        metaWorkspaces={metaWorkspaces}
        activeMetaRuntime={activeMetaRuntime}
        onActivateMeta={handleMetaWorkspaceActivate}
        onMetaCreated={handleMetaWorkspaceCreated}
        onMetaUpdated={handleMetaWorkspaceUpdated}
        onMetaDeleted={handleMetaWorkspaceDeleted}
        onSettingChange={(key, value) => {
          if (key === 'editorFontSize') setEditorFontSize(value);
          if (key === 'editorMinimap') setEditorMinimap(value);
          if (key === 'aiProvider') { setAiProvider(value); handleNewChat(); }
          if (key === 'commitMessageProvider') setCommitMessageProvider(value);
          if (key === 'aiTitleGeneration') setAiTitleGeneration(value);
          if (key === 'geminiModel') handleGeminiModelChange(value);
          if (key === 'geminiApprovalMode') handleGeminiApprovalModeChange(value);
          if (key === 'geminiConversationMode') handleGeminiConversationModeChange(value);
          if (key === 'codexModel') handleCodexModelChange(value);
          if (key === 'codexPermission') handleCodexPermissionChange(value);
          if (key === 'focusedChat') { setFocusedChat(value); if (value) { setExpanded(['chat', 'terminal']); setSplitRatio(0.66); } }
          if (key === 'overlayEnabled') setOverlayEnabled(!!value);
          if (key === 'defaultView') { /* persisted only, applies on next launch */ }
          if (key === 'sidebarWidth') document.documentElement.style.setProperty('--sidebar-width', `${value}px`);
          if (typeof key === 'string' && key.startsWith('swarm.')) {
            const cfg = swarmSettingsRef.current;
            if (key === 'swarm.concurrencyCap') {
              const n = typeof value === 'number' && value > 0 ? value : SWARM_DEFAULT_CAP;
              cfg.concurrencyCap = n;
              swarmSchedulers.current.forEach(s => s.setCap(n));
            } else if (key === 'swarm.defaultApprovalPolicy') {
              if (value === 'auto' || value === 'auto-read' || value === 'always-ask') cfg.defaultApprovalPolicy = value;
            } else if (key === 'swarm.defaultTaskProvider') {
              if (value === 'claude' || value === 'codex' || value === 'gemini') cfg.defaultTaskProvider = value;
              else if (value == null || value === '') cfg.defaultTaskProvider = null;
            } else if (key === 'swarm.defaultTaskModel') {
              cfg.defaultTaskModel = typeof value === 'string' ? value : '';
            } else if (key === 'swarm.worktreeRoot') {
              cfg.worktreeRoot = typeof value === 'string' ? value : '';
            } else if (key === 'swarm.notifyOnComplete') {
              cfg.notifyOnComplete = !!value;
              if (cfg.notifyOnComplete && typeof Notification !== 'undefined' && Notification.permission === 'default') {
                try { Notification.requestPermission().catch(() => {}); } catch {}
              }
            } else if (key === 'swarm.notifyOnApproval') {
              cfg.notifyOnApproval = !!value;
              if (cfg.notifyOnApproval && typeof Notification !== 'undefined' && Notification.permission === 'default') {
                try { Notification.requestPermission().catch(() => {}); } catch {}
              }
            } else if (key === 'swarm.orchestratorProvider') {
              if (value === 'claude' || value === 'codex' || value === 'gemini') cfg.orchestratorProvider = value;
              else if (value == null || value === '') cfg.orchestratorProvider = null;
            } else if (key === 'swarm.orchestratorModel') {
              cfg.orchestratorModel = typeof value === 'string' && value ? value : null;
            }
          }
        }}
        onOpenWhatsNew={openWhatsNew}
        onNewProject={() => setShowNewProject(true)}
        onHistoryRetentionChange={(days) => {
          dbPurgeExpired(days).then(count => {
            if (count > 0 && activeProjectPath) {
              dbGetSessions(activeProjectPath).then(sessions => {
                updateWorkspace(activeProjectPath, ws => ({ ...ws, sessions }));
              });
            }
          });
        }}
        claudeModel={modelChoice}
        onClaudeModelChange={handleModelChange}
        claudeEffort={effortLevel}
        onClaudeEffortChange={handleEffortChange}
        claudeModels={claudeModels}
      />
      <ApprovalBanner
        approvals={Array.from(approvalSessions.entries()).flatMap(([projectPath, inner]) =>
          Array.from(inner.entries()).map(([sessionId, approval]) => ({ projectPath, sessionId, approval }))
        )}
        currentProjectPath={projectPath}
        onSwitchToWorkspace={(targetPath, sessionId) => {
          if (sessionId && targetPath !== activeProjectPath) {
            // Defer the session-select until the session list for the new
            // workspace has loaded (see the activeProjectPath effect).
            pendingSessionAfterSwitchRef.current = { projectPath: targetPath, sessionId };
          } else if (sessionId && activeSession?.id !== sessionId) {
            // Same workspace, just hop sessions.
            handleSelectSession(sessionId);
          }
          handleProjectSwitch(targetPath);
        }}
        onDismiss={(targetPath, sessionId) => {
          setApprovalSessions(prev => {
            const inner = prev.get(targetPath);
            if (!inner || !inner.has(sessionId)) return prev;
            const next = new Map(prev);
            const innerNext = new Map(inner);
            innerNext.delete(sessionId);
            if (innerNext.size === 0) next.delete(targetPath);
            else next.set(targetPath, innerNext);
            return next;
          });
        }}
      />
      <div className="app-body">
        <NavBar
          activeSidebar={sidebarOpen}
          onToggle={toggleSidebar}
          gitChangeCount={gitChangeCount}
          swarmApprovalCount={swarmApprovalCount}
          chatNotificationCount={chatNotificationCount}
          overallStatus={approvalSessions.size > 0 ? 'approval' : busyWorkspaces.size > 0 && completedWorkspaces.size > 0 ? 'busy-done' : completedWorkspaces.size > 0 ? 'done' : busyWorkspaces.size > 0 ? 'busy' : null}
          hasOrchestrator={getCapabilities(aiProvider).hasOrchestrator}
          hasMcp={getCapabilities(aiProvider).hasMcp}
          hasPlugins={getCapabilities(aiProvider).hasPlugins}
        />
        <AnimatePresence initial={false} mode="popLayout">
          {sidebarOpen === 'files' && (
            <motion.div
              key="sidebar-files"
              className="sidebar-slot"
              initial={{ opacity: 0, x: -10 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.15, ease: [0.2, 0.8, 0.2, 1] }}
              style={{ overflow: 'hidden' }}
            >
              <FileExplorerSidebar
                projectPath={projectPath}
                onFileOpen={handleFileOpen}
                metaRuntime={activeMetaRuntime && activeMetaRuntime.syntheticRoot === projectPath ? activeMetaRuntime : null}
              />
            </motion.div>
          )}
          {sidebarOpen === 'git' && (
            <motion.div
              key="sidebar-git"
              className="sidebar-slot"
              initial={{ opacity: 0, x: -10 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.15, ease: [0.2, 0.8, 0.2, 1] }}
              style={{ overflow: 'hidden' }}
            >
              {activeMetaRuntime && activeMetaRuntime.syntheticRoot === projectPath
                ? <MetaGitSidebar runtime={activeMetaRuntime} onFileClick={handleFileClick} commitMessageProvider={commitMessageProvider} />
                : <GitSidebar projectPath={projectPath} onFileClick={handleFileClick} commitMessageProvider={commitMessageProvider} />}
            </motion.div>
          )}
          {sidebarOpen === 'search' && (
            <motion.div
              key="sidebar-search"
              className="sidebar-slot"
              initial={{ opacity: 0, x: -10 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.15, ease: [0.2, 0.8, 0.2, 1] }}
              style={{ overflow: 'hidden' }}
            >
              <SearchPanel
                projectPath={projectPath}
                getOpenBuffers={() => openFiles
                  .filter(f => f.isDirty && typeof f.content === 'string')
                  .map(f => ({ path: f.path, content: f.content as string }))}
                applyMonacoEdits={(p, edits) => applySearchEditsToMonaco(p, edits)}
                onOpenFile={handleFileOpen}
                metaRuntime={activeMetaRuntime && activeMetaRuntime.syntheticRoot === projectPath ? activeMetaRuntime : null}
              />
            </motion.div>
          )}
          {sidebarOpen === 'chats' && (
            <motion.div
              key="sidebar-chats"
              className="sidebar-slot"
              initial={{ opacity: 0, x: -10 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.15, ease: [0.2, 0.8, 0.2, 1] }}
              style={{ overflow: 'hidden' }}
            >
              <ChatHistorySidebar
                sessions={sessions}
                activeSessionId={activeSession.id}
                aiProvider={aiProvider}
                onSelectSession={handleSelectSession}
                onNewChat={handleNewChat}
                onUpdateSessions={handleUpdateSessions}
                projectPath={projectPath}
                titleGeneratingIds={titleGeneratingIds}
                streamingSessionIds={streamingSessionIds}
                awaitingSessionIds={awaitingSessionIds}
                errorSessionIds={errorSessionIds}
                suspendedSessionIds={suspendedSessionIds}
                waitingSessionIds={waitingSessionIds}
              />
            </motion.div>
          )}
          {sidebarOpen === 'plugins' && (
            <motion.div
              key="sidebar-plugins"
              className="sidebar-slot"
              initial={{ opacity: 0, x: -10 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.15, ease: [0.2, 0.8, 0.2, 1] }}
              style={{ overflow: 'hidden' }}
            >
              <PluginsSidebar />
            </motion.div>
          )}
          {sidebarOpen === 'mcp' && (
            <motion.div
              key="sidebar-mcp"
              className="sidebar-slot"
              initial={{ opacity: 0, x: -10 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.15, ease: [0.2, 0.8, 0.2, 1] }}
              style={{ overflow: 'hidden' }}
            >
              <McpSidebar />
            </motion.div>
          )}
          {sidebarOpen === 'swarm' && (
            <motion.div
              key="sidebar-swarm"
              className="sidebar-slot"
              initial={{ opacity: 0, x: -10 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.15, ease: [0.2, 0.8, 0.2, 1] }}
              style={{ overflow: 'hidden' }}
            >
              <SwarmSidebar
                tasks={swarmTasksByWs.get(activeProjectPath) ?? []}
                selectedId={swarmSelected}
                onSelect={setSwarmSelected}
                onNewTask={() => setShowNewTaskPopover(true)}
                onDiscard={(task) => discardWithCard(task.id)}
                streamingTaskIds={(() => {
                  // streamingScopes is keyed by `${projectPath}:${scope}` where
                  // scope = sessionId for swarm tasks. Map back to taskId so
                  // the row indicator pulses live, independent of `task.status`.
                  const ids = new Set<string>();
                  const tasks = swarmTasksByWs.get(activeProjectPath) ?? [];
                  for (const t of tasks) {
                    if (streamingScopes.has(`${activeProjectPath}:${t.sessionId}`)) ids.add(t.id);
                  }
                  return ids;
                })()}
              />
            </motion.div>
          )}
        </AnimatePresence>
        <NewTaskPopover
          open={showNewTaskPopover}
          onClose={() => setShowNewTaskPopover(false)}
          onSubmit={(input) => { void spawnSwarmTask(input); setShowNewTaskPopover(false); }}
          defaultProvider={aiProvider}
          defaultModel=""
        />
        <div className="tm-views-wrapper">
          <div className="main-content" ref={mainContentRef}>
            {allPanels.map((panel, i) => (
              <div key={panel} style={{ display: 'contents' }}>
                {renderPanel(panel)}
                {showHandleAfter(panel) && (
                  <div
                    className={`drag-handle ${isDragging ? 'dragging' : ''}`}
                    onMouseDown={handleDragStart}
                  />
                )}
              </div>
            ))}
          </div>
        </div>
      </div>

      {isDragging && <div className="drag-overlay" />}

      {pendingClose && (() => {
        const ws = activeProjectPath ? workspaces.get(activeProjectPath) : null;
        const file = ws?.openFiles.find(f => f.path === pendingClose);
        const fileName = basename(pendingClose);
        return (
          <UnsavedChangesModal
            fileName={fileName}
            onSave={async () => {
              if (file?.content !== undefined) {
                await handleEditorSave(pendingClose, file.content);
              }
              doFileClose(pendingClose);
              setPendingClose(null);
            }}
            onDiscard={() => {
              doFileClose(pendingClose);
              setPendingClose(null);
            }}
            onCancel={() => setPendingClose(null)}
          />
        );
      })()}

      {quitConfirmTasks && (
        <QuitSwarmConfirmModal
          tasks={quitConfirmTasks}
          onCancel={() => setQuitConfirmTasks(null)}
          onConfirm={async () => {
            const tasksToPause = quitConfirmTasks;
            setQuitConfirmTasks(null);
            // Update local state to reflect the pause across all workspaces.
            setSwarmTasksByWs(prev => {
              const idSet = new Set(tasksToPause.map(t => t.id));
              const m = new Map(prev);
              for (const [ws, tasks] of prev) {
                let changed = false;
                const updated = tasks.map(t => {
                  if (idSet.has(t.id) && t.status === 'streaming') {
                    changed = true;
                    return { ...t, status: 'paused' as const };
                  }
                  return t;
                });
                if (changed) m.set(ws, updated);
              }
              return m;
            });
            void flushAllSessionsRef.current().finally(() => (window.sai as any).confirmQuit?.());
          }}
        />
      )}

      {showNewProject && (
        <NewProjectModal
          onClose={() => setShowNewProject(false)}
          onCreated={(path) => {
            setShowNewProject(false);
            handleProjectSwitch(path);
          }}
        />
      )}

      {whatsNewOpen && (
        <WhatsNewModal
          isOpen={whatsNewOpen}
          version={whatsNewVersion}
          releases={releases}
          fetchStatus={fetchStatus}
          onClose={closeWhatsNew}
        />
      )}

      {swarmDiffModal && (
        <SwarmDiffModal
          title={swarmDiffModal.title}
          branch={swarmDiffModal.branch}
          baseBranch={swarmDiffModal.baseBranch}
          diff={swarmDiffModal.diff}
          loading={swarmDiffModal.loading}
          error={swarmDiffModal.error}
          onClose={() => setSwarmDiffModal(null)}
        />
      )}

      {toast && (
        <WorkspaceToast key={toast.key} message={toast.message} tone={toast.tone} onDismiss={() => setToast(null)} />
      )}

      {chatToasts.length > 0 && (
        <div style={{
          position: 'fixed',
          bottom: 16,
          right: 16,
          display: 'flex',
          flexDirection: 'column-reverse',
          gap: 8,
          zIndex: 901,
          pointerEvents: 'none',
        }}>
          {chatToasts.map(t => (
            <div key={t.id} style={{ position: 'relative', pointerEvents: 'auto' }}>
              <WorkspaceToast
                message={t.message}
                tone={t.tone}
                onClick={() => handleSelectSession(t.sessionId)}
                onDismiss={() => dismissChatToast(t.id)}
                inline
              />
            </div>
          ))}
        </div>
      )}

      {projectPath && <CommandPalette
        open={commandPaletteOpen}
        onClose={() => setCommandPaletteOpen(false)}
        fileIndex={fileIndex}
        slashCommands={slashCommandsRef.current}
        workspaces={paletteWorkspaces}
        projectPath={projectPath}
        onFileOpen={handleFileOpen}
        onCommand={handlePaletteCommand}
        onWorkspaceSwitch={handleProjectSwitch}
      />}

      <style>{`
        .accordion-panel {
          display: flex;
          flex-direction: column;
          overflow: hidden;
          transition: flex 0.25s cubic-bezier(0.4, 0, 0.2, 1);
          min-height: 0;
        }
        .accordion-panel.accordion-collapsed {
          flex: 0 0 32px !important;
        }
        .accordion-bar {
          display: flex;
          align-items: center;
          gap: 8px;
          padding: 0 12px;
          height: 32px;
          font-size: 11px;
          font-weight: 600;
          text-transform: uppercase;
          letter-spacing: 0.5px;
          color: var(--text-muted);
          cursor: pointer;
          user-select: none;
          flex-shrink: 0;
          background: var(--bg-secondary);
          border-top: 1px solid var(--border);
        }
        .accordion-panel:first-child .accordion-bar {
          border-top: none;
        }
        .accordion-bar:hover {
          color: var(--text-secondary);
          background: var(--bg-hover);
        }
        .accordion-chevron {
          transition: transform 0.25s cubic-bezier(0.4, 0, 0.2, 1);
          flex-shrink: 0;
          color: var(--text-muted);
        }
        .accordion-chevron.open {
          transform: rotate(90deg);
        }
        .accordion-bar-actions {
          display: flex;
          align-items: center;
          gap: 2px;
          margin-left: auto;
          position: relative;
        }
        .accordion-bar-btn {
          background: none;
          border: none;
          color: var(--text-muted);
          cursor: pointer;
          padding: 3px;
          border-radius: 4px;
          display: flex;
          align-items: center;
        }
        .accordion-bar-btn:hover {
          color: var(--accent);
          background: var(--bg-hover);
        }
        .accordion-provider-icon {
          display: inline-block;
          width: 12px;
          height: 12px;
          mask-size: contain;
          -webkit-mask-size: contain;
          mask-repeat: no-repeat;
          -webkit-mask-repeat: no-repeat;
          flex-shrink: 0;
        }
        .accordion-bar-detail {
          font-weight: 400;
          text-transform: none;
          letter-spacing: 0;
          color: var(--text-muted);
          font-family: 'Geist Mono', 'JetBrains Mono', monospace;
          font-size: 11px;
          opacity: 0.6;
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
        }
        .accordion-body-wrapper {
          flex: 1;
          overflow: hidden;
          min-height: 0;
        }
        .accordion-collapsed .accordion-body-wrapper {
          flex: 0;
          height: 0;
        }
        .accordion-body {
          height: 100%;
          display: flex;
          flex-direction: column;
          overflow: hidden;
        }
        .accordion-body .terminal-panel {
          height: 100%;
          border-top: none;
        }
        .drag-handle {
          height: 6px;
          flex-shrink: 0;
          cursor: row-resize;
          background: transparent;
          position: relative;
          z-index: 10;
        }
        .drag-handle::after {
          content: '';
          position: absolute;
          left: 50%;
          top: 50%;
          transform: translate(-50%, -50%);
          width: 32px;
          height: 3px;
          border-radius: 2px;
          background: var(--text-muted);
          opacity: 0;
          transition: opacity 0.15s;
        }
        .drag-handle:hover::after,
        .drag-handle.dragging::after {
          opacity: 0.5;
        }
        .drag-handle:hover,
        .drag-handle.dragging {
          background: var(--bg-hover);
        }
        .drag-overlay {
          position: fixed;
          inset: 0;
          z-index: 9999;
          cursor: row-resize;
        }
      `}</style>
    </div>
  );
}
