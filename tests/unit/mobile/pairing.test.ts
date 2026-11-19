import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { FullNativeApi } from '../../../mobile/src/native';
import { parsePairUrl, pair, PairError } from '../../../mobile/src/machines/pairing';
import { listMachines, getToken } from '../../../mobile/src/machines/store';

function fakeNative(responses: Array<{ status: number; data: unknown } | Error>): FullNativeApi & { kc: Map<string, string>; calls: any[] } {
  const kc = new Map<string, string>();
  const calls: any[] = [];
  return {
    kc, calls,
    openUrl() {}, copyText() {}, toast() {},
    async keychainGet(k) { return kc.get(k) ?? null; },
    async keychainSet(k, v) { kc.set(k, v); },
    async keychainRemove(k) { kc.delete(k); },
    http: vi.fn(async (req) => {
      calls.push(req);
      const r = responses.shift()!;
      if (r instanceof Error) throw r;
      return r;
    }),
  };
}

const URL1 = 'http://desk.tail1234.ts.net:7421/?code=abc_DEF-123';

beforeEach(() => localStorage.clear());

describe('parsePairUrl', () => {
  it('accepts the desktop QR url and rejects others', () => {
    expect(parsePairUrl(URL1)).toEqual({ baseUrl: 'http://desk.tail1234.ts.net:7421', code: 'abc_DEF-123' });
    expect(parsePairUrl('  http://100.64.0.2:7421/?code=xyz  ')).toEqual({ baseUrl: 'http://100.64.0.2:7421', code: 'xyz' });
    expect(parsePairUrl('https://h:1/?code=a')).toEqual({ baseUrl: 'https://h:1', code: 'a' });
    expect(parsePairUrl('http://h:1/')).toBeNull();
    expect(parsePairUrl('http://h:1/?code=')).toBeNull();
    expect(parsePairUrl('ftp://h:1/?code=a')).toBeNull();
    expect(parsePairUrl('hello world')).toBeNull();
    expect(parsePairUrl('')).toBeNull();
  });
});

describe('pair', () => {
  it('stores the token in the keychain, not localStorage', async () => {
    const native = fakeNative([{ status: 200, data: { token: 'TOK-1', deviceId: 'dev1', wsUrl: '/ws' } }]);
    const m = await pair(URL1, 'iPhone', native);
    expect(native.calls[0]).toMatchObject({ method: 'POST', url: 'http://desk.tail1234.ts.net:7421/pair' });
    expect(native.calls[0].body).toMatchObject({ code: 'abc_DEF-123', deviceLabel: 'iPhone' });
    expect(typeof native.calls[0].body.clientId).toBe('string');
    expect(await getToken(m.id, native)).toBe('TOK-1');
    expect(m).toMatchObject({ baseUrl: 'http://desk.tail1234.ts.net:7421', deviceId: 'dev1' });
    const dump = JSON.stringify(Object.entries(localStorage));
    expect(dump).not.toContain('TOK-1');
    expect(listMachines()).toHaveLength(1);
  });

  it('uses a stable clientId across pairings', async () => {
    const native = fakeNative([
      { status: 200, data: { token: 'a', deviceId: 'd' } },
      { status: 200, data: { token: 'b', deviceId: 'd' } },
    ]);
    await pair(URL1, 'iPhone', native);
    await pair(URL1, 'iPhone', native);
    expect(native.calls[0].body.clientId).toBe(native.calls[1].body.clientId);
  });

  it('re-pair of the same baseUrl replaces the token', async () => {
    const native = fakeNative([
      { status: 200, data: { token: 'OLD', deviceId: 'd1' } },
      { status: 200, data: { token: 'NEW', deviceId: 'd2' } },
    ]);
    const a = await pair(URL1, 'iPhone', native);
    const b = await pair('http://desk.tail1234.ts.net:7421/?code=zzz', 'iPhone', native);
    expect(listMachines()).toHaveLength(1);
    expect(b.id).toBe(a.id);
    expect(await getToken(a.id, native)).toBe('NEW');
    expect(listMachines()[0].deviceId).toBe('d2');
    expect(JSON.stringify(Object.entries(localStorage))).not.toContain('NEW');
  });

  it('maps server errors to inline messages', async () => {
    await expect(pair(URL1, 'i', fakeNative([{ status: 401, data: 'invalid code' }]))).rejects.toMatchObject({ code: 'expired', message: 'code expired' });
    await expect(pair(URL1, 'i', fakeNative([{ status: 429, data: 'x' }]))).rejects.toMatchObject({ code: 'rate_limited' });
    await expect(pair(URL1, 'i', fakeNative([new Error('net')]))).rejects.toMatchObject({ code: 'unreachable', message: "can't reach desktop — is Tailscale on?" });
    await expect(pair('nope', 'i', fakeNative([]))).rejects.toBeInstanceOf(PairError);
    expect(listMachines()).toEqual([]);
  });
});
