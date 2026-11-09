import { describe, it, expect, vi, afterEach } from 'vitest';
import {
  shouldPurge,
  startIdleMemoryPurge,
  PURGE_IDLE_MS,
  PURGE_MIN_GAP_MS,
} from '@electron/services/idleMemoryPurge';

const base = { now: 1_000_000, focused: true, blurredAt: null, systemIdleMs: 0, lastPurgeAt: null };

describe('shouldPurge', () => {
  it('does not purge a focused window in active use', () => {
    expect(shouldPurge(base)).toBe(false);
  });
  it('purges a focused window once the system has been idle long enough', () => {
    expect(shouldPurge({ ...base, systemIdleMs: PURGE_IDLE_MS })).toBe(true);
  });
  it('purges once the window has been unfocused long enough', () => {
    expect(shouldPurge({ ...base, focused: false, blurredAt: base.now - PURGE_IDLE_MS })).toBe(true);
    expect(shouldPurge({ ...base, focused: false, blurredAt: base.now - PURGE_IDLE_MS + 1 })).toBe(false);
  });
  it('respects the minimum gap between purges', () => {
    const idle = { ...base, systemIdleMs: PURGE_IDLE_MS * 10 };
    expect(shouldPurge({ ...idle, lastPurgeAt: base.now - PURGE_MIN_GAP_MS + 1 })).toBe(false);
    expect(shouldPurge({ ...idle, lastPurgeAt: base.now - PURGE_MIN_GAP_MS })).toBe(true);
  });
});

describe('startIdleMemoryPurge', () => {
  afterEach(() => vi.useRealTimers());

  it('purges after blur, then waits out the gap before purging again', async () => {
    let now = 0;
    let focused = true;
    const purge = vi.fn(async () => {});
    const p = startIdleMemoryPurge({ now: () => now, isFocused: () => focused, systemIdleMs: () => 0, purge });

    await p.tick();
    expect(purge).not.toHaveBeenCalled();

    focused = false;
    p.onBlur();
    now += PURGE_IDLE_MS;
    await p.tick();
    expect(purge).toHaveBeenCalledTimes(1);

    now += PURGE_MIN_GAP_MS - 1;
    await p.tick();
    expect(purge).toHaveBeenCalledTimes(1);
    now += 1;
    await p.tick();
    expect(purge).toHaveBeenCalledTimes(2);

    focused = true;
    p.onFocus();
    now += PURGE_MIN_GAP_MS;
    await p.tick();
    expect(purge).toHaveBeenCalledTimes(2);
    p.stop();
  });

  it('swallows purge failures and keeps running', async () => {
    let now = 0;
    const purge = vi.fn(async () => { throw new Error('attach failed'); });
    const p = startIdleMemoryPurge({ now: () => now, isFocused: () => true, systemIdleMs: () => PURGE_IDLE_MS, purge });
    await expect(p.tick()).resolves.toBeUndefined();
    now += PURGE_MIN_GAP_MS;
    await p.tick();
    expect(purge).toHaveBeenCalledTimes(2);
    p.stop();
  });
});
