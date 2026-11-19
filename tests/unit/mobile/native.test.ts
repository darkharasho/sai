import { describe, it, expect, vi, beforeEach } from 'vitest';

const kc = { get: vi.fn(), set: vi.fn(), remove: vi.fn() };
const request = vi.fn();
vi.mock('@capacitor/core', () => ({
  Capacitor: { isNativePlatform: () => true },
  CapacitorHttp: { request: (...a: unknown[]) => request(...a) },
  registerPlugin: (name: string) => (name === 'Keychain' ? kc : {}),
}));

import { createNative } from '../../../mobile/src/native';

beforeEach(() => { vi.clearAllMocks(); });

describe('native (Capacitor path)', () => {
  it('routes keychain calls to the Keychain plugin', async () => {
    const n = createNative();
    kc.get.mockResolvedValue({ value: 'v' });
    expect(await n.keychainGet('k')).toBe('v');
    kc.get.mockResolvedValue({ value: null });
    expect(await n.keychainGet('k')).toBeNull();
    await n.keychainSet('k', 'x');
    await n.keychainRemove('k');
    expect(kc.set).toHaveBeenCalledWith({ key: 'k', value: 'x' });
    expect(kc.remove).toHaveBeenCalledWith({ key: 'k' });
  });

  it('http uses CapacitorHttp with connect/read timeouts', async () => {
    request.mockResolvedValue({ status: 200, data: '{"status":"ok"}' });
    const n = createNative();
    const r = await n.http({ method: 'GET', url: 'http://h:1/healthz', timeoutMs: 3000 });
    expect(r).toEqual({ status: 200, data: { status: 'ok' } });
    expect(request).toHaveBeenCalledWith(expect.objectContaining({ url: 'http://h:1/healthz', connectTimeout: 3000, readTimeout: 3000 }));
  });
});
