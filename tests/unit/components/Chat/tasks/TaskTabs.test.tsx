// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { TaskTabs } from '../../../../../src/components/Chat/tasks/TaskTabs';
import type { TaskBoard, TaskCard } from '../../../../../src/components/Chat/tasks/types';

const card = (o: Partial<TaskCard>): TaskCard => ({
  id: 'a', source: 'declared', title: 'Alpha', status: 'running',
  steps: [], doneCount: 0, totalCount: 0, currentLabel: null,
  startedAt: 0, endedAt: null, result: null, agent: null, messageIds: [], question: null, ...o,
});
const board = (cards: TaskCard[]): TaskBoard => ({ cards, batchStartedAt: 0, allDone: false });
const two = board([card({ id: 'a', title: 'Alpha', doneCount: 1, totalCount: 3 }), card({ id: 'b', title: 'Beta' })]);
afterEach(cleanup);

describe('TaskTabs', () => {
  it('All plus one tab per card', () => {
    render(<TaskTabs board={two} tails={new Map()} activeId={null} onSelect={() => {}} />);
    expect(screen.getAllByRole('tab').map((t) => t.textContent)).toEqual(['All', 'Alpha1/3', 'Beta']);
    expect(screen.getByRole('tab', { name: 'All' }).getAttribute('aria-selected')).toBe('true');
  });
  it('renders nothing for an empty board', () => {
    const { container } = render(<TaskTabs board={board([])} tails={new Map()} activeId={null} onSelect={() => {}} />);
    expect(container.firstChild).toBeNull();
  });
  it('selecting a tab calls onSelect with its id; All calls onSelect(null)', () => {
    const onSelect = vi.fn();
    render(<TaskTabs board={two} tails={new Map()} activeId="a" onSelect={onSelect} />);
    fireEvent.click(screen.getByRole('tab', { name: /Beta/ }));
    expect(onSelect).toHaveBeenLastCalledWith('b');
    fireEvent.click(screen.getByRole('tab', { name: 'All' }));
    expect(onSelect).toHaveBeenLastCalledWith(null);
  });
  it('active tab shows step pills and tail', () => {
    const b = board([card({ id: 'a', steps: [
      { label: 'Plan', state: 'done' }, { label: 'Build', state: 'current' }, { label: 'Ship', state: 'pending' },
    ] })]);
    const tails = new Map([['a', Array.from({ length: 6 }, (_, i) => ({ text: `line${i}`, tone: 'normal' as const }))]]);
    render(<TaskTabs board={b} tails={tails} activeId="a" onSelect={() => {}} />);
    expect(screen.getByText('Plan')).toBeTruthy();
    expect(screen.getByText('Build').className).toContain('pill--current');
    expect(screen.getByText('Ship').className).toContain('pill--pending');
    expect(screen.queryByText('line1')).toBeNull();
    expect(screen.getByText('line2')).toBeTruthy();
    expect(screen.getByText('line5')).toBeTruthy();
  });
  it('active running agent tab shows Stop that calls onStop with the card', () => {
    const agentCard = card({ id: 'g', title: 'Gamma', agent: { description: 'd', toolUseId: 'tu', taskId: 'bg1' } });
    const onStop = vi.fn();
    const { rerender } = render(<TaskTabs board={board([agentCard])} tails={new Map()} activeId="g" onSelect={() => {}} onStop={onStop} />);
    fireEvent.click(screen.getByRole('button', { name: 'Stop' }));
    expect(onStop).toHaveBeenCalledWith(agentCard);
    // No Stop for a finished card, an inline card, or without onStop.
    rerender(<TaskTabs board={board([{ ...agentCard, status: 'done' }])} tails={new Map()} activeId="g" onSelect={() => {}} onStop={onStop} />);
    expect(screen.queryByRole('button', { name: 'Stop' })).toBeNull();
    rerender(<TaskTabs board={board([card({ id: 'g' })])} tails={new Map()} activeId="g" onSelect={() => {}} onStop={onStop} />);
    expect(screen.queryByRole('button', { name: 'Stop' })).toBeNull();
    rerender(<TaskTabs board={board([agentCard])} tails={new Map()} activeId="g" onSelect={() => {}} />);
    expect(screen.queryByRole('button', { name: 'Stop' })).toBeNull();
  });
});
