// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import SwarmSidebar from '@/components/Swarm/SwarmSidebar';

const tasks = [{
  id: 't1', title: 'refactor auth', status: 'streaming',
  lastActivityAt: 1, toolCallCount: 14, hasApproval: false,
}, {
  id: 't2', title: 'migrate users', status: 'awaiting_approval',
  lastActivityAt: 2, toolCallCount: 3, hasApproval: true,
}];

describe('SwarmSidebar', () => {
  it('renders Overview row + tasks, fires onSelect', () => {
    const onSelect = vi.fn();
    render(
      <SwarmSidebar
        tasks={tasks as any}
        selectedId="overview"
        onSelect={onSelect}
        onNewTask={() => {}}
      />
    );
    expect(screen.getByText(/swarm overview/i)).toBeInTheDocument();
    expect(screen.getByText('refactor auth')).toBeInTheDocument();
    fireEvent.click(screen.getByText('migrate users'));
    expect(onSelect).toHaveBeenCalledWith('t2');
  });

  it('renders a discard button per task and fires onDiscard with the task', () => {
    const onSelect = vi.fn();
    const onDiscard = vi.fn();
    render(
      <SwarmSidebar
        tasks={tasks as any}
        selectedId="overview"
        onSelect={onSelect}
        onNewTask={() => {}}
        onDiscard={onDiscard}
      />
    );
    const btn = screen.getByLabelText('Discard refactor auth');
    fireEvent.click(btn);
    expect(onDiscard).toHaveBeenCalledTimes(1);
    expect(onDiscard.mock.calls[0][0]).toMatchObject({ id: 't1', title: 'refactor auth' });
    // Clicking discard must not trigger row selection.
    expect(onSelect).not.toHaveBeenCalled();
  });

  it('omits the discard button when onDiscard is not provided', () => {
    render(
      <SwarmSidebar
        tasks={tasks as any}
        selectedId="overview"
        onSelect={() => {}}
        onNewTask={() => {}}
      />
    );
    expect(screen.queryByLabelText('Discard refactor auth')).toBeNull();
  });

  it('marks rows whose id is in streamingTaskIds with the pulsing indicator', () => {
    const { container } = render(
      <SwarmSidebar
        tasks={tasks as any}
        selectedId="overview"
        onSelect={() => {}}
        onNewTask={() => {}}
        streamingTaskIds={new Set(['t1'])}
      />
    );
    const liveRows = container.querySelectorAll('.swarm-row[data-streaming="true"]');
    expect(liveRows.length).toBe(1);
    expect(container.querySelectorAll('.swarm-row .row-icon.pulsing').length).toBe(1);
  });

  it('renders no pulsing indicator when streamingTaskIds is empty / omitted', () => {
    const { container, rerender } = render(
      <SwarmSidebar
        tasks={tasks as any}
        selectedId="overview"
        onSelect={() => {}}
        onNewTask={() => {}}
        streamingTaskIds={new Set()}
      />
    );
    expect(container.querySelectorAll('.swarm-row[data-streaming="true"]').length).toBe(0);
    expect(container.querySelectorAll('.swarm-row .row-icon.pulsing').length).toBe(0);
    rerender(
      <SwarmSidebar
        tasks={tasks as any}
        selectedId="overview"
        onSelect={() => {}}
        onNewTask={() => {}}
      />
    );
    expect(container.querySelectorAll('.swarm-row[data-streaming="true"]').length).toBe(0);
  });
});
