import { describe, it, expect, vi, beforeEach } from 'vitest';
import { act, render, screen, waitFor } from '@testing-library/react';
import type { ComponentProps } from 'react';
import { installMockSai } from '../../../helpers/ipc-mock';
import { flushChatlog, seedPanelHistory } from '../../../helpers/chatlogMock';

vi.mock('../../../../src/components/Chat/ChatMessage', () => ({ default: () => <div /> }));

let inputProps: any;
vi.mock('../../../../src/components/Chat/ChatInput', () => ({
  default: (props: any) => {
    inputProps = props;
    return <button data-testid="chat-input" onClick={() => props.onSend('new prompt')}>send</button>;
  },
}));
vi.mock('../../../../src/components/Chat/MessageQueue', () => ({ default: () => <div /> }));
vi.mock('../../../../src/components/ThinkingAnimation', () => ({ default: () => <div /> }));

import RealChatPanel from '../../../../src/components/Chat/ChatPanel';

function ChatPanel(props: any) {
  seedPanelHistory(props);
  return <RealChatPanel {...props} />;
}

type Props = ComponentProps<typeof RealChatPanel> & { initialMessages?: any[] };

const state = (paused: boolean) => ({
  level: paused ? 'critical' : 'normal', paused, override: false, saiCaused: false, saiAppHeavy: false,
  memUsedPct: 95, swapUsedPct: 50, game: null, recoveredAt: null, enabled: true,
});
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

describe('ChatPanel load guard pause', () => {
  let mockSai: ReturnType<typeof installMockSai>;
  let broadcast: (s: any) => void;

  const baseProps = (): Props => ({
    projectPath: '/project', permissionMode: 'default', onPermissionChange: vi.fn(),
    effortLevel: 'high', onEffortChange: vi.fn(), modelChoice: 'sonnet', onModelChange: vi.fn(),
    aiProvider: 'claude', codexModel: '', onCodexModelChange: vi.fn(), codexModels: [],
    codexPermission: 'auto', onCodexPermissionChange: vi.fn(), geminiModel: 'auto-gemini-3',
    onGeminiModelChange: vi.fn(), geminiModels: [], geminiApprovalMode: 'default',
    onGeminiApprovalModeChange: vi.fn(), geminiConversationMode: 'planning',
    onGeminiConversationModeChange: vi.fn(), initialMessages: [], onMessagesChange: vi.fn(),
    onTurnComplete: vi.fn(), onClaudeSessionId: vi.fn(), onGeminiSessionId: vi.fn(),
    onCodexSessionId: vi.fn(), activeFilePath: null, onFileOpen: vi.fn(), isActive: true,
    sessionId: 'session-1', terminalTabs: [], onSlashCommandsUpdate: vi.fn(),
  });

  beforeEach(() => {
    mockSai = installMockSai();
    inputProps = undefined;
    mockSai.settingsGet.mockImplementation((_k: string, f: unknown) => Promise.resolve(f));
    mockSai.claudeOnMessage.mockImplementation(() => () => {});
    mockSai.geminiStart.mockResolvedValue({ slashCommands: [] });
    (window.sai as any).loadGuardGetState = vi.fn().mockResolvedValue(state(false));
    (window.sai as any).loadGuardOnState = vi.fn((cb: any) => { broadcast = cb; return () => {}; });
    Object.defineProperty(window, 'IntersectionObserver', {
      writable: true, value: class { observe() {} disconnect() {} unobserve() {} },
    });
    Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', { writable: true, value: vi.fn() });
  });

  // The guard pauses main (ChatCommands holds sends) and the renderer (banner, composer) together.
  const setPaused = async (p: boolean) => {
    await act(async () => { mockSai.chatlog.setPaused(p); broadcast(state(p)); });
    await flushChatlog();
  };
  const queueInLog = (clientId: string, text: string) => {
    mockSai.chatlog.append('session-1', { type: 'queue_added', item: { clientId, text, queuedAt: 1 } }, { projectPath: '/project' });
  };
  const mount = async (props: Props) => {
    const r = render(<ChatPanel {...props} />);
    await waitFor(() => expect((window.sai as any).loadGuardOnState).toHaveBeenCalled());
    await flushChatlog();
    return r;
  };

  it('sends while paused go to main, which holds them in the queue and drains exactly once on resume', async () => {
    const props = baseProps();
    await mount(props);
    await setPaused(true);
    expect(inputProps.sendsQueued).toBe(true);

    act(() => { screen.getByTestId('chat-input').click(); });
    await sleep(20);
    await flushChatlog();
    expect(mockSai.chatlog.commands('send')).toEqual([expect.objectContaining({ text: 'new prompt' })]);
    expect(mockSai.chatlog.commands('send')[0].now).toBeUndefined();
    expect(mockSai.claudeSend).not.toHaveBeenCalled();
    // Held in the log's queue, shown in the strip.
    expect(inputProps.messageQueue.map((q: any) => q.text)).toEqual(['new prompt']);

    await sleep(450);
    expect(mockSai.claudeSend).not.toHaveBeenCalled();

    await setPaused(false);
    await waitFor(() => expect(mockSai.claudeSend).toHaveBeenCalledTimes(1), { timeout: 2000 });
    expect(mockSai.claudeSend.mock.calls[0][1]).toBe('new prompt');
    await waitFor(() => expect(inputProps.messageQueue).toEqual([]));
    await sleep(50);
    expect(mockSai.claudeSend).toHaveBeenCalledTimes(1);
  });

  it('"send now" does not bypass the pause or stop the running turn', async () => {
    queueInLog('q1', 'queued');
    const props = { ...baseProps(), isStreaming: true };
    await mount(props);
    await setPaused(true);
    await act(async () => { await inputProps.onQueueSendNow('q1'); });
    expect(mockSai.chatlog.commands('queueRemove')).toEqual([]);
    expect(mockSai.claudeStop).not.toHaveBeenCalled();
    expect(mockSai.claudeSend).not.toHaveBeenCalled();
    expect(inputProps.messageQueue.map((q: any) => q.id)).toEqual(['q1']);
  });

  it('does not queue when not paused', async () => {
    const props = baseProps();
    await mount(props);
    act(() => { screen.getByTestId('chat-input').click(); });
    await waitFor(() => expect(mockSai.claudeSend).toHaveBeenCalledTimes(1));
    expect(mockSai.chatlog.entries('session-1').some((e) => e.ev.type === 'queue_added')).toBe(false);
  });

  it('hands the load state to the composer toolbar, not the scrolling conversation header', async () => {
    const props = { ...baseProps(), initialMessages: [{ id: 'm1', role: 'user', content: 'hi', timestamp: 1 }] } as Props;
    const { container } = await mount(props);
    await setPaused(true);
    expect(inputProps.loadGuard).toMatchObject({ level: 'critical', paused: true });
    expect(container.querySelector('.chat-conversation-header')).not.toBeNull();
    expect(container.querySelector('.chat-conversation-header .load-guard-pill')).toBeNull();
  });
});
