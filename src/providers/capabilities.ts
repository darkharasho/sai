import type { AIProvider } from '../types';

export interface ProviderCapabilities {
  hasOrchestrator: boolean;
  hasSlashCommands: boolean;
  hasEffortMode: boolean;
  hasConversationMode: boolean;
  hasApprovalMode: boolean;
  supportsImages: boolean;
  supportsTerminalScope: boolean;
  supportsMultiScope: boolean;
  hasMcp: boolean;
  hasPlugins: boolean;
}

const CAPABILITIES: Record<AIProvider, ProviderCapabilities> = {
  claude: {
    hasOrchestrator: true,
    hasSlashCommands: true,
    hasEffortMode: true,
    hasConversationMode: false,
    hasApprovalMode: false,
    supportsImages: true,
    supportsTerminalScope: true,
    supportsMultiScope: true,
    hasMcp: true,
    hasPlugins: true,
  },
  gemini: {
    hasOrchestrator: false,
    hasSlashCommands: false,
    hasEffortMode: false,
    hasConversationMode: true,
    hasApprovalMode: true,
    supportsImages: true,
    supportsTerminalScope: true,
    supportsMultiScope: true,
    hasMcp: false,
    hasPlugins: false,
  },
  codex: {
    hasOrchestrator: false,
    hasSlashCommands: false,
    hasEffortMode: false,
    hasConversationMode: false,
    hasApprovalMode: true,
    supportsImages: true,
    supportsTerminalScope: false,
    supportsMultiScope: false,
    hasMcp: false,
    hasPlugins: false,
  },
};

export function getCapabilities(provider: AIProvider): ProviderCapabilities {
  return CAPABILITIES[provider];
}
