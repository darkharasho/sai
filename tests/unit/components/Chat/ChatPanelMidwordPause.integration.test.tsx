import { describe, it, expect, vi, beforeEach } from 'vitest';
import { act, render, waitFor } from '@testing-library/react';
import type { ComponentProps } from 'react';
import { installMockSai } from '../../../helpers/ipc-mock';
import { _resetRevealRegistry } from '../../../../src/components/Chat/revealRegistry';
import { scopeMessageBuffer, hasChatListener, _resetChatFrameGate } from '../../../../src/lib/chatFrameGate';

// Repro for the v1.12.14 dogfood report: a reply that pauses mid-sentence
// longer than the stream-idle settle (250ms), then keeps streaming, rendered
// CUT OFF at the pause point — the transcript showed "…the two Discord-" while
// the CLI transcript had the full sentence. Drives the REAL ChatMessage +
// StreamingAssistantHead through ChatPanel's event handler.

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
    initialMessages: [{ id: 'u1', role: 'user', content: 'release notes please', timestamp: Date.now() }],
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
    sessionId: 'session-midword',
    terminalTabs: [],
    onSlashCommandsUpdate: vi.fn(),
  } as ChatPanelProps;
}

describe('mid-sentence pause past the settle debounce', () => {
  let mockSai: ReturnType<typeof installMockSai>;

  beforeEach(() => {
    _resetRevealRegistry();
    _resetChatFrameGate();
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
  const sleep = async (ms: number) => {
    await act(async () => { await new Promise(res => setTimeout(res, ms)); });
  };

  it('text streamed after a >250ms mid-reply pause still renders', async () => {
    // Virtual clock only for performance.now (watched-time logic); real timers
    // still drive the settle debounce and post-settle hold.
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

    // Stream the first half, watched (on screen well past WATCHED_MS).
    await send(calls, delta('I left out the two Discord-'));
    await sleep(20); // rAF flush
    now += 600;

    // Mid-sentence pause: outlive the 250ms settle debounce.
    await sleep(400);

    // The tail arrives after the settle.
    await send(calls, delta('embed CI fixes since they do not affect users.'));
    await sleep(20);
    now += 600;
    await sleep(400);

    await send(calls, { type: 'done', projectPath: '/project', scope: 'chat' });
    rerender(<ChatPanel {...props} isStreaming={false} />);
    await sleep(1200); // let reveal/hold timers run out

    const text = container.textContent?.replace(/[▋▊▍]/g, '') ?? '';
    expect(text).toContain('I left out the two Discord-embed CI fixes since they do not affect users.');
    nowSpy.mockRestore();
  });

  it('a final-tagged complete frame heals a bubble whose tail deltas were lost', async () => {
    const props = baseProps();
    const { container, rerender } = render(<ChatPanel {...props} />);
    await waitFor(() => expect(mockSai.claudeOnMessage).toHaveBeenCalled());
    const calls = mockSai.claudeOnMessage.mock.calls;

    await send(calls, { type: 'streaming_start', projectPath: '/project', scope: 'chat' });
    rerender(<ChatPanel {...props} isStreaming />);

    // Only the head deltas arrive — the tail is lost (focus-swap listener gap).
    await send(calls, {
      type: 'assistant',
      message: { content: [{ type: 'text', delta: true, text: 'I left out the two Discord-' }] },
      projectPath: '/project', scope: 'chat',
    });
    await sleep(20);

    // SDK reconcile frame: complete message text tagged `final`.
    const FULL = 'I left out the two Discord-embed CI fixes since they do not affect users in-game.';
    await send(calls, {
      type: 'assistant',
      message: { content: [{ type: 'text', text: FULL, final: true }] },
      projectPath: '/project', scope: 'chat',
    });

    await send(calls, { type: 'done', projectPath: '/project', scope: 'chat' });
    rerender(<ChatPanel {...props} isStreaming={false} />);
    await sleep(600);

    const text = container.textContent?.replace(/[▋▊▍]/g, '') ?? '';
    expect(text).toContain(FULL);
    // Replaced, not duplicated: the head prefix appears exactly once.
    expect(text.split('I left out the two Discord-').length).toBe(2);
  });

  it('drains frames buffered before the panel subscribed (focus-swap gap)', async () => {
    // App buffered content for this scope while no ChatPanel listener was
    // registered; the panel must pick it up at mount.
    scopeMessageBuffer.set('session-gap', [
      { id: 'gap-1', role: 'assistant', content: 'buffered while unmounted', timestamp: Date.now() },
    ] as any);

    const props = { ...baseProps(), claudeScope: 'session-gap', sessionId: 'session-gap' } as any;
    const { container } = render(<ChatPanel {...props} />);
    await waitFor(() => expect(mockSai.claudeOnMessage).toHaveBeenCalled());

    // Panel took ownership: the buffer is drained and the listener registered.
    expect(hasChatListener('session-gap')).toBe(true);
    expect(scopeMessageBuffer.has('session-gap')).toBe(false);
    // The word-reveal interleaves caret glyphs — strip them before matching.
    await waitFor(() => {
      const text = container.textContent?.replace(/[▋▊▍]/g, '') ?? '';
      expect(text).toContain('buffered while unmounted');
    });
  });

  it('gives a focused scoped Codex chat ownership of its frame gate buffer', async () => {
    scopeMessageBuffer.set('codex-scope', [
      { id: 'codex-gap', role: 'assistant', content: 'scoped codex buffer', timestamp: Date.now() },
    ] as any);

    const props = {
      ...baseProps(),
      aiProvider: 'codex' as const,
      claudeScope: 'codex-scope',
      sessionId: 'codex-scope',
    } as ChatPanelProps;
    const { container, unmount } = render(<ChatPanel {...props} />);
    await waitFor(() => expect(mockSai.claudeOnMessage).toHaveBeenCalled());

    expect(hasChatListener('codex-scope')).toBe(true);
    expect(scopeMessageBuffer.has('codex-scope')).toBe(false);
    await waitFor(() => {
      const text = container.textContent?.replace(/[▋▊▍]/g, '') ?? '';
      expect(text).toContain('scoped codex buffer');
    });

    unmount();
    expect(hasChatListener('codex-scope')).toBe(false);
  });
});
