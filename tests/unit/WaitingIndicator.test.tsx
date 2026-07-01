// tests/unit/WaitingIndicator.test.tsx
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import WaitingIndicator from '@/components/Chat/WaitingIndicator';

describe('WaitingIndicator', () => {
  it('scheduled: shows "Waiting to resume" + a countdown and fires onCancel', () => {
    const onCancel = vi.fn();
    // startedAtMs far in the past-ish but resume 90s out -> live MM:SS
    render(<WaitingIndicator wait={{ kind: 'scheduled', resumeInSeconds: 90, taskCount: null }} startedAtMs={Date.now()} onCancel={onCancel} />);
    expect(screen.getByText('Waiting to resume')).toBeTruthy();
    expect(screen.getByText(/^\d{2}:\d{2}$|^~\d+m$/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /cancel/i }));
    expect(onCancel).toHaveBeenCalledTimes(1);
  });
  it('background: shows "Waiting on background work" and no countdown pill', () => {
    render(<WaitingIndicator wait={{ kind: 'background', resumeInSeconds: null, taskCount: 2 }} startedAtMs={Date.now()} onCancel={() => {}} />);
    expect(screen.getByText('Waiting on background work')).toBeTruthy();
    expect(screen.queryByText(/^\d{2}:\d{2}$/)).toBeNull();
  });
  it('renders nothing for kind none', () => {
    const { container } = render(<WaitingIndicator wait={{ kind: 'none', resumeInSeconds: null, taskCount: null }} startedAtMs={Date.now()} onCancel={() => {}} />);
    expect(container.firstChild).toBeNull();
  });
});
