import type { ClaudeModelOption } from '../claude';
import type { SlashCommandInfo } from '../slashCommands';

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

export type ApproveResult = boolean | void | { result: string; isError: boolean };
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
  start(args: StartArgs): { slashCommands: SlashCommandInfo[] } | undefined;
  /** Re-pull the scope's slash commands from the live query (SDK
   *  supportedCommands()), falling back to the per-project cache when no
   *  session exists. Drives the renderer's on-demand refresh. */
  refreshSlashCommands(projectPath: string, scope?: string): Promise<SlashCommandInfo[]>;
  send(args: SendArgs): void;
  interrupt(projectPath: string, scope?: string): void;
  /** Re-assert backend truth for a scope the renderer believes is streaming.
   *  If the scope is genuinely busy: no-op. If it is idle (or unknown), emit
   *  an unconditional-unstick `done` (turnSeq null — never stale-droppable);
   *  if it is in a wait state, re-emit the wait done. Safety net for lost or
   *  stale-dropped turn-ends — the renderer's streaming state is event-sourced
   *  and otherwise never reconciles with reality. */
  reconcileScope(projectPath: string, scope?: string): void;
  setSessionId(projectPath: string, sessionId: string | undefined, scope?: string): void;
  compact(args: CompactArgs): void;
  approve(args: ApproveArgs): Promise<ApproveResult>;
  answerQuestion(args: AnswerQuestionArgs): Promise<boolean>;
  answerPlanReview(args: AnswerPlanArgs): Promise<boolean>;
  alwaysAllow(projectPath: string, toolPattern: string): Promise<boolean>;
  generateCommitMessage(cwd: string, provider?: string): Promise<string>;
  generateTitle(cwd: string, userMessage: string, provider?: string): Promise<string>;
  getModels(): { models: ClaudeModelOption[]; detected: boolean };
  destroy?(): void;
}
