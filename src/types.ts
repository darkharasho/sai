export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  timestamp: number;
  toolCalls?: ToolCall[];
}

export interface ChatSession {
  id: string;
  title: string;
  messages: ChatMessage[];
  createdAt: number;
  updatedAt: number;
}

export interface ToolCall {
  type: 'file_edit' | 'terminal_command' | 'file_read' | 'other';
  name: string;
  input: string;
  output?: string;
}

export interface GitFile {
  path: string;
  status: 'modified' | 'added' | 'deleted' | 'renamed';
  staged: boolean;
}

export interface OpenFile {
  file: GitFile;
  diffMode: 'unified' | 'split';
}

export interface GitCommit {
  hash: string;
  message: string;
  author: string;
  date: string;
  files: string[];
  isClaude: boolean;
}

declare global {
  interface Window {
    sai: Record<string, any>;
  }
}
