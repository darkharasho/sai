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

describe('BridgeServer files routing', () => {
  let server: BridgeServer; let port: number;

  afterEach(async () => { await server.stop(); });

  it('files.list returns entries with reqId', async () => {
    const listFiles = vi.fn().mockResolvedValue([{ name: 'a.txt', kind: 'file', size: 4 }]);
    server = new BridgeServer({
      tailnetIp: '127.0.0.1', pairing: new PairingStore(':memory:'), bus: new SessionBus(),
      pwaDir: null, screenshotSecret: 'x', loadScreenshot: async () => null,
      listFiles,
    });
    ({ port } = await server.start());
    const ws = await pairedSocket(server, port);
    ws.send(JSON.stringify({ type: 'files.list', cwd: '/repo', path: 'src', reqId: 'l1' }));
    const m = await once(ws, (m) => m.type === 'files.list.result');
    expect(m.reqId).toBe('l1');
    expect(m.entries).toEqual([{ name: 'a.txt', kind: 'file', size: 4 }]);
    expect(listFiles).toHaveBeenCalledWith('/repo', 'src');
    ws.close();
  });

  it('files.read returns content', async () => {
    const readFile = vi.fn().mockResolvedValue({ content: 'hi', encoding: 'text', size: 2, lang: 'tsx' });
    server = new BridgeServer({
      tailnetIp: '127.0.0.1', pairing: new PairingStore(':memory:'), bus: new SessionBus(),
      pwaDir: null, screenshotSecret: 'x', loadScreenshot: async () => null,
      readFile,
    });
    ({ port } = await server.start());
    const ws = await pairedSocket(server, port);
    ws.send(JSON.stringify({ type: 'files.read', cwd: '/repo', path: 'a.tsx', reqId: 'r1' }));
    const m = await once(ws, (m) => m.type === 'files.read.result');
    expect(m.reqId).toBe('r1');
    expect(m.content).toBe('hi');
    expect(m.lang).toBe('tsx');
    ws.close();
  });

  it('files.status returns entries', async () => {
    const statusFiles = vi.fn().mockResolvedValue({ entries: [{ path: 'a.txt', status: 'modified', staged: false }], branch: 'main', ahead: 0, behind: 0 });
    server = new BridgeServer({
      tailnetIp: '127.0.0.1', pairing: new PairingStore(':memory:'), bus: new SessionBus(),
      pwaDir: null, screenshotSecret: 'x', loadScreenshot: async () => null,
      statusFiles,
    });
    ({ port } = await server.start());
    const ws = await pairedSocket(server, port);
    ws.send(JSON.stringify({ type: 'files.status', cwd: '/repo', reqId: 's1' }));
    const m = await once(ws, (m) => m.type === 'files.status.result');
    expect(m.entries).toHaveLength(1);
    ws.close();
  });

  it('files.diff returns diff string', async () => {
    const diffFile = vi.fn().mockResolvedValue({ diff: '@@ ...', lang: 'tsx' });
    server = new BridgeServer({
      tailnetIp: '127.0.0.1', pairing: new PairingStore(':memory:'), bus: new SessionBus(),
      pwaDir: null, screenshotSecret: 'x', loadScreenshot: async () => null,
      diffFile,
    });
    ({ port } = await server.start());
    const ws = await pairedSocket(server, port);
    ws.send(JSON.stringify({ type: 'files.diff', cwd: '/repo', path: 'a.tsx', staged: false, reqId: 'd1' }));
    const m = await once(ws, (m) => m.type === 'files.diff.result');
    expect(m.diff).toBe('@@ ...');
    expect(m.lang).toBe('tsx');
    ws.close();
  });

  it('errors are returned with reqId', async () => {
    const listFiles = vi.fn().mockRejectedValue(new Error('boom'));
    server = new BridgeServer({
      tailnetIp: '127.0.0.1', pairing: new PairingStore(':memory:'), bus: new SessionBus(),
      pwaDir: null, screenshotSecret: 'x', loadScreenshot: async () => null,
      listFiles,
    });
    ({ port } = await server.start());
    const ws = await pairedSocket(server, port);
    ws.send(JSON.stringify({ type: 'files.list', cwd: '/repo', path: 'src', reqId: 'err' }));
    const m = await once(ws, (m) => m.type === 'error');
    expect(m.reqId).toBe('err');
    expect(m.message).toMatch(/boom/);
    ws.close();
  });
});
