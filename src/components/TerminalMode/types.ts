// src/components/TerminalMode/types.ts

export type BlockType = 'command' | 'ai-response' | 'approval';

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

export interface AIResponseBlock {
  type: 'ai-response';
  id: string;
  content: string;
  parentBlockId: string;
}

export interface ApprovalBlock {
  type: 'approval';
  id: string;
  command: string;
  parentBlockId: string;
  status: 'pending' | 'approved' | 'rejected' | 'edited';
}

export type Block = CommandBlock | AIResponseBlock | ApprovalBlock;

export type InputMode = 'shell' | 'ai';
