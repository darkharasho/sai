import { describe, it, expect } from 'vitest';
import { formatCountdown, formatWakeTime, formatElapsed } from '@/components/Chat/formatCountdown';

describe('formatCountdown', () => {
  it('live MM:SS under an hour', () => {
    expect(formatCountdown(1720)).toBe('28:40');
    expect(formatCountdown(120)).toBe('02:00');
    expect(formatCountdown(119)).toBe('01:59');
    expect(formatCountdown(72)).toBe('01:12');
    expect(formatCountdown(5)).toBe('00:05');
  });
  it('live H:MM:SS at an hour or more', () => {
    expect(formatCountdown(3600)).toBe('1:00:00');
    expect(formatCountdown(4930)).toBe('1:22:10');
  });
  it('zero or negative shows resuming', () => {
    expect(formatCountdown(0)).toBe('resuming…');
    expect(formatCountdown(-4)).toBe('resuming…');
  });
});

describe('formatWakeTime', () => {
  it('renders a 12-hour resume time from now + remaining', () => {
    const now = new Date('2026-06-30T15:39:00').getTime();
    expect(formatWakeTime(now, 252)).toBe('resumes 3:43pm'); // +4m12s -> 15:43
  });
  it('handles midnight rollover to 12-hour am', () => {
    const now = new Date('2026-06-30T23:59:00').getTime();
    expect(formatWakeTime(now, 120)).toBe('resumes 12:01am');
  });
});

describe('formatElapsed', () => {
  // A background wait has no countdown — the pill showed only "Waiting on
  // background work", which is indistinguishable from a hang. Elapsed time
  // makes a stuck wait visible even if one ever slips past the backstop.
  it('counts seconds under a minute', () => {
    expect(formatElapsed(0)).toBe('0s');
    expect(formatElapsed(45)).toBe('45s');
  });
  it('switches to m:ss at a minute', () => {
    expect(formatElapsed(60)).toBe('1m 00s');
    expect(formatElapsed(125)).toBe('2m 05s');
  });
  it('switches to h:mm at an hour', () => {
    expect(formatElapsed(3600)).toBe('1h 00m');
    expect(formatElapsed(7860)).toBe('2h 11m');
  });
  it('clamps negatives (clock skew) to zero', () => {
    expect(formatElapsed(-5)).toBe('0s');
  });
});
