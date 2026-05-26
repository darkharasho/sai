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

function baseOpts(extra: any) {
  return {
    tailnetIp: '127.0.0.1', pairing: new PairingStore(':memory:'), bus: new SessionBus(),
    pwaDir: null, screenshotSecret: 'x', loadScreenshot: async () => null,
    ...extra,
  };
}

describe('BridgeServer files.write routing', () => {
  let server: BridgeServer; let port: number;
  afterEach(async () => { await server.stop(); });

  it('happy path: forwards to writeFile and returns mtime+sha', async () => {
    const writeFile = vi.fn().mockResolvedValue({ mtime: 1234, sha: 'aaaaaaaaaaaaaaaa' });
    server = new BridgeServer(baseOpts({ writeFile }));
    ({ port } = await server.start());
    const ws = await pairedSocket(server, port);
    ws.send(JSON.stringify({
      type: 'files.write', cwd: '/repo', path: 'a.txt', content: 'hi',
      expectMtime: 1000, expectSha: 'bbbbbbbbbbbbbbbb', reqId: 'w1',
    }));
    const m = await once(ws, (m) => m.type === 'files.write.result');
    expect(m.reqId).toBe('w1');
    expect(m.mtime).toBe(1234);
    expect(m.sha).toBe('aaaaaaaaaaaaaaaa');
    expect(writeFile).toHaveBeenCalledWith('/repo', 'a.txt', 'hi',
      { expectMtime: 1000, expectSha: 'bbbbbbbbbbbbbbbb' });
    ws.close();
  });

  it('stale error is encoded with currentMtime + currentSha', async () => {
    const writeFile = vi.fn().mockRejectedValue(Object.assign(new Error('file changed since fetch'),
      { code: 'stale', currentMtime: 9999, currentSha: 'cccccccccccccccc' }));
    server = new BridgeServer(baseOpts({ writeFile }));
    ({ port } = await server.start());
    const ws = await pairedSocket(server, port);
    ws.send(JSON.stringify({
      type: 'files.write', cwd: '/repo', path: 'a.txt', content: 'hi',
      expectMtime: 1, expectSha: 'aaaaaaaaaaaaaaaa', reqId: 'w2',
    }));
    const m = await once(ws, (m) => m.type === 'error');
    expect(m.reqId).toBe('w2');
    expect(m.code).toBe('stale');
    expect(m.currentMtime).toBe(9999);
    expect(m.currentSha).toBe('cccccccccccccccc');
    ws.close();
  });

  it('force-write passes both nulls through to writeFile', async () => {
    const writeFile = vi.fn().mockResolvedValue({ mtime: 1, sha: 'dddddddddddddddd' });
    server = new BridgeServer(baseOpts({ writeFile }));
    ({ port } = await server.start());
    const ws = await pairedSocket(server, port);
    ws.send(JSON.stringify({
      type: 'files.write', cwd: '/repo', path: 'a.txt', content: 'hi',
      expectMtime: null, expectSha: null, reqId: 'w3',
    }));
    await once(ws, (m) => m.type === 'files.write.result');
    expect(writeFile).toHaveBeenCalledWith('/repo', 'a.txt', 'hi',
      { expectMtime: null, expectSha: null });
    ws.close();
  });

  it('too_large error encodes the code field', async () => {
    const writeFile = vi.fn().mockRejectedValue(Object.assign(new Error('too large'), { code: 'too_large' }));
    server = new BridgeServer(baseOpts({ writeFile }));
    ({ port } = await server.start());
    const ws = await pairedSocket(server, port);
    ws.send(JSON.stringify({
      type: 'files.write', cwd: '/repo', path: 'a.txt', content: 'x',
      expectMtime: null, expectSha: null, reqId: 'w4',
    }));
    const m = await once(ws, (m) => m.type === 'error');
    expect(m.code).toBe('too_large');
    ws.close();
  });

  it('traversal error from writeFile is forwarded as write_failed', async () => {
    const writeFile = vi.fn().mockRejectedValue(new Error('path escapes cwd: ../bad'));
    server = new BridgeServer(baseOpts({ writeFile }));
    ({ port } = await server.start());
    const ws = await pairedSocket(server, port);
    ws.send(JSON.stringify({
      type: 'files.write', cwd: '/repo', path: '../bad', content: 'x',
      expectMtime: null, expectSha: null, reqId: 'w5',
    }));
    const m = await once(ws, (m) => m.type === 'error');
    expect(m.code).toBe('write_failed');
    expect(m.message).toMatch(/escapes/);
    ws.close();
  });

  it('missing writeFile callback returns code=unsupported', async () => {
    server = new BridgeServer(baseOpts({}));
    ({ port } = await server.start());
    const ws = await pairedSocket(server, port);
    ws.send(JSON.stringify({
      type: 'files.write', cwd: '/repo', path: 'a.txt', content: 'x',
      expectMtime: null, expectSha: null, reqId: 'w6',
    }));
    const m = await once(ws, (m) => m.type === 'error');
    expect(m.code).toBe('unsupported');
    ws.close();
  });
});
