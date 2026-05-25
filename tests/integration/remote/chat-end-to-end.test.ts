import { describe, it, expect } from 'vitest';
import WebSocket from 'ws';
import { RemoteModule } from '@electron/services/remote';
import { BridgeServer } from '@electron/services/remote/bridge-server';
import { PairingStore } from '@electron/services/remote/pairing-store';
import { SessionBus } from '@electron/services/remote/session-bus';

describe('mobile remote chat end-to-end', () => {
  it('attach → bus event → prompt → approval → interrupt', async () => {
    const pairing = new PairingStore(':memory:');
    const bus = new SessionBus();

    const sendPromptCalls: any[] = [];
    const approveCalls: any[] = [];
    let interruptCalls = 0;

    const remote = new RemoteModule({
      pairing, bus,
      resolveTailnetEndpoint: async () => ({ ip: '127.0.0.1', host: null }),
      makeBridge: (ip) => new BridgeServer({
        tailnetIp: ip, pairing, bus, pwaDir: null,
        screenshotSecret: 'e2e', loadScreenshot: async () => null, port: 0,
        sendPrompt: (args) => { sendPromptCalls.push(args); },
        resolveApproval: async (args) => { approveCalls.push(args); },
        interruptTurn: () => { interruptCalls++; },
        listSessions: async () => [{ id: 's1', projectPath: '/p', updatedAt: 0 }],
        loadHistory: async () => [{ role: 'user', text: 'hi' }],
      }),
      pollMs: 0,
    });
    await remote.start();
    const { url } = remote.status();

    // pair
    const { code } = remote.mintPairingCode();
    const pairRes = await fetch(`${url}/pair`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ code, deviceLabel: 'E2E' }),
    });
    const { token } = await pairRes.json();

    // ws + auth
    const ws = new WebSocket(`${url!.replace(/^http/, 'ws')}/ws`);
    const inbox: any[] = [];
    ws.on('message', (d) => inbox.push(JSON.parse(d.toString())));
    await new Promise((r) => ws.once('open', r));
    ws.send(JSON.stringify({ type: 'auth', token }));
    await new Promise((r) => setTimeout(r, 50));
    expect(inbox.find((m) => m.type === 'auth_ok')).toBeTruthy();

    // attach
    ws.send(JSON.stringify({ type: 'session.attach', projectPath: '/p', scope: 'chat', sessionId: 's1' }));
    await new Promise((r) => setTimeout(r, 50));
    expect(inbox.find((m) => m.type === 'session.history')?.messages).toEqual([{ role: 'user', text: 'hi' }]);

    // bus event flows
    bus.publish('chat:/p:chat', { type: 'assistant', text: 'hello' });
    bus.publish('chat:/other:chat', { type: 'assistant', text: 'dropped' });
    await new Promise((r) => setTimeout(r, 30));
    const assistantFrames = inbox.filter((m) => m.type === 'assistant');
    expect(assistantFrames).toHaveLength(1);
    expect(assistantFrames[0].text).toBe('hello');
    expect(assistantFrames[0].topic).toBe('chat:/p:chat');

    // prompt
    ws.send(JSON.stringify({ type: 'prompt', text: 'go', projectPath: '/p', scope: 'chat' }));
    await new Promise((r) => setTimeout(r, 30));
    expect(sendPromptCalls).toEqual([expect.objectContaining({ text: 'go', projectPath: '/p' })]);

    // approval
    ws.send(JSON.stringify({ type: 'approval', toolUseId: 'tu1', decision: 'approve', projectPath: '/p', scope: 'chat' }));
    await new Promise((r) => setTimeout(r, 30));
    expect(approveCalls).toEqual([expect.objectContaining({ toolUseId: 'tu1', decision: 'approve' })]);

    // interrupt
    ws.send(JSON.stringify({ type: 'interrupt', projectPath: '/p', scope: 'chat' }));
    await new Promise((r) => setTimeout(r, 30));
    expect(interruptCalls).toBe(1);

    ws.close();
    await remote.stop();
  });
});
