// src/components/TerminalMode/types.ts

export type BlockType = 'command' | 'ai-response' | 'ai-prompt' | 'approval' | 'tool-approval';

export interface AIPromptBlock {
  type: 'ai-prompt';
  id: string;
  content: string;
}

export interface CommandBlock {
  type: 'command';
  id: string;
  command: string;
  output: string;
  exitCode: number | null;  // null = still running
  startTime: number;
  duration: number | null;
  groupId?: string;
}

export interface AIToolCall {
  id: string;        // tool_use_id for matching results
  name: string;      // tool name (Bash, Read, etc.)
  input: string;     // command or file path
  output?: string;   // result content
  isError?: boolean;
}

export type AIEntry =
  | { kind: 'text'; text: string }
  | { kind: 'tool'; call: AIToolCall };

export interface AIResponseBlock {
  type: 'ai-response';
  id: string;
  content: string;
  parentBlockId: string;
  toolActivity?: string[];
  streaming?: boolean;
  entries?: AIEntry[];
}

export interface ApprovalBlock {
  type: 'approval';
  id: string;
  command: string;
  parentBlockId: string;
  status: 'pending' | 'approved' | 'rejected' | 'edited';
}

export interface ToolApprovalBlock {
  type: 'tool-approval';
  id: string;
  toolName: string;
  toolUseId: string;
  command: string;
  description: string;
  status: 'pending' | 'approved' | 'rejected';
}

export type Block = CommandBlock | AIResponseBlock | AIPromptBlock | ApprovalBlock | ToolApprovalBlock;

export type InputMode = 'shell' | 'ai';

// Terminal-native mode types
export type { SegmentedBlock } from './BlockSegmenter';
export type { DisplayItem } from './NativeBlockList';
