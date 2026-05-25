import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
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

describe('BridgeServer chat routing', () => {
  let server: BridgeServer; let port: number; let bus: SessionBus;
  let sendPrompt = vi.fn(); let resolveApproval = vi.fn(); let interruptTurn = vi.fn();
  let listSessions = vi.fn(); let loadHistory = vi.fn();

  beforeEach(async () => {
    bus = new SessionBus();
    sendPrompt = vi.fn();
    resolveApproval = vi.fn().mockResolvedValue(undefined);
    interruptTurn = vi.fn();
    listSessions = vi.fn().mockResolvedValue([{ id: 's1', projectPath: '/p' }]);
    loadHistory = vi.fn().mockResolvedValue([{ role: 'user', content: 'hi' }]);
    server = new BridgeServer({
      tailnetIp: '127.0.0.1', pairing: new PairingStore(':memory:'), bus,
      pwaDir: null, screenshotSecret: 'x', loadScreenshot: async () => null,
      sendPrompt, resolveApproval, interruptTurn, listSessions, loadHistory,
    });
    ({ port } = await server.start());
  });
  afterEach(async () => { await server.stop(); });

  it('session.attach gates bus events to the attached topic only', async () => {
    const ws = await pairedSocket(server, port);
    ws.send(JSON.stringify({ type: 'session.attach', projectPath: '/p', scope: 'chat', sessionId: 's1' }));
    // Wait for session.history reply to confirm attach landed
    await once(ws, (m) => m.type === 'session.history');
    setTimeout(() => {
      bus.publish('chat:/p:chat', { type: 'assistant', text: 'hello' });
      bus.publish('chat:/other:chat', { type: 'assistant', text: 'dropped' });
    }, 20);
    const m = await once(ws, (m) => m.type === 'assistant');
    expect(m.text).toBe('hello');
    expect(m.topic).toBe('chat:/p:chat');
    ws.close();
  });

  it('sessions.list calls callback and replies with reqId correlation', async () => {
    const ws = await pairedSocket(server, port);
    ws.send(JSON.stringify({ type: 'sessions.list', projectPath: '/p', reqId: 'r1' }));
    const m = await once(ws, (m) => m.type === 'sessions.list.result');
    expect(m.reqId).toBe('r1');
    expect(m.sessions).toEqual([{ id: 's1', projectPath: '/p' }]);
    expect(listSessions).toHaveBeenCalledWith('/p');
    ws.close();
  });

  it('session.attach replies with history dump', async () => {
    const ws = await pairedSocket(server, port);
    ws.send(JSON.stringify({ type: 'session.attach', projectPath: '/p', scope: 'chat', sessionId: 's1' }));
    const m = await once(ws, (m) => m.type === 'session.history');
    expect(m.sessionId).toBe('s1');
    expect(m.messages).toEqual([{ role: 'user', content: 'hi' }]);
    ws.close();
  });

  it('prompt calls sendPrompt', async () => {
    const ws = await pairedSocket(server, port);
    ws.send(JSON.stringify({ type: 'prompt', text: 'hi', projectPath: '/p', scope: 'chat' }));
    await new Promise((r) => setTimeout(r, 20));
    expect(sendPrompt).toHaveBeenCalledWith(expect.objectContaining({ text: 'hi', projectPath: '/p', scope: 'chat' }));
    ws.close();
  });

  it('approval calls resolveApproval', async () => {
    const ws = await pairedSocket(server, port);
    ws.send(JSON.stringify({ type: 'approval', toolUseId: 'tu1', decision: 'approve', projectPath: '/p', scope: 'chat' }));
    await new Promise((r) => setTimeout(r, 20));
    expect(resolveApproval).toHaveBeenCalledWith(expect.objectContaining({ toolUseId: 'tu1', decision: 'approve' }));
    ws.close();
  });

  it('interrupt calls interruptTurn', async () => {
    const ws = await pairedSocket(server, port);
    ws.send(JSON.stringify({ type: 'interrupt', projectPath: '/p', scope: 'chat' }));
    await new Promise((r) => setTimeout(r, 20));
    expect(interruptTurn).toHaveBeenCalledWith('/p', 'chat');
    ws.close();
  });
});
