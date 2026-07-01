import { describe, it, expect, vi } from 'vitest';
import { sweepIdleScopes } from '@electron/services/idleScopeSweep';

const base = { workspaceId: 'w', scope: 'chat', lastActivityAt: 0 };

describe('sweepIdleScopes', () => {
  it('reaps an idle, non-streaming scope past the threshold', () => {
    const stop = vi.fn();
    sweepIdleScopes({ now: 60_000, idleMs: 30_000, stop, scopes: [{ ...base, streaming: false }] });
    expect(stop).toHaveBeenCalledWith('w', 'chat');
  });
  it('does NOT reap a scope with a pending wakeup even when idle', () => {
    const stop = vi.fn();
    sweepIdleScopes({ now: 60_000, idleMs: 30_000, stop, scopes: [{ ...base, streaming: false, pendingWakeup: true }] });
    expect(stop).not.toHaveBeenCalled();
  });
  it('still skips streaming and awaitingInput scopes', () => {
    const stop = vi.fn();
    sweepIdleScopes({ now: 60_000, idleMs: 30_000, stop, scopes: [
      { ...base, streaming: true },
      { ...base, streaming: false, awaitingInput: true },
    ]});
    expect(stop).not.toHaveBeenCalled();
  });
});
