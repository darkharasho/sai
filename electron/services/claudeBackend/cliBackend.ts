import {
  startImpl, sendImpl, interruptImpl, setSessionIdImpl, compactImpl, approveImpl,
  answerQuestionImpl, answerPlanReviewImpl, alwaysAllowImpl,
  generateCommitMessageImpl, generateTitleImpl, getAvailableClaudeModels,
  reconcileScopeImpl, isScopeBusyImpl,
} from '../claude';
import { readCachedSlashCommands } from '../slashCommands';
import { listAllWorkspaces } from '../workspace';
import type {
  ClaudeBackend, StartArgs, SendArgs, CompactArgs, ApproveArgs, AnswerQuestionArgs, AnswerPlanArgs,
} from './types';

export class CliBackend implements ClaudeBackend {
  start(a: StartArgs) { return startImpl(a); }
  // The CLI has no supportedCommands() equivalent — its list only ever arrives
  // on an init frame, so a refresh can do no better than the cache.
  refreshSlashCommands(projectPath: string) { return Promise.resolve(readCachedSlashCommands(projectPath)); }
  send(a: SendArgs) { sendImpl(a.projectPath, a.message, a.imagePaths, a.permMode, a.effort, a.model, a.scope, a.origin, a.logged); }
  interrupt(projectPath: string, scope?: string) { interruptImpl(projectPath, scope); }
  isScopeBusy(projectPath: string, scope?: string) { return isScopeBusyImpl(projectPath, scope); }
  reconcileScope(projectPath: string, scope?: string) { reconcileScopeImpl(projectPath, scope); }
  setSessionId(projectPath: string, sessionId: string | undefined, scope?: string) { setSessionIdImpl(projectPath, sessionId, scope); }
  compact(a: CompactArgs) { compactImpl(a); }
  approve(a: ApproveArgs) { return approveImpl(a.projectPath, a.toolUseId, a.approved, a.modifiedCommand, a.scope); }
  answerQuestion(a: AnswerQuestionArgs) { return Promise.resolve(answerQuestionImpl(a.projectPath, a.toolUseId, a.answers, a.scope)); }
  answerPlanReview(a: AnswerPlanArgs) { return Promise.resolve(answerPlanReviewImpl(a.projectPath, a.toolUseId, a.approved, a.scope)); }
  alwaysAllow(projectPath: string, toolPattern: string) { return alwaysAllowImpl(projectPath, toolPattern); }
  generateCommitMessage(cwd: string, provider?: string) { return generateCommitMessageImpl(cwd, provider); }
  generateTitle(cwd: string, userMessage: string, provider?: string) { return generateTitleImpl(cwd, userMessage, provider); }
  getModels() { return getAvailableClaudeModels(); }
  /** Scopes whose persistent CLI process is alive. */
  liveScopes() {
    const out: Array<{ projectPath: string; scope: string }> = [];
    for (const ws of listAllWorkspaces()) {
      for (const [scope, c] of ws.claudeScopes) if (c.process) out.push({ projectPath: ws.projectPath, scope });
    }
    return out;
  }
}
