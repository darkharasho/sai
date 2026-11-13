import { describe, it, expect, vi, beforeEach } from 'vitest';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import type { ComponentProps } from 'react';
import { installMockSai } from '../../../helpers/ipc-mock';

// Mirrors the real renderer's one rule that matters here: a message holding
// only sai_task calls (an empty "shell") renders nothing (TaskFeedView tests
// check this against the real ChatMessage).
vi.mock('../../../../src/components/Chat/ChatMessage', () => ({
  default: ({ message }: any) => {
    const calls: any[] = Array.isArray(message?.toolCalls) ? message.toolCalls : [];
    const visible = calls.filter((c) => !String(c?.name ?? '').includes('sai_task'));
    const text = typeof message?.content === 'string' ? message.content : '';
    if (calls.length > 0 && visible.length === 0 && !text.trim()) return null;
    return <div data-testid="msg" data-tools={visible.map((c) => c.name).join(',')}>{text}</div>;
  },
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

import { directAtTask } from '../../../../src/components/Chat/tasks/taskFeed';
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

describe('ChatPanel task feeds integration', () => {
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
    taskUiEnabled: true, backgroundTasks: [], onStopBackgroundTask: vi.fn().mockResolvedValue(true),
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
  const streamTexts = () => within(screen.getByTestId('task-feed')).queryAllByTestId('msg').map((el) => el.textContent);
  const messageList = () => document.querySelector('.chat-messages') as HTMLElement;

  it('renders tabs whenever tasks exist', async () => {
    await mount(baseProps());
    const tabs = screen.getAllByRole('tab').map((t) => t.textContent);
    expect(tabs[0]).toBe('All');
    expect(tabs.some((t) => t?.includes('Alpha task'))).toBe(true);
    expect(tabs.some((t) => t?.includes('Beta task'))).toBe(true);

    // A tab opens that task's stream; All restores the message list.
    fireEvent.click(screen.getAllByRole('tab').find((t) => t.textContent?.includes('Alpha task'))!);
    expect(streamTexts()).toEqual(['Alpha work in progress']);
    expect(messageList()).not.toBeVisible();
    fireEvent.click(screen.getByRole('tab', { name: 'All' }));
    expect(screen.queryByTestId('task-feed')).toBeNull();
    expect(messageList()).toBeVisible();
    expect(msgTexts()).toContain('Intro before tasks');
  });

  it('renders no tabs when taskUiEnabled is false even with sai_task history', async () => {
    await mount({ ...baseProps(), taskUiEnabled: false, claudeSessionId: 'claude-sess', backgroundTasks: [gammaTask] });
    await act(async () => { await Promise.resolve(); });
    expect((window.sai as any).claudeSubagentTranscript).not.toHaveBeenCalled();
    expect(document.querySelector('.task-tabs')).toBeNull();
    expect(inputProps.todos).toBeUndefined();
    expect(msgTexts()).toContain('Intro before tasks');
  });

  it('no tasks → no tab bar', async () => {
    await mount({
      ...baseProps(),
      initialMessages: [
        { id: 'u1', role: 'user', content: 'hello', timestamp: 1 },
        { id: 'a1', role: 'assistant', content: 'hi there', timestamp: 2 },
      ] as any,
    });
    expect(document.querySelector('.task-tabs')).toBeNull();
    expect(document.querySelector('.task-chip')).toBeNull();
    expect(inputProps.todos).toBeUndefined();
    expect(msgTexts()).toEqual(['hello', 'hi there']);
  });

  const tabFor = (title: string) => screen.getAllByRole('tab').find((t) => t.textContent?.includes(title))!;
  const feedEl = () => screen.getByTestId('task-feed');

  it('All shows a chip at a task boundary only', async () => {
    await mount({
      ...baseProps(),
      initialMessages: [
        ...taskHistory(),
        { id: 'a3b', role: 'assistant', content: 'More alpha work', timestamp: 6 },
        { id: 'a5', role: 'assistant', content: '', timestamp: 7, toolCalls: [taskCall('t3', { action: 'update', id: 'beta', status: 'running', step: 0 })] },
        { id: 'a6', role: 'assistant', content: 'Beta work', timestamp: 8 },
      ] as any,
    });
    const chips = Array.from(document.querySelectorAll('.chat-messages .task-chip'));
    expect(chips.map((c) => c.textContent)).toEqual(['Alpha task', 'Beta task']);
    // Card index picks the color: alpha is card 0, beta card 1.
    expect(chips.map((c) => c.className)).toEqual(['task-chip task-chip--c0', 'task-chip task-chip--c1']);
    // The chip sits right above the first message of each run.
    expect(chips[0].nextElementSibling?.textContent).toBe('Alpha work in progress');
    expect(chips[1].nextElementSibling?.textContent).toBe('Beta work');
    // All's messages are unchanged.
    expect(msgTexts()).toEqual(['do alpha and beta', 'Intro before tasks', 'Alpha work in progress', 'More alpha work', 'Beta work']);
  });

  it("opening a tab shows only that task's items", async () => {
    await mount(baseProps());
    const all = msgTexts();
    const pinnedBar = () => document.querySelector('.pinned-prompt-bar') as HTMLElement;
    expect(pinnedBar().style.display).not.toBe('none');

    fireEvent.click(tabFor('Alpha task'));
    // a2 (the sai_task update) is in the feed as an empty shell and renders nothing.
    expect(within(feedEl()).queryAllByTestId('msg')).toHaveLength(1);
    expect(streamTexts()).toEqual(['Alpha work in progress']);
    expect(messageList()).not.toBeVisible();
    expect(pinnedBar().style.display).toBe('none');
    // Chips belong to All only.
    expect(feedEl().querySelector('.task-chip')).toBeNull();

    fireEvent.click(screen.getByText('← All'));
    expect(screen.queryByTestId('task-feed')).toBeNull();
    expect(messageList()).toBeVisible();
    expect(pinnedBar().style.display).not.toBe('none');
    expect(msgTexts()).toEqual(all);
  });

  it('composer todos come from the board while the message list and composer stay mounted', async () => {
    await mount(baseProps());
    expect(msgTexts()).toContain('Intro before tasks');
    expect(screen.getByTestId('chat-input')).toBeTruthy();
    expect(inputProps.todos).toEqual([
      expect.objectContaining({ content: 'Alpha task', status: 'in_progress' }),
      expect.objectContaining({ content: 'Beta task', status: 'pending' }),
    ]);
  });

  it('a tagged pending question renders in All and in the task tab, and the tab dot is waiting', async () => {
    await mount({ ...baseProps(), awaitingQuestion: true, initialMessages: [...taskHistory(), askCall([pickQuestion])] as any });
    const isAsk = (el: Element) => el.getAttribute('data-tools') === 'AskUserQuestion';
    expect(screen.getAllByTestId('msg').filter(isAsk)).toHaveLength(1);
    expect(tabFor('Alpha task').className).toContain('task-status--waiting');

    fireEvent.click(tabFor('Alpha task'));
    expect(within(feedEl()).getAllByTestId('msg').filter(isAsk)).toHaveLength(1);
    // The feed header carries the waiting status too.
    expect(feedEl().className).toContain('task-status--waiting');
  });

  it('a multi-question AskUserQuestion renders in the task tab', async () => {
    await mount({
      ...baseProps(), awaitingQuestion: true,
      initialMessages: [...taskHistory(), askCall([pickQuestion, { ...pickQuestion, question: 'Which ORM?' }])] as any,
    });
    fireEvent.click(tabFor('Alpha task'));
    expect(within(feedEl()).getAllByTestId('msg').filter((el) => el.getAttribute('data-tools') === 'AskUserQuestion')).toHaveLength(1);
  });

  it('pending approval UI stays visible while a task tab is open', async () => {
    await mount({
      ...baseProps(),
      initialMessages: [
        ...taskHistory(),
        { id: 'a5', role: 'assistant', content: '', timestamp: 6, toolCalls: [{ id: 'toolu_bash', name: 'Bash', input: JSON.stringify({ command: 'rm -rf build' }) }] },
      ] as any,
      initialPendingApproval: { toolName: 'Bash', toolUseId: 'toolu_bash', command: 'rm -rf build', description: '', input: { command: 'rm -rf build' } },
    });
    expect(tabFor('Alpha task').className).toContain('task-status--waiting');
    fireEvent.click(tabFor('Alpha task'));
    expect(feedEl()).toBeTruthy();
    expect(screen.getByTestId('chat-input')).toBeVisible();
    expect(screen.getByTestId('chat-bottom-strip')).toBeVisible();
    expect(inputProps.pendingApproval?.toolUseId).toBe('toolu_bash');
  });

  it('Stop in the feed header on an agent-backed card calls onStopBackgroundTask with the task id', async () => {
    const onStop = vi.fn().mockResolvedValue(true);
    await mount({ ...baseProps(), onStopBackgroundTask: onStop, backgroundTasks: [gammaTask] });
    await act(async () => { fireEvent.click(tabFor('Research gamma')); });
    fireEvent.click(within(feedEl()).getByRole('button', { name: 'Stop' }));
    expect(onStop).toHaveBeenCalledWith('bg1');
  });

  describe('directing typed messages', () => {
    const sentPrompt = () => (window.sai.claudeSend as any).mock.calls.at(-1)[1];
    const latestMessages = (props: Props) => (props.onMessagesChange as any).mock.calls.at(-1)[0] as any[];

    it('message typed on a task tab is tagged and prefixed', async () => {
      const props = baseProps();
      await mount(props);
      fireEvent.click(tabFor('Alpha task'));
      await act(async () => { await inputProps.onSend('fix it'); });
      const msgs = await waitFor(() => {
        const m = latestMessages(props);
        expect(m.some((x) => x.content === 'fix it')).toBe(true);
        return m;
      });
      const sent = msgs.find((x) => x.content === 'fix it');
      expect(sent.taskId).toMatch(/:alpha$/);
      expect(sentPrompt()).toBe(directAtTask('fix it', 'Alpha task'));
      expect(streamTexts()).toContain('fix it');
    });

    it('a queued message sent now while a task tab is open is neither tagged nor prefixed', async () => {
      const props = { ...baseProps(), messageQueue: [{ id: 'q1', text: 'queued', fullText: 'queued' }] as any };
      await mount(props);
      fireEvent.click(tabFor('Alpha task'));
      await act(async () => { await inputProps.onQueueSendNow('q1'); });
      const msgs = await waitFor(() => {
        const m = latestMessages(props);
        expect(m.some((x) => x.content === 'queued')).toBe(true);
        return m;
      });
      expect(msgs.find((x) => x.content === 'queued').taskId).toBeNull();
      expect(sentPrompt()).toBe('queued');
    });

    it('typing in All is unchanged', async () => {
      const props = baseProps();
      await mount(props);
      await act(async () => { await inputProps.onSend('fix it'); });
      const msgs = await waitFor(() => {
        const m = latestMessages(props);
        expect(m.some((x) => x.content === 'fix it')).toBe(true);
        return m;
      });
      expect(msgs.find((x) => x.content === 'fix it').taskId).toBeNull();
      expect(sentPrompt()).toBe('fix it');
    });
  });
});
