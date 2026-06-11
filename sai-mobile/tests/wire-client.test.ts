import { connect } from '../lib/wire';

class MockWS {
  static instances: MockWS[] = [];
  static OPEN = 1; static CLOSED = 3; static CLOSING = 2; static CONNECTING = 0;
  readyState = 0;
  onopen: ((e: any) => void) | null = null;
  onmessage: ((e: any) => void) | null = null;
  onclose: ((e: any) => void) | null = null;
  onerror: ((e: any) => void) | null = null;
  sent: string[] = [];
  constructor(public url: string) { MockWS.instances.push(this); }
  send(d: string) { this.sent.push(d); }
  close() { this.readyState = 3; this.onclose?.({}); }
  emitOpen() { this.readyState = 1; this.onopen?.({}); }
  emitMessage(obj: any) { this.onmessage?.({ data: JSON.stringify(obj) }); }
}

describe('connect (wire client)', () => {
  beforeEach(() => { MockWS.instances = []; (global as any).WebSocket = MockWS; });

  it('opens, authenticates, and notifies open state', (done) => {
    const c = connect({ baseUrl: 'http://h', token: 't' });
    c.onState((s) => { if (s === 'open') { expect(MockWS.instances[0].sent[0]).toContain('"auth"'); c.close(); done(); } });
    MockWS.instances[0].emitOpen();
    MockWS.instances[0].emitMessage({ type: 'auth_ok' });
  });

  it('delivers inbound messages to handler', (done) => {
    const c = connect({ baseUrl: 'http://h', token: 't' });
    c.on((m) => { if (m.type === 'user_message') { expect(m.text).toBe('hi'); c.close(); done(); } });
    MockWS.instances[0].emitOpen();
    MockWS.instances[0].emitMessage({ type: 'auth_ok' });
    MockWS.instances[0].emitMessage({ type: 'user_message', text: 'hi' });
  });

  it('correlates request/response by reqId', async () => {
    const c = connect({ baseUrl: 'http://h', token: 't' });
    MockWS.instances[0].emitOpen();
    MockWS.instances[0].emitMessage({ type: 'auth_ok' });
    const p = c.listWorkspaces();
    // The 2nd outbound frame is workspaces.list (1st was auth).
    const sentFrames = MockWS.instances[0].sent.map((s) => JSON.parse(s));
    const req = sentFrames.find((f) => f.type === 'workspaces.list');
    expect(req).toBeTruthy();
    MockWS.instances[0].emitMessage({ type: 'workspaces.list.result', workspaces: [{ projectPath: '/r' }], reqId: req.reqId });
    const result = await p;
    expect(result).toEqual([{ projectPath: '/r' }]);
    c.close();
  });
});

describe('sendPrompt sessionId threading', () => {
  beforeEach(() => { MockWS.instances = []; (global as any).WebSocket = MockWS; });

  it('includes the sessionId in the prompt frame', () => {
    const c = connect({ baseUrl: 'http://h', token: 't' });
    MockWS.instances[0].emitOpen();
    MockWS.instances[0].emitMessage({ type: 'auth_ok' });
    c.sendPrompt({ text: 'hi', projectPath: '/p', sessionId: 's1' });
    const frames = MockWS.instances[0].sent.map((s: string) => JSON.parse(s));
    const prompt = frames.find((f: any) => f.type === 'prompt');
    expect(prompt).toMatchObject({ text: 'hi', projectPath: '/p', sessionId: 's1' });
    c.close();
  });
});
