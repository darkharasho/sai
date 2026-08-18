import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  HOME_WORKSPACE_NAME,
  isHomeWorkspace,
  getHomePath,
  setHomeInfo,
  loadHomeInfo,
  resetHomeInfo,
} from '../../../src/lib/homeWorkspace';

describe('homeWorkspace', () => {
  beforeEach(() => {
    resetHomeInfo();
  });

  it('reports no home path until one is loaded', () => {
    expect(getHomePath()).toBeNull();
    expect(isHomeWorkspace('/var/home/mstephens')).toBe(false);
  });

  it('matches the canonical home path once set', () => {
    setHomeInfo({ path: '/var/home/mstephens', aliases: ['/var/home/mstephens'] });
    expect(getHomePath()).toBe('/var/home/mstephens');
    expect(isHomeWorkspace('/var/home/mstephens')).toBe(true);
    expect(isHomeWorkspace('/var/home/mstephens/Documents/GitHub/sai')).toBe(false);
  });

  it('matches an aliased home path (symlinked home)', () => {
    // /home/mstephens is a symlink to /var/home/mstephens on this machine, and
    // workspace paths reach the renderer in both spellings depending on who
    // reported them. Both must resolve to the Home workspace.
    setHomeInfo({ path: '/var/home/mstephens', aliases: ['/home/mstephens', '/var/home/mstephens'] });
    expect(isHomeWorkspace('/home/mstephens')).toBe(true);
    expect(isHomeWorkspace('/var/home/mstephens')).toBe(true);
  });

  it('ignores trailing slashes and empty input', () => {
    setHomeInfo({ path: '/var/home/mstephens', aliases: ['/var/home/mstephens'] });
    expect(isHomeWorkspace('/var/home/mstephens/')).toBe(true);
    expect(isHomeWorkspace('')).toBe(false);
    expect(isHomeWorkspace(null)).toBe(false);
    expect(isHomeWorkspace(undefined)).toBe(false);
  });

  it('loads the home info over the bridge and caches it', async () => {
    const homeDir = vi.fn().mockResolvedValue({ path: '/var/home/x', aliases: ['/home/x', '/var/home/x'] });
    (globalThis as any).window = { sai: { homeDir } };

    const first = await loadHomeInfo();
    const second = await loadHomeInfo();

    expect(first?.path).toBe('/var/home/x');
    expect(second?.path).toBe('/var/home/x');
    expect(homeDir).toHaveBeenCalledTimes(1);
    expect(isHomeWorkspace('/home/x')).toBe(true);
  });

  it('survives a bridge without homeDir', async () => {
    (globalThis as any).window = { sai: {} };
    await expect(loadHomeInfo()).resolves.toBeNull();
    expect(getHomePath()).toBeNull();
  });

  it('exposes the display name used for the pinned row', () => {
    expect(HOME_WORKSPACE_NAME).toBe('Home');
  });
});
