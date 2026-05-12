// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import SwarmTaskHeader from '@/components/Swarm/SwarmTaskHeader';

const t = {
  id: 't', title: 'refactor auth', branch: 'swarm/refactor-auth-abc',
  worktreePath: '/p/../sai-swarm/p/t', status: 'streaming',
  provider: 'claude', model: 'opus',
} as any;

describe('SwarmTaskHeader', () => {
  it('renders branch and reacts to pause/discard/land buttons', () => {
    const onPause = vi.fn(); const onDiscard = vi.fn(); const onLand = vi.fn();
    render(<SwarmTaskHeader task={t} onPause={onPause} onDiscard={onDiscard} onLand={onLand} onOpenDiff={() => {}} />);
    expect(screen.getByText(/swarm\/refactor-auth-abc/)).toBeInTheDocument();
    fireEvent.click(screen.getByLabelText(/pause/i));
    expect(onPause).toHaveBeenCalled();
  });
  it('disables Land unless status is done', () => {
    render(<SwarmTaskHeader task={t} onPause={() => {}} onDiscard={() => {}} onLand={() => {}} onOpenDiff={() => {}} />);
    expect(screen.getByRole('button', { name: /land/i })).toBeDisabled();
  });
});
