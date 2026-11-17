/**
 * Pure follow-up state derivation for the "will the AI pick back up?" indicator.
 * No I/O, no dependencies: callers feed in the latest judge verdict and runtime
 * facts, and get back the indicator state plus the next time it could change.
 */

export interface FollowUpVerdict {
  followUp: boolean;
  waitingFor: string | null;
}

export type FollowUpState = 'none' | 'following' | 'resuming' | 'stalled';

export const FOLLOWUP_RESUME_GRACE_MS = 120_000;
export const FOLLOWUP_HOLD_CAP_MS = 2 * 60 * 60_000;

export interface FollowUpInput {
  verdict: FollowUpVerdict | null;
  wakeSourceAlive: boolean;
  queryAlive: boolean;
  now: number;
  /** epoch ms when ⟳ first began for this turn, or null */
  followingSince: number | null;
  /** epoch ms when the wake sources last went to zero (or the pin was alive with no task at verdict time), or null */
  drainedAt: number | null;
}

function holdCapReached(i: FollowUpInput): boolean {
  return i.followingSince !== null && i.now - i.followingSince >= FOLLOWUP_HOLD_CAP_MS;
}

function inResumeGrace(i: FollowUpInput): boolean {
  return i.drainedAt !== null && i.now - i.drainedAt < FOLLOWUP_RESUME_GRACE_MS;
}

export function deriveFollowUpState(i: FollowUpInput): FollowUpState {
  if (!i.verdict || !i.verdict.followUp) return 'none';
  if (!i.queryAlive) return 'stalled';
  if (holdCapReached(i)) return 'stalled';
  if (i.wakeSourceAlive) return 'following';
  if (inResumeGrace(i)) return 'resuming';
  return 'stalled';
}

/** Next epoch ms at which deriveFollowUpState could change with no new event, or null. */
export function nextFollowUpDeadline(i: FollowUpInput): number | null {
  const state = deriveFollowUpState(i);
  if (state === 'resuming') return (i.drainedAt as number) + FOLLOWUP_RESUME_GRACE_MS;
  if (state === 'following' && i.followingSince !== null) {
    return i.followingSince + FOLLOWUP_HOLD_CAP_MS;
  }
  return null;
}
