import { describe, it, expect } from 'vitest';
import { createMockSai } from '../../../helpers/ipc-mock';
import { getTerminalProviderBridge } from '../../../../src/components/TerminalMode/providerBridge';

describe('getTerminalProviderBridge', () => {
  it('routes Codex terminal requests through codex bridge methods', () => {
    const sai = createMockSai();
    const bridge = getTerminalProviderBridge(sai, 'codex');

    bridge.send('/repo', 'prompt', 'default');
    bridge.stop('/repo');

    expect(sai.codexSend).toHaveBeenCalledWith('/repo', 'prompt', undefined, 'auto', undefined);
    expect(sai.codexStop).toHaveBeenCalledWith('/repo');
    expect(sai.claudeSend).not.toHaveBeenCalled();
    expect(sai.claudeStop).not.toHaveBeenCalled();
  });

  it('maps bypass terminal mode to Codex full-access', () => {
    const sai = createMockSai();
    const bridge = getTerminalProviderBridge(sai, 'codex');

    bridge.send('/repo', 'prompt', 'bypass');

    expect(sai.codexSend).toHaveBeenCalledWith('/repo', 'prompt', undefined, 'full-access', undefined);
  });

  it('routes Gemini terminal requests through gemini bridge methods', () => {
    const sai = createMockSai();
    const bridge = getTerminalProviderBridge(sai, 'gemini');

    bridge.send('/repo', 'prompt', 'default');
    bridge.stop('/repo');

    expect(sai.geminiSend).toHaveBeenCalledWith('/repo', 'prompt', undefined, 'auto_edit', 'planning', undefined, 'terminal');
    expect(sai.geminiStop).toHaveBeenCalledWith('/repo', 'terminal');
    expect(sai.claudeSend).not.toHaveBeenCalled();
    expect(sai.claudeStop).not.toHaveBeenCalled();
  });

  it('keeps Claude terminal requests on the Claude bridge', () => {
    const sai = createMockSai();
    const bridge = getTerminalProviderBridge(sai, 'claude');

    bridge.send('/repo', 'prompt', 'bypass');
    bridge.stop('/repo');

    expect(sai.claudeSend).toHaveBeenCalledWith('/repo', 'prompt', undefined, 'bypass', 'high', 'sonnet', 'terminal');
    expect(sai.claudeStop).toHaveBeenCalledWith('/repo', 'terminal');
  });
});
