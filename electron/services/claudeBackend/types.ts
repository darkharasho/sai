import type { ClaudeModelOption } from '../claude';

export interface StartArgs {
  projectPath: string;
  scope?: string;
  kind?: 'chat' | 'task' | 'orchestrator';
  orchestratorContext?: Record<string, unknown> | null;
  scopeCwd?: string;
  metaPreamble?: string;
}
export interface SendArgs {
  projectPath: string;
  message: string;
  imagePaths?: string[];
  permMode?: string;
  effort?: string;
  model?: string;
  scope?: string;
  origin?: 'desktop' | 'remote';
}
export interface CompactArgs {
  projectPath: string;
  permMode?: string;
  effort?: string;
  model?: string;
  scope?: string;
}
export interface ApproveArgs {
  projectPath: string;
  toolUseId: string;
  approved: boolean;
  modifiedCommand?: string;
  scope?: string;
}
export interface AnswerQuestionArgs {
  projectPath: string;
  toolUseId: string;
  answers: Record<string, string | string[]>;
  scope?: string;
}
export interface AnswerPlanArgs {
  projectPath: string;
  toolUseId: string;
  approved: boolean;
  scope?: string;
}

export interface ClaudeBackend {
  start(args: StartArgs): { slashCommands: string[] } | undefined;
  send(args: SendArgs): void;
  interrupt(projectPath: string, scope?: string): void;
  setSessionId(projectPath: string, sessionId: string | undefined, scope?: string): void;
  compact(args: CompactArgs): void;
  approve(args: ApproveArgs): Promise<boolean>;
  answerQuestion(args: AnswerQuestionArgs): Promise<boolean>;
  answerPlanReview(args: AnswerPlanArgs): Promise<boolean>;
  alwaysAllow(projectPath: string, toolPattern: string): Promise<boolean>;
  generateCommitMessage(cwd: string, provider?: string): Promise<string>;
  generateTitle(cwd: string, userMessage: string, provider?: string): Promise<string>;
  getModels(): { models: ClaudeModelOption[]; detected: boolean };
}
