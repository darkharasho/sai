// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { TaskFeedView } from '../../../../../src/components/Chat/tasks/TaskFeedView';
import ChatMessage from '../../../../../src/components/Chat/ChatMessage';
import type { TaskCard } from '../../../../../src/components/Chat/tasks/types';

const card: TaskCard = {
  id: 'a', source: 'declared', title: 'Alpha', tag: '0:a', status: 'running', now: null,
  startedAt: 0, endedAt: null, result: null, agent: null, messageIds: [], question: null,
};
const msgs: any[] = [
  { id: 'm1', role: 'assistant', content: 'one', timestamp: 1 },
  { id: 'm2', role: 'assistant', content: 'two', timestamp: 2 },
];
afterEach(cleanup);

describe('TaskFeedView', () => {
  it('renders feed through renderMessage', () => {
    const { container } = render(<TaskFeedView card={card} feed={msgs} onBack={() => {}} renderMessage={(m) => <b>msg:{m.content}</b>} />);
    expect(screen.getByText('Alpha')).toBeTruthy();
    expect(screen.getByText('msg:one')).toBeTruthy();
    expect(screen.getByText('msg:two')).toBeTruthy();
    // No pills, no tail, no n/m.
    expect(container.querySelector('.task-stream__progress')).toBeNull();
    expect(container.textContent).not.toMatch(/\d+\/\d+/);
  });
  it('empty feed message', () => {
    render(<TaskFeedView card={card} feed={[]} onBack={() => {}} renderMessage={() => null} />);
    expect(screen.getByText('Nothing filed under this task yet')).toBeTruthy();
  });
  it('an empty shell (only a sai_task call) renders nothing visible through the real renderer', () => {
    const shell: any = {
      id: 'a2', role: 'assistant', content: '', timestamp: 4,
      toolCalls: [{ id: 't2', name: 'mcp__sai__sai_task', input: JSON.stringify({ action: 'update', id: 'a', status: 'running' }) }],
    };
    render(
      <TaskFeedView
        card={card}
        feed={[shell, msgs[0]]}
        onBack={() => {}}
        renderMessage={(m) => <ChatMessage message={m} projectPath="/p" />}
      />,
    );
    const body = screen.getByTestId('task-feed').querySelector('.task-stream__body')!;
    expect(body.querySelectorAll('[data-testid="chat-msg"]')).toHaveLength(1);
    expect(body.textContent).toContain('one');
  });
  it('shows unavailable state when the feed is null', () => {
    render(<TaskFeedView card={card} feed={null} onBack={() => {}} renderMessage={() => null} />);
    expect(screen.getByText('Transcript unavailable')).toBeTruthy();
  });
  it('renders a status panel instead of the dead end when a fallback is given', () => {
    const detail: any = {
      id: 'bg1', description: 'npm test', kind: 'shell', isShell: true, isAgent: false,
      status: 'running', startedAt: 0, endedAt: null, lastEventAt: 0,
      totalTokens: null, toolUses: 3, lastToolName: 'Bash', summary: null, error: null, toolUseId: null,
    };
    render(
      <TaskFeedView
        card={{ ...card, agent: { description: 'npm test', toolUseId: null, taskId: 'bg1' } }}
        feed={null}
        fallback={{ reason: 'shell', detail }}
        onBack={() => {}}
        renderMessage={() => null}
      />,
    );
    expect(screen.queryByText('Transcript unavailable')).toBeNull();
    expect(screen.getByTestId('task-stream-fallback').getAttribute('data-reason')).toBe('shell');
    expect(screen.getByText(/shell command running in the background/)).toBeTruthy();
    expect(screen.getByText('shell')).toBeTruthy();
    expect(screen.getByText('Bash')).toBeTruthy();
    expect(screen.getByText('3')).toBeTruthy();
  });
  it('fallback surfaces a failed task error', () => {
    const detail: any = {
      id: 'bg2', description: 'd', kind: 'Explore', isShell: false, isAgent: true,
      status: 'failed', startedAt: 0, endedAt: 5000, lastEventAt: 5000,
      totalTokens: 1234, toolUses: null, lastToolName: null, summary: null, error: 'agent crashed', toolUseId: 'tu',
    };
    render(
      <TaskFeedView
        card={{ ...card, status: 'failed', agent: { description: 'd', toolUseId: 'tu', taskId: 'bg2' } }}
        feed={null}
        fallback={{ reason: 'missing', detail }}
        onBack={() => {}}
        renderMessage={() => null}
      />,
    );
    expect(screen.getByText('agent crashed')).toBeTruthy();
    expect(screen.getByText('failed')).toBeTruthy();
    expect(screen.getByText('1,234')).toBeTruthy();
  });
  it('back button calls onBack', () => {
    const onBack = vi.fn();
    render(<TaskFeedView card={card} feed={[]} onBack={onBack} renderMessage={() => null} />);
    fireEvent.click(screen.getByText('← All'));
    expect(onBack).toHaveBeenCalled();
  });
  it('header Stop shows for a running agent card and calls onStop', () => {
    const agentCard: TaskCard = { ...card, agent: { description: 'd', toolUseId: 'tu', taskId: 'bg1' } };
    const onStop = vi.fn();
    const { rerender } = render(<TaskFeedView card={agentCard} feed={msgs} onBack={() => {}} renderMessage={() => null} onStop={onStop} />);
    fireEvent.click(screen.getByRole('button', { name: 'Stop' }));
    expect(onStop).toHaveBeenCalledWith(agentCard);
    rerender(<TaskFeedView card={{ ...agentCard, status: 'done' }} feed={msgs} onBack={() => {}} renderMessage={() => null} onStop={onStop} />);
    expect(screen.queryByRole('button', { name: 'Stop' })).toBeNull();
    rerender(<TaskFeedView card={card} feed={msgs} onBack={() => {}} renderMessage={() => null} onStop={onStop} />);
    expect(screen.queryByRole('button', { name: 'Stop' })).toBeNull();
  });
});
