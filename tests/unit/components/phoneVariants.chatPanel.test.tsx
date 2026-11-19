import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, waitFor } from '@testing-library/react';
import { installMockSai } from '../../helpers/ipc-mock';
import { bridgeClaudeOnMessageToLog, installSyncFrames } from '../../helpers/chatlogMock';

vi.mock('../../../src/components/Chat/ChatInput', () => ({ default: () => <div data-testid="chat-input" /> }));
vi.mock('../../../src/components/Chat/MessageQueue', () => ({ default: () => <div /> }));
vi.mock('../../../src/components/ThinkingAnimation', () => ({ default: () => <div /> }));

import ChatPanel from '../../../src/components/Chat/ChatPanel';

const props: any = {
  projectPath: '/project', permissionMode: 'default', onPermissionChange: vi.fn(),
  effortLevel: 'high', onEffortChange: vi.fn(), modelChoice: 'sonnet', onModelChange: vi.fn(),
  aiProvider: 'claude', codexModel: '', onCodexModelChange: vi.fn(), codexModels: [],
  codexPermission: 'auto', onCodexPermissionChange: vi.fn(), geminiModel: 'auto-gemini-3',
  onGeminiModelChange: vi.fn(), geminiModels: [], geminiApprovalMode: 'default',
  onGeminiApprovalModeChange: vi.fn(), geminiConversationMode: 'planning',
  onGeminiConversationModeChange: vi.fn(), onMessagesChange: vi.fn(), onTurnComplete: vi.fn(),
  onClaudeSessionId: vi.fn(), onGeminiSessionId: vi.fn(), onCodexSessionId: vi.fn(),
  activeFilePath: null, onFileOpen: vi.fn(), isActive: true, sessionId: 'session-1',
  terminalTabs: [], onSlashCommandsUpdate: vi.fn(),
};

let sai: ReturnType<typeof installMockSai>;
beforeEach(() => {
  sai = installMockSai();
  sai.settingsGet.mockImplementation((_k: string, d: unknown) => Promise.resolve(d));
  sai.claudeOnMessage.mockImplementation(() => () => {});
  bridgeClaudeOnMessageToLog(sai as any);
  Object.defineProperty(window, 'IntersectionObserver', { writable: true, value: class { observe() {} disconnect() {} unobserve() {} } });
  Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', { writable: true, value: vi.fn() });
  installSyncFrames();
});
afterEach(() => { delete document.documentElement.dataset.saiPhone; });

describe('ChatPanel empty state', () => {
  it('desktop: keyboard hints render', async () => {
    const { container } = render(<ChatPanel {...props} />);
    await waitFor(() => expect(sai.claudeOnMessage).toHaveBeenCalled());
    expect(container.querySelector('.chat-empty-hints')).toBeTruthy();
  });

  it('phone: keyboard hints hidden', async () => {
    document.documentElement.dataset.saiPhone = '1';
    const { container } = render(<ChatPanel {...props} />);
    await waitFor(() => expect(sai.claudeOnMessage).toHaveBeenCalled());
    expect(container.querySelector('.chat-empty-subtitle')).toBeTruthy();
    expect(container.querySelector('.chat-empty-hints')).toBeNull();
  });
});
