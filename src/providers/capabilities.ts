import type { AIProvider } from '../types';

export interface ProviderCapabilities {
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
    hasSlashCommands: false,
    hasEffortMode: true,
    hasConversationMode: false,
    hasApprovalMode: true,
    supportsImages: true,
    supportsTerminalScope: true,
    supportsMultiScope: true,
    // Codex exposes a read-only App Server MCP runtime view. It does not
    // reuse Claude's install/configuration controls.
    hasMcp: true,
    hasPlugins: false,
  },
  kimi: {
    hasSlashCommands: false,
    hasEffortMode: false,
    hasConversationMode: false,
    hasApprovalMode: true,
    supportsImages: true,
    supportsTerminalScope: true,
    supportsMultiScope: true,
    hasMcp: false,
    hasPlugins: false,
  },
};

export function getCapabilities(provider: AIProvider): ProviderCapabilities {
  return CAPABILITIES[provider];
}
