import { describe, it, expect, vi, beforeEach } from 'vitest';
import { act, render, waitFor } from '@testing-library/react';
import type { ComponentProps } from 'react';
import { installMockSai } from '../../../helpers/ipc-mock';
import { _resetRevealRegistry } from '../../../../src/components/Chat/revealRegistry';

// Regression: a reply that streamed into a hidden (busy, non-active) workspace
// was persisted truncated to its FIRST delta ("CI now" out of a 2k-char reply).
// The final frame and `done` landed before React rendered, so the done-time
// flushMessagesToParent read a messagesRef that lagged the queued updates;
// the turn end then unmounted the hidden panel, discarding them for good.

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
    initialMessages: [{ id: 'u1', role: 'user', content: 'how is CI', timestamp: Date.now() }],
    onMessagesChange: vi.fn(),
    onTurnComplete: vi.fn(),
    onClaudeSessionId: vi.fn(),
    onGeminiSessionId: vi.fn(),
    onCodexSessionId: vi.fn(),
    activeFilePath: null,
    onFileOpen: vi.fn(),
    isActive: false,
    messageQueue: [],
    onQueueAdd: vi.fn(),
    onQueueRemove: vi.fn(),
    onQueueShift: vi.fn(),
    sessionId: 'session-int',
    terminalTabs: [],
    onSlashCommandsUpdate: vi.fn(),
  } as ChatPanelProps;
}

describe('done-time flush to parent', () => {
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
    // Hidden/unfocused window: animation frames never fire.
    Object.defineProperty(window, 'requestAnimationFrame', { writable: true, value: () => 1 });
    Object.defineProperty(window, 'cancelAnimationFrame', { writable: true, value: () => {} });
  });

  it('hands the parent the full final text even when done arrives before a render', async () => {
    const props = baseProps();
    let atTurnComplete: any[] | null = null;
    (props.onTurnComplete as any).mockImplementation(() => {
      const calls = (props.onMessagesChange as any).mock.calls;
      atTurnComplete = calls[calls.length - 1][0];
    });
    render(<ChatPanel {...props} />);
    await waitFor(() => expect(mockSai.claudeOnMessage).toHaveBeenCalled());
    const handlers = mockSai.claudeOnMessage.mock.calls.map(([h]: any[]) => h as (m: any) => void);
    const emit = (msg: any) => { for (const h of handlers) h({ projectPath: '/project', scope: 'chat', ...msg }); };
    const full = 'CI now passes on both Linux and Windows, which finishes Task 5.';

    await act(async () => {
      emit({ type: 'streaming_start', turnSeq: 3 });
      emit({ type: 'assistant', message: { content: [{ type: 'tool_use', id: 't1', name: 'Bash', input: { command: 'tar' } }] } });
      emit({ type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: 't1', content: 'ok' }] } });
    });
    // First delta opens a new bubble and renders.
    await act(async () => {
      emit({ type: 'assistant', message: { content: [{ type: 'text', delta: true, text: 'CI now' }] } });
    });
    // A token pause longer than the 250ms stream-idle debounce settles the
    // bubble, so the next delta's un-settle is a REAL queued update.
    await act(async () => { await new Promise(res => setTimeout(res, 300)); });
    // The rest of the reply, the reconcile frame, and the turn end all land
    // before React gets to render.
    await act(async () => {
      emit({ type: 'assistant', message: { content: [{ type: 'text', delta: true, text: full.slice('CI now'.length) }] } });
      emit({ type: 'assistant', message: { content: [{ type: 'text', text: full, final: true }] } });
      emit({ type: 'result', turnSeq: 3 });
      emit({ type: 'done', turnSeq: 3 });
    });

    expect(props.onTurnComplete).toHaveBeenCalled();
    const last = atTurnComplete![atTurnComplete!.length - 1];
    expect(last.role).toBe('assistant');
    expect(last.content).toBe(full);
  });
});
