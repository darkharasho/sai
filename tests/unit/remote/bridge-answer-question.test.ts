import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import WebSocket from 'ws';
import { BridgeServer } from '@electron/services/remote/bridge-server';
import { PairingStore } from '@electron/services/remote/pairing-store';
import { SessionBus } from '@electron/services/remote/session-bus';

describe('bridge answer.question forwarding', () => {
  let server: BridgeServer; let port: number;
  let pairing: PairingStore; let bus: SessionBus;
  let received: any;

  beforeEach(async () => {
    pairing = new PairingStore(':memory:');
    bus = new SessionBus();
    received = null;
    server = new BridgeServer({
      tailnetIp: '127.0.0.1', pairing, bus, pwaDir: null,
      screenshotSecret: 'x', loadScreenshot: async () => null,
      answerQuestion: async (args) => { received = args; },
    });
    ({ port } = await server.start());
  });
  afterEach(async () => { await server.stop(); });

  async function pairAndGetToken(): Promise<string> {
    const code = server.mintPairingCode();
    const r = await fetch(`http://127.0.0.1:${port}/pair`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ code, deviceLabel: 'Test' }),
    });
    return (await r.json()).token;
  }

  it('forwards answer.question frame to opts.answerQuestion', async () => {
    const token = await pairAndGetToken();
    const ws = new WebSocket(`ws://127.0.0.1:${port}/ws`);
    await new Promise<void>((resolve) => {
      ws.on('open', () => ws.send(JSON.stringify({ type: 'auth', token })));
      ws.on('message', (d) => {
        const m = JSON.parse(d.toString());
        if (m.type === 'auth_ok') {
          ws.send(JSON.stringify({
            type: 'answer.question',
            toolUseId: 'tu_1',
            projectPath: '/p',
            scope: 'chat',
            answers: { 'q?': 'a' },
          }));
          setTimeout(resolve, 50);
        }
      });
    });
    ws.close();
    expect(received).toEqual({
      toolUseId: 'tu_1',
      projectPath: '/p',
      scope: 'chat',
      answers: { 'q?': 'a' },
    });
  });

  it('defaults scope to chat when omitted', async () => {
    const token = await pairAndGetToken();
    const ws = new WebSocket(`ws://127.0.0.1:${port}/ws`);
    await new Promise<void>((resolve) => {
      ws.on('open', () => ws.send(JSON.stringify({ type: 'auth', token })));
      ws.on('message', (d) => {
        const m = JSON.parse(d.toString());
        if (m.type === 'auth_ok') {
          ws.send(JSON.stringify({
            type: 'answer.question',
            toolUseId: 'tu_2',
            projectPath: '/p',
            answers: { 'q?': ['a', 'b'] },
          }));
          setTimeout(resolve, 50);
        }
      });
    });
    ws.close();
    expect(received?.scope).toBe('chat');
    expect(received?.answers).toEqual({ 'q?': ['a', 'b'] });
  });

  it('ignores malformed frames (missing toolUseId)', async () => {
    const token = await pairAndGetToken();
    const ws = new WebSocket(`ws://127.0.0.1:${port}/ws`);
    await new Promise<void>((resolve) => {
      ws.on('open', () => ws.send(JSON.stringify({ type: 'auth', token })));
      ws.on('message', (d) => {
        const m = JSON.parse(d.toString());
        if (m.type === 'auth_ok') {
          ws.send(JSON.stringify({
            type: 'answer.question',
            projectPath: '/p',
            answers: { 'q?': 'a' },
          }));
          setTimeout(resolve, 50);
        }
      });
    });
    ws.close();
    expect(received).toBeNull();
  });
});
