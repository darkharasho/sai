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

/** Runtime-only capability evidence. Codex Swarm requires the isolated App
 * Server transport to have completed its experimental handshake; the static
 * provider table alone must never advertise it. */
export interface ProviderCapabilityRuntime {
  codexBackendMode?: 'sdk' | 'app-server';
  codexSwarmStatus?: { available: boolean; reason?: string };
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
    hasEffortMode: true,
    hasConversationMode: false,
    hasApprovalMode: true,
    supportsImages: true,
    supportsTerminalScope: true,
    supportsMultiScope: true,
    hasMcp: false,
    hasPlugins: false,
  },
  kimi: {
    hasOrchestrator: false,
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

export function getCapabilities(provider: AIProvider, runtime: ProviderCapabilityRuntime = {}): ProviderCapabilities {
  const capabilities = CAPABILITIES[provider];
  if (provider !== 'codex') return capabilities;
  return {
    ...capabilities,
    hasOrchestrator: runtime.codexBackendMode === 'app-server' && runtime.codexSwarmStatus?.available === true,
  };
}
