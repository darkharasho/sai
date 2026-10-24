import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, act } from '@testing-library/react';
import LoadGuardPill from '../../../../src/components/Chat/LoadGuardPill';

const base: any = {
  level: 'normal', paused: false, override: false, saiCaused: false, saiAppHeavy: false,
  memUsedPct: 84, swapUsedPct: 0, game: null, recoveredAt: null, enabled: true,
};

afterEach(() => vi.useRealTimers());

describe('LoadGuardPill', () => {
  it('warning shows RAM pct', () => {
    render(<LoadGuardPill state={{ ...base, level: 'warning' }} />);
    expect(screen.getByRole('status').textContent).toBe('RAM 84%');
  });
  it('warning with game', () => {
    render(<LoadGuardPill state={{ ...base, level: 'warning', game: { name: 'x', sizeKb: 1 } }} />);
    expect(screen.getByRole('status').textContent).toBe('RAM 84% · game running');
  });
  it('critical paused', () => {
    render(<LoadGuardPill state={{ ...base, level: 'critical', paused: true }} />);
    expect(screen.getByRole('status').textContent).toBe('Paused · critical load');
  });
  it('critical paused wins over override', () => {
    render(<LoadGuardPill state={{ ...base, level: 'critical', paused: true, override: true }} />);
    expect(screen.getByRole('status').textContent).toBe('Paused · critical load');
  });
  it('critical override', () => {
    render(<LoadGuardPill state={{ ...base, level: 'critical', override: true }} />);
    expect(screen.getByRole('status').textContent).toBe('Critical load · resumed manually');
  });
  it('recovered, then hides when the 60s window expires without a new broadcast', () => {
    vi.useFakeTimers();
    render(<LoadGuardPill state={{ ...base, recoveredAt: Date.now() - 10_000 }} />);
    expect(screen.getByRole('status').textContent).toBe('Recovered');
    act(() => { vi.advanceTimersByTime(51_000); });
    expect(screen.queryByRole('status')).toBeNull();
  });
  it('hidden when normal with no or old recovery', () => {
    const { container, rerender } = render(<LoadGuardPill state={base} />);
    expect(container.querySelector('.load-guard-pill')).toBeNull();
    rerender(<LoadGuardPill state={{ ...base, recoveredAt: Date.now() - 120_000 }} />);
    expect(container.querySelector('.load-guard-pill')).toBeNull();
  });
});
