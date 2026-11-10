import { describe, it, expect, vi } from 'vitest';
import { canonicalUserData, enforceSingleInstance } from '@electron/services/singleInstance';

describe('canonicalUserData', () => {
  it('collapses a symlinked spelling to the realpath', () => {
    const realpath = (p: string) => p.replace('/home/', '/var/home/');
    expect(canonicalUserData('/home/me/.config/sai', realpath)).toBe('/var/home/me/.config/sai');
  });

  it('falls back to the raw path when realpath throws', () => {
    const realpath = () => {
      throw new Error('ENOENT');
    };
    expect(canonicalUserData('/home/me/.config/sai', realpath)).toBe('/home/me/.config/sai');
  });
});

describe('enforceSingleInstance', () => {
  it('continues and registers a focus handler when it is the primary instance', () => {
    const onSecondInstance = vi.fn();
    const quit = vi.fn();
    const focusExisting = vi.fn();

    const ok = enforceSingleInstance({
      requestLock: () => true,
      onSecondInstance,
      focusExisting,
      quit,
    });

    expect(ok).toBe(true);
    expect(quit).not.toHaveBeenCalled();
    expect(onSecondInstance).toHaveBeenCalledTimes(1);
  });

  it('focuses the running window when a duplicate second instance launches', () => {
    const focusExisting = vi.fn();
    let registered: (() => void) | null = null;

    enforceSingleInstance({
      requestLock: () => true,
      onSecondInstance: (h) => {
        registered = h;
      },
      focusExisting,
      quit: vi.fn(),
    });

    registered!();
    expect(focusExisting).toHaveBeenCalledTimes(1);
  });

  it('quits without booting when another instance holds the lock', () => {
    const quit = vi.fn();
    const onSecondInstance = vi.fn();

    const ok = enforceSingleInstance({
      requestLock: () => false,
      onSecondInstance,
      focusExisting: vi.fn(),
      quit,
    });

    expect(ok).toBe(false);
    expect(quit).toHaveBeenCalledTimes(1);
    expect(onSecondInstance).not.toHaveBeenCalled();
  });
});
