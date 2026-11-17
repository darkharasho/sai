import { describe, it, expect } from 'vitest';
import {
  FOLLOWUP_HOLD_CAP_MS,
  FOLLOWUP_RESUME_GRACE_MS,
  deriveFollowUpState,
  nextFollowUpDeadline,
  type FollowUpInput,
} from '../../electron/services/followupState';

const NOW = 1_700_000_000_000;

function input(over: Partial<FollowUpInput> = {}): FollowUpInput {
  return {
    verdict: { followUp: true, waitingFor: 'background build' },
    wakeSourceAlive: false,
    queryAlive: true,
    now: NOW,
    followingSince: null,
    drainedAt: null,
    ...over,
  };
}

describe('deriveFollowUpState', () => {
  it('returns none when there is no verdict', () => {
    expect(deriveFollowUpState(input({ verdict: null, wakeSourceAlive: true }))).toBe('none');
  });

  it('returns none when the verdict says no follow-up, even with a wake source alive', () => {
    expect(
      deriveFollowUpState(
        input({ verdict: { followUp: false, waitingFor: null }, wakeSourceAlive: true }),
      ),
    ).toBe('none');
  });

  it('returns stalled when the query is no longer alive', () => {
    expect(deriveFollowUpState(input({ queryAlive: false, wakeSourceAlive: true }))).toBe(
      'stalled',
    );
  });

  it('returns stalled when the hold cap is reached, even if a wake source is alive', () => {
    expect(
      deriveFollowUpState(
        input({
          wakeSourceAlive: true,
          followingSince: NOW - FOLLOWUP_HOLD_CAP_MS,
        }),
      ),
    ).toBe('stalled');
  });

  it('returns following when a wake source is alive', () => {
    expect(deriveFollowUpState(input({ wakeSourceAlive: true, followingSince: NOW - 1000 }))).toBe(
      'following',
    );
  });

  it('returns resuming when no wake source is alive but drained recently', () => {
    expect(deriveFollowUpState(input({ wakeSourceAlive: false, drainedAt: NOW - 1000 }))).toBe(
      'resuming',
    );
  });

  it('returns stalled once the resume grace window has elapsed', () => {
    expect(
      deriveFollowUpState(input({ wakeSourceAlive: false, drainedAt: NOW - FOLLOWUP_RESUME_GRACE_MS })),
    ).toBe('stalled');
  });

  it('returns stalled when no wake source is alive and drainedAt is null', () => {
    expect(deriveFollowUpState(input({ wakeSourceAlive: false, drainedAt: null }))).toBe('stalled');
  });
});

describe('nextFollowUpDeadline', () => {
  it('returns drainedAt plus the resume grace while resuming', () => {
    const drainedAt = NOW - 1000;
    expect(nextFollowUpDeadline(input({ wakeSourceAlive: false, drainedAt }))).toBe(
      drainedAt + FOLLOWUP_RESUME_GRACE_MS,
    );
  });

  it('returns followingSince plus the hold cap while following', () => {
    const followingSince = NOW - 1000;
    expect(
      nextFollowUpDeadline(input({ wakeSourceAlive: true, followingSince })),
    ).toBe(followingSince + FOLLOWUP_HOLD_CAP_MS);
  });

  it('returns null when none', () => {
    expect(nextFollowUpDeadline(input({ verdict: null }))).toBeNull();
  });

  it('returns null when stalled', () => {
    expect(nextFollowUpDeadline(input({ queryAlive: false }))).toBeNull();
  });
});
