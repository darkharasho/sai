// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import RecentActivity from '../../src/components/Swarm/RecentActivity';

const items = [
  { id: 't1', title: 'shipped feature', status: 'landed' as const, lastActivityAt: 1000 },
  { id: 't2', title: 'aborted work', status: 'discarded' as const, lastActivityAt: 900 },
  { id: 't3', title: 'crashed task', status: 'failed' as const, lastActivityAt: 800 },
];

describe('RecentActivity', () => {
  it('renders one row per status with timestamps', () => {
    render(<RecentActivity items={items} />);
    expect(screen.getByText(/shipped feature/)).toBeInTheDocument();
    expect(screen.getByText(/aborted work/)).toBeInTheDocument();
    expect(screen.getByText(/crashed task/)).toBeInTheDocument();
    expect(screen.getByText(/landed/i)).toBeInTheDocument();
    expect(screen.getByText(/discarded/i)).toBeInTheDocument();
    expect(screen.getByText(/failed/i)).toBeInTheDocument();
  });

  it('renders nothing when empty', () => {
    const { container } = render(<RecentActivity items={[]} />);
    expect(container.firstChild).toBeNull();
  });
});
