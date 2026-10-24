import { describe, it, expect, vi, beforeEach } from 'vitest';
import { act, render, screen, waitFor } from '@testing-library/react';
import type { ComponentProps } from 'react';
import { installMockSai } from '../../../helpers/ipc-mock';

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

import ChatPanel from '../../../../src/components/Chat/ChatPanel';

type Props = ComponentProps<typeof ChatPanel>;

const state = (paused: boolean) => ({
  level: paused ? 'critical' : 'normal', paused, override: false, saiCaused: false, saiAppHeavy: false,
  memUsedPct: 95, swapUsedPct: 50, game: null, recoveredAt: null, enabled: true,
});
const item = { id: 'q1', text: 'queued', fullText: 'queued' };
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
    messageQueue: [], onQueueAdd: vi.fn(), onQueueRemove: vi.fn(), onQueueShift: vi.fn(),
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

  const setPaused = async (p: boolean) => { await act(async () => { broadcast(state(p)); }); };
  const mount = async (props: Props) => {
    const r = render(<ChatPanel {...props} />);
    await waitFor(() => expect((window.sai as any).loadGuardOnState).toHaveBeenCalled());
    return r;
  };

  it('queues composer sends while paused, drains exactly once on resume', async () => {
    const props = baseProps();
    const { rerender } = await mount(props);
    await setPaused(true);
    expect(inputProps.sendsQueued).toBe(true);

    act(() => { screen.getByTestId('chat-input').click(); });
    await sleep(20);
    expect(props.onQueueAdd).toHaveBeenCalledWith('session-1', 'new prompt', 'new prompt', undefined);
    expect(mockSai.claudeSend).not.toHaveBeenCalled();

    // Queue holds an item while paused: no drain.
    rerender(<ChatPanel {...props} messageQueue={[item]} />);
    await sleep(450);
    expect(props.onQueueShift).not.toHaveBeenCalled();

    await setPaused(false);
    await waitFor(() => expect(mockSai.claudeSend).toHaveBeenCalledTimes(1), { timeout: 2000 });
    expect(props.onQueueShift).toHaveBeenCalledTimes(1);
    expect(mockSai.claudeSend.mock.calls[0][1]).toBe('queued');
  });

  it('a pause inside the 300ms drain window leaves the item queued and resume picks it up', async () => {
    const props = baseProps();
    const { rerender } = await mount(props);
    rerender(<ChatPanel {...props} messageQueue={[item]} />);
    await setPaused(true); // lands before the 300ms timer fires
    await sleep(500);
    expect(props.onQueueShift).not.toHaveBeenCalled();
    expect(mockSai.claudeSend).not.toHaveBeenCalled();

    await setPaused(false);
    await waitFor(() => expect(mockSai.claudeSend).toHaveBeenCalledTimes(1), { timeout: 2000 });
    expect(props.onQueueShift).toHaveBeenCalledTimes(1);
  });

  it('"send now" does not bypass the pause or stop the running turn', async () => {
    const props = { ...baseProps(), messageQueue: [item], isStreaming: true };
    await mount(props);
    await setPaused(true);
    act(() => { inputProps.onQueueSendNow('q1'); });
    expect(props.onQueueRemove).not.toHaveBeenCalled();
    expect(mockSai.claudeStop).not.toHaveBeenCalled();
    expect(mockSai.claudeSend).not.toHaveBeenCalled();
  });

  it('does not queue when not paused', async () => {
    const props = baseProps();
    await mount(props);
    act(() => { screen.getByTestId('chat-input').click(); });
    await waitFor(() => expect(mockSai.claudeSend).toHaveBeenCalledTimes(1));
    expect(props.onQueueAdd).not.toHaveBeenCalled();
  });
});
