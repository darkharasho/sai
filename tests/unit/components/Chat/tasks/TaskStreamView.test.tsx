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
  it('shows unavailable state when transcript is null', () => {
    render(<TaskStreamView card={card} messages={null} onBack={() => {}} renderMessage={() => null} />);
    expect(screen.getByText('Transcript unavailable')).toBeTruthy();
  });
  it('shows empty state for no messages', () => {
    render(<TaskStreamView card={card} messages={[]} onBack={() => {}} renderMessage={() => null} />);
    expect(screen.getByText('No activity yet')).toBeTruthy();
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
