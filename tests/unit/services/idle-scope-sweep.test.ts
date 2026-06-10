import { describe, it, expect, vi } from 'vitest';
import { sweepIdleScopes } from '../../../electron/services/idleScopeSweep';

describe('sweepIdleScopes', () => {
  it('stops scopes idle longer than the threshold', () => {
    const now = 10_000_000;
    const stop = vi.fn();
    const scopes = [
      { workspaceId: '/a', scope: 's1', lastActivityAt: now - 31 * 60_000, streaming: false },
      { workspaceId: '/a', scope: 's2', lastActivityAt: now - 5  * 60_000, streaming: false },
      { workspaceId: '/a', scope: 's3', lastActivityAt: now - 60 * 60_000, streaming: true  },
    ];
    sweepIdleScopes({ now, idleMs: 30 * 60_000, scopes, stop });
    expect(stop).toHaveBeenCalledTimes(1);
    expect(stop).toHaveBeenCalledWith('/a', 's1');
  });

  it('does not stop an idle scope that is awaiting user input', () => {
    // A scope blocked on an AskUserQuestion / approval / plan review is not
    // abandoned — the agent is waiting on the user. Killing it makes the
    // pending question unanswerable (the answer is injected via the live
    // process stdin, which no longer exists once interrupted).
    const now = 10_000_000;
    const stop = vi.fn();
    sweepIdleScopes({
      now,
      idleMs: 30 * 60_000,
      scopes: [
        { workspaceId: '/a', scope: 'q', lastActivityAt: now - 60 * 60_000, streaming: false, awaitingInput: true },
      ],
      stop,
    });
    expect(stop).not.toHaveBeenCalled();
  });

  it('does not stop scopes within the threshold even if not streaming', () => {
    const stop = vi.fn();
    sweepIdleScopes({
      now: 100,
      idleMs: 50,
      scopes: [{ workspaceId: '/a', scope: 'fresh', lastActivityAt: 80, streaming: false }],
      stop,
    });
    expect(stop).not.toHaveBeenCalled();
  });
});
