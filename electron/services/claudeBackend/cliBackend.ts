import {
  startImpl, sendImpl, interruptImpl, setSessionIdImpl, compactImpl, approveImpl,
  answerQuestionImpl, answerPlanReviewImpl, alwaysAllowImpl,
  generateCommitMessageImpl, generateTitleImpl, getAvailableClaudeModels,
} from '../claude';
import type {
  ClaudeBackend, StartArgs, SendArgs, CompactArgs, ApproveArgs, AnswerQuestionArgs, AnswerPlanArgs,
} from './types';

export class CliBackend implements ClaudeBackend {
  start(a: StartArgs) { return startImpl(a); }
  send(a: SendArgs) { sendImpl(a.projectPath, a.message, a.imagePaths, a.permMode, a.effort, a.model, a.scope, a.origin); }
  interrupt(projectPath: string, scope?: string) { interruptImpl(projectPath, scope); }
  setSessionId(projectPath: string, sessionId: string | undefined, scope?: string) { setSessionIdImpl(projectPath, sessionId, scope); }
  compact(a: CompactArgs) { compactImpl(a); }
  approve(a: ApproveArgs) { return Promise.resolve(approveImpl(a.projectPath, a.toolUseId, a.approved, a.modifiedCommand, a.scope)); }
  answerQuestion(a: AnswerQuestionArgs) { return Promise.resolve(answerQuestionImpl(a.projectPath, a.toolUseId, a.answers, a.scope)); }
  answerPlanReview(a: AnswerPlanArgs) { return Promise.resolve(answerPlanReviewImpl(a.projectPath, a.toolUseId, a.approved, a.scope)); }
  alwaysAllow(projectPath: string, toolPattern: string) { return alwaysAllowImpl(projectPath, toolPattern); }
  generateCommitMessage(cwd: string, provider?: string) { return generateCommitMessageImpl(cwd, provider); }
  generateTitle(cwd: string, userMessage: string, provider?: string) { return generateTitleImpl(cwd, userMessage, provider); }
  getModels() { return getAvailableClaudeModels(); }
}
