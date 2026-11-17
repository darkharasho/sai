import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import FollowUpIndicator from '@/components/Chat/FollowUpIndicator';

describe('FollowUpIndicator', () => {
  it('following row copy with orbit and no Check now', () => {
    const { container } = render(<FollowUpIndicator state="following" waitingFor="CI" onCheckNow={() => {}} />);
    expect(screen.getByText('Waiting on CI — will pick back up automatically')).toBeTruthy();
    expect(container.querySelector('.sai-waiting-orbit')).toBeTruthy();
    expect(screen.queryByRole('button', { name: /check now/i })).toBeNull();
  });
  it('resuming row copy', () => {
    render(<FollowUpIndicator state="resuming" waitingFor="CI" onCheckNow={() => {}} />);
    expect(screen.getByText('CI: watcher finished — picking back up…')).toBeTruthy();
    expect(screen.queryByRole('button', { name: /check now/i })).toBeNull();
  });
  it('stalled row copy, Check now fires once, no spinner/shimmer', () => {
    const onCheckNow = vi.fn();
    const { container } = render(<FollowUpIndicator state="stalled" waitingFor="CI" onCheckNow={onCheckNow} />);
    expect(screen.getByText('Said it would follow up on CI, but nothing is watching')).toBeTruthy();
    expect(container.querySelector('.sai-waiting-orbit')).toBeNull();
    expect(container.querySelector('.sai-shimmer')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: /check now/i }));
    expect(onCheckNow).toHaveBeenCalledTimes(1);
  });
  it('null waitingFor falls back to "this"', () => {
    render(<FollowUpIndicator state="stalled" waitingFor={null} onCheckNow={() => {}} />);
    expect(screen.getByText('Said it would follow up on this, but nothing is watching')).toBeTruthy();
  });
});
