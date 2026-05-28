import { describe, it, expect, vi } from 'vitest';
import { RemoteModule } from '@electron/services/remote';
import { SessionBus } from '@electron/services/remote/session-bus';

function fakePairing(): any {
  return { list: () => [], issue: vi.fn(), verify: vi.fn(), revoke: vi.fn() };
}

function fakeBridge(opts: { startResult?: 'ok' | 'fail'; port?: number } = {}) {
  let startCalls = 0;
  return {
    startCalls: () => startCalls,
    start: vi.fn(async () => {
      startCalls += 1;
      if (opts.startResult === 'fail') throw new Error('boom');
      return { port: opts.port ?? 17829 };
    }),
    stop: vi.fn(async () => {}),
    mintPairingCode: vi.fn(() => 'CODE'),
    signScreenshotUrl: vi.fn((id: string) => `/screenshot/${id}`),
    closeDeviceConnections: vi.fn(),
  };
}

describe('RemoteModule', () => {
  it('runs when tailnet IP available', async () => {
    const bridge = fakeBridge();
    const m = new RemoteModule({
      pairing: fakePairing(), bus: new SessionBus(),
      resolveTailnetEndpoint: async () => ({ ip: '100.64.1.1', host: 'sai.tail.ts.net' }),
      makeBridge: () => bridge as any,
      pollMs: 0,
    });
    await m.start();
    const s = m.status();
    expect(s.running).toBe(true);
    expect(s.url).toBe('http://sai.tail.ts.net:17829');
    await m.stop();
  });

  it('stays down with reason when no tailnet IP', async () => {
    const m = new RemoteModule({
      pairing: fakePairing(), bus: new SessionBus(),
      resolveTailnetEndpoint: async () => ({ ip: null, host: null }),
      makeBridge: () => fakeBridge() as any,
      pollMs: 0,
    });
    await m.start();
    const s = m.status();
    expect(s.running).toBe(false);
    expect(s.reason).toMatch(/tailnet/);
    await m.stop();
  });

  it('retries once on bridge.start failure', async () => {
    let attempts = 0;
    const m = new RemoteModule({
      pairing: fakePairing(), bus: new SessionBus(),
      resolveTailnetEndpoint: async () => ({ ip: '100.64.1.1', host: null }),
      makeBridge: () => ({
        ...fakeBridge(),
        start: vi.fn(async () => {
          attempts += 1;
          if (attempts < 2) throw new Error('first fail');
          return { port: 17829 };
        }),
      } as any),
      pollMs: 0, restartDelayMs: 5,
    });
    await m.start();
    await new Promise((r) => setTimeout(r, 30));
    expect(attempts).toBe(2);
    expect(m.status().running).toBe(true);
    await m.stop();
  });
});
