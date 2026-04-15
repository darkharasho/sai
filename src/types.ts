export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  timestamp: number;
  toolCalls?: ToolCall[];
  images?: string[];
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

declare global {
  interface SaiBridge extends Record<string, any> {
    geminiSetSessionId?: (projectPath: string, sessionId: string | undefined, scope?: string) => void;
  }

  interface Window {
    sai: SaiBridge;
  }
}
