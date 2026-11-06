import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, act, within } from '@testing-library/react';
import BackgroundTasksSidebar from '@/components/Chat/BackgroundTasksSidebar';
import { DONE_HOLD_MS } from '@/components/Chat/backgroundTaskView';
import type { BackgroundTaskDetail } from '../../electron/services/claudeBackend/backgroundTasks';

const NOW = 1_000_000;
const task = (over: Partial<BackgroundTaskDetail>): BackgroundTaskDetail => ({
  id: 'a', description: 'Research auth', kind: 'Explore', isShell: false, isAgent: true, status: 'running',
  startedAt: NOW - 5000, endedAt: null, lastEventAt: NOW - 1000, totalTokens: 18400, toolUses: 3,
  lastToolName: 'Grep', summary: null, error: null, ...over,
});

const card = (id: string) => document.querySelector(`[data-task-id="${id}"]`) as HTMLElement;
const finishedSection = () => document.querySelector('[data-section="finished"]') as HTMLElement | null;

describe('BackgroundTasksSidebar', () => {
  beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(NOW); });
  afterEach(() => { vi.useRealTimers(); });

  const three = () => [
    task({ id: 'a' }),
    task({ id: 'b', description: 'npm run dev', kind: 'shell', isShell: true, isAgent: false }),
    task({ id: 'c', description: 'Old one', status: 'completed', endedAt: NOW - 100, summary: 'Done it' }),
  ];

  it('header shows counts', () => {
    render(<BackgroundTasksSidebar tasks={three()} onClose={() => {}} onStopTask={async () => true} />);
    expect(screen.getByText('Background work')).toBeTruthy();
    expect(screen.getByText('2 running · 1 done')).toBeTruthy();
  });

  it('running cards have Stop, finished do not', () => {
    render(<BackgroundTasksSidebar tasks={three()} onClose={() => {}} onStopTask={async () => true} />);
    expect(within(card('a')).getByText('Research auth')).toBeTruthy();
    expect(within(card('a')).getByText('Explore')).toBeTruthy();
    expect(within(card('a')).getByRole('button', { name: /stop/i })).toBeTruthy();
    expect(within(card('b')).getByText('shell')).toBeTruthy();
    expect(within(card('c')).queryByRole('button', { name: /stop/i })).toBeNull();
    expect(within(finishedSection()!).getByText('Old one')).toBeTruthy();
  });

  it('Stop shows Stopping… and disables', async () => {
    const onStop = vi.fn(() => new Promise<boolean>(() => {}));
    render(<BackgroundTasksSidebar tasks={three()} onClose={() => {}} onStopTask={onStop} />);
    fireEvent.click(within(card('a')).getByRole('button', { name: /stop/i }));
    expect(onStop).toHaveBeenCalledWith('a');
    const btn = within(card('a')).getByRole('button', { name: /stopping/i }) as HTMLButtonElement;
    expect(btn.disabled).toBe(true);
  });

  it('Stop that fails reverts', async () => {
    render(<BackgroundTasksSidebar tasks={three()} onClose={() => {}} onStopTask={async () => false} />);
    await act(async () => { fireEvent.click(within(card('a')).getByRole('button', { name: /stop/i })); });
    const btn = within(card('a')).getByRole('button', { name: /^stop$/i });
    expect(btn.getAttribute('title')).toBe("Couldn't stop this task");
  });

  it('done state holds in place, then moves to Finished', () => {
    const tasks = three();
    const { rerender } = render(<BackgroundTasksSidebar tasks={tasks} onClose={() => {}} onStopTask={async () => true} />);
    const done = tasks.map((t) => (t.id === 'a' ? { ...t, status: 'completed' as const, endedAt: NOW } : t));
    rerender(<BackgroundTasksSidebar tasks={done} onClose={() => {}} onStopTask={async () => true} />);
    expect(card('a').getAttribute('data-state')).toBe('done');
    expect(finishedSection()!.contains(card('a'))).toBe(false);
    act(() => { vi.advanceTimersByTime(DONE_HOLD_MS); });
    expect(finishedSection()!.contains(card('a'))).toBe(true);
    expect(document.querySelectorAll('[data-task-id="a"]')).toHaveLength(1);
  });

  it('stuck agent is flagged', () => {
    render(<BackgroundTasksSidebar tasks={[task({ id: 'a', lastEventAt: NOW - 120_000 })]} onClose={() => {}} onStopTask={async () => true} />);
    expect(card('a').getAttribute('data-stuck')).toBe('true');
    expect(within(card('a')).getByText(/may be stuck/)).toBeTruthy();
  });

  it('× calls onClose', () => {
    const onClose = vi.fn();
    render(<BackgroundTasksSidebar tasks={three()} onClose={onClose} onStopTask={async () => true} />);
    fireEvent.click(screen.getByRole('button', { name: /close/i }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
