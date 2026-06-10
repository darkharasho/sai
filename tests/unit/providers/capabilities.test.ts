import { describe, it, expect } from 'vitest';
import { getCapabilities } from '../../../src/providers/capabilities';

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
    it('does not have effort mode', () => expect(getCapabilities('codex').hasEffortMode).toBe(false));
    it('does not have conversation mode', () => expect(getCapabilities('codex').hasConversationMode).toBe(false));
    it('has approval mode', () => expect(getCapabilities('codex').hasApprovalMode).toBe(true));
    it('does not support terminal scope', () => expect(getCapabilities('codex').supportsTerminalScope).toBe(false));
    it('does not support multi-scope', () => expect(getCapabilities('codex').supportsMultiScope).toBe(false));
  });
});
