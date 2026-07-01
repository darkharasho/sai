import { describe, it, expect } from 'vitest';
import { formatCountdown, formatWakeTime } from '@/components/Chat/formatCountdown';

describe('formatCountdown', () => {
  it('coarse minutes when >= 2 min out', () => {
    expect(formatCountdown(1720)).toBe('~29m');
    expect(formatCountdown(120)).toBe('~2m');
  });
  it('live MM:SS under 2 min', () => {
    expect(formatCountdown(119)).toBe('01:59');
    expect(formatCountdown(72)).toBe('01:12');
    expect(formatCountdown(5)).toBe('00:05');
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
