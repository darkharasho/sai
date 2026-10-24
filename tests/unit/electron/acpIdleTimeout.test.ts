// @vitest-environment node
import { describe, it, expect, vi, afterEach } from 'vitest';

vi.mock('electron', () => ({
  BrowserWindow: class {},
  ipcMain: { on: vi.fn(), handle: vi.fn() },
  app: { getPath: vi.fn(() => '/tmp') },
}));
vi.mock('../../../electron/services/notify', () => ({ notifyCompletion: vi.fn() }));
vi.mock('../../../electron/services/workspace', () => ({
  getOrCreate: vi.fn(), get: vi.fn(), touchActivity: vi.fn(),
}));

import { pauseAwareIdleTimeout } from '../../../electron/services/acpProvider';

afterEach(() => { vi.useRealTimers(); });

describe('pauseAwareIdleTimeout (I4)', () => {
  it('fires after the idle window when not paused', () => {
    vi.useFakeTimers();
    const onTimeout = vi.fn();
    pauseAwareIdleTimeout(1000, () => false, onTimeout).reset();
    vi.advanceTimersByTime(999);
    expect(onTimeout).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(onTimeout).toHaveBeenCalledTimes(1);
  });

  it('re-arms instead of timing out while the load guard has the provider frozen', () => {
    vi.useFakeTimers();
    const onTimeout = vi.fn();
    let paused = true;
    pauseAwareIdleTimeout(1000, () => paused, onTimeout).reset();
    vi.advanceTimersByTime(10_000);
    expect(onTimeout).not.toHaveBeenCalled();
    paused = false; // thawed: the agent gets one full silent window before a timeout
    vi.advanceTimersByTime(1000);
    expect(onTimeout).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1000);
    expect(onTimeout).toHaveBeenCalledTimes(1);
  });

  it('a throwing pause check counts as not paused', () => {
    vi.useFakeTimers();
    const onTimeout = vi.fn();
    pauseAwareIdleTimeout(1000, () => { throw new Error('x'); }, onTimeout).reset();
    vi.advanceTimersByTime(1000);
    expect(onTimeout).toHaveBeenCalledTimes(1);
  });

  it('reset restarts the window and clear cancels it', () => {
    vi.useFakeTimers();
    const onTimeout = vi.fn();
    const t = pauseAwareIdleTimeout(1000, () => false, onTimeout);
    t.reset();
    vi.advanceTimersByTime(800);
    t.reset();
    vi.advanceTimersByTime(800);
    expect(onTimeout).not.toHaveBeenCalled();
    t.clear();
    vi.advanceTimersByTime(5000);
    expect(onTimeout).not.toHaveBeenCalled();
  });
});
