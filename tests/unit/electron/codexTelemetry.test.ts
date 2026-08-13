import { EventEmitter } from 'node:events';
import { describe, it, expect, vi } from 'vitest';
import {
  requestCodexRateLimits,
  CodexTelemetryService,
  type RequestCodexRateLimitsDeps,
} from '../../../electron/services/codexTelemetry';
import type { CodexRateLimitsSnapshot } from '../../../src/lib/composerTelemetry';

// ---------------------------------------------------------------------------
// Fake child process — a real EventEmitter so `.on`/`.off`/`.emit` behave like
// the actual ChildProcess/stream API the implementation removes listeners on.
// ---------------------------------------------------------------------------
function createFakeChild() {
  const proc = new EventEmitter() as EventEmitter & {
    stdin: { write: (data: string) => boolean };
    stdout: EventEmitter;
    kill: ReturnType<typeof vi.fn>;
  };
  const writes: string[] = [];
  proc.stdout = new EventEmitter();
  proc.stdin = { write: (data: string) => { writes.push(data); return true; } };
  proc.kill = vi.fn();
  return { proc, writes, stdout: proc.stdout };
}

function baseDeps(proc: unknown, overrides: RequestCodexRateLimitsDeps = {}): RequestCodexRateLimitsDeps {
  return {
    spawn: vi.fn().mockReturnValue(proc) as unknown as RequestCodexRateLimitsDeps['spawn'],
    resolveBundledCodex: vi.fn().mockReturnValue({ executablePath: '/bin/codex', pathDirs: ['/bin'] }),
    enrichedEnv: vi.fn().mockReturnValue({ PATH: '/usr/bin' }),
    now: () => 1_000,
    ...overrides,
  };
}

const emitLine = (stdout: EventEmitter, payload: unknown) => {
  stdout.emit('data', Buffer.from(`${JSON.stringify(payload)}\n`));
};

describe('requestCodexRateLimits', () => {
  it('runs the initialize/initialized/read handshake and prefers rateLimitsByLimitId.codex', async () => {
    const { proc, writes, stdout } = createFakeChild();
    const promise = requestCodexRateLimits(baseDeps(proc));

    expect(JSON.parse(writes[0])).toEqual({
      id: 0,
      method: 'initialize',
      params: { clientInfo: { name: 'sai', version: '1.0' } },
    });

    emitLine(stdout, { id: 0, result: {} });
    expect(JSON.parse(writes[1])).toEqual({ method: 'initialized' });
    expect(JSON.parse(writes[2])).toEqual({ id: 1, method: 'account/rateLimits/read' });
    expect(writes.map((line) => JSON.parse(line)).every((message) => !Object.hasOwn(message, 'jsonrpc'))).toBe(true);

    emitLine(stdout, {
      id: 1,
      result: {
        rateLimits: { primary: { usedPercent: 9, windowDurationMins: 300, resetsAt: 10 } },
        rateLimitsByLimitId: {
          codex: {
            primary: { usedPercent: 35, windowDurationMins: 300, resetsAt: 20 },
            secondary: { usedPercent: 60, windowDurationMins: 10_080, resetsAt: 30 },
          },
        },
      },
    });

    await expect(promise).resolves.toMatchObject({
      provider: 'codex',
      primary: { usedPercent: 35, windowDurationMins: 300, resetsAt: 20 },
      secondary: { usedPercent: 60, windowDurationMins: 10_080, resetsAt: 30 },
    });
    expect(proc.kill).toHaveBeenCalledOnce();
  });

  it('falls back to result.rateLimits when rateLimitsByLimitId.codex is absent', async () => {
    const { proc, stdout } = createFakeChild();
    const promise = requestCodexRateLimits(baseDeps(proc));

    emitLine(stdout, { id: 0, result: {} });
    emitLine(stdout, {
      id: 1,
      result: { rateLimits: { primary: { usedPercent: 12, windowDurationMins: 300, resetsAt: 40 } } },
    });

    await expect(promise).resolves.toMatchObject({
      primary: { usedPercent: 12, windowDurationMins: 300, resetsAt: 40 },
      secondary: null,
    });
    expect(proc.kill).toHaveBeenCalledOnce();
  });

  it('normalizes malformed or missing windows to null instead of throwing', async () => {
    const { proc, stdout } = createFakeChild();
    const promise = requestCodexRateLimits(baseDeps(proc));

    emitLine(stdout, { id: 0, result: {} });
    emitLine(stdout, {
      id: 1,
      result: {
        rateLimitsByLimitId: {
          codex: {
            primary: { usedPercent: 'not-a-number', windowDurationMins: 300, resetsAt: 20 },
            secondary: null,
          },
        },
      },
    });

    await expect(promise).resolves.toMatchObject({ provider: 'codex', primary: null, secondary: null });
    expect(proc.kill).toHaveBeenCalledOnce();
  });

  it('rejects with a generic message and kills the process on initialize failure', async () => {
    const { proc, stdout } = createFakeChild();
    const promise = requestCodexRateLimits(baseDeps(proc));

    emitLine(stdout, { id: 0, error: { code: -1, message: 'auth token abc123 invalid for user@host' } });

    await expect(promise).rejects.toThrow();
    const err = await promise.catch((e: Error) => e);
    expect((err as Error).message).not.toMatch(/token|abc123|user@host/);
    expect(proc.kill).toHaveBeenCalledOnce();
  });

  it('rejects when the rate-limit read itself returns a protocol error', async () => {
    const { proc, stdout } = createFakeChild();
    const promise = requestCodexRateLimits(baseDeps(proc));

    emitLine(stdout, { id: 0, result: {} });
    emitLine(stdout, { id: 1, error: { code: -32000, message: 'internal: /home/user/.codex/auth.json unreadable' } });

    await expect(promise).rejects.toThrow();
    const err = await promise.catch((e: Error) => e);
    expect((err as Error).message).not.toMatch(/auth\.json|home\/user/);
    expect(proc.kill).toHaveBeenCalledOnce();
  });

  it('rejects and kills the process when it reports a runtime error', async () => {
    const { proc } = createFakeChild();
    const promise = requestCodexRateLimits(baseDeps(proc));

    proc.emit('error', new Error('ENOENT: /Users/secret/.env not found'));

    await expect(promise).rejects.toThrow();
    const err = await promise.catch((e: Error) => e);
    expect((err as Error).message).not.toMatch(/secret|\.env/);
    expect(proc.kill).toHaveBeenCalledOnce();
  });

  it('rejects when the process exits before responding, settling exactly once', async () => {
    const { proc } = createFakeChild();
    const promise = requestCodexRateLimits(baseDeps(proc));

    proc.emit('error', new Error('boom'));
    proc.emit('exit', 1);

    await expect(promise).rejects.toThrow();
    expect(proc.kill).toHaveBeenCalledOnce();
  });

  it('rejects and kills the process after the request timeout elapses', async () => {
    const { proc } = createFakeChild();
    let timeoutCb: (() => void) | undefined;
    const setTimeoutFn = vi.fn((cb: () => void, ms: number) => {
      timeoutCb = cb;
      expect(ms).toBe(10_000);
      return 1 as unknown as ReturnType<typeof setTimeout>;
    }) as unknown as typeof setTimeout;
    const clearTimeoutFn = vi.fn() as unknown as typeof clearTimeout;

    const promise = requestCodexRateLimits(baseDeps(proc, { setTimeoutFn, clearTimeoutFn }));
    timeoutCb?.();

    await expect(promise).rejects.toThrow();
    expect(proc.kill).toHaveBeenCalledOnce();
  });

  it('rejects when the executable cannot be resolved, without spawning', async () => {
    const resolveBundledCodex = vi.fn(() => { throw new Error('Bundled Codex optional dependency is unavailable: @openai/codex-linux-x64'); });
    const spawnFn = vi.fn();
    const promise = requestCodexRateLimits({
      spawn: spawnFn as unknown as RequestCodexRateLimitsDeps['spawn'],
      resolveBundledCodex,
      enrichedEnv: vi.fn().mockReturnValue({ PATH: '/usr/bin' }),
    });

    await expect(promise).rejects.toThrow();
    expect(spawnFn).not.toHaveBeenCalled();
  });
});

describe('CodexTelemetryService', () => {
  function snapshot(overrides: Partial<CodexRateLimitsSnapshot> = {}): CodexRateLimitsSnapshot {
    return {
      provider: 'codex',
      fetchedAt: 0,
      stale: false,
      primary: { usedPercent: 1, windowDurationMins: 300, resetsAt: 1 },
      secondary: null,
      ...overrides,
    };
  }

  it('coalesces concurrent calls into a single in-flight request and reuses a fresh cache', async () => {
    let now = 0;
    const load = vi.fn().mockResolvedValue(snapshot());
    const service = new CodexTelemetryService({ load, now: () => now });

    const first = service.readRateLimits();
    const second = service.readRateLimits();
    expect(load).toHaveBeenCalledOnce();
    expect(first).toBe(second);

    await first;
    now = 29_999;
    await service.readRateLimits();
    expect(load).toHaveBeenCalledOnce();

    now = 31_000;
    await service.readRateLimits();
    expect(load).toHaveBeenCalledTimes(2);

    service.destroy();
  });

  it('marks the last success stale after 120s and suppresses retries during backoff', async () => {
    let now = 0;
    const load = vi.fn().mockResolvedValueOnce(snapshot({ fetchedAt: 0 }));
    const service = new CodexTelemetryService({ load, now: () => now });

    await service.readRateLimits();
    expect(load).toHaveBeenCalledOnce();

    load.mockRejectedValue(new Error('boom'));

    // Past the 30s cache TTL: triggers a refresh attempt, which fails.
    now = 40_000;
    const afterFirstFailure = await service.readRateLimits();
    expect(load).toHaveBeenCalledTimes(2);
    expect(afterFirstFailure).toMatchObject({ stale: false });

    // Still inside the first backoff window (5_000 * 2^0 = 5s after the failure at t=40_000).
    now = 42_000;
    const suppressed = await service.readRateLimits();
    expect(load).toHaveBeenCalledTimes(2);
    expect(suppressed).toMatchObject({ stale: false });

    // Backoff elapsed: retries, fails again, backoff doubles (10s).
    now = 46_000;
    await service.readRateLimits();
    expect(load).toHaveBeenCalledTimes(3);

    // Well past the 120s stale threshold relative to the original fetchedAt (0).
    // The backoff cap (60s) is always well under the stale threshold (120s), so
    // by now the backoff window has also elapsed and a new (failing) attempt
    // is made — the point of this assertion is the recalculated `stale` flag,
    // not backoff suppression (already covered above).
    now = 130_000;
    const stale = await service.readRateLimits();
    expect(load).toHaveBeenCalledTimes(4);
    expect(stale).toMatchObject({ stale: true });

    service.destroy();
  });

  it('does not bypass failure backoff with force:true — only the success cache', async () => {
    let now = 0;
    const load = vi.fn().mockRejectedValueOnce(new Error('boom'));
    const service = new CodexTelemetryService({ load, now: () => now });

    await service.readRateLimits();
    expect(load).toHaveBeenCalledOnce();

    // Still inside the first backoff window (5_000ms after the failure at t=0).
    now = 1_000;
    const forced = await service.readRateLimits({ force: true });
    expect(load).toHaveBeenCalledOnce();
    expect(forced).toBeNull();

    service.destroy();
  });

  it('returns null once a failure occurs with no prior success', async () => {
    let now = 0;
    const load = vi.fn().mockRejectedValue(new Error('boom'));
    const service = new CodexTelemetryService({ load, now: () => now });

    const result = await service.readRateLimits();
    expect(result).toBeNull();

    service.destroy();
  });

  it('lets force bypass the 30-second success cache but not an in-flight call', async () => {
    let now = 0;
    let resolveLoad!: (s: CodexRateLimitsSnapshot) => void;
    const load = vi.fn()
      .mockImplementationOnce(() => new Promise<CodexRateLimitsSnapshot>((resolve) => { resolveLoad = resolve; }))
      .mockResolvedValueOnce(snapshot({ fetchedAt: 5_000 }));
    const service = new CodexTelemetryService({ load, now: () => now });

    const inFlight = service.readRateLimits();
    const duringInFlight = service.readRateLimits({ force: true });
    expect(inFlight).toBe(duringInFlight);
    expect(load).toHaveBeenCalledOnce();

    resolveLoad(snapshot({ fetchedAt: 0 }));
    await inFlight;

    now = 5_000; // well inside the 30s cache window
    await service.readRateLimits({ force: true });
    expect(load).toHaveBeenCalledTimes(2);

    service.destroy();
  });

  it('destroy() kills an active child, clears cached state, and never rejects the caller', async () => {
    let now = 0;
    const kill = vi.fn();
    let rejectLoad!: (err: Error) => void;
    const load = vi.fn((registerCleanup: (cleanup: () => void) => void) => {
      registerCleanup(kill);
      return new Promise<CodexRateLimitsSnapshot>((_resolve, reject) => { rejectLoad = reject; });
    });
    const service = new CodexTelemetryService({ load, now: () => now });

    const pending = service.readRateLimits();
    service.destroy();
    expect(kill).toHaveBeenCalledOnce();

    rejectLoad(new Error('killed'));
    await expect(pending).resolves.toBeNull();

    // Cached state was cleared: the next call starts a fresh load rather than
    // reusing anything from before destroy().
    load.mockResolvedValueOnce(snapshot({ fetchedAt: 0 }));
    now = 100;
    const after = await service.readRateLimits();
    expect(after).toMatchObject({ primary: { usedPercent: 1 } });
    expect(load).toHaveBeenCalledTimes(2);
  });
});
