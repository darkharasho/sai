// Shared chat state for the desktop, the phone app and main-process log
// compaction. Everything here must stay JSON-serializable (no Map/Set): it goes
// into snapshots and over the wire. Type-only imports keep this module free of
// React/DOM/Electron.
import type { ChatMessage } from '../../types';

export type ChatEvent = { type: string; [k: string]: unknown };

export interface ChatLogEntry { chatId: string; seq: number; ts: number; ev: ChatEvent }

export interface ChatSettings {
  provider: 'claude' | 'codex' | 'gemini' | 'kimi';
  model?: string; permMode?: string; effort?: string;
  approvalMode?: string; conversationMode?: string;
}

export interface QueuedItem {
  clientId: string; text: string; images?: string[]; queuedAt: number;
  /** The send's task tag: the bubble keeps it when the item is sent. */
  taskId?: string;
}

export interface TurnState {
  streaming: boolean;
  /** Active turn's sequence; -1 once a turn ended (stale-event guard). */
  turnSeq: number | null;
  /** Turn start time, for cumulative bubble durations. */
  startedAt: number | null;
  /** messages.length when the turn started; turn-end stamping starts here. */
  startIndex: number | null;
  /** The next text opens a new bubble instead of merging (set at turn boundaries). */
  forceNewBubble: boolean;
  /** startedAt for the next bubble (turn start or last tool result). */
  nextSegmentStart: number | null;
  /** A live reasoning row is open; thinking_tokens go onto it. */
  reasoningActive: boolean;
  /** After the load guard killed this chat's agent, errors are swallowed until this time. */
  loadGuardQuietUntil: number | null;
  /** The quiet window already ended the turn once. */
  loadGuardEnded: boolean;
}

export interface ChatState {
  messages: ChatMessage[];
  turn: TurnState;
  pendingApproval: PendingApproval | null;
  pendingSudo: PendingSudoPrompt | null;
  pendingCodexUserInput: PendingCodexUserInput | null;
  pendingCodexMcpElicitation: PendingCodexMcpElicitation | null;
  activeSubagents: Record<string, { summary: string; turnSeq: number | null }>;
  streamHint: string | null;
  promptSuggestion: string | null;
  settings: ChatSettings;
  queue: QueuedItem[];
  lastSeq: number;
}

export interface ChatSnapshot { chatId: string; seq: number; state: ChatState }

export interface ChatMeta {
  chatId: string; projectPath: string; title?: string;
  createdAt: number; updatedAt: number; headSeq: number; snapshotSeq: number;
  provider: ChatSettings['provider'];
  /** Equals the post-reduce state's turn.streaming; lets startup find open turns without reducing logs. */
  openTurn: boolean;
  /** Equals the post-reduce state's queue length; lets startup find persisted queues without reducing logs. */
  queued?: number;
  /**
   * The chat's pre-log (IndexedDB) history is settled: imported, or the chat
   * was created by a client (which checks IndexedDB first). False/absent for a
   * log a backend event created — importMessages folds the history in front.
   */
  imported?: boolean;
}

export interface PendingApproval {
  toolName: string;
  toolUseId: string;
  command: string;
  description: string;
  input: Record<string, any>;
  /** Present only for the capability-gated Codex App Server preview. */
  provider?: 'codex';
  requestHandle?: string;
  kind?: 'command' | 'file-change' | 'permissions';
  availableDecisions?: string[];
  reason?: string;
  cwd?: string;
  network?: { host?: string; protocol?: string };
  grantRoot?: string;
  permissionsSummary?: string[];
  /** JSON-safe opaque copies of the Codex App Server permissions being requested. */
  requestedPermissions?: unknown[];
  proposedExecpolicyAmendment?: string[];
}

export interface PendingSudoPrompt {
  promptId: string;
  toolUseId: string;
  command: string;
  /** Reason the previous attempt failed (e.g. "Incorrect password"). */
  error?: string;
}

/** Renderer-safe, capability-gated Codex App Server input request. */
export interface PendingCodexUserInput {
  provider: 'codex';
  requestHandle: string;
  questions: Array<{
    id: string;
    header: string;
    prompt: string;
    options?: Array<{ id: string; label: string; description?: string }>;
    allowOther?: boolean;
    isSecret?: boolean;
  }>;
  /** Present only when the server supplied an automatic-resolution deadline. */
  autoResolutionMs?: number;
}

/** Renderer-safe MCP elicitation request from the Codex App Server preview. */
export type PendingCodexMcpElicitation = {
  provider: 'codex';
  requestHandle: string;
  serverName: string;
  message: string;
} & (
  | { mode: 'form'; requestedSchema: Record<string, unknown> }
  | { mode: 'url'; url: string; elicitationId?: string }
);

/** Event types the client (desktop or phone) writes; every other type comes from a backend. */
export const CLIENT_EVENT_TYPES = [
  'user_message', 'local_note', 'cleared', 'watcher_snapshot',
  'settings_changed', 'queue_added', 'queue_removed', 'queue_cleared', 'queue_promoted',
] as const;
export type ClientEventType = (typeof CLIENT_EVENT_TYPES)[number];
