import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act, render, waitFor } from '@testing-library/react';
import type { ComponentProps } from 'react';
import { installMockSai } from '../../../helpers/ipc-mock';
import { readFlipRect, _resetFlipRegistry } from '../../../../src/components/Chat/flipRegistry';

vi.mock('../../../../src/components/Chat/ChatMessage', () => ({
  default: () => <div data-testid="chat-message" />,
}));

let latestChatInputProps: any;

vi.mock('../../../../src/components/Chat/ChatInput', () => ({
  default: (props: any) => {
    latestChatInputProps = props;
    return (
      <button data-testid="chat-input" onClick={() => props.onSend('new prompt')}>
        send
      </button>
    );
  },
}));

vi.mock('../../../../src/components/Chat/MessageQueue', () => ({
  default: () => <div data-testid="message-queue" />,
}));

vi.mock('../../../../src/components/ThinkingAnimation', () => ({
  default: () => <div data-testid="thinking-animation" />,
}));

import ChatPanel from '../../../../src/components/Chat/ChatPanel';

type ChatPanelProps = ComponentProps<typeof ChatPanel>;

describe('ChatPanel', () => {
  let mockSai: ReturnType<typeof installMockSai>;

  beforeEach(() => {
    mockSai = installMockSai();
    latestChatInputProps = undefined;
    mockSai.settingsGet.mockImplementation((_key: string, fallback: unknown) => Promise.resolve(fallback));
    mockSai.claudeOnMessage.mockImplementation(() => () => {});
    mockSai.geminiStart.mockResolvedValue({ slashCommands: [] });

    Object.defineProperty(window, 'IntersectionObserver', {
      writable: true,
      value: class {
        constructor() {}
        observe() {}
        disconnect() {}
        unobserve() {}
      },
    });
    Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', {
      writable: true,
      value: vi.fn(),
    });
    Object.defineProperty(window, 'requestAnimationFrame', {
      writable: true,
      value: (cb: FrameRequestCallback) => setTimeout(() => cb(0), 0),
    });
    Object.defineProperty(window, 'cancelAnimationFrame', {
      writable: true,
      value: (id: number) => clearTimeout(id),
    });

  });

  it('routes Gemini session_id messages to onGeminiSessionId', async () => {
    const onGeminiSessionId = vi.fn();

    const props: ChatPanelProps = {
      projectPath: '/project',
      permissionMode: 'default',
      onPermissionChange: vi.fn(),
      effortLevel: 'high',
      onEffortChange: vi.fn(),
      modelChoice: 'sonnet',
      onModelChange: vi.fn(),
      aiProvider: 'gemini',
      codexModel: '',
      onCodexModelChange: vi.fn(),
      codexModels: [],
      codexPermission: 'auto',
      onCodexPermissionChange: vi.fn(),
      geminiModel: 'auto-gemini-3',
      onGeminiModelChange: vi.fn(),
      geminiModels: [],
      geminiApprovalMode: 'default',
      onGeminiApprovalModeChange: vi.fn(),
      geminiConversationMode: 'planning',
      onGeminiConversationModeChange: vi.fn(),
      initialMessages: [],
      onMessagesChange: vi.fn(),
      onTurnComplete: vi.fn(),
      onClaudeSessionId: vi.fn(),
      onGeminiSessionId,
      onCodexSessionId: vi.fn(),
      activeFilePath: null,
      onFileOpen: vi.fn(),
      isActive: true,
      messageQueue: [],
      onQueueAdd: vi.fn(),
      onQueueRemove: vi.fn(),
      onQueueShift: vi.fn(),
      sessionId: 'session-1',
      terminalTabs: [],
      onSlashCommandsUpdate: vi.fn(),
    };

    render(<ChatPanel {...props} />);

    await waitFor(() => expect(mockSai.claudeOnMessage).toHaveBeenCalled());

    await act(async () => {
      for (const [handler] of mockSai.claudeOnMessage.mock.calls) {
        (handler as (msg: any) => void)({ type: 'session_id', sessionId: 'gemini-session-42', projectPath: '/project', scope: 'chat' });
      }
    });

    expect(onGeminiSessionId).toHaveBeenCalledWith('gemini-session-42');
  });

  it('sends the raw Gemini prompt without synthetic conversation history and includes chat scope', async () => {
    const props: ChatPanelProps = {
      projectPath: '/project',
      permissionMode: 'default',
      onPermissionChange: vi.fn(),
      effortLevel: 'high',
      onEffortChange: vi.fn(),
      modelChoice: 'sonnet',
      onModelChange: vi.fn(),
      aiProvider: 'gemini',
      codexModel: '',
      onCodexModelChange: vi.fn(),
      codexModels: [],
      codexPermission: 'auto',
      onCodexPermissionChange: vi.fn(),
      geminiModel: 'auto-gemini-3',
      onGeminiModelChange: vi.fn(),
      geminiModels: [],
      geminiApprovalMode: 'default',
      onGeminiApprovalModeChange: vi.fn(),
      geminiConversationMode: 'planning',
      onGeminiConversationModeChange: vi.fn(),
      initialMessages: [
        { id: 'u1', role: 'user', content: 'old question', timestamp: 1 },
        { id: 'a1', role: 'assistant', content: 'old answer', timestamp: 2 },
      ],
      onMessagesChange: vi.fn(),
      onTurnComplete: vi.fn(),
      onClaudeSessionId: vi.fn(),
      onGeminiSessionId: vi.fn(),
      onCodexSessionId: vi.fn(),
      activeFilePath: null,
      onFileOpen: vi.fn(),
      isActive: true,
      messageQueue: [],
      onQueueAdd: vi.fn(),
      onQueueRemove: vi.fn(),
      onQueueShift: vi.fn(),
      sessionId: 'session-1',
      terminalTabs: [],
      onSlashCommandsUpdate: vi.fn(),
    };

    render(<ChatPanel {...props} />);

    await waitFor(() => expect(latestChatInputProps).toBeTruthy());

    await act(async () => {
      await latestChatInputProps.onSend('new prompt');
    });

    expect(mockSai.geminiSend).toHaveBeenCalledWith(
      '/project',
      'new prompt',
      undefined,
      'default',
      'planning',
      'auto-gemini-3',
      'chat',
    );
    expect(mockSai.geminiSend).not.toHaveBeenCalledWith(
      '/project',
      expect.stringContaining('<conversation_history>'),
      expect.anything(),
      expect.anything(),
      expect.anything(),
      expect.anything(),
      expect.anything(),
    );
  });

  it('renders a leading flex spacer so messages stack from the bottom', () => {
    const props: ChatPanelProps = {
      projectPath: '/project',
      permissionMode: 'default',
      onPermissionChange: vi.fn(),
      effortLevel: 'high',
      onEffortChange: vi.fn(),
      modelChoice: 'sonnet',
      onModelChange: vi.fn(),
      aiProvider: 'gemini',
      codexModel: '',
      onCodexModelChange: vi.fn(),
      codexModels: [],
      codexPermission: 'auto',
      onCodexPermissionChange: vi.fn(),
      geminiModel: 'auto-gemini-3',
      onGeminiModelChange: vi.fn(),
      geminiModels: [],
      geminiApprovalMode: 'default',
      onGeminiApprovalModeChange: vi.fn(),
      geminiConversationMode: 'planning',
      onGeminiConversationModeChange: vi.fn(),
      initialMessages: [{ id: '1', role: 'user', content: 'hi', timestamp: 0 }],
      onMessagesChange: vi.fn(),
      onTurnComplete: vi.fn(),
      onClaudeSessionId: vi.fn(),
      onGeminiSessionId: vi.fn(),
      onCodexSessionId: vi.fn(),
      activeFilePath: null,
      onFileOpen: vi.fn(),
      isActive: true,
      messageQueue: [],
      onQueueAdd: vi.fn(),
      onQueueRemove: vi.fn(),
      onQueueShift: vi.fn(),
      sessionId: 'session-1',
      terminalTabs: [],
      onSlashCommandsUpdate: vi.fn(),
    };

    const { container } = render(<ChatPanel {...props} />);
    const spacer = container.querySelector('.chat-messages-spacer');
    expect(spacer).toBeTruthy();
  });

  it('registers a flip rect for the new user message id when the composer fires onBeforeSend', async () => {
    _resetFlipRegistry();

    const props: ChatPanelProps = {
      projectPath: '/project',
      permissionMode: 'default',
      onPermissionChange: vi.fn(),
      effortLevel: 'high',
      onEffortChange: vi.fn(),
      modelChoice: 'sonnet',
      onModelChange: vi.fn(),
      aiProvider: 'gemini',
      codexModel: '',
      onCodexModelChange: vi.fn(),
      codexModels: [],
      codexPermission: 'auto',
      onCodexPermissionChange: vi.fn(),
      geminiModel: 'auto-gemini-3',
      onGeminiModelChange: vi.fn(),
      geminiModels: [],
      geminiApprovalMode: 'default',
      onGeminiApprovalModeChange: vi.fn(),
      geminiConversationMode: 'planning',
      onGeminiConversationModeChange: vi.fn(),
      initialMessages: [],
      onMessagesChange: vi.fn(),
      onTurnComplete: vi.fn(),
      onClaudeSessionId: vi.fn(),
      onGeminiSessionId: vi.fn(),
      onCodexSessionId: vi.fn(),
      activeFilePath: null,
      onFileOpen: vi.fn(),
      isActive: true,
      messageQueue: [],
      onQueueAdd: vi.fn(),
      onQueueRemove: vi.fn(),
      onQueueShift: vi.fn(),
      sessionId: 'session-1',
      terminalTabs: [],
      onSlashCommandsUpdate: vi.fn(),
    };

    render(<ChatPanel {...props} />);

    await waitFor(() => expect(latestChatInputProps).toBeTruthy());

    // Freeze Date.now so we know the generated message id
    const fakeNow = 1700000000000;
    vi.spyOn(Date, 'now').mockReturnValue(fakeNow);

    const fakeRect = new DOMRect(0, 100, 300, 48);

    await act(async () => {
      // Simulate ChatInput firing onBeforeSend (with the composer's rect) then onSend
      latestChatInputProps.onBeforeSend(fakeRect);
      await latestChatInputProps.onSend('hi there');
    });

    const rect = readFlipRect(String(fakeNow));
    expect(rect).toBeDefined();
    expect(typeof rect!.left).toBe('number');

    vi.restoreAllMocks();
  });
});
