import { describe, it, expect } from 'vitest';
import { getCapabilities } from '../../../src/providers/capabilities';
import { isAIProvider, AI_PROVIDERS } from '../../../src/types';

describe('getCapabilities', () => {
  describe('claude', () => {
    it('has orchestrator', () => expect(getCapabilities('claude').hasOrchestrator).toBe(true));
    it('has slash commands', () => expect(getCapabilities('claude').hasSlashCommands).toBe(true));
    it('has effort mode', () => expect(getCapabilities('claude').hasEffortMode).toBe(true));
    it('does not have conversation mode', () => expect(getCapabilities('claude').hasConversationMode).toBe(false));
    it('does not have approval mode', () => expect(getCapabilities('claude').hasApprovalMode).toBe(false));
    it('supports images', () => expect(getCapabilities('claude').supportsImages).toBe(true));
    it('supports terminal scope', () => expect(getCapabilities('claude').supportsTerminalScope).toBe(true));
    it('supports multi-scope', () => expect(getCapabilities('claude').supportsMultiScope).toBe(true));
    it('keeps orchestrator support independent of Codex transport state', () => {
      expect(getCapabilities('claude', {
        codexBackendMode: 'sdk',
        codexSwarmStatus: { available: false, reason: 'SDK selected' },
      }).hasOrchestrator).toBe(true);
    });
  });

  describe('gemini', () => {
    it('does not have orchestrator', () => expect(getCapabilities('gemini').hasOrchestrator).toBe(false));
    it('does not have slash commands', () => expect(getCapabilities('gemini').hasSlashCommands).toBe(false));
    it('does not have effort mode', () => expect(getCapabilities('gemini').hasEffortMode).toBe(false));
    it('has conversation mode', () => expect(getCapabilities('gemini').hasConversationMode).toBe(true));
    it('has approval mode', () => expect(getCapabilities('gemini').hasApprovalMode).toBe(true));
    it('supports images', () => expect(getCapabilities('gemini').supportsImages).toBe(true));
  });

  describe('codex', () => {
    it('does not have orchestrator', () => expect(getCapabilities('codex').hasOrchestrator).toBe(false));
    it('does not have slash commands', () => expect(getCapabilities('codex').hasSlashCommands).toBe(false));
    it('has read-only MCP runtime status', () => expect(getCapabilities('codex').hasMcp).toBe(true));
    it('does not have plugins', () => expect(getCapabilities('codex').hasPlugins).toBe(false));
    it('has its own effort mode', () => expect(getCapabilities('codex').hasEffortMode).toBe(true));
    it('does not have conversation mode', () => expect(getCapabilities('codex').hasConversationMode).toBe(false));
    it('has approval mode', () => expect(getCapabilities('codex').hasApprovalMode).toBe(true));
    it('supports terminal scope', () => expect(getCapabilities('codex').supportsTerminalScope).toBe(true));
    it('supports multi-scope', () => expect(getCapabilities('codex').supportsMultiScope).toBe(true));

    it('enables the orchestrator only after the App Server Swarm bridge is ready', () => {
      expect(getCapabilities('codex', {
        codexBackendMode: 'app-server',
        codexSwarmStatus: { available: true },
      }).hasOrchestrator).toBe(true);
    });

    it.each([
      ['SDK backend', { codexBackendMode: 'sdk' as const, codexSwarmStatus: { available: true } }],
      ['unnegotiated App Server', { codexBackendMode: 'app-server' as const, codexSwarmStatus: { available: false, reason: 'Dynamic tools are unavailable' } }],
    ])('keeps the orchestrator disabled for %s', (_label, runtime) => {
      expect(getCapabilities('codex', runtime).hasOrchestrator).toBe(false);
    });
  });
});

describe('kimi provider plumbing', () => {
  it('kimi capabilities: gemini-level minus conversation mode', () => {
    expect(getCapabilities('kimi')).toEqual({
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
    });
  });

  it('isAIProvider accepts all four providers and rejects junk', () => {
    expect(AI_PROVIDERS).toEqual(['claude', 'codex', 'gemini', 'kimi']);
    expect(isAIProvider('kimi')).toBe(true);
    expect(isAIProvider('grok')).toBe(false);
    expect(isAIProvider(undefined)).toBe(false);
  });
});
