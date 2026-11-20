import { describe, it, expect, vi, beforeEach } from 'vitest';

const { http, updater, env } = vi.hoisted(() => ({
  http: vi.fn(),
  updater: {
    current: vi.fn(),
    list: vi.fn(),
    download: vi.fn(),
    next: vi.fn(),
    notifyAppReady: vi.fn(),
  },
  env: { native: true },
}));
vi.mock('@capacitor/core', () => ({
  Capacitor: { isNativePlatform: () => env.native, getPlatform: () => 'ios' },
  CapacitorHttp: { get: (...a: unknown[]) => http(...a) },
}));
vi.mock('@capacitor/app', () => ({
  App: { getInfo: async () => ({ build: '29900000' }), addListener: vi.fn() },
}));
vi.mock('@capgo/capacitor-updater', () => ({ CapacitorUpdater: updater }));

import { checkForLiveUpdate, markAppReady } from '../../../mobile/src/update/liveUpdate';

const manifest = {
  version: '1.41.0-ota.100.abc1234',
  url: 'https://github.com/darkharasho/sai/releases/download/ota-ios-29900000/bundle-1.41.0-ota.100.abc1234.zip',
  checksum: 'a'.repeat(64),
  build: '29900000',
};

beforeEach(() => {
  vi.clearAllMocks();
  env.native = true;
  updater.current.mockResolvedValue({ bundle: { id: 'builtin', version: 'builtin' } });
  updater.list.mockResolvedValue({ bundles: [] });
  updater.download.mockResolvedValue({ id: 'b1' });
  updater.notifyAppReady.mockResolvedValue(undefined);
});

describe('live updates', () => {
  it('reads the manifest for this native build and queues the new bundle', async () => {
    http.mockResolvedValue({ status: 200, data: manifest });
    await checkForLiveUpdate();
    expect(http.mock.calls[0][0].url).toBe(
      'https://github.com/darkharasho/sai/releases/download/ota-ios-29900000/manifest.json',
    );
    expect(updater.download).toHaveBeenCalledWith({ url: manifest.url, version: manifest.version, checksum: manifest.checksum });
    expect(updater.next).toHaveBeenCalledWith({ id: 'b1' });
  });

  it('does nothing when no update is published for this build', async () => {
    http.mockResolvedValue({ status: 404, data: 'Not Found' });
    await checkForLiveUpdate();
    expect(updater.download).not.toHaveBeenCalled();
  });

  it('ignores a manifest for another build or the bundle already running', async () => {
    http.mockResolvedValue({ status: 200, data: JSON.stringify({ ...manifest, build: '1' }) });
    await checkForLiveUpdate();
    updater.current.mockResolvedValue({ bundle: { id: 'b1', version: manifest.version } });
    http.mockResolvedValue({ status: 200, data: manifest });
    await checkForLiveUpdate();
    expect(updater.download).not.toHaveBeenCalled();
    expect(updater.next).not.toHaveBeenCalled();
  });

  it('reuses a bundle it already downloaded', async () => {
    http.mockResolvedValue({ status: 200, data: manifest });
    updater.list.mockResolvedValue({ bundles: [{ id: 'b0', version: manifest.version, status: 'success' }] });
    await checkForLiveUpdate();
    expect(updater.download).not.toHaveBeenCalled();
    expect(updater.next).toHaveBeenCalledWith({ id: 'b0' });
  });

  it('marks the app ready only on a native platform', () => {
    markAppReady();
    expect(updater.notifyAppReady).toHaveBeenCalledTimes(1);
    env.native = false;
    markAppReady();
    expect(updater.notifyAppReady).toHaveBeenCalledTimes(1);
  });
});
