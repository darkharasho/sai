// One entry point for a provider's model list: the same functions the
// claude:models / codex:models / gemini:models / kimi:models IPC handlers call
// (remote v2 models.list uses this). The shape is whatever that handler returns.
import { listClaudeModels } from './claude';
import { listCodexModels } from './codex';
import { listGeminiModels } from './gemini';
import { acpModels } from './acpProvider';
import { KIMI_CONFIG } from './kimi';

export type ModelProvider = 'claude' | 'codex' | 'gemini' | 'kimi';

export async function listProviderModels(provider: ModelProvider): Promise<unknown> {
  switch (provider) {
    case 'claude': return listClaudeModels();
    case 'codex': return listCodexModels(false);
    case 'gemini': return listGeminiModels();
    case 'kimi': return acpModels(KIMI_CONFIG);
  }
}
