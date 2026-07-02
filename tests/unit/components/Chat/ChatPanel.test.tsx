import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act, render, waitFor } from '@testing-library/react';
import type { ComponentProps } from 'react';
import { installMockSai } from '../../../helpers/ipc-mock';
import { readFlipRect, _resetFlipRegistry } from '../../../../src/components/Chat/flipRegistry';

vi.mock('../../../../src/components/Chat/ChatMessage', () => ({
  default: (props: any) => (
    <div
      data-testid="chat-message"
      data-msg-id={props.message?.id}
      data-msg-content={typeof props.message?.content === 'string' ? props.message.content : ''}
      data-msg-toolcalls={props.message?.toolCalls ? props.message.toolCalls.length : 0}
      data-streaming={props.isStreaming ? 'true' : 'false'}
    />
  ),
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
      <span className="thinking-clock">[00:00.0]</span>
      <span className="thinking-cursor thinking-cursor-block" />
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

    const { container, rerender } = render(<ChatPanel {...props} />);

    await waitFor(() => expect(mockSai.claudeOnMessage).toHaveBeenCalled());

    await act(async () => {
      for (const [handler] of mockSai.claudeOnMessage.mock.calls) {
        (handler as (msg: any) => void)({ type: 'streaming_start', projectPath: '/project', scope: 'chat' });
      }
    });
    rerender(<ChatPanel {...props} isStreaming />);

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
    const { container, rerender } = render(<ChatPanel {...props} />);

    await waitFor(() => expect(mockSai.claudeOnMessage).toHaveBeenCalled());

    await act(async () => {
      for (const [handler] of mockSai.claudeOnMessage.mock.calls) {
        (handler as (msg: any) => void)({ type: 'streaming_start', projectPath: '/project', scope: 'chat' });
      }
    });
    rerender(<ChatPanel {...props} isStreaming />);

    expect(container.querySelector('.thinking-cursor.thinking-cursor-block')).toBeTruthy();
    expect(container.querySelector('.thinking-clock')?.textContent).toMatch(/^\[\d{2}:\d{2}\.\d\]$/);
  });

  it('Codex thinking shows SAI ThinkingAnimation when streaming with animations off', async () => {
    const props = { ...baseProps(), aiProvider: 'codex' as const, saiAnimationEnabled: false };
    const { container, rerender } = render(<ChatPanel {...props} />);

    await waitFor(() => expect(mockSai.claudeOnMessage).toHaveBeenCalled());

    await act(async () => {
      for (const [handler] of mockSai.claudeOnMessage.mock.calls) {
        (handler as (msg: any) => void)({ type: 'streaming_start', projectPath: '/project', scope: 'chat' });
      }
    });
    rerender(<ChatPanel {...props} isStreaming />);

    // Provider-specific animations removed — Codex no longer gets its own "Working" wave
    expect(container.querySelector('.codex-working-wave')).toBeFalsy();
  });

  it('Gemini thinking uses SAI animation system (no provider-specific hint)', async () => {
    const props = { ...baseProps(), aiProvider: 'gemini' as const };
    const { container, rerender } = render(<ChatPanel {...props} />);

    await waitFor(() => expect(mockSai.claudeOnMessage).toHaveBeenCalled());

    await act(async () => {
      for (const [handler] of mockSai.claudeOnMessage.mock.calls) {
        (handler as (msg: any) => void)({ type: 'streaming_start', projectPath: '/project', scope: 'chat' });
      }
    });
    rerender(<ChatPanel {...props} isStreaming />);

    expect(container.querySelector('.gemini-hint-slide')).toBeFalsy();
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

  it('renders the SAI logo in the empty state', () => {
    const props = { ...baseProps(), initialMessages: [] };
    const { container } = render(<ChatPanel {...props} />);
    expect(container.querySelector('.chat-empty-logo')).toBeTruthy();
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

  it('does not render MessageQueue as a standalone child of the bottom strip', () => {
    const props = {
      ...baseProps(),
      messageQueue: [{ id: 'q-0', text: 'a', fullText: 'a' }],
    };
    const { container } = render(<ChatPanel {...props} />);
    const bottomStrip = container.querySelector('[data-testid="chat-bottom-strip"]');
    expect(bottomStrip?.querySelector('[data-testid="queue-badge"]')).toBeNull();
  });

  it('does not render TodoProgress as a standalone child of the bottom strip', () => {
    const props = baseProps();
    const { container } = render(<ChatPanel {...props} />);
    const bottomStrip = container.querySelector('[data-testid="chat-bottom-strip"]');
    expect(bottomStrip?.querySelector('.todo-ring-wrap')).toBeNull();
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

  it('does not load older messages (which cancels the jump) while a pinned jump is in progress', async () => {
    // Controllable IntersectionObserver so we can fire the pin observer and the
    // load-more sentinel observer deterministically.
    const ioInstances: any[] = [];
    class FakeIO {
      cb: any;
      elements: Element[] = [];
      constructor(cb: any) { this.cb = cb; ioInstances.push(this); }
      observe(el: Element) { this.elements.push(el); }
      unobserve() {}
      disconnect() {}
      trigger(entries: any[]) { this.cb(entries, this); }
    }
    // @ts-expect-error - test stub
    window.IntersectionObserver = FakeIO;

    // 60 messages (> RENDER_CHUNK = 50) so renderStart = 10 and the
    // load-more sentinel is rendered. End on a user message so there is a
    // last user message inside the window to pin.
    const initialMessages = Array.from({ length: 60 }, (_, i) =>
      i % 2 === 0
        ? { id: `u${i}`, role: 'user' as const, content: `user ${i}`, timestamp: Date.now() }
        : { id: `a${i}`, role: 'assistant' as const, content: `asst ${i}`, timestamp: Date.now() }
    );
    initialMessages[59] = { id: 'u59', role: 'user', content: 'last user', timestamp: Date.now() };

    const props = { ...baseProps(), initialMessages };
    const { container } = render(<ChatPanel {...props} />);

    // Windowed rendering hides earlier messages → the load-more sentinel exists.
    expect(container.querySelector('.chat-load-sentinel')).toBeTruthy();

    // Pin the last user message by firing its IntersectionObserver as out-of-view.
    const lastWrapper = container.querySelector('[data-layout-id="pinned-u59"]');
    expect(lastWrapper).toBeTruthy();
    const pinIO = ioInstances.find(io => io.elements.includes(lastWrapper));
    expect(pinIO).toBeTruthy();
    await act(async () => { pinIO.trigger([{ isIntersecting: false }]); });

    const jumpBtn = container.querySelector('.pinned-prompt-jump') as HTMLButtonElement;
    expect(jumpBtn).toBeTruthy();

    const before = container.querySelectorAll('[data-testid="chat-message"]').length;

    // Start the jump, then fire the load-more sentinel *during* the jump.
    await act(async () => { jumpBtn.click(); });
    const sentinelEl = container.querySelector('.chat-load-sentinel');
    const sentIO = ioInstances.find(io => io.elements.includes(sentinelEl));
    expect(sentIO).toBeTruthy();
    await act(async () => { sentIO.trigger([{ isIntersecting: true }]); });

    // Loading older messages mid-jump rewrites scrollTop and cancels the
    // smooth scroll ("nothing moves"). While a jump is in progress the sentinel
    // must not expand the window, so the rendered message count is unchanged.
    const after = container.querySelectorAll('[data-testid="chat-message"]').length;
    expect(after).toBe(before);
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

  describe('bypass-queue-on-enter', () => {
    it('plain-Enter while streaming with non-empty queue stops current turn and dispatches immediately', async () => {
      const onQueueShift = vi.fn();
      const props: ChatPanelProps = {
        ...baseProps(),
        messageQueue: [{ id: 'q-0', text: 'queued one', fullText: 'queued one' }],
        onQueueShift,
      };
      const { rerender } = render(<ChatPanel {...props} />);

      await waitFor(() => expect(mockSai.claudeOnMessage).toHaveBeenCalled());
      const handler = mockSai.claudeOnMessage.mock.calls[0][0] as (msg: any) => void;

      await act(async () => {
        handler({ type: 'streaming_start', projectPath: '/project', scope: 'chat' });
      });
      rerender(<ChatPanel {...props} isStreaming />);

      mockSai.claudeSend.mockClear();
      mockSai.claudeStop.mockClear();
      await act(async () => {
        await latestChatInputProps.onSend('jump-the-line message');
      });

      expect(mockSai.claudeStop).toHaveBeenCalledTimes(1);
      expect(mockSai.claudeSend).toHaveBeenCalledTimes(1);
      expect(mockSai.claudeSend.mock.calls[0][1]).toContain('jump-the-line message');
      expect(onQueueShift).not.toHaveBeenCalled();
    });

    it('after the bypass message turn ends, the queue resumes draining from index 0', async () => {
      const onQueueShift = vi.fn();
      const props: ChatPanelProps = {
        ...baseProps(),
        messageQueue: [{ id: 'q-0', text: 'queued one', fullText: 'queued one' }],
        onQueueShift,
      };
      const { rerender } = render(<ChatPanel {...props} />);

      await waitFor(() => expect(mockSai.claudeOnMessage).toHaveBeenCalled());
      const handler = mockSai.claudeOnMessage.mock.calls[0][0] as (msg: any) => void;

      // Initial turn starts streaming, user bypasses with a new message.
      await act(async () => {
        handler({ type: 'streaming_start', projectPath: '/project', scope: 'chat' });
      });
      rerender(<ChatPanel {...props} isStreaming />);
      await act(async () => {
        await latestChatInputProps.onSend('jump-the-line message');
      });

      // Simulate the stop's `done` — the suppress flag should consume this.
      await act(async () => {
        handler({ type: 'done', projectPath: '/project', scope: 'chat' });
      });
      rerender(<ChatPanel {...props} isStreaming={false} />);
      expect(onQueueShift).not.toHaveBeenCalled();

      // The bypass message starts streaming, then ends — queue should drain now.
      mockSai.claudeSend.mockClear();
      await act(async () => {
        handler({ type: 'streaming_start', projectPath: '/project', scope: 'chat' });
      });
      rerender(<ChatPanel {...props} isStreaming />);
      await act(async () => {
        handler({ type: 'done', projectPath: '/project', scope: 'chat' });
      });
      rerender(<ChatPanel {...props} isStreaming={false} />);
      await act(async () => { await new Promise(resolve => setTimeout(resolve, 350)); });

      expect(onQueueShift).toHaveBeenCalledTimes(1);
      expect(mockSai.claudeSend).toHaveBeenCalledTimes(1);
      expect(mockSai.claudeSend.mock.calls[0][1]).toContain('queued one');
    });

    it('drains a message that landed in the queue just AFTER the turn ended (race)', async () => {
      // Hit-or-miss bug: the user queues a message in the tiny window as the
      // turn is wrapping up. The `done` IPC flips isStreaming false and runs the
      // drain effect while the queue is still empty; the queued item arrives one
      // render later. Because the drain only keyed on the isStreaming edge, that
      // item was never sent. It must drain on arrival while idle.
      const onQueueShift = vi.fn();
      const props: ChatPanelProps = { ...baseProps(), messageQueue: [], onQueueShift };
      const { rerender } = render(<ChatPanel {...props} />);

      await waitFor(() => expect(mockSai.claudeOnMessage).toHaveBeenCalled());
      const handler = mockSai.claudeOnMessage.mock.calls[0][0] as (msg: any) => void;

      // Turn streams, then ends while the queue is still empty.
      await act(async () => {
        handler({ type: 'streaming_start', projectPath: '/project', scope: 'chat' });
      });
      rerender(<ChatPanel {...props} isStreaming />);
      await act(async () => {
        handler({ type: 'done', projectPath: '/project', scope: 'chat' });
      });
      rerender(<ChatPanel {...props} isStreaming={false} />);
      expect(onQueueShift).not.toHaveBeenCalled();

      // The queued message lands a render AFTER the turn already ended.
      mockSai.claudeSend.mockClear();
      const withQueue: ChatPanelProps = {
        ...props,
        isStreaming: false,
        messageQueue: [{ id: 'q-0', text: 'late one', fullText: 'late one' }],
      };
      await act(async () => { rerender(<ChatPanel {...withQueue} />); });
      await act(async () => { await new Promise(resolve => setTimeout(resolve, 350)); });

      expect(onQueueShift).toHaveBeenCalledTimes(1);
      expect(mockSai.claudeSend).toHaveBeenCalledTimes(1);
      expect(mockSai.claudeSend.mock.calls[0][1]).toContain('late one');
    });

    it('plain-Enter while not streaming with non-empty queue dispatches immediately without stop', async () => {
      const onQueueShift = vi.fn();
      const props: ChatPanelProps = {
        ...baseProps(),
        messageQueue: [{ id: 'q-0', text: 'queued one', fullText: 'queued one' }],
        onQueueShift,
      };
      render(<ChatPanel {...props} />);

      await waitFor(() => expect(latestChatInputProps).toBeTruthy());

      mockSai.claudeSend.mockClear();
      mockSai.claudeStop.mockClear();
      await act(async () => {
        await latestChatInputProps.onSend('immediate message');
      });

      expect(mockSai.claudeStop).not.toHaveBeenCalled();
      expect(mockSai.claudeSend).toHaveBeenCalledTimes(1);
      expect(mockSai.claudeSend.mock.calls[0][1]).toContain('immediate message');
      expect(onQueueShift).not.toHaveBeenCalled();
    });
  });

  it('coalesces streaming text deltas into a single bubble via rAF flush', async () => {
    // Perf: per-chunk setMessages was retokenizing the entire growing message
    // on every stdout chunk. Deltas now buffer in a ref and flush once per
    // animation frame. This test confirms accumulated content is preserved.
    const props: ChatPanelProps = { ...baseProps() };
    const { container, rerender } = render(<ChatPanel {...props} />);

    await waitFor(() => expect(mockSai.claudeOnMessage).toHaveBeenCalled());
    const handler = mockSai.claudeOnMessage.mock.calls[0][0] as (msg: any) => void;

    await act(async () => {
      handler({ type: 'streaming_start', projectPath: '/project', scope: 'chat' });
    });
    rerender(<ChatPanel {...props} isStreaming />);

    // Initial assistant text creates the bubble (non-delta path).
    await act(async () => {
      handler({
        type: 'assistant',
        projectPath: '/project',
        scope: 'chat',
        message: { content: [{ type: 'text', text: 'hello ' }] },
      });
    });

    // Stream three deltas — these hit the buffered rAF path.
    await act(async () => {
      handler({
        type: 'assistant',
        projectPath: '/project',
        scope: 'chat',
        message: { content: [{ type: 'text', text: 'brave ', delta: true }] },
      });
      handler({
        type: 'assistant',
        projectPath: '/project',
        scope: 'chat',
        message: { content: [{ type: 'text', text: 'new ', delta: true }] },
      });
      handler({
        type: 'assistant',
        projectPath: '/project',
        scope: 'chat',
        message: { content: [{ type: 'text', text: 'world', delta: true }] },
      });
      // Let the rAF callback (mocked as setTimeout 0) fire.
      await new Promise(resolve => setTimeout(resolve, 0));
    });

    const bubbles = container.querySelectorAll('[data-testid="chat-message"]');
    const assistant = Array.from(bubbles).find(el => el.getAttribute('data-msg-content')?.startsWith('hello'));
    expect(assistant).toBeTruthy();
    expect(assistant!.getAttribute('data-msg-content')).toBe('hello brave new world');
  });

  it('flushes pending deltas before pushing a tool-use bubble', async () => {
    // A non-delta event (tool_use) must commit any buffered text to state
    // before mutating, so order is preserved: prose bubble first, tool bubble after.
    const props: ChatPanelProps = { ...baseProps() };
    const { container, rerender } = render(<ChatPanel {...props} />);

    await waitFor(() => expect(mockSai.claudeOnMessage).toHaveBeenCalled());
    const handler = mockSai.claudeOnMessage.mock.calls[0][0] as (msg: any) => void;

    await act(async () => {
      handler({ type: 'streaming_start', projectPath: '/project', scope: 'chat' });
    });
    rerender(<ChatPanel {...props} isStreaming />);

    await act(async () => {
      handler({
        type: 'assistant',
        projectPath: '/project',
        scope: 'chat',
        message: { content: [{ type: 'text', text: 'reading file' }] },
      });
    });

    // Buffer a delta but immediately follow with a tool_use without letting rAF fire.
    await act(async () => {
      handler({
        type: 'assistant',
        projectPath: '/project',
        scope: 'chat',
        message: { content: [{ type: 'text', text: ' now', delta: true }] },
      });
      handler({
        type: 'assistant',
        projectPath: '/project',
        scope: 'chat',
        message: { content: [{ type: 'tool_use', id: 'tu-1', name: 'Read', input: { path: 'x' } }] },
      });
    });

    const bubbles = Array.from(container.querySelectorAll('[data-testid="chat-message"]'));
    const prose = bubbles.find(el => el.getAttribute('data-msg-content') === 'reading file now');
    const tool = bubbles.find(el => Number(el.getAttribute('data-msg-toolcalls')) > 0);
    expect(prose).toBeTruthy();
    expect(tool).toBeTruthy();
  });

  it('durationMs reflects the gap between streaming_start and stream end, not ~0', async () => {
    const onMessagesChange = vi.fn();
    const props: ChatPanelProps = { ...baseProps(), onMessagesChange };
    const { rerender } = render(<ChatPanel {...props} />);

    await waitFor(() => expect(mockSai.claudeOnMessage).toHaveBeenCalled());
    const handler = mockSai.claudeOnMessage.mock.calls[0][0] as (msg: any) => void;

    // Simulate streaming_start at t=1000
    vi.spyOn(Date, 'now').mockReturnValue(1000);
    await act(async () => {
      handler({ type: 'streaming_start', projectPath: '/project', scope: 'chat' });
    });
    rerender(<ChatPanel {...props} isStreaming />);

    // Simulate assistant text arriving at t=1000 (same tick, no duration yet)
    await act(async () => {
      handler({
        type: 'assistant',
        projectPath: '/project',
        scope: 'chat',
        message: { content: [{ type: 'text', text: 'hello world' }] },
      });
    });

    // Simulate done arriving at t=3500 (2500ms later)
    vi.spyOn(Date, 'now').mockReturnValue(3500);
    await act(async () => {
      handler({ type: 'done', projectPath: '/project', scope: 'chat' });
    });
    rerender(<ChatPanel {...props} isStreaming={false} />);

    vi.restoreAllMocks();

    // Find the assistant message in the last onMessagesChange call
    const lastCall = onMessagesChange.mock.calls[onMessagesChange.mock.calls.length - 1];
    const messages: any[] = lastCall[0];
    const assistantMsg = messages.find((m: any) => m.role === 'assistant' && m.content === 'hello world');

    expect(assistantMsg).toBeDefined();
    // durationMs should be 3500 - 1000 = 2500, not ~0
    expect(assistantMsg.durationMs).toBe(2500);
    expect(assistantMsg.startedAt).toBe(1000);
  });

  it('does not render between-turn dividers (removed in chat message list refresh)', async () => {
    const props = {
      ...baseProps(),
      initialMessages: [
        { id: 'u1', role: 'user' as const, content: 'first', timestamp: 0 },
        { id: 'a1', role: 'assistant' as const, content: 'reply one', timestamp: 1 },
        { id: 'u2', role: 'user' as const, content: 'second', timestamp: 2 },
        { id: 'a2', role: 'assistant' as const, content: 'reply two', timestamp: 3 },
      ],
    };
    const { container } = render(<ChatPanel {...props} />);
    await waitFor(() => expect(mockSai.claudeOnMessage).toHaveBeenCalled());
    const dividers = container.querySelectorAll('.chat-turn-divider');
    expect(dividers.length).toBe(0);
    // and confirm the map still renders every message (no Fragment regression)
    expect(container.querySelectorAll('[data-testid="chat-message"]').length).toBe(4);
  });

  describe('SAI thinking row relocation', () => {
    it('SAI: shows a pending thinking row when streaming with no assistant segment yet', async () => {
      const props = { ...baseProps(), aiProvider: 'claude' as const };
      const { container, rerender } = render(<ChatPanel {...props} />);
      await waitFor(() => expect(mockSai.claudeOnMessage).toHaveBeenCalled());

      // Only a user message exists; no assistant segment is streaming yet.
      await act(async () => {
        for (const [handler] of mockSai.claudeOnMessage.mock.calls) {
          (handler as (msg: any) => void)({ type: 'streaming_start', projectPath: '/project', scope: 'chat' });
        }
      });
      rerender(<ChatPanel {...props} isStreaming />);

      // The detached/pending tail row renders the ThinkingAnimation.
      expect(container.querySelector('[data-testid="thinking-animation"]')).toBeTruthy();
    });

    it('SAI: no detached banner once an assistant segment is streaming', async () => {
      const props = { ...baseProps(), aiProvider: 'claude' as const };
      const { container, rerender } = render(<ChatPanel {...props} />);
      await waitFor(() => expect(mockSai.claudeOnMessage).toHaveBeenCalled());

      // Text deltas arrive: the first appends an assistant segment; the second hits the
      // streaming fast-path and sets streamSettled=false, so the per-segment morph head
      // (not the tail row) carries the thinking visuals.
      const delta = (text: string) => ({
        type: 'assistant',
        message: { content: [{ type: 'text', delta: true, text }] },
        projectPath: '/project',
        scope: 'chat',
      });
      await act(async () => {
        for (const [handler] of mockSai.claudeOnMessage.mock.calls) {
          (handler as (msg: any) => void)({ type: 'streaming_start', projectPath: '/project', scope: 'chat' });
          (handler as (msg: any) => void)(delta('think'));
        }
      });
      // Second delta in a separate act so the first has committed to messagesRef,
      // letting the streaming fast-path fire and flip streamSettled=false.
      await act(async () => {
        for (const [handler] of mockSai.claudeOnMessage.mock.calls) {
          (handler as (msg: any) => void)(delta('ing...'));
        }
      });
      rerender(<ChatPanel {...props} isStreaming />);

      // No standalone thinking banner at the tail.
      expect(container.querySelector('[data-testid="thinking-animation"]')).toBeNull();
      // The morph head lives inside the streaming assistant ChatMessage (mocked).
      const streamingMsg = container.querySelector('[data-testid="chat-message"][data-streaming="true"]');
      expect(streamingMsg).toBeTruthy();
    });

    it('SAI: hides the pending thinking row while a reasoning card is live', async () => {
      const props = { ...baseProps(), aiProvider: 'claude' as const };
      const { container, rerender } = render(<ChatPanel {...props} />);
      await waitFor(() => expect(mockSai.claudeOnMessage).toHaveBeenCalled());

      await act(async () => {
        for (const [handler] of mockSai.claudeOnMessage.mock.calls) {
          (handler as (m: any) => void)({ type: 'streaming_start', projectPath: '/project', scope: 'chat' });
          (handler as (m: any) => void)({ type: 'reasoning_delta', text: 'weighing options...', projectPath: '/project', scope: 'chat' });
        }
      });
      rerender(<ChatPanel {...props} isStreaming />);

      // The reasoning flush is rAF-batched (stubbed to setTimeout 0) — once the
      // live reasoning card exists it owns the working signal, so the pending
      // thinking row must not double up below it.
      await waitFor(() => {
        expect(container.querySelector('[data-testid="thinking-animation"]')).toBeNull();
      });

      // A tool call finalizes the reasoning segment — but the running tool card
      // is now the working signal (and the row's morph target), so the row stays
      // hidden until the tool resolves.
      await act(async () => {
        for (const [handler] of mockSai.claudeOnMessage.mock.calls) {
          (handler as (m: any) => void)({
            type: 'assistant',
            message: { content: [{ type: 'tool_use', id: 'tool-1', name: 'Read', input: {} }] },
            projectPath: '/project',
            scope: 'chat',
          });
        }
      });
      rerender(<ChatPanel {...props} isStreaming />);
      expect(container.querySelector('[data-testid="thinking-animation"]')).toBeNull();

      // Tool result arrives, turn still live → the pending row takes back over.
      await act(async () => {
        for (const [handler] of mockSai.claudeOnMessage.mock.calls) {
          (handler as (m: any) => void)({
            type: 'user',
            message: { content: [{ type: 'tool_result', tool_use_id: 'tool-1', content: 'ok' }] },
            projectPath: '/project',
            scope: 'chat',
          });
        }
      });
      rerender(<ChatPanel {...props} isStreaming />);
      expect(container.querySelector('[data-testid="thinking-animation"]')).toBeTruthy();
    });

    it('all providers use SAI animation system — no provider-specific banners', async () => {
      const props = { ...baseProps(), aiProvider: 'gemini' as const };
      const { container, rerender } = render(<ChatPanel {...props} />);
      await waitFor(() => expect(mockSai.claudeOnMessage).toHaveBeenCalled());

      await act(async () => {
        for (const [handler] of mockSai.claudeOnMessage.mock.calls) {
          (handler as (msg: any) => void)({ type: 'streaming_start', projectPath: '/project', scope: 'chat' });
        }
      });
      rerender(<ChatPanel {...props} isStreaming />);

      // Provider-specific animations removed — gemini-hint-slide no longer exists.
      expect(container.querySelector('.gemini-hint-slide')).toBeFalsy();
    });
  });

  describe('thinking continuity across tool calls', () => {
    // An assistant event carrying a tool_use block (optionally preceded by typed text).
    // streamSettled stays true here (no pure-text-delta path runs), mirroring the real
    // idle state while a tool executes.
    const toolUseEvent = (text?: string) => ({
      type: 'assistant',
      message: {
        content: [
          ...(text ? [{ type: 'text', text }] : []),
          { type: 'tool_use', id: 'tool-1', name: 'Read', input: { file: 'x.ts' } },
        ],
      },
      projectPath: '/project',
      scope: 'chat',
    });

    // A tool result event resolving the tool spawned by toolUseEvent().
    const toolResultEvent = () => ({
      type: 'user',
      message: { content: [{ type: 'tool_result', tool_use_id: 'tool-1', content: 'ok' }] },
      projectPath: '/project',
      scope: 'chat',
    });

    it('SAI: the running tool card owns the working signal; the row returns on its result', async () => {
      const props = { ...baseProps(), aiProvider: 'claude' as const };
      const { container, rerender } = render(<ChatPanel {...props} />);
      await waitFor(() => expect(mockSai.claudeOnMessage).toHaveBeenCalled());
      await act(async () => {
        for (const [handler] of mockSai.claudeOnMessage.mock.calls) {
          (handler as (m: any) => void)({ type: 'streaming_start', projectPath: '/project', scope: 'chat' });
          (handler as (m: any) => void)(toolUseEvent());
        }
      });
      rerender(<ChatPanel {...props} isStreaming />);
      // While the tool runs, its shimmering card is the working signal and the
      // thinking row yields to it (the newborn card mounts with the seedGrow entry).
      expect(container.querySelector('[data-testid="thinking-animation"]')).toBeNull();
      expect(container.querySelector('[data-msg-toolcalls="1"]')).toBeTruthy();

      // Tool resolved but the turn continues → the thinking row must come back
      // so the working state never goes signal-less.
      await act(async () => {
        for (const [handler] of mockSai.claudeOnMessage.mock.calls) {
          (handler as (m: any) => void)(toolResultEvent());
        }
      });
      rerender(<ChatPanel {...props} isStreaming />);
      expect(container.querySelector('[data-testid="thinking-animation"]')).toBeTruthy();
    });

    it('SAI: typed response into a tool call — card owns the signal, row returns after', async () => {
      const props = { ...baseProps(), aiProvider: 'claude' as const };
      const { container, rerender } = render(<ChatPanel {...props} />);
      await waitFor(() => expect(mockSai.claudeOnMessage).toHaveBeenCalled());
      await act(async () => {
        for (const [handler] of mockSai.claudeOnMessage.mock.calls) {
          (handler as (m: any) => void)({ type: 'streaming_start', projectPath: '/project', scope: 'chat' });
          (handler as (m: any) => void)(toolUseEvent('Let me check that file.'));
        }
      });
      rerender(<ChatPanel {...props} isStreaming />);
      // The typed text reveals (in the mocked ChatMessage); the running tool card
      // below it carries the working signal, not a duplicate thinking row.
      expect(container.querySelector('[data-testid="thinking-animation"]')).toBeNull();
      expect(container.querySelector('[data-msg-toolcalls="1"]')).toBeTruthy();

      await act(async () => {
        for (const [handler] of mockSai.claudeOnMessage.mock.calls) {
          (handler as (m: any) => void)(toolResultEvent());
        }
      });
      rerender(<ChatPanel {...props} isStreaming />);
      expect(container.querySelector('[data-testid="thinking-animation"]')).toBeTruthy();
    });
  });

  describe('queue-drain handoff', () => {
    it('keeps Stop button + thinking animation while a follow-up sits queued (turn ended)', async () => {
      // Reproduces: sending a message right as the turn finishes left the
      // composer showing Send (not Stop) and dropped the thinking animation
      // during the gap between the old turn's `done` and the follow-up's start.
      const props = {
        ...baseProps(),
        isStreaming: false,
        messageQueue: [{ id: 'q-0', text: 'follow up', fullText: 'follow up' }],
      };
      const { container } = render(<ChatPanel {...props} />);
      await waitFor(() => expect(mockSai.claudeOnMessage).toHaveBeenCalled());
      // Composer must present as streaming so the Stop button stays put...
      expect(latestChatInputProps.isStreaming).toBe(true);
      // ...and the thinking animation must not vanish mid-handoff.
      expect(container.querySelector('[data-testid="thinking-animation"]')).toBeTruthy();
    });

    it('shows Send (not Stop) when idle with an empty queue', async () => {
      const props = { ...baseProps(), isStreaming: false, messageQueue: [] };
      render(<ChatPanel {...props} />);
      await waitFor(() => expect(mockSai.claudeOnMessage).toHaveBeenCalled());
      expect(latestChatInputProps.isStreaming).toBe(false);
    });
  });
});
