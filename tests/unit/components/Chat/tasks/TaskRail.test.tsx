// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { TaskRail } from '../../../../../src/components/Chat/tasks/TaskRail';
import type { TaskBoard, TaskCard } from '../../../../../src/components/Chat/tasks/types';

const card = (o: Partial<TaskCard>): TaskCard => ({
  id: 'a', source: 'declared', title: 'Alpha', status: 'running',
  steps: [], doneCount: 0, totalCount: 0, currentLabel: null,
  startedAt: 0, endedAt: null, result: null, agent: null, messageIds: [], question: null, ...o,
});
const board = (cards: TaskCard[], extra: Partial<TaskBoard> = {}): TaskBoard =>
  ({ cards, batchStartedAt: 0, allDone: false, ...extra });
const noop = () => {};
const props = (b: TaskBoard, o: any = {}) => ({
  board: b, tails: new Map(), selectedId: null,
  onSelect: noop, onOpenStream: noop, onStop: noop, onAnswer: noop, onReply: noop, ...o,
});

afterEach(() => { cleanup(); vi.useRealTimers(); });

describe('TaskRail', () => {
  it('renders one card per task with n/m and current step', () => {
    vi.useFakeTimers(); vi.setSystemTime(65_000);
    const b = board([
      card({ id: 'a', title: 'Alpha', doneCount: 3, totalCount: 5, currentLabel: 'Running tests' }),
      card({ id: 'b', title: 'Beta', status: 'queued', startedAt: null }),
    ]);
    render(<TaskRail {...props(b)} />);
    expect(screen.getByText('Alpha')).toBeTruthy();
    expect(screen.getByText('Beta')).toBeTruthy();
    expect(screen.getByText(/3\/5/)).toBeTruthy();
    expect(screen.getByText('Running tests')).toBeTruthy();
    expect(screen.getByText('0 of 2 done')).toBeTruthy();
  });

  it('only the selected card shows steps and Open stream', () => {
    const steps = [{ label: 'S1', state: 'done' as const }, { label: 'S2', state: 'current' as const }];
    const b = board([card({ id: 'a', steps }), card({ id: 'b', title: 'Beta', steps })]);
    render(<TaskRail {...props(b, { selectedId: 'a' })} />);
    expect(screen.getAllByText('S1')).toHaveLength(1);
    expect(screen.getAllByText(/Open stream/)).toHaveLength(1);
  });

  it('waiting card shows question and option buttons that call onAnswer', () => {
    const onAnswer = vi.fn(); const onReply = vi.fn();
    const b = board([card({ status: 'waiting', question: { text: 'Which?', options: ['Providers', 'MCP'] } })]);
    render(<TaskRail {...props(b, { onAnswer, onReply })} />);
    expect(screen.getByText('Which?')).toBeTruthy();
    expect(screen.getByText('Waiting on you')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'MCP' }));
    expect(onAnswer).toHaveBeenCalledWith('MCP');
    fireEvent.click(screen.getByRole('button', { name: 'Reply…' }));
    expect(onReply).toHaveBeenCalled();
  });

  it('Stop only for running agent-backed cards', () => {
    const agent = { description: 'd', toolUseId: 't', taskId: 'x' };
    const onStop = vi.fn();
    const mk = (o: Partial<TaskCard>) => board([card({ id: 'a', ...o })]);
    const { rerender } = render(<TaskRail {...props(mk({ agent }), { selectedId: 'a', onStop })} />);
    fireEvent.click(screen.getByRole('button', { name: 'Stop' }));
    expect(onStop).toHaveBeenCalledTimes(1);
    rerender(<TaskRail {...props(mk({ agent: { ...agent, taskId: null } }), { selectedId: 'a' })} />);
    expect(screen.queryByRole('button', { name: 'Stop' })).toBeNull();
    rerender(<TaskRail {...props(mk({ agent, status: 'done' }), { selectedId: 'a' })} />);
    expect(screen.queryByRole('button', { name: 'Stop' })).toBeNull();
    rerender(<TaskRail {...props(mk({ agent: null }), { selectedId: 'a' })} />);
    expect(screen.queryByRole('button', { name: 'Stop' })).toBeNull();
  });

  it('collapses to a summary when all done and expands on click', () => {
    const b = board([
      card({ id: 'a', status: 'done', startedAt: 0, endedAt: 60_000, result: 'ok' }),
      card({ id: 'b', title: 'Beta', status: 'done', startedAt: 0, endedAt: 125_000 }),
    ], { allDone: true, batchStartedAt: 0 });
    render(<TaskRail {...props(b)} />);
    expect(screen.queryByText('Alpha')).toBeNull();
    const row = screen.getByText('2 tasks done · 2m 5s');
    fireEvent.click(row);
    expect(screen.getByText('Alpha')).toBeTruthy();
    fireEvent.click(screen.getByText('2 tasks done · 2m 5s'));
    expect(screen.queryByText('Alpha')).toBeNull();
  });

  it('collapses again when batchStartedAt changes', () => {
    const mk = (start: number) => board([card({ status: 'done', endedAt: 5000 })], { allDone: true, batchStartedAt: start });
    const { rerender } = render(<TaskRail {...props(mk(0))} />);
    fireEvent.click(screen.getByText(/1 task done/));
    expect(screen.getByText('Alpha')).toBeTruthy();
    rerender(<TaskRail {...props(mk(1000))} />);
    expect(screen.queryByText('Alpha')).toBeNull();
  });

  it('renders nothing for an empty board', () => {
    const { container } = render(<TaskRail {...props(board([]))} />);
    expect(container.firstChild).toBeNull();
  });

  it('summary counts failed cards and a failed card shows its reason', () => {
    const b = board([
      card({ id: 'a', status: 'done', endedAt: 60_000 }),
      card({ id: 'b', title: 'Beta', status: 'done', endedAt: 60_000 }),
      card({ id: 'c', title: 'Gamma', status: 'failed', endedAt: 125_000, result: 'tests broke' }),
    ], { allDone: true });
    render(<TaskRail {...props(b)} />);
    fireEvent.click(screen.getByText('2 done · 1 failed · 2m 5s'));
    expect(screen.getByText('Failed: tests broke')).toBeTruthy();
  });
});
