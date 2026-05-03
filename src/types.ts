export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  timestamp: number;
  toolCalls?: ToolCall[];
  images?: string[];
  error?: {
    title: string;
    status?: number;
    message: string;
    requestId?: string;
    details?: string;
    errorType?: string;
  };
}

export interface ChatSession {
  id: string;
  title: string;
  messages: ChatMessage[];
  createdAt: number;
  updatedAt: number;
  aiProvider?: 'claude' | 'codex' | 'gemini';
  claudeSessionId?: string;
  codexSessionId?: string;
  geminiSessionId?: string;
  pinned?: boolean;
  titleEdited?: boolean;
  messageCount: number;
  projectPath?: string;
}

export interface ToolCall {
  id?: string;
  type: 'file_edit' | 'terminal_command' | 'file_read' | 'web_fetch' | 'other';
  name: string;
  input: string;
  output?: string;
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
    geminiSetSessionId?: (projectPath: string, sessionId: string | undefined, scope?: string) => void;
    searchRun?: SaiSearchApi['searchRun'];
    searchReplaceFile?: SaiSearchApi['searchReplaceFile'];
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
