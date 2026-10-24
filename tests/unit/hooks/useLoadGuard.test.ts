import { describe, it, expect, vi, afterEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import { useLoadGuard } from '../../../src/hooks/useLoadGuard';

const base = {
  level: 'normal', paused: false, override: false, saiCaused: false, saiAppHeavy: false,
  memUsedPct: 10, swapUsedPct: 0, game: null, recoveredAt: null, enabled: true,
} as const;

afterEach(() => { delete (window as any).sai; });

describe('useLoadGuard', () => {
  it('defaults when the bridge is missing', () => {
    (window as any).sai = {};
    const { result } = renderHook(() => useLoadGuard());
    expect(result.current.enabled).toBe(false);
    expect(result.current.paused).toBe(false);
  });

  it('starts from getState, follows broadcasts, unsubscribes on unmount', async () => {
    let cb: (s: any) => void = () => {};
    const unsub = vi.fn();
    (window as any).sai = {
      loadGuardGetState: vi.fn().mockResolvedValue({ ...base, memUsedPct: 42 }),
      loadGuardOnState: vi.fn((c) => { cb = c; return unsub; }),
    };
    const { result, unmount } = renderHook(() => useLoadGuard());
    await waitFor(() => expect(result.current.memUsedPct).toBe(42));
    act(() => cb({ ...base, level: 'critical', paused: true, memUsedPct: 97 }));
    expect(result.current.paused).toBe(true);
    expect(result.current.memUsedPct).toBe(97);
    expect((window as any).sai.loadGuardOnState).toHaveBeenCalledTimes(1);
    unmount();
    expect(unsub).toHaveBeenCalledTimes(1);
  });
});
