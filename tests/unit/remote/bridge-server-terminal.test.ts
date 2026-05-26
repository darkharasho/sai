import { describe, it, expect, vi, afterEach } from 'vitest';
import WebSocket from 'ws';
import { BridgeServer } from '@electron/services/remote/bridge-server';
import { PairingStore } from '@electron/services/remote/pairing-store';
import { SessionBus } from '@electron/services/remote/session-bus';

function once<T = any>(ws: WebSocket, predicate: (m: any) => boolean): Promise<T> {
  return new Promise((resolve, reject) => {
    const onMsg = (data: WebSocket.Data) => {
      const m = JSON.parse(data.toString());
      if (predicate(m)) { ws.off('message', onMsg); resolve(m); }
    };
    ws.on('message', onMsg);
    ws.once('close', (code) => reject(new Error(`closed: ${code}`)));
  });
}

async function pairedSocket(server: BridgeServer, port: number): Promise<WebSocket> {
  const code = server.mintPairingCode();
  const r = await fetch(`http://127.0.0.1:${port}/pair`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ code, deviceLabel: 'Test' }),
  });
  const { token } = await r.json();
  const ws = new WebSocket(`ws://127.0.0.1:${port}/ws`);
  await new Promise((r) => ws.once('open', r));
  ws.send(JSON.stringify({ type: 'auth', token }));
  await once(ws, (m) => m.type === 'auth_ok');
  return ws;
}

function fakeStore(overrides: Partial<any> = {}): any {
  const base = {
    list: vi.fn().mockReturnValue([]),
    open: vi.fn().mockReturnValue({ termId: 7, cwd: '/r', cols: 80, rows: 24, alive: true }),
    attach: vi.fn().mockReturnValue({ replay: '', cols: 80, rows: 24 }),
    detach: vi.fn(),
    detachAll: vi.fn(),
    input: vi.fn(),
    resize: vi.fn(),
    signal: vi.fn(),
    kill: vi.fn(),
  };
  return { ...base, ...overrides };
}

describe('BridgeServer — terminal.list / terminal.open', () => {
  let server: BridgeServer; let port: number;
  afterEach(async () => { await server.stop(); });

  it('terminal.list returns store.list(cwd)', async () => {
    const store = fakeStore({
      list: vi.fn((cwd: string) => cwd === '/r'
        ? [{ termId: 1, cwd: '/r', cols: 80, rows: 24, alive: true }]
        : []),
    });
    server = new BridgeServer({
      tailnetIp: '127.0.0.1', pairing: new PairingStore(':memory:'), bus: new SessionBus(),
      pwaDir: null, screenshotSecret: 'x', loadScreenshot: async () => null,
      terminalStore: store,
    });
    ({ port } = await server.start());
    const ws = await pairedSocket(server, port);
    ws.send(JSON.stringify({ type: 'terminal.list', cwd: '/r', reqId: 'L1' }));
    const m = await once(ws, (m) => m.type === 'terminal.list.result');
    expect(m.reqId).toBe('L1');
    expect(m.terms).toEqual([{ termId: 1, cwd: '/r', cols: 80, rows: 24, alive: true }]);
    expect(store.list).toHaveBeenCalledWith('/r');
    ws.close();
  });

  it('terminal.open spawns and returns termId + dims', async () => {
    const store = fakeStore();
    server = new BridgeServer({
      tailnetIp: '127.0.0.1', pairing: new PairingStore(':memory:'), bus: new SessionBus(),
      pwaDir: null, screenshotSecret: 'x', loadScreenshot: async () => null,
      terminalStore: store,
    });
    ({ port } = await server.start());
    const ws = await pairedSocket(server, port);
    ws.send(JSON.stringify({ type: 'terminal.open', cwd: '/r', cols: 100, rows: 30, reqId: 'O1' }));
    const m = await once(ws, (m) => m.type === 'terminal.opened');
    expect(m.reqId).toBe('O1');
    expect(m.termId).toBe(7);
    expect(m.cols).toBe(80);
    expect(m.rows).toBe(24);
    expect(store.open).toHaveBeenCalledWith('/r', 100, 30);
    ws.close();
  });

  it('terminal.open with no store returns error', async () => {
    server = new BridgeServer({
      tailnetIp: '127.0.0.1', pairing: new PairingStore(':memory:'), bus: new SessionBus(),
      pwaDir: null, screenshotSecret: 'x', loadScreenshot: async () => null,
    });
    ({ port } = await server.start());
    const ws = await pairedSocket(server, port);
    ws.send(JSON.stringify({ type: 'terminal.open', cwd: '/r', cols: 80, rows: 24, reqId: 'E1' }));
    const m = await once(ws, (m) => m.type === 'error');
    expect(m.reqId).toBe('E1');
    expect(m.code).toBe('terminal_unavailable');
    ws.close();
  });
});
