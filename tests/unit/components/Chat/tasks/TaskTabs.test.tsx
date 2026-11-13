// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { TaskTabs } from '../../../../../src/components/Chat/tasks/TaskTabs';
import type { TaskBoard, TaskCard } from '../../../../../src/components/Chat/tasks/types';

const card = (o: Partial<TaskCard>): TaskCard => ({
  id: 'a', source: 'declared', title: 'Alpha', tag: '0:a', status: 'running', now: null,
  startedAt: 0, endedAt: null, result: null, agent: null, messageIds: [], question: null, ...o,
});
const board = (cards: TaskCard[]): TaskBoard => ({ cards, batchStartedAt: 0, allDone: false });
const doneBoard = (over: Partial<TaskBoard> = {}): TaskBoard => ({
  cards: [
    card({ id: 'a', title: 'Alpha', status: 'done', endedAt: 60_000 }),
    card({ id: 'b', title: 'Beta', status: 'done', endedAt: 80_000 }),
  ],
  batchStartedAt: 0, allDone: true, ...over,
});
const two = board([card({ id: 'a', title: 'Alpha' }), card({ id: 'b', title: 'Beta' })]);
afterEach(cleanup);

describe('TaskTabs', () => {
  it('All plus one tab per card', () => {
    render(<TaskTabs board={two} activeId={null} onSelect={() => {}} />);
    expect(screen.getAllByRole('tab').map((t) => t.textContent)).toEqual(['All', 'Alpha', 'Beta']);
    expect(screen.getByRole('tab', { name: 'All' }).getAttribute('aria-selected')).toBe('true');
  });
  it('renders nothing for an empty board', () => {
    const { container } = render(<TaskTabs board={board([])} activeId={null} onSelect={() => {}} />);
    expect(container.firstChild).toBeNull();
  });
  it('selecting a tab calls onSelect with its id; All calls onSelect(null)', () => {
    const onSelect = vi.fn();
    render(<TaskTabs board={two} activeId="a" onSelect={onSelect} />);
    fireEvent.click(screen.getByRole('tab', { name: /Beta/ }));
    expect(onSelect).toHaveBeenLastCalledWith('b');
    fireEvent.click(screen.getByRole('tab', { name: 'All' }));
    expect(onSelect).toHaveBeenLastCalledWith(null);
  });
  it('shows the now label and no progress', () => {
    const b = board([card({ id: 'a', now: '$ npx vitest run…' })]);
    const { container } = render(<TaskTabs board={b} activeId={null} onSelect={() => {}} />);
    const now = screen.getByText('$ npx vitest run…');
    expect(now.className).toBe('task-tabs__now');
    expect(container.textContent).not.toMatch(/\d+\/\d+/);
    expect(container.querySelector('.task-tabs__underline')).toBeNull();
  });
  // The tabs are a bare row: Stop belongs to the feed view so the tabs fit
  // inside the host's Chat bar (see TaskFeedView tests).
  it('renders no Stop of its own', () => {
    const b = board([card({ id: 'a', agent: { description: 'd', toolUseId: 'tu', taskId: 'bg1' } })]);
    render(<TaskTabs board={b} activeId="a" onSelect={() => {}} />);
    expect(screen.queryByRole('button', { name: 'Stop' })).toBeNull();
  });

  it('a finished batch collapses to a summary line, and expands again on click', () => {
    render(<TaskTabs board={doneBoard()} activeId={null} onSelect={() => {}} />);
    expect(screen.queryByRole('tab')).toBeNull();
    const summary = screen.getByText('2 tasks done · 1m 20s');
    fireEvent.click(summary);
    expect(screen.getAllByRole('tab').map((t) => t.textContent)).toEqual(['All', 'Alpha', 'Beta']);
  });

  it('summary counts failures', () => {
    const b = doneBoard();
    b.cards[1] = card({ id: 'b', title: 'Beta', status: 'failed', endedAt: 80_000 });
    render(<TaskTabs board={b} activeId={null} onSelect={() => {}} />);
    expect(screen.getByText('1 done · 1 failed · 1m 20s')).toBeTruthy();
  });

  it('dismiss hides the strip until a new batch starts', () => {
    const { rerender } = render(<TaskTabs board={doneBoard()} activeId={null} onSelect={() => {}} />);
    fireEvent.click(screen.getByRole('button', { name: 'Dismiss finished tasks' }));
    expect(screen.queryByText(/tasks done/)).toBeNull();
    expect(screen.queryByRole('tab')).toBeNull();
    // same batch re-rendered: still dismissed
    rerender(<TaskTabs board={doneBoard()} activeId={null} onSelect={() => {}} />);
    expect(screen.queryByRole('tab')).toBeNull();
    // a new batch brings the tabs back
    rerender(<TaskTabs board={{ ...board([card({ id: 'c', title: 'Gamma' })]), batchStartedAt: 99 }} activeId={null} onSelect={() => {}} />);
    expect(screen.getAllByRole('tab').map((t) => t.textContent)).toEqual(['All', 'Gamma']);
  });

  it('does not collapse out from under an open tab, and the collapse control closes it', () => {
    const onSelect = vi.fn();
    const { rerender } = render(<TaskTabs board={doneBoard()} activeId="a" onSelect={onSelect} />);
    expect(screen.getAllByRole('tab')).toHaveLength(3);
    fireEvent.click(screen.getByRole('button', { name: 'Collapse finished tasks' }));
    expect(onSelect).toHaveBeenCalledWith(null);
    rerender(<TaskTabs board={doneBoard()} activeId={null} onSelect={onSelect} />);
    expect(screen.queryByRole('tab')).toBeNull();
    expect(screen.getByText('2 tasks done · 1m 20s')).toBeTruthy();
  });

  it('an unfinished board never collapses', () => {
    render(<TaskTabs board={two} activeId={null} onSelect={() => {}} />);
    expect(screen.getAllByRole('tab')).toHaveLength(3);
    expect(screen.queryByRole('button', { name: 'Collapse finished tasks' })).toBeNull();
  });
});
