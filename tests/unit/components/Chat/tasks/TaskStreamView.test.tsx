// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { TaskStreamView } from '../../../../../src/components/Chat/tasks/TaskStreamView';
import type { TaskCard } from '../../../../../src/components/Chat/tasks/types';

const card: TaskCard = {
  id: 'a', source: 'declared', title: 'Alpha', status: 'running',
  steps: [], doneCount: 2, totalCount: 5, currentLabel: null,
  startedAt: 0, endedAt: null, result: null, agent: null, messageIds: [], question: null,
};
const msgs: any[] = [
  { id: 'm1', role: 'assistant', content: 'one', timestamp: 1 },
  { id: 'm2', role: 'assistant', content: 'two', timestamp: 2 },
];
afterEach(cleanup);

describe('TaskStreamView', () => {
  it('renders the card header and each message via renderMessage', () => {
    render(<TaskStreamView card={card} messages={msgs} onBack={() => {}} renderMessage={(m) => <b>msg:{m.content}</b>} />);
    expect(screen.getByText('Alpha')).toBeTruthy();
    expect(screen.getByText('2/5')).toBeTruthy();
    expect(screen.getByText('msg:one')).toBeTruthy();
    expect(screen.getByText('msg:two')).toBeTruthy();
  });
  it('shows the card step pills and the last few tail lines', () => {
    const steps = [
      { label: 'Plan', state: 'done' as const },
      { label: 'Build', state: 'current' as const },
      { label: 'Ship', state: 'pending' as const },
    ];
    const tail = Array.from({ length: 6 }, (_, i) => ({ text: `line${i}`, tone: 'normal' as const }));
    render(<TaskStreamView card={{ ...card, steps }} messages={msgs} tail={tail} onBack={() => {}} renderMessage={() => null} />);
    expect(screen.getByText('Plan')).toBeTruthy();
    expect(screen.getByText('Build').className).toContain('pill--current');
    expect(screen.getByText('Ship').className).toContain('pill--pending');
    expect(screen.queryByText('line1')).toBeNull();
    expect(screen.getByText('line2')).toBeTruthy();
    expect(screen.getByText('line5')).toBeTruthy();
  });
  it('omits the progress block when there are no steps and no tail', () => {
    const { container } = render(<TaskStreamView card={card} messages={msgs} onBack={() => {}} renderMessage={() => null} />);
    expect(container.querySelector('.task-stream__progress')).toBeNull();
  });
  it('shows unavailable state when transcript is null', () => {
    render(<TaskStreamView card={card} messages={null} onBack={() => {}} renderMessage={() => null} />);
    expect(screen.getByText('Transcript unavailable')).toBeTruthy();
  });
  it('shows empty state for no messages', () => {
    render(<TaskStreamView card={{ ...card, status: 'done' }} messages={[]} onBack={() => {}} renderMessage={() => null} />);
    expect(screen.getByText('No activity yet')).toBeTruthy();
    cleanup();
    render(<TaskStreamView card={card} messages={[]} onBack={() => {}} renderMessage={() => null} />);
    expect(screen.getByText('Waiting for the first activity…')).toBeTruthy();
  });
  it('renders a status panel instead of the dead end when a fallback is given', () => {
    const detail: any = {
      id: 'bg1', description: 'npm test', kind: 'shell', isShell: true, isAgent: false,
      status: 'running', startedAt: 0, endedAt: null, lastEventAt: 0,
      totalTokens: null, toolUses: 3, lastToolName: 'Bash', summary: null, error: null, toolUseId: null,
    };
    render(
      <TaskStreamView
        card={{ ...card, agent: { description: 'npm test', toolUseId: null, taskId: 'bg1' } }}
        messages={null}
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
      <TaskStreamView
        card={{ ...card, status: 'failed', agent: { description: 'd', toolUseId: 'tu', taskId: 'bg2' } }}
        messages={null}
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
    render(<TaskStreamView card={card} messages={[]} onBack={onBack} renderMessage={() => null} />);
    fireEvent.click(screen.getByText('← All'));
    expect(onBack).toHaveBeenCalled();
  });
  it('header Stop shows for a running agent card and calls onStop', () => {
    const agentCard: TaskCard = { ...card, agent: { description: 'd', toolUseId: 'tu', taskId: 'bg1' } };
    const onStop = vi.fn();
    const { rerender } = render(<TaskStreamView card={agentCard} messages={msgs} onBack={() => {}} renderMessage={() => null} onStop={onStop} />);
    fireEvent.click(screen.getByRole('button', { name: 'Stop' }));
    expect(onStop).toHaveBeenCalledWith(agentCard);
    rerender(<TaskStreamView card={{ ...agentCard, status: 'done' }} messages={msgs} onBack={() => {}} renderMessage={() => null} onStop={onStop} />);
    expect(screen.queryByRole('button', { name: 'Stop' })).toBeNull();
    rerender(<TaskStreamView card={card} messages={msgs} onBack={() => {}} renderMessage={() => null} onStop={onStop} />);
    expect(screen.queryByRole('button', { name: 'Stop' })).toBeNull();
  });
});
