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

  describe('background task toggle', () => {
    const bg = { kind: 'background' as const, resumeInSeconds: null, taskCount: 4 };
    it('live count overrides snapshot', () => {
      render(<WaitingIndicator wait={bg} startedAtMs={Date.now()} onCancel={() => {}} liveTaskCount={2} onToggleTasks={() => {}} />);
      expect(screen.getByText('2 tasks running')).toBeTruthy();
      expect(screen.queryByText('4 tasks running')).toBeNull();
    });
    it('clickable with tasks', () => {
      const onToggle = vi.fn();
      const { rerender } = render(<WaitingIndicator wait={bg} startedAtMs={Date.now()} onCancel={() => {}} liveTaskCount={2} onToggleTasks={onToggle} tasksOpen={false} />);
      const toggle = screen.getByRole('button', { name: /background work/i });
      expect(toggle.getAttribute('aria-expanded')).toBe('false');
      expect(toggle.textContent).toContain('▸');
      fireEvent.click(toggle);
      expect(onToggle).toHaveBeenCalledTimes(1);
      rerender(<WaitingIndicator wait={bg} startedAtMs={Date.now()} onCancel={() => {}} liveTaskCount={2} onToggleTasks={onToggle} tasksOpen />);
      const open = screen.getByRole('button', { name: /background work/i });
      expect(open.getAttribute('aria-expanded')).toBe('true');
      expect(open.textContent).toContain('◂');
    });
    it('Cancel does not toggle', () => {
      const onToggle = vi.fn();
      const onCancel = vi.fn();
      render(<WaitingIndicator wait={bg} startedAtMs={Date.now()} onCancel={onCancel} onToggleTasks={onToggle} />);
      fireEvent.click(screen.getByRole('button', { name: /cancel/i }));
      expect(onCancel).toHaveBeenCalledTimes(1);
      expect(onToggle).not.toHaveBeenCalled();
    });
    it('no tasks → not clickable', () => {
      const { container } = render(<WaitingIndicator wait={bg} startedAtMs={Date.now()} onCancel={() => {}} liveTaskCount={2} />);
      expect(screen.queryByRole('button', { name: /background work/i })).toBeNull();
      expect(container.textContent).not.toMatch(/[▸◂]/);
      expect(screen.getByText('4 tasks running')).toBeTruthy();
    });
  });
});
