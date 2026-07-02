import { describe, it, expect, vi, beforeEach } from 'vitest';
import { act, render, waitFor } from '@testing-library/react';
import type { ComponentProps } from 'react';
import { installMockSai } from '../../../helpers/ipc-mock';
import { _resetRevealRegistry } from '../../../../src/components/Chat/revealRegistry';

// Deliberately NO ChatMessage mock: this suite exercises the REAL
// ChatMessage + StreamingAssistantHead through ChatPanel's event handler, to
// catch integration bugs the mocked suite can't (e.g. the final reply popping
// in with no thinking/reveal animation).

vi.mock('../../../../src/components/Chat/ChatInput', () => ({
  default: () => <button data-testid="chat-input">send</button>,
}));
vi.mock('../../../../src/components/Chat/MessageQueue', () => ({
  default: () => <div data-testid="message-queue" />,
}));

import ChatPanel from '../../../../src/components/Chat/ChatPanel';

type ChatPanelProps = ComponentProps<typeof ChatPanel>;

function baseProps(): ChatPanelProps {
  return {
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
    initialMessages: [{ id: 'u1', role: 'user', content: 'run some test tools', timestamp: Date.now() }],
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
    sessionId: 'session-int',
    terminalTabs: [],
    onSlashCommandsUpdate: vi.fn(),
  } as ChatPanelProps;
}

describe('final reply animation (real ChatMessage, post-tool turn)', () => {
  let mockSai: ReturnType<typeof installMockSai>;

  beforeEach(() => {
    _resetRevealRegistry();
    mockSai = installMockSai();
    mockSai.settingsGet.mockImplementation((_key: string, fallback: unknown) => Promise.resolve(fallback));
    mockSai.claudeOnMessage.mockImplementation(() => () => {});
    mockSai.geminiStart.mockResolvedValue({ slashCommands: [] });
    Object.defineProperty(window, 'IntersectionObserver', {
      writable: true,
      value: class { observe() {} disconnect() {} unobserve() {} },
    });
    Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', { writable: true, value: vi.fn() });
    Object.defineProperty(window, 'requestAnimationFrame', {
      writable: true,
      value: (cb: FrameRequestCallback) => setTimeout(() => cb(0), 0),
    });
    Object.defineProperty(window, 'cancelAnimationFrame', { writable: true, value: (id: number) => clearTimeout(id) });
  });

  const send = async (handlerCalls: any[], msg: any) => {
    await act(async () => {
      for (const [handler] of handlerCalls) (handler as (m: any) => void)(msg);
    });
  };

  it('a full-frame final reply after a tool run keeps the thinking phase, then word-reveals', async () => {
    const props = baseProps();
    const { container, rerender } = render(<ChatPanel {...props} />);
    await waitFor(() => expect(mockSai.claudeOnMessage).toHaveBeenCalled());
    const calls = mockSai.claudeOnMessage.mock.calls;

    await send(calls, { type: 'streaming_start', projectPath: '/project', scope: 'chat' });
    rerender(<ChatPanel {...props} isStreaming />);
    await send(calls, {
      type: 'assistant',
      message: { content: [{ type: 'tool_use', id: 'tool-1', name: 'Bash', input: { command: 'ls' } }] },
      projectPath: '/project', scope: 'chat',
    });
    await send(calls, {
      type: 'user',
      message: { content: [{ type: 'tool_result', tool_use_id: 'tool-1', content: 'ok' }] },
      projectPath: '/project', scope: 'chat',
    });

    // Final reply: ONE complete (non-delta) frame while still streaming.
    await send(calls, {
      type: 'assistant',
      message: { content: [{ type: 'text', text: 'All tools ran successfully and everything passed.' }] },
      projectPath: '/project', scope: 'chat',
    });

    // The head must be in its thinking phase (typing status visible, text held).
    const head = container.querySelector('.sah-root');
    expect(head).toBeTruthy();
    expect(head!.getAttribute('data-phase')).toBe('thinking');
    expect(container.querySelector('.sah-status')).toBeTruthy();

    // Turn ends → morph (250ms) → word-by-word reveal of the reply.
    rerender(<ChatPanel {...props} isStreaming={false} />);
    await act(async () => { await new Promise(res => setTimeout(res, 400)); });
    expect(container.querySelector('.sah-root')?.getAttribute('data-phase')).toBe('revealed');
    // revealWords wraps words in .rv-word spans while animating.
    expect(container.querySelectorAll('.rv-word').length).toBeGreaterThan(0);
    // The reveal inserts a transient caret glyph between words while animating —
    // strip it before matching the reply text.
    expect(container.textContent?.replace(/[▋▊▍]/g, '')).toContain('All tools ran successfully');
  });

  it('the thinking row returns on the second turn (fresh presence key per appearance)', async () => {
    const props = baseProps();
    const { container, rerender } = render(<ChatPanel {...props} />);
    await waitFor(() => expect(mockSai.claudeOnMessage).toHaveBeenCalled());
    const calls = mockSai.claudeOnMessage.mock.calls;

    // Turn 1: think → reply → done.
    await send(calls, { type: 'streaming_start', projectPath: '/project', scope: 'chat' });
    rerender(<ChatPanel {...props} isStreaming />);
    const firstRow = container.querySelector('.thinking-animation');
    expect(firstRow).toBeTruthy();
    await send(calls, {
      type: 'assistant',
      message: { content: [{ type: 'text', text: 'first reply' }] },
      projectPath: '/project', scope: 'chat',
    });
    await send(calls, { type: 'done', projectPath: '/project', scope: 'chat' });
    rerender(<ChatPanel {...props} isStreaming={false} />);
    await act(async () => { await new Promise(res => setTimeout(res, 500)); });
    expect(container.querySelector('.thinking-animation')).toBeNull();

    // Turn 2: the row must come back, as a NEW presence child (a reused key can
    // resurrect the exited child's final state — an invisible row).
    await send(calls, { type: 'streaming_start', projectPath: '/project', scope: 'chat' });
    rerender(<ChatPanel {...props} isStreaming />);
    await act(async () => { await new Promise(res => setTimeout(res, 300)); });
    const secondRow = container.querySelector('.thinking-animation');
    expect(secondRow).toBeTruthy();
    const wrap = secondRow!.parentElement as HTMLElement;
    expect(wrap.style.opacity).not.toBe('0');
    expect(wrap.style.height === '' || wrap.style.height === 'auto').toBe(true);
  });

  it('a delta-streamed (watched) final reply renders live without re-revealing at settle', async () => {
    // "Watched" is time-based (WATCHED_MS): advance a virtual clock so the
    // streamed text counts as genuinely read while it arrived.
    let now = 10_000;
    const nowSpy = vi.spyOn(performance, 'now').mockImplementation(() => now);
    const props = baseProps();
    const { container, rerender } = render(<ChatPanel {...props} />);
    await waitFor(() => expect(mockSai.claudeOnMessage).toHaveBeenCalled());
    const calls = mockSai.claudeOnMessage.mock.calls;

    await send(calls, { type: 'streaming_start', projectPath: '/project', scope: 'chat' });
    rerender(<ChatPanel {...props} isStreaming />);
    const delta = (text: string) => ({
      type: 'assistant',
      message: { content: [{ type: 'text', delta: true, text }] },
      projectPath: '/project', scope: 'chat',
    });
    await send(calls, delta('Streaming '));
    // rAF flush is stubbed to setTimeout(0); let the buffered delta land.
    await act(async () => { await new Promise(res => setTimeout(res, 20)); });
    await send(calls, delta('reply text here.'));
    await act(async () => { await new Promise(res => setTimeout(res, 20)); });

    // Watched live: text visible while streaming, no typing status.
    const md = container.querySelector('.sah-md') as HTMLElement;
    expect(md).toBeTruthy();
    expect(md.style.display).not.toBe('none');

    now += 600; // on screen well past the watch threshold
    rerender(<ChatPanel {...props} isStreaming={false} />);
    await act(async () => { await new Promise(res => setTimeout(res, 400)); });
    // No word-reveal replay for text the user already watched arrive.
    expect(container.querySelectorAll('.rv-word').length).toBe(0);
    expect(container.textContent).toContain('Streaming reply text here.');
    nowSpy.mockRestore();
  });
});
