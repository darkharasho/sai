import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { FullNativeApi } from '../../../mobile/src/native';
import { listMachines, removeMachine, getToken, addMachine, tokenKey } from '../../../mobile/src/machines/store';
import { checkReachable } from '../../../mobile/src/machines/reachability';

function fakeNative(over: Partial<FullNativeApi> = {}): FullNativeApi & { kc: Map<string, string> } {
  const kc = new Map<string, string>();
  return {
    kc,
    openUrl() {}, copyText() {}, toast() {},
    async keychainGet(k) { return kc.get(k) ?? null; },
    async keychainSet(k, v) { kc.set(k, v); },
    async keychainRemove(k) { kc.delete(k); },
    async http() { return { status: 200, data: { status: 'ok' } }; },
    ...over,
  };
}

beforeEach(() => localStorage.clear());

describe('machines', () => {
  it('unreachable machine shows offline', async () => {
    const native = fakeNative({ http: vi.fn(async () => { throw new Error('timeout'); }) });
    expect(await checkReachable({ baseUrl: 'http://100.1.1.1:9' }, native)).toBe(false);
    expect(native.http).toHaveBeenCalledWith(expect.objectContaining({ method: 'GET', url: 'http://100.1.1.1:9/healthz', timeoutMs: 3000 }));
  });

  it('reachable machine is online', async () => {
    expect(await checkReachable({ baseUrl: 'http://h:1' }, fakeNative())).toBe(true);
  });

  it('non-200 healthz is offline', async () => {
    const native = fakeNative({ async http() { return { status: 502, data: '' }; } });
    expect(await checkReachable({ baseUrl: 'http://h:1' }, native)).toBe(false);
  });

  it('remove deletes the token', async () => {
    const native = fakeNative();
    const m = await addMachine({ label: 'a', baseUrl: 'http://a:1', deviceId: 'd', token: 'secret' }, native);
    expect(await getToken(m.id, native)).toBe('secret');
    await removeMachine(m.id, native);
    expect(await getToken(m.id, native)).toBeNull();
    expect(native.kc.has(tokenKey(m.id))).toBe(false);
    expect(listMachines()).toEqual([]);
  });
});
