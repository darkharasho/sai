// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import NewTaskPopover from '@/components/Swarm/NewTaskPopover';

describe('NewTaskPopover', () => {
  it('submits prompt + provider', () => {
    const onSubmit = vi.fn();
    render(<NewTaskPopover open onClose={() => {}} onSubmit={onSubmit} defaultProvider="claude" defaultModel="opus"/>);
    fireEvent.change(screen.getByPlaceholderText(/what should this task do/i), { target: { value: 'fix lint' }});
    fireEvent.click(screen.getByText(/dispatch/i));
    expect(onSubmit).toHaveBeenCalledWith({
      prompt: 'fix lint', provider: 'claude', model: 'opus', approvalPolicy: 'auto-read',
    });
  });
});
