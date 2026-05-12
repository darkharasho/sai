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
});
