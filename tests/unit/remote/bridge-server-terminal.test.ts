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

describe('BridgeServer — terminal.attach', () => {
  let server: BridgeServer; let port: number;
  afterEach(async () => { await server.stop(); });

  it('terminal.attach replies with cols/rows then sends replay as terminal.output', async () => {
    const store = fakeStore({
      attach: vi.fn(() => ({ replay: 'hello\n', cols: 80, rows: 24 })),
    });
    server = new BridgeServer({
      tailnetIp: '127.0.0.1', pairing: new PairingStore(':memory:'), bus: new SessionBus(),
      pwaDir: null, screenshotSecret: 'x', loadScreenshot: async () => null,
      terminalStore: store,
    });
    ({ port } = await server.start());
    const ws = await pairedSocket(server, port);
    const attachedP = once(ws, (m) => m.type === 'terminal.attached');
    const replayP = once(ws, (m) => m.type === 'terminal.output' && m.termId === 7);
    ws.send(JSON.stringify({ type: 'terminal.attach', termId: 7, cols: 80, rows: 24, reqId: 'A1' }));
    const attached: any = await attachedP;
    expect(attached.reqId).toBe('A1');
    expect(attached.termId).toBe(7);
    expect(attached.cols).toBe(80);
    expect(attached.rows).toBe(24);
    const replay: any = await replayP;
    expect(replay.data).toBe('hello\n');
    expect(store.attach).toHaveBeenCalled();
    ws.close();
  });

});

describe('BridgeServer — terminal input/resize/signal/kill/detach + ws close', () => {
  let server: BridgeServer; let port: number;
  afterEach(async () => { await server.stop(); });

  it('terminal.input / resize / signal / detach are one-way, no reply', async () => {
    const store = fakeStore();
    server = new BridgeServer({
      tailnetIp: '127.0.0.1', pairing: new PairingStore(':memory:'), bus: new SessionBus(),
      pwaDir: null, screenshotSecret: 'x', loadScreenshot: async () => null,
      terminalStore: store,
    });
    ({ port } = await server.start());
    const ws = await pairedSocket(server, port);
    ws.send(JSON.stringify({ type: 'terminal.input', termId: 7, data: 'ls\n' }));
    ws.send(JSON.stringify({ type: 'terminal.resize', termId: 7, cols: 120, rows: 40 }));
    ws.send(JSON.stringify({ type: 'terminal.signal', termId: 7, signal: 'SIGINT' }));
    ws.send(JSON.stringify({ type: 'terminal.detach', termId: 7 }));
    // No reply expected — give the server time to process
    await new Promise((r) => setTimeout(r, 50));
    expect(store.input).toHaveBeenCalledWith(7, 'ls\n');
    expect(store.resize).toHaveBeenCalledWith(7, 120, 40);
    expect(store.signal).toHaveBeenCalledWith(7, 'SIGINT');
    expect(store.detach).toHaveBeenCalledWith(7, expect.anything());
    ws.close();
  });

  it('terminal.kill calls store.kill and replies result', async () => {
    const store = fakeStore();
    server = new BridgeServer({
      tailnetIp: '127.0.0.1', pairing: new PairingStore(':memory:'), bus: new SessionBus(),
      pwaDir: null, screenshotSecret: 'x', loadScreenshot: async () => null,
      terminalStore: store,
    });
    ({ port } = await server.start());
    const ws = await pairedSocket(server, port);
    ws.send(JSON.stringify({ type: 'terminal.kill', termId: 7, reqId: 'K1' }));
    const m = await once(ws, (m) => m.type === 'terminal.kill.result');
    expect(m.reqId).toBe('K1');
    expect(store.kill).toHaveBeenCalledWith(7);
    ws.close();
  });

  it('ws close calls store.detachAll(ws)', async () => {
    const store = fakeStore();
    server = new BridgeServer({
      tailnetIp: '127.0.0.1', pairing: new PairingStore(':memory:'), bus: new SessionBus(),
      pwaDir: null, screenshotSecret: 'x', loadScreenshot: async () => null,
      terminalStore: store,
    });
    ({ port } = await server.start());
    const ws = await pairedSocket(server, port);
    ws.close();
    // Allow the close handler to run
    await new Promise((r) => setTimeout(r, 100));
    expect(store.detachAll).toHaveBeenCalled();
  });
});

describe('BridgeServer — terminal.attach unknown', () => {
  let server: BridgeServer; let port: number;
  afterEach(async () => { await server.stop(); });

  it('terminal.attach unknown termId returns error', async () => {
    const store = fakeStore({ attach: vi.fn(() => null) });
    server = new BridgeServer({
      tailnetIp: '127.0.0.1', pairing: new PairingStore(':memory:'), bus: new SessionBus(),
      pwaDir: null, screenshotSecret: 'x', loadScreenshot: async () => null,
      terminalStore: store,
    });
    ({ port } = await server.start());
    const ws = await pairedSocket(server, port);
    ws.send(JSON.stringify({ type: 'terminal.attach', termId: 999, cols: 80, rows: 24, reqId: 'A2' }));
    const m = await once(ws, (m) => m.type === 'error');
    expect(m.reqId).toBe('A2');
    expect(m.code).toBe('terminal_unknown');
    ws.close();
  });
});
