import { describe, it, expect, vi, beforeEach } from 'vitest';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import type { ComponentProps } from 'react';
import { installMockSai } from '../../../helpers/ipc-mock';

vi.mock('../../../../src/components/Chat/ChatMessage', () => ({
  default: ({ message }: any) => <div data-testid="msg">{typeof message?.content === 'string' ? message.content : ''}</div>,
}));

let inputProps: any;
vi.mock('../../../../src/components/Chat/ChatInput', () => ({
  default: (props: any) => {
    inputProps = props;
    return <div data-testid="chat-input" />;
  },
}));
vi.mock('../../../../src/components/Chat/MessageQueue', () => ({ default: () => <div /> }));
vi.mock('../../../../src/components/ThinkingAnimation', () => ({ default: () => <div /> }));

import ChatPanel from '../../../../src/components/Chat/ChatPanel';

type Props = ComponentProps<typeof ChatPanel>;

const taskCall = (id: string, input: unknown) => ({ id, name: 'mcp__sai__sai_task', input: JSON.stringify(input) });

const taskHistory = (): any[] => [
  { id: 'u1', role: 'user', content: 'do alpha and beta', timestamp: 1 },
  { id: 'a0', role: 'assistant', content: 'Intro before tasks', timestamp: 2 },
  {
    id: 'a1', role: 'assistant', content: '', timestamp: 3,
    toolCalls: [taskCall('t1', {
      action: 'create',
      tasks: [
        { id: 'alpha', title: 'Alpha task', steps: ['Read', 'Write'] },
        { id: 'beta', title: 'Beta task', steps: ['Plan'] },
      ],
    })],
  },
  { id: 'a2', role: 'assistant', content: '', timestamp: 4, toolCalls: [taskCall('t2', { action: 'update', id: 'alpha', status: 'running', step: 0 })] },
  { id: 'a3', role: 'assistant', content: 'Alpha work in progress', timestamp: 5 },
];

const gammaTask = {
  id: 'bg1', description: 'Research gamma', kind: 'general-purpose', isShell: false, isAgent: true,
  status: 'running' as const, startedAt: 10, endedAt: null, lastEventAt: 10, totalTokens: null, toolUses: null,
  lastToolName: null, summary: null, error: null, toolUseId: 'toolu_g',
};

const askCall = (questions: unknown[]) => ({
  id: 'a4', role: 'assistant', content: '', timestamp: 6,
  toolCalls: [{ id: 'toolu_ask', name: 'AskUserQuestion', input: JSON.stringify({ questions }) }],
});
const pickQuestion = { question: 'Which DB?', header: 'DB', multiSelect: false, options: [{ label: 'Postgres', description: '' }, { label: 'SQLite', description: '' }] };

describe('ChatPanel task rail integration', () => {
  let mockSai: ReturnType<typeof installMockSai>;

  const baseProps = (): Props => ({
    projectPath: '/project', permissionMode: 'default', onPermissionChange: vi.fn(),
    effortLevel: 'high', onEffortChange: vi.fn(), modelChoice: 'sonnet', onModelChange: vi.fn(),
    aiProvider: 'claude', codexModel: '', onCodexModelChange: vi.fn(), codexModels: [],
    codexPermission: 'auto', onCodexPermissionChange: vi.fn(), geminiModel: 'auto-gemini-3',
    onGeminiModelChange: vi.fn(), geminiModels: [], geminiApprovalMode: 'default',
    onGeminiApprovalModeChange: vi.fn(), geminiConversationMode: 'planning',
    onGeminiConversationModeChange: vi.fn(), initialMessages: taskHistory(), onMessagesChange: vi.fn(),
    onTurnComplete: vi.fn(), onClaudeSessionId: vi.fn(), onGeminiSessionId: vi.fn(),
    onCodexSessionId: vi.fn(), activeFilePath: null, onFileOpen: vi.fn(), isActive: true,
    isStreaming: true,
    messageQueue: [], onQueueAdd: vi.fn(), onQueueRemove: vi.fn(), onQueueShift: vi.fn(),
    sessionId: 'session-1', terminalTabs: [], onSlashCommandsUpdate: vi.fn(),
    taskUiEnabled: true, taskView: 'rail', backgroundTasks: [], onStopBackgroundTask: vi.fn().mockResolvedValue(true),
  });

  beforeEach(() => {
    mockSai = installMockSai();
    inputProps = undefined;
    mockSai.settingsGet.mockImplementation((_k: string, f: unknown) => Promise.resolve(f));
    mockSai.claudeOnMessage.mockImplementation(() => () => {});
    (window.sai as any).loadGuardGetState = vi.fn().mockResolvedValue(null);
    (window.sai as any).loadGuardOnState = vi.fn(() => () => {});
    (window.sai as any).claudeSubagentTranscript = vi.fn().mockResolvedValue(null);
    Object.defineProperty(window, 'IntersectionObserver', {
      writable: true, value: class { observe() {} disconnect() {} unobserve() {} },
    });
    Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', { writable: true, value: vi.fn() });
  });

  const mount = async (props: Props) => {
    const r = render(<ChatPanel {...props} />);
    await waitFor(() => expect(inputProps).toBeTruthy());
    return r;
  };
  const msgTexts = () => screen.queryAllByTestId('msg').map((el) => el.textContent);
  const streamTexts = () => within(screen.getByTestId('task-stream')).queryAllByTestId('msg').map((el) => el.textContent);
  const messageList = () => document.querySelector('.chat-messages') as HTMLElement;

  it('renders rail with cards when taskUiEnabled and taskView rail', async () => {
    await mount(baseProps());
    const rail = screen.getByRole('complementary', { name: 'Tasks' });
    expect(rail.textContent).toContain('Alpha task');
    expect(rail.textContent).toContain('Beta task');
    expect(document.querySelector('.task-tabs')).toBeNull();
    // Messages and composer stay mounted next to the rail.
    expect(msgTexts()).toContain('Intro before tasks');
    expect(screen.getByTestId('chat-input')).toBeTruthy();
    // The running card's steps drive the composer's todo ring.
    expect(inputProps.todos).toEqual([
      expect.objectContaining({ content: 'Read', status: 'in_progress' }),
      expect.objectContaining({ content: 'Write', status: 'pending' }),
    ]);
  });

  it('renders tabs instead when taskView tabs', async () => {
    await mount({ ...baseProps(), taskView: 'tabs' });
    expect(screen.queryByRole('complementary', { name: 'Tasks' })).toBeNull();
    const tabs = screen.getAllByRole('tab').map((t) => t.textContent);
    expect(tabs[0]).toBe('All');
    expect(tabs.some((t) => t?.includes('Alpha task'))).toBe(true);
    expect(tabs.some((t) => t?.includes('Beta task'))).toBe(true);

    // A tab opens that task's stream; All restores the message list.
    fireEvent.click(screen.getAllByRole('tab').find((t) => t.textContent?.includes('Alpha task'))!);
    expect(streamTexts()).toEqual(['Alpha work in progress']);
    expect(messageList()).not.toBeVisible();
    fireEvent.click(screen.getByRole('tab', { name: 'All' }));
    expect(screen.queryByTestId('task-stream')).toBeNull();
    expect(messageList()).toBeVisible();
    expect(msgTexts()).toContain('Intro before tasks');
  });

  it('renders no rail or tabs when taskUiEnabled is false even with sai_task history', async () => {
    await mount({ ...baseProps(), taskUiEnabled: false, claudeSessionId: 'claude-sess', backgroundTasks: [gammaTask] });
    await act(async () => { await Promise.resolve(); });
    expect((window.sai as any).claudeSubagentTranscript).not.toHaveBeenCalled();
    expect(screen.queryByRole('complementary', { name: 'Tasks' })).toBeNull();
    expect(document.querySelector('.task-tabs')).toBeNull();
    expect(document.querySelector('.task-rail')).toBeNull();
    expect(inputProps.todos).toBeUndefined();
    expect(msgTexts()).toContain('Intro before tasks');
  });

  it("Open stream swaps the message list for the task's attributed messages and back restores it", async () => {
    await mount(baseProps());
    const all = msgTexts();
    expect(all).toContain('Intro before tasks');
    expect(all).toContain('Alpha work in progress');

    fireEvent.click(screen.getByTestId('task-card-alpha').querySelector('.task-card__main')!);
    fireEvent.click(screen.getByText('Open stream →'));

    expect(streamTexts()).toEqual(['Alpha work in progress']);
    expect(messageList()).not.toBeVisible();
    // The rail stays visible beside the stream.
    expect(screen.getByRole('complementary', { name: 'Tasks' })).toBeTruthy();

    const pinnedBar = () => document.querySelector('.pinned-prompt-bar') as HTMLElement;
    expect(pinnedBar().style.display).toBe('none');

    fireEvent.click(screen.getByText('← All'));
    expect(screen.queryByTestId('task-stream')).toBeNull();
    expect(messageList()).toBeVisible();
    expect(pinnedBar().style.display).not.toBe('none');
    expect(msgTexts()).toEqual(all);
  });

  it('no rail when the chat has no task data', async () => {
    await mount({
      ...baseProps(),
      initialMessages: [
        { id: 'u1', role: 'user', content: 'hello', timestamp: 1 },
        { id: 'a1', role: 'assistant', content: 'hi there', timestamp: 2 },
      ] as any,
    });
    expect(document.querySelector('.task-rail')).toBeNull();
    expect(document.querySelector('.task-tabs')).toBeNull();
    expect(inputProps.todos).toBeUndefined();
    expect(msgTexts()).toEqual(['hello', 'hi there']);
  });

  it('Stop on an agent card calls onStopBackgroundTask with the task id', async () => {
    const onStop = vi.fn().mockResolvedValue(true);
    await mount({
      ...baseProps(),
      onStopBackgroundTask: onStop,
      backgroundTasks: [gammaTask],
    });
    await act(async () => {
      fireEvent.click(screen.getByTestId('task-card-bg:bg1').querySelector('.task-card__main')!);
    });
    fireEvent.click(screen.getByText('Stop'));
    expect(onStop).toHaveBeenCalledWith('bg1');
  });
  it('Answer on a waiting card calls claudeAnswerQuestion with the question and option', async () => {
    (window.sai as any).claudeAnswerQuestion = vi.fn().mockResolvedValue(undefined);
    await mount({ ...baseProps(), awaitingQuestion: true, initialMessages: [...taskHistory(), askCall([pickQuestion])] as any });
    const alpha = screen.getByTestId('task-card-alpha');
    expect(alpha.textContent).toContain('Which DB?');
    fireEvent.click(within(alpha).getByRole('button', { name: 'SQLite' }));
    expect((window.sai as any).claudeAnswerQuestion).toHaveBeenCalledWith('/project', 'toolu_ask', { 'Which DB?': 'SQLite' }, 'chat');
  });

  it('a multi-question AskUserQuestion shows Reply only, no quick answers', async () => {
    await mount({
      ...baseProps(), awaitingQuestion: true,
      initialMessages: [...taskHistory(), askCall([pickQuestion, { ...pickQuestion, question: 'Which ORM?' }])] as any,
    });
    const alpha = screen.getByTestId('task-card-alpha');
    expect(within(alpha).getByRole('button', { name: 'Reply…' })).toBeTruthy();
    expect(within(alpha).queryByRole('button', { name: 'SQLite' })).toBeNull();
    expect(alpha.textContent).not.toContain('Which DB?');
  });
});
