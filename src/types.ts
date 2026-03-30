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
}

export interface ToolCall {
  id?: string;
  type: 'file_edit' | 'terminal_command' | 'file_read' | 'other';
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
}

export interface GitCommit {
  hash: string;
  message: string;
  author: string;
  date: string;
  files: string[];
  isClaude: boolean;
}

export interface DirEntry {
  name: string;
  path: string;
  type: 'file' | 'directory';
}

export type WorkspaceStatus = 'active' | 'suspended' | 'recent';

export interface WorkspaceContext {
  projectPath: string;
  sessions: ChatSession[];
  activeSession: ChatSession;
  openFiles: OpenFile[];
  activeFilePath: string | null;
  terminalIds: number[];
  status: WorkspaceStatus;
  lastActivity: number;
}

declare global {
  interface Window {
    sai: Record<string, any>;
  }
}
