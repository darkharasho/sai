export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  timestamp: number;
  startedAt?: number;
  toolCalls?: ToolCall[];
  images?: string[];
  /**
   * Snapshots of GitHubWatcherCard state captured at phase transitions so the
   * card resumes from its last-known state when an old chat is reopened. Keyed
   * by url. The payload shape is intentionally untyped here to avoid pulling
   * watcher-internal types into the global ChatMessage interface.
   */
  githubWatchers?: GitHubWatcherSnapshot[];
  durationMs?: number;
  error?: {
    title: string;
    status?: number;
    message: string;
    requestId?: string;
    details?: string;
    errorType?: string;
  };
  /**
   * Optional metadata for non-standard rendering (e.g. inline swarm approval
   * cards injected into the orchestrator chat). Generic chat panels ignore
   * this field; the orchestrator's renderToolCall / renderMessage hooks use
   * it to render purpose-built cards instead of plain text.
   */
  meta?: ChatMessageMeta;
}

export type ChatMessageMeta = ApprovalChatMeta;

export interface ApprovalChatMeta {
  type: 'approval';
  approvalId: string;
  taskId: string;
  taskTitle: string;
  toolName: string;
  command?: string;
  branch?: string;
  createdAt: number;
  /** Set when the approval has been resolved; collapses the card. */
  resolved?: 'approved' | 'denied';
}

export type AIProvider = 'claude' | 'codex' | 'gemini';

export interface ChatSession {
  id: string;
  title: string;
  messages: ChatMessage[];
  createdAt: number;
  updatedAt: number;
  aiProvider?: AIProvider;
  claudeSessionId?: string;
  codexSessionId?: string;
  geminiSessionId?: string;
  pinned?: boolean;
  lastViewedAt?: number;
  /** Stamped when a background turn ends with is_error/error_during_execution.
   *  Cleared when a subsequent turn completes successfully. Drives the
   *  ChatHistorySidebar error indicator. */
  lastTurnErrored?: boolean;
  /** Stamped when the backing Claude scope was reaped by the idle sweep.
   *  Cleared on the next streaming_start (process respawned). Persisted so
   *  the yellow sidebar dot survives app restarts. */
  scopeSuspended?: boolean;
  titleEdited?: boolean;
  messageCount: number;
  projectPath?: string;
  kind?: SessionKind;        // default 'chat'
  swarmTaskId?: string;      // populated for task / orchestrator sessions
}

export interface GitHubWatcherSnapshot {
  url: string;
  kind: 'run';
  phase: 'pending' | 'queued' | 'in_progress' | 'success' | 'failure' | 'cancelled' | 'neutral' | 'error';
  /** ms epoch of when this snapshot was captured — used by the hybrid resume policy. */
  capturedAt: number;
  /** Opaque RunState payload. Kept loose so this type doesn't depend on the card. */
  data: Record<string, unknown>;
}

export interface ToolCall {
  id?: string;
  type: 'file_edit' | 'terminal_command' | 'file_read' | 'web_fetch' | 'other';
  name: string;
  input: string;
  output?: string;
  startedAt?: number;
  durationMs?: number;
}

export interface PendingApproval {
  toolName: string;
  toolUseId: string;
  command: string;
  description: string;
  input: Record<string, any>;
}

export interface QueuedMessage {
  id: string;
  text: string;
  fullText: string;
  images?: string[];
  attachments?: { images: number; files: number; terminal: boolean };
}

export interface GitFile {
  path: string;
  status: 'modified' | 'added' | 'deleted' | 'renamed';
  staged: boolean;
}

export interface OpenFile {
  path: string;
  viewMode: 'diff' | 'editor';
  // diff mode fields
  file?: GitFile;
  diffMode?: 'unified' | 'split';
  // editor mode fields
  content?: string;
  savedContent?: string;
  isDirty?: boolean;
  diskMtime?: number;
  pendingLine?: number;
  mdPreview?: boolean;
}

export interface GitCommit {
  hash: string;
  message: string;
  author: string;
  date: string;
  files: string[];
  aiProvider?: 'claude' | 'codex' | 'gemini';
}

export interface DirEntry {
  name: string;
  path: string;
  type: 'file' | 'directory';
}

export type WorkspaceStatus = 'active' | 'suspended' | 'recent';

export interface TerminalTab {
  uid: number;         // stable unique ID for React keys (never changes)
  id: number;          // PTY id from main process (updated when PTY is created)
  name: string | null; // user-assigned name (null = auto from process)
  order: number;       // display order in tab list (1-based)
}

export interface WorkspaceContext {
  projectPath: string;
  sessions: ChatSession[];
  activeSession: ChatSession;
  openFiles: OpenFile[];
  activeFilePath: string | null;
  terminalIds: number[];
  terminalTabs: TerminalTab[];
  activeTerminalId: number | null;
  status: WorkspaceStatus;
  lastActivity: number;
}

export type MetaWorkspaceProjectStatus = 'ok' | 'unavailable';

export interface MetaWorkspaceProject {
  path: string;            // absolute path on the originating device
  linkName: string;        // basename used inside the synthetic root
  description?: string;    // one-line hint fed to the AI system prompt
}

export interface MetaWorkspace {
  id: string;                          // stable UUID, also used as ~/.sai/meta/<id>
  name: string;                        // display name
  projects: MetaWorkspaceProject[];
  createdAt: number;
  lastActivity: number;
}

export interface MetaWorkspaceListItem extends MetaWorkspace {
  syntheticRoot: string;               // derived per-device, populated by IPC list
}

export interface MetaWorkspaceRuntimeProject extends MetaWorkspaceProject {
  status: MetaWorkspaceProjectStatus;  // derived per-device on activation
}

export interface MetaWorkspaceRuntime {
  meta: MetaWorkspace;
  syntheticRoot: string;               // ~/.sai/meta/<id>/, derived per-device
  projects: MetaWorkspaceRuntimeProject[];
}

export interface Plugin {
  name: string;
  description: string;
  version: string;
  source: string;
  enabled: boolean;
  skills: string[];
  icon?: string;
}

export interface RegistryPlugin {
  name: string;
  description: string;
  version: string;
  source: string;
  skills: string[];
  commands: string[];
  author: string;
  repositoryUrl: string;
  installed: boolean;
}

export interface McpServer {
  name: string;
  description?: string;
  transport: 'stdio' | 'sse' | 'streamable-http';
  command?: string;
  args?: string[];
  url?: string;
  env?: Record<string, string>;
  enabled: boolean;
  source?: 'user' | 'plugin';
}

export interface McpServerConfig {
  name: string;
  transport: 'stdio' | 'sse' | 'streamable-http';
  command?: string;
  args?: string[];
  url?: string;
  env?: Record<string, string>;
}

export interface McpTool {
  name: string;
  description?: string;
  parameters?: string;
}

export interface McpPackage {
  registryType: string;
  identifier: string;
  version?: string;
  transport?: { type: string };
  environmentVariables?: { name: string; description: string; required?: boolean }[];
}

export interface McpRemote {
  type: string;
  url: string;
}

export interface RegistryMcpServer {
  name: string;
  title: string;
  description: string;
  source: string;
  repositoryUrl: string;
  websiteUrl: string;
  iconUrl: string;
  transport: 'stdio' | 'sse' | 'streamable-http';
  version: string;
  installed: boolean;
  packages: McpPackage[];
  remotes: McpRemote[];
}

export interface ConflictHunk {
  index: number;
  ours: string[];
  theirs: string[];
  oursLabel: string;
  theirsLabel: string;
}

export interface StashEntry {
  index: number;
  message: string;
  date: string;
  fileCount: number;
}

export interface RebaseStatus {
  inProgress: boolean;
  onto: string;
}

export interface SaiSearchApi {
  searchRun(args: { rootPath: string; query: SearchQuery; openBuffers: { path: string; content: string }[] }): Promise<SearchResults>;
  searchReplaceFile(args: { filePath: string; edits: { line: number; column: number; length: number; replacement: string }[] }): Promise<void>;
}

declare global {
  interface SaiBridge extends Record<string, any> {
    metaWorkspaceList?: () => Promise<any[]>;
    metaWorkspaceCreate?: (input: any) => Promise<any>;
    metaWorkspaceUpdate?: (id: string, patch: any) => Promise<any>;
    metaWorkspaceActivate?: (id: string) => Promise<any>;
    metaWorkspaceDelete?: (id: string) => Promise<boolean>;
    geminiSetSessionId?: (projectPath: string, sessionId: string | undefined, scope?: string) => void;
    searchRun?: SaiSearchApi['searchRun'];
    searchReplaceFile?: SaiSearchApi['searchReplaceFile'];
    swarm?: {
      worktreeAdd: (projectPath: string, taskId: string, branch: string, baseBranch: string) => Promise<string>;
      worktreeRemove: (projectPath: string, worktreePath: string, branch: string) => Promise<void>;
      canFastForward: (projectPath: string, source: string, target: string) => Promise<boolean>;
      ffMerge: (projectPath: string, source: string) => Promise<void>;
      diffStats: (cwd: string, baseBranch: string, branch: string) => Promise<{ additions: number; deletions: number; files: number }>;
      branchDiff: (cwd: string, baseBranch: string, branch: string) => Promise<string>;
    };
  }

  interface Window {
    sai: SaiBridge;
  }
}

export interface SearchQuery {
  pattern: string;
  caseSensitive: boolean;
  wholeWord: boolean;
  regex: boolean;
  includeGlobs: string[];
  excludeGlobs: string[];
  useGitignore: boolean;
}

export interface SearchMatch {
  line: number;
  column: number;
  length: number;
  preview: string;
  matchStart: number;
  matchEnd: number;
}

export interface FileMatches {
  path: string;
  matches: SearchMatch[];
}

export interface SearchResults {
  files: FileMatches[];
  truncated: boolean;
  durationMs: number;
}

export type SessionKind = 'chat' | 'task' | 'orchestrator';

export type SwarmTaskStatus =
  | 'queued'
  | 'streaming'
  | 'awaiting_approval'
  | 'paused'
  | 'done'
  | 'failed'
  | 'landed'
  | 'discarded';

export type ApprovalPolicy = 'auto' | 'auto-read' | 'always-ask';

export interface SwarmTask {
  id: string;
  workspaceId: string;        // = projectPath
  sessionId: string;          // FK to ChatSession.id
  title: string;
  prompt: string;
  provider: AIProvider;
  model: string;
  approvalPolicy: ApprovalPolicy;
  status: SwarmTaskStatus;
  branch: string;
  baseBranch: string;         // branch HEAD when task was spawned
  worktreePath: string | null;
  /** For meta workspaces: the real project root that owns this task's git worktree and cwd.
   *  For normal workspaces: undefined (equivalent to workspaceId). */
  projectPath?: string;
  /** For meta workspaces: the human-readable link name shown in cards. */
  projectLinkName?: string;
  createdAt: number;
  lastActivityAt: number;
  costEstimate: number;
  toolCallCount: number;
}

export interface SwarmApproval {
  id: string;
  taskId: string;
  workspaceId: string;
  toolName: string;
  toolUseId: string;
  command?: string;
  description?: string;
  input?: unknown;
  createdAt: number;
}
