import { pair } from '../lib/wire';

describe('pair', () => {
  const realFetch = global.fetch;
  afterEach(() => { global.fetch = realFetch; });

  it('POSTs to /pair and returns token + deviceId', async () => {
    global.fetch = jest.fn(async () => new Response(
      JSON.stringify({ token: 't1', deviceId: 'd1' }),
      { status: 200, headers: { 'content-type': 'application/json' } }
    )) as any;
    const r = await pair('https://my.ts.net', 'CODE', 'iPhone', 'client-xyz');
    expect(r).toEqual({ token: 't1', deviceId: 'd1' });
    expect((global.fetch as jest.Mock).mock.calls[0][0]).toBe('https://my.ts.net/pair');
  });

  it('throws on non-2xx', async () => {
    global.fetch = jest.fn(async () => new Response('nope', { status: 401 })) as any;
    await expect(pair('https://my.ts.net', 'X', 'i', 'c')).rejects.toThrow(/pair failed/);
  });
});
