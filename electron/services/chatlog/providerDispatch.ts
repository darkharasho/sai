// The real ProviderDispatch for ChatCommands: routes a chat command to the
// provider backend the way ChatPanel's handleSend/handleApprove do today
// (settings → per-provider send args). Gemini and Kimi take the chat id as
// scope; Claude sends carry logged:true (the user message is already logged).
import { getClaudeBackend } from '../claudeBackend';
import { getCodexBackend } from '../codexBackend';
import type { CodexPermission, CodexReasoningEffort } from '../codexBackend/types';
import { getGeminiCommands } from '../gemini';
import { getAcpCommands } from '../acpProvider';
import { get as getWorkspace } from '../workspace';
import { getLoadGuard } from '../loadGuard';
import { normalizeCodexEffort } from '../../../src/lib/codexEffort';
import type { CodexEffort } from '../../../src/types';
import type { ProviderDispatch } from './commands';

export function createProviderDispatch(devlog: (event: string, data: Record<string, unknown>) => void = () => {}): ProviderDispatch {
  return {
    send(p, a) {
      const s = a.settings;
      switch (p) {
        case 'gemini':
          if (!getGeminiCommands()) devlog('chatcmd.noProvider', { provider: p });
          getGeminiCommands()?.send({
            projectPath: a.projectPath, message: a.prompt, imagePaths: a.imagePaths,
            approvalMode: s.approvalMode, conversationMode: s.conversationMode, model: s.model, scope: a.scope,
          });
          return;
        case 'kimi':
          if (!getAcpCommands('kimi')) devlog('chatcmd.noProvider', { provider: p });
          // kimiSend never passes a conversation mode.
          getAcpCommands('kimi')?.send({
            projectPath: a.projectPath, message: a.prompt, imagePaths: a.imagePaths,
            approvalMode: s.approvalMode, conversationMode: undefined, model: s.model, scope: a.scope,
          });
          return;
        case 'codex': {
          const backend = getCodexBackend();
          // ChatPanel: normalizeCodexEffort(codexEffort ?? 'high', selected model option).
          void backend.getModels(false).catch(() => null).then((res) => {
            const option = res?.models.find((m) => m.id === s.model);
            const effort = normalizeCodexEffort((s.effort ?? 'high') as CodexEffort, option);
            backend.send({
              projectPath: a.projectPath, message: a.prompt, imagePaths: a.imagePaths,
              permission: s.permMode as CodexPermission | undefined,
              effort: effort as CodexReasoningEffort | undefined,
              model: s.model, scope: a.scope, origin: a.origin,
            });
          });
          return;
        }
        default:
          getClaudeBackend().send({
            projectPath: a.projectPath, message: a.prompt, imagePaths: a.imagePaths,
            permMode: s.permMode, effort: s.effort, model: s.model, scope: a.scope, origin: a.origin,
            logged: true,
          });
      }
    },

    stop(p, projectPath, scope) {
      switch (p) {
        case 'gemini': getGeminiCommands()?.stop(projectPath, scope); return;
        case 'kimi': getAcpCommands('kimi')?.stop(projectPath, scope); return;
        case 'codex': getCodexBackend().interrupt(projectPath, scope); return;
        default: getClaudeBackend().interrupt(projectPath, scope);
      }
    },

    async approve(p, a) {
      switch (p) {
        case 'gemini':
          return; // gemini:approve is a no-op (Antigravity picks its permission mode per launch).
        case 'kimi':
          await getAcpCommands('kimi')?.approve(a);
          return;
        case 'codex': {
          // ChatPanel approves via requestHandle ?? toolUseId; the command carries that id.
          const result = getCodexBackend().approve(a.projectPath, a.scope, a.toolUseId,
            { type: 'decision', value: a.approved ? 'accept' : 'decline' });
          if (!result.ok) throw new Error(`codex approval ${result.code}`);
          return;
        }
        default:
          await getClaudeBackend().approve(a);
      }
    },

    async answer(a) {
      await getClaudeBackend().answerQuestion(a);
    },

    async planReview(a) {
      await getClaudeBackend().answerPlanReview(a);
    },

    isBusy(projectPath, scope) {
      const claude = getClaudeBackend();
      if (claude.isScopeBusy?.(projectPath, scope)) return true;
      if (getCodexBackend().isScopeBusy?.(projectPath, scope)) return true;
      const ws = getWorkspace(projectPath);
      return !!ws && (ws.gemini.scopeTurns.has(scope) || ws.kimi.scopeTurns.has(scope));
    },

    isLoadPaused() {
      return getLoadGuard()?.state().paused === true;
    },
  };
}
