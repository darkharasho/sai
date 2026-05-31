import { connectWire } from '../lib/wire';

class MockWS {
  static instances: MockWS[] = [];
  static OPEN = 1; static CLOSED = 3;
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

describe('connectWire', () => {
  beforeEach(() => { MockWS.instances = []; (global as any).WebSocket = MockWS; });

  it('opens, authenticates, and notifies open state', (done) => {
    const c = connectWire({ baseUrl: 'http://h', token: 't' });
    c.onState((s) => { if (s === 'open') { expect(MockWS.instances[0].sent[0]).toContain('"auth"'); c.close(); done(); } });
    MockWS.instances[0].emitOpen();
    MockWS.instances[0].emitMessage({ type: 'auth_ok' });
  });

  it('delivers inbound messages to handler', (done) => {
    const c = connectWire({ baseUrl: 'http://h', token: 't' });
    c.on((m) => { if (m.type === 'chat:msg') { expect(m.text).toBe('hi'); c.close(); done(); } });
    MockWS.instances[0].emitOpen();
    MockWS.instances[0].emitMessage({ type: 'auth_ok' });
    MockWS.instances[0].emitMessage({ type: 'chat:msg', text: 'hi' });
  });
});
