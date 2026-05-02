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
  default: () => (
    <div data-testid="thinking-animation">
      <span className="thinking-cursor thinking-cursor-breathing">|</span>
    </div>
  ),
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

  it('renders thinking indicator while streaming with no first-assistant message yet', async () => {
    const props: ChatPanelProps = {
      projectPath: '/project',
      permissionMode: 'default',
      onPermissionChange: vi.fn(),
      effortLevel: 'high',
      onEffortChange: vi.fn(),
      modelChoice: 'sonnet',
      onModelChange: vi.fn(),
      aiProvider: 'claude',
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

    const { container } = render(<ChatPanel {...props} />);

    await waitFor(() => expect(mockSai.claudeOnMessage).toHaveBeenCalled());

    await act(async () => {
      for (const [handler] of mockSai.claudeOnMessage.mock.calls) {
        (handler as (msg: any) => void)({ type: 'streaming_start', projectPath: '/project', scope: 'chat' });
      }
    });

    expect(container.querySelector('[data-testid="thinking-animation"]')).toBeTruthy();
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

  const baseProps = (): ChatPanelProps => ({
    projectPath: '/project',
    permissionMode: 'default',
    onPermissionChange: vi.fn(),
    effortLevel: 'high',
    onEffortChange: vi.fn(),
    modelChoice: 'sonnet',
    onModelChange: vi.fn(),
    aiProvider: 'claude',
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
  });

  it('pinned bar is always mounted (zero-height when no pinned message)', async () => {
    const props = baseProps();
    const { container } = render(<ChatPanel {...props} />);
    await waitFor(() => expect(mockSai.claudeOnMessage).toHaveBeenCalled());
    // The pinned bar should be present in the DOM even with no pinned message
    const bar = container.querySelector('.pinned-prompt-bar');
    expect(bar).toBeTruthy();
    // No data-layout-id when there is no pinned message
    expect(bar?.getAttribute('data-layout-id')).toBeNull();
  });

  it('user-message wrapper carries data-layout-id for shared layoutId', async () => {
    const initialMessages = [
      { id: 'u1', role: 'user' as const, content: 'Hello', timestamp: Date.now() },
      { id: 'a1', role: 'assistant' as const, content: 'Hi there', timestamp: Date.now() },
    ];
    const props = { ...baseProps(), initialMessages };
    const { container } = render(<ChatPanel {...props} />);
    await waitFor(() => expect(mockSai.claudeOnMessage).toHaveBeenCalled());
    // The user-message wrapper div should carry data-layout-id matching the pinned-bar convention
    const wrapper = container.querySelector('[data-layout-id="pinned-u1"]');
    expect(wrapper).toBeTruthy();
  });

  it('Claude thinking has breathing-cursor class when streaming', async () => {
    const props = { ...baseProps(), aiProvider: 'claude' as const };
    const { container } = render(<ChatPanel {...props} />);

    await waitFor(() => expect(mockSai.claudeOnMessage).toHaveBeenCalled());

    await act(async () => {
      for (const [handler] of mockSai.claudeOnMessage.mock.calls) {
        (handler as (msg: any) => void)({ type: 'streaming_start', projectPath: '/project', scope: 'chat' });
      }
    });

    expect(container.querySelector('.thinking-cursor.thinking-cursor-breathing')).toBeTruthy();
  });

  it('Codex thinking applies wave to Working text when streaming', async () => {
    const props = { ...baseProps(), aiProvider: 'codex' as const };
    const { container } = render(<ChatPanel {...props} />);

    await waitFor(() => expect(mockSai.claudeOnMessage).toHaveBeenCalled());

    await act(async () => {
      for (const [handler] of mockSai.claudeOnMessage.mock.calls) {
        (handler as (msg: any) => void)({ type: 'streaming_start', projectPath: '/project', scope: 'chat' });
      }
    });

    expect(container.querySelector('.codex-working-wave')).toBeTruthy();
  });

  it('Gemini thinking hint has cross-slide class when streaming', async () => {
    const props = { ...baseProps(), aiProvider: 'gemini' as const };
    const { container } = render(<ChatPanel {...props} />);

    await waitFor(() => expect(mockSai.claudeOnMessage).toHaveBeenCalled());

    await act(async () => {
      for (const [handler] of mockSai.claudeOnMessage.mock.calls) {
        (handler as (msg: any) => void)({ type: 'streaming_start', projectPath: '/project', scope: 'chat' });
      }
    });

    expect(container.querySelector('.gemini-hint-slide')).toBeTruthy();
  });

  it('wraps the bottom strip in a LayoutGroup', () => {
    const props = baseProps();
    const { container } = render(<ChatPanel {...props} />);
    expect(container.querySelector('[data-testid="chat-bottom-strip"]')).toBeTruthy();
  });

  it('uses requestAnimationFrame for auto-scroll instead of smooth scrollIntoView', async () => {
    const scrollIntoViewSpy = vi.fn();
    Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', {
      writable: true,
      value: scrollIntoViewSpy,
    });

    const props = { ...baseProps(), aiProvider: 'claude' as const };
    render(<ChatPanel {...props} />);

    await waitFor(() => expect(mockSai.claudeOnMessage).toHaveBeenCalled());

    // Simulate a new assistant message arriving (triggers the messages effect)
    await act(async () => {
      for (const [handler] of mockSai.claudeOnMessage.mock.calls) {
        (handler as (msg: any) => void)({
          type: 'text',
          text: 'Hello from assistant',
          projectPath: '/project',
          scope: 'chat',
        });
      }
    });

    // Any scrollIntoView call triggered by auto-scroll should NOT use behavior:'smooth'
    const smoothCalls = scrollIntoViewSpy.mock.calls.filter(
      (args: any[]) => args[0]?.behavior === 'smooth'
    );
    expect(smoothCalls).toHaveLength(0);
  });

  it('empty-state logo has float class', () => {
    // Build full props with initialMessages: [] (no messages -> empty state).
    const props = { ...baseProps(), initialMessages: [] };
    const { container } = render(<ChatPanel {...props} />);
    expect(container.querySelector('.chat-empty-logo-float')).toBeTruthy();
  });

  it('renders without error under reduced-motion preference', () => {
    // Stub matchMedia to report prefers-reduced-motion: reduce.
    const original = window.matchMedia;
    // @ts-expect-error - test stub
    window.matchMedia = (q: string) => ({
      matches: q.includes('reduce'),
      media: q,
      addEventListener: () => {},
      removeEventListener: () => {},
      onchange: null,
      addListener: () => {},
      removeListener: () => {},
      dispatchEvent: () => false,
    });

    // Render with a mix of messages so motion children are exercised.
    const props = {
      ...baseProps(),
      initialMessages: [
        { id: 'u1', role: 'user' as const, content: 'Hello', timestamp: Date.now() },
        { id: 'a1', role: 'assistant' as const, content: 'Hi there', timestamp: Date.now() },
      ],
    };

    // Should not throw; all useReducedMotionTransition calls resolve { duration: 0 }.
    const { container } = render(<ChatPanel {...props} />);
    expect(container.querySelector('.chat-panel')).toBeTruthy();

    window.matchMedia = original;
  });

  it('does not render the follow button when at-bottom', () => {
    const props = baseProps();
    const { container } = render(<ChatPanel {...props} />);
    expect(container.querySelector('[data-testid="follow-btn"]')).toBeNull();
  });

  it('renders the follow button when the user has scrolled away from the bottom', async () => {
    const props = baseProps();
    const { container } = render(<ChatPanel {...props} />);

    const list = container.querySelector('.chat-messages') as HTMLElement;
    expect(list).toBeTruthy();
    await act(async () => {
      list.dispatchEvent(new WheelEvent('wheel', { deltaY: -50, bubbles: true }));
    });

    expect(container.querySelector('[data-testid="follow-btn"]')).toBeTruthy();
  });

  it('shows the unread dot when an assistant message arrives while follow is off', async () => {
    const props = baseProps();
    const { container } = render(<ChatPanel {...props} />);

    await waitFor(() => expect(mockSai.claudeOnMessage).toHaveBeenCalled());

    const list = container.querySelector('.chat-messages') as HTMLElement;
    await act(async () => {
      list.dispatchEvent(new WheelEvent('wheel', { deltaY: -50, bubbles: true }));
    });

    await act(async () => {
      for (const [handler] of mockSai.claudeOnMessage.mock.calls) {
        (handler as (msg: any) => void)({
          type: 'assistant',
          projectPath: '/project',
          scope: 'chat',
          message: { content: [{ type: 'text', text: 'hello' }] },
        });
      }
    });

    expect(container.querySelector('[data-testid="follow-btn-unread"]')).toBeTruthy();
  });

  it('click on the follow button clears unread and re-engages follow', async () => {
    const props = baseProps();
    const { container } = render(<ChatPanel {...props} />);

    await waitFor(() => expect(mockSai.claudeOnMessage).toHaveBeenCalled());

    const list = container.querySelector('.chat-messages') as HTMLElement;
    await act(async () => {
      list.dispatchEvent(new WheelEvent('wheel', { deltaY: -50, bubbles: true }));
    });
    await act(async () => {
      for (const [handler] of mockSai.claudeOnMessage.mock.calls) {
        (handler as (msg: any) => void)({
          type: 'assistant',
          projectPath: '/project',
          scope: 'chat',
          message: { content: [{ type: 'text', text: 'hi' }] },
        });
      }
    });

    const btn = container.querySelector('[data-testid="follow-btn"]') as HTMLButtonElement;
    expect(btn).toBeTruthy();
    await act(async () => { btn.click(); });

    await waitFor(() => expect(container.querySelector('[data-testid="follow-btn"]')).toBeNull());
    expect(container.querySelector('[data-testid="follow-btn-unread"]')).toBeNull();
  });

  it('/fake-error appends a default API-error system message in dev mode', async () => {
    const onMessagesChange = vi.fn();
    const props: ChatPanelProps = { ...baseProps(), onMessagesChange };
    render(<ChatPanel {...props} />);

    await waitFor(() => expect(latestChatInputProps).toBeTruthy());

    await act(async () => {
      await latestChatInputProps.onSend('/fake-error');
    });

    const lastCall = onMessagesChange.mock.calls[onMessagesChange.mock.calls.length - 1];
    const messages = lastCall[0];
    const last = messages[messages.length - 1];

    expect(last.role).toBe('system');
    expect(last.error).toBeTruthy();
    expect(last.error.status).toBe(400);
    expect(last.error.title).toBe('Invalid request');
    expect(last.error.message).toBe('Output blocked by content filtering policy');
    expect(last.error.requestId).toMatch(/^req_fake_/);
  });

  it('/fake-error rate-limit produces a 429 envelope', async () => {
    const onMessagesChange = vi.fn();
    const props: ChatPanelProps = { ...baseProps(), onMessagesChange };
    render(<ChatPanel {...props} />);

    await waitFor(() => expect(latestChatInputProps).toBeTruthy());

    await act(async () => {
      await latestChatInputProps.onSend('/fake-error rate-limit');
    });

    const lastCall = onMessagesChange.mock.calls[onMessagesChange.mock.calls.length - 1];
    const last = lastCall[0][lastCall[0].length - 1];

    expect(last.role).toBe('system');
    expect(last.error.status).toBe(429);
    expect(last.error.title).toBe('Rate limit exceeded');
  });

  it('/fake-error with unknown variant falls back to the default envelope', async () => {
    const onMessagesChange = vi.fn();
    const props: ChatPanelProps = { ...baseProps(), onMessagesChange };
    render(<ChatPanel {...props} />);

    await waitFor(() => expect(latestChatInputProps).toBeTruthy());

    await act(async () => {
      await latestChatInputProps.onSend('/fake-error nonsense');
    });

    const lastCall = onMessagesChange.mock.calls[onMessagesChange.mock.calls.length - 1];
    const last = lastCall[0][lastCall[0].length - 1];

    expect(last.role).toBe('system');
    expect(last.error.status).toBe(400);
    expect(last.error.title).toBe('Invalid request');
  });

  it('routes API-Error assistant text through the error path', async () => {
    const onMessagesChange = vi.fn();
    const props: ChatPanelProps = { ...baseProps(), onMessagesChange };

    render(<ChatPanel {...props} />);

    await waitFor(() => expect(mockSai.claudeOnMessage).toHaveBeenCalled());

    const apiErrorText = 'API Error: 400 {"type":"error","error":{"type":"invalid_request_error","message":"Output blocked by content filtering policy"},"request_id":"req_011CaeanuZcbSgzbnKUNX8hP"}';

    await act(async () => {
      for (const [handler] of mockSai.claudeOnMessage.mock.calls) {
        (handler as (msg: any) => void)({
          type: 'assistant',
          projectPath: '/project',
          scope: 'chat',
          message: { content: [{ type: 'text', text: apiErrorText }] },
        });
      }
    });

    const lastCall = onMessagesChange.mock.calls[onMessagesChange.mock.calls.length - 1];
    const messages = lastCall[0];
    const last = messages[messages.length - 1];

    expect(last.role).toBe('system');
    expect(last.error).toBeTruthy();
    expect(last.error.title).toBe('Invalid request');
    expect(last.error.status).toBe(400);
    expect(last.error.message).toBe('Output blocked by content filtering policy');
    expect(last.error.requestId).toBe('req_011CaeanuZcbSgzbnKUNX8hP');
  });
});
