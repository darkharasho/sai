import { describe, it, expect } from 'vitest';
import WebSocket from 'ws';
import { RemoteModule } from '@electron/services/remote';
import { BridgeServer } from '@electron/services/remote/bridge-server';
import { PairingStore } from '@electron/services/remote/pairing-store';
import { SessionBus } from '@electron/services/remote/session-bus';
import { PhoneTerminalRegistry } from '@electron/services/remote/terminal-store';

describe('mobile remote terminal end-to-end', () => {
  it.skipIf(process.platform === 'win32')('spawn → echo hello → exit 0 → replay on reconnect', async () => {
    const pairing = new PairingStore(':memory:');
    const bus = new SessionBus();
    const terminalStore = new PhoneTerminalRegistry();

    const remote = new RemoteModule({
      pairing, bus,
      resolveTailnetEndpoint: async () => ({ ip: '127.0.0.1', host: null }),
      makeBridge: (ip) => new BridgeServer({
        tailnetIp: ip, pairing, bus, pwaDir: null,
        screenshotSecret: 'e2e', loadScreenshot: async () => null, port: 0,
        terminalStore,
      }),
      pollMs: 0,
    });
    await remote.start();
    const { url } = remote.status();
    const { code } = remote.mintPairingCode();
    const pairRes = await fetch(`${url}/pair`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ code, deviceLabel: 'E2E' }),
    });
    const { token } = await pairRes.json();

    const wsUrl = url!.replace(/^http/, 'ws') + '/ws';
    const ws = new WebSocket(wsUrl);
    const inbox: any[] = [];
    ws.on('message', (d) => inbox.push(JSON.parse(d.toString())));
    await new Promise((r) => ws.once('open', r));
    ws.send(JSON.stringify({ type: 'auth', token }));
    await waitFor(inbox, (m) => m.type === 'auth_ok', 3000);

    // Open a PTY that prints hello and exits.
    ws.send(JSON.stringify({ type: 'terminal.open', cwd: process.cwd(), cols: 80, rows: 24, reqId: 'O1' }));
    const opened = await waitFor(inbox, (m) => m.type === 'terminal.opened' && m.reqId === 'O1', 3000);
    const termId = opened.termId as number;
    // Attach so output is streamed
    ws.send(JSON.stringify({ type: 'terminal.attach', termId, cols: 80, rows: 24, reqId: 'A1' }));
    await waitFor(inbox, (m) => m.type === 'terminal.attached' && m.reqId === 'A1', 3000);

    // Some shells (login profile customizations on Linux) emit DSR cursor-position
    // queries during init and BLOCK until the terminal responds. Watch the inbox
    // and respond with a synthetic cursor-position report so the shell can proceed.
    const dsrResponder = (m: any) => {
      if (m.type === 'terminal.output' && typeof m.data === 'string'
          && m.termId === termId && m.data.includes('[6n')) {
        ws.send(JSON.stringify({ type: 'terminal.input', termId, data: '[1;1R' }));
      }
    };
    ws.on('message', (d) => dsrResponder(JSON.parse(d.toString())));

    // Give the shell time to finish init
    await new Promise((r) => setTimeout(r, 1500));

    // Send a command
    ws.send(JSON.stringify({ type: 'terminal.input', termId, data: 'echo hello-from-pty; exit 0\n' }));

    // Wait for hello and exit
    await waitFor(inbox, (m) =>
      m.type === 'terminal.output' && m.termId === termId && String(m.data).includes('hello-from-pty'),
      10_000);
    await waitFor(inbox, (m) => m.type === 'terminal.exit' && m.termId === termId, 10_000);

    ws.close();
    terminalStore.destroyAll();
    await remote.stop();
  }, 30_000);

  it.skipIf(process.platform === 'win32')('mid-stream disconnect → reconnect → replay contains earlier output', async () => {
    const pairing = new PairingStore(':memory:');
    const bus = new SessionBus();
    const terminalStore = new PhoneTerminalRegistry();

    const remote = new RemoteModule({
      pairing, bus,
      resolveTailnetEndpoint: async () => ({ ip: '127.0.0.1', host: null }),
      makeBridge: (ip) => new BridgeServer({
        tailnetIp: ip, pairing, bus, pwaDir: null,
        screenshotSecret: 'e2e2', loadScreenshot: async () => null, port: 0,
        terminalStore,
      }),
      pollMs: 0,
    });
    await remote.start();
    const { url } = remote.status();
    const { code } = remote.mintPairingCode();
    const pairRes = await fetch(`${url}/pair`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ code, deviceLabel: 'E2E' }),
    });
    const { token } = await pairRes.json();
    const wsUrl = url!.replace(/^http/, 'ws') + '/ws';

    // First socket
    const ws1 = new WebSocket(wsUrl);
    const in1: any[] = [];
    ws1.on('message', (d) => in1.push(JSON.parse(d.toString())));
    await new Promise((r) => ws1.once('open', r));
    ws1.send(JSON.stringify({ type: 'auth', token }));
    await waitFor(in1, (m) => m.type === 'auth_ok', 3000);
    ws1.send(JSON.stringify({ type: 'terminal.open', cwd: process.cwd(), cols: 80, rows: 24, reqId: 'O' }));
    const opened = await waitFor(in1, (m) => m.type === 'terminal.opened', 3000);
    const termId = opened.termId as number;
    ws1.send(JSON.stringify({ type: 'terminal.attach', termId, cols: 80, rows: 24, reqId: 'A' }));
    await waitFor(in1, (m) => m.type === 'terminal.attached', 3000);
    ws1.send(JSON.stringify({ type: 'terminal.input', termId, data: 'echo phase-one-marker\n' }));
    await waitFor(in1, (m) =>
      m.type === 'terminal.output' && String(m.data).includes('phase-one-marker'), 5000);
    // Drop the socket without sending detach (server's ws.close handler runs detachAll)
    ws1.close();
    await new Promise((r) => setTimeout(r, 100));

    // Second socket — reattach and assert replay contains the marker
    const ws2 = new WebSocket(wsUrl);
    const in2: any[] = [];
    ws2.on('message', (d) => in2.push(JSON.parse(d.toString())));
    await new Promise((r) => ws2.once('open', r));
    ws2.send(JSON.stringify({ type: 'auth', token }));
    await waitFor(in2, (m) => m.type === 'auth_ok', 3000);
    ws2.send(JSON.stringify({ type: 'terminal.attach', termId, cols: 80, rows: 24, reqId: 'A2' }));
    await waitFor(in2, (m) => m.type === 'terminal.attached' && m.reqId === 'A2', 3000);
    // The very next terminal.output frame is the ring replay
    const replay = await waitFor(in2, (m) => m.type === 'terminal.output' && m.termId === termId, 3000);
    expect(String(replay.data)).toContain('phase-one-marker');

    ws2.send(JSON.stringify({ type: 'terminal.kill', termId, reqId: 'K' }));
    await waitFor(in2, (m) => m.type === 'terminal.kill.result', 3000);
    ws2.close();
    terminalStore.destroyAll();
    await remote.stop();
  }, 15_000);
});

async function waitFor(inbox: any[], pred: (m: any) => boolean, timeoutMs: number): Promise<any> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const m = inbox.find(pred);
    if (m) return m;
    await new Promise((r) => setTimeout(r, 20));
  }
  throw new Error('waitFor timeout');
}
