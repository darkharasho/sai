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

describe('BridgeServer git write ops', () => {
  let server: BridgeServer; let port: number;
  afterEach(async () => { await server.stop(); });

  it('git.stage calls stageFile with cwd+path', async () => {
    const stageFile = vi.fn().mockResolvedValue(undefined);
    server = new BridgeServer({
      tailnetIp: '127.0.0.1', pairing: new PairingStore(':memory:'), bus: new SessionBus(),
      pwaDir: null, screenshotSecret: 'x', loadScreenshot: async () => null,
      stageFile,
    });
    ({ port } = await server.start());
    const ws = await pairedSocket(server, port);
    ws.send(JSON.stringify({ type: 'git.stage', cwd: '/repo', path: 'a.ts', reqId: 'g1' }));
    const m = await once(ws, (m) => m.type === 'git.stage.result');
    expect(m.reqId).toBe('g1');
    expect(stageFile).toHaveBeenCalledWith('/repo', 'a.ts');
    ws.close();
  });

  it('git.unstage calls unstageFile', async () => {
    const unstageFile = vi.fn().mockResolvedValue(undefined);
    server = new BridgeServer({
      tailnetIp: '127.0.0.1', pairing: new PairingStore(':memory:'), bus: new SessionBus(),
      pwaDir: null, screenshotSecret: 'x', loadScreenshot: async () => null,
      unstageFile,
    });
    ({ port } = await server.start());
    const ws = await pairedSocket(server, port);
    ws.send(JSON.stringify({ type: 'git.unstage', cwd: '/r', path: 'a.ts', reqId: 'u1' }));
    const m = await once(ws, (m) => m.type === 'git.unstage.result');
    expect(m.reqId).toBe('u1');
    expect(unstageFile).toHaveBeenCalledWith('/r', 'a.ts');
    ws.close();
  });

  it('git.commit returns hash', async () => {
    const commit = vi.fn().mockResolvedValue({ hash: 'abc1234' });
    server = new BridgeServer({
      tailnetIp: '127.0.0.1', pairing: new PairingStore(':memory:'), bus: new SessionBus(),
      pwaDir: null, screenshotSecret: 'x', loadScreenshot: async () => null,
      commit,
    });
    ({ port } = await server.start());
    const ws = await pairedSocket(server, port);
    ws.send(JSON.stringify({ type: 'git.commit', cwd: '/r', message: 'feat: x', reqId: 'c1' }));
    const m = await once(ws, (m) => m.type === 'git.commit.result');
    expect(m.reqId).toBe('c1');
    expect(m.hash).toBe('abc1234');
    expect(commit).toHaveBeenCalledWith('/r', 'feat: x');
    ws.close();
  });

  it('git.push and git.pull call callbacks', async () => {
    const push = vi.fn().mockResolvedValue(undefined);
    const pull = vi.fn().mockResolvedValue(undefined);
    server = new BridgeServer({
      tailnetIp: '127.0.0.1', pairing: new PairingStore(':memory:'), bus: new SessionBus(),
      pwaDir: null, screenshotSecret: 'x', loadScreenshot: async () => null,
      push, pull,
    });
    ({ port } = await server.start());
    const ws = await pairedSocket(server, port);
    ws.send(JSON.stringify({ type: 'git.push', cwd: '/r', reqId: 'p1' }));
    const pushResp = await once(ws, (m) => m.type === 'git.push.result');
    expect(pushResp.reqId).toBe('p1');
    ws.send(JSON.stringify({ type: 'git.pull', cwd: '/r', reqId: 'p2' }));
    const pullResp = await once(ws, (m) => m.type === 'git.pull.result');
    expect(pullResp.reqId).toBe('p2');
    expect(push).toHaveBeenCalledWith('/r');
    expect(pull).toHaveBeenCalledWith('/r');
    ws.close();
  });

  it('errors are returned with reqId', async () => {
    const commit = vi.fn().mockRejectedValue(new Error('hook rejected'));
    server = new BridgeServer({
      tailnetIp: '127.0.0.1', pairing: new PairingStore(':memory:'), bus: new SessionBus(),
      pwaDir: null, screenshotSecret: 'x', loadScreenshot: async () => null,
      commit,
    });
    ({ port } = await server.start());
    const ws = await pairedSocket(server, port);
    ws.send(JSON.stringify({ type: 'git.commit', cwd: '/r', message: 'x', reqId: 'err' }));
    const m = await once(ws, (m) => m.type === 'error');
    expect(m.reqId).toBe('err');
    expect(m.message).toMatch(/hook rejected/);
    ws.close();
  });
});
