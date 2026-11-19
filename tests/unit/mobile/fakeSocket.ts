// A scripted browser-style WebSocket for V2Client tests.
export class FakeSocket {
  static all: FakeSocket[] = [];
  readyState = 0;
  sent: any[] = [];
  closedWith: number | null = null;
  onopen: ((ev: unknown) => void) | null = null;
  onmessage: ((ev: { data: unknown }) => void) | null = null;
  onclose: ((ev: { code?: number }) => void) | null = null;
  onerror: ((ev: unknown) => void) | null = null;
  constructor(public url: string) { FakeSocket.all.push(this); }
  send(data: string) {
    if (this.readyState !== 1) throw new Error('not open');
    this.sent.push(JSON.parse(data));
  }
  close(code = 1000) {
    if (this.readyState === 3) return;
    this.readyState = 3;
    this.closedWith = code;
    this.onclose?.({ code });
  }
  // Server side
  open() { this.readyState = 1; this.onopen?.({}); }
  recv(frame: Record<string, unknown>) { this.onmessage?.({ data: JSON.stringify(frame) }); }
  authOk() { this.recv({ v: 1, type: 'auth_ok', deviceId: 'd', deviceLabel: 'phone' }); }
  serverClose(code: number) { this.readyState = 3; this.onclose?.({ code }); }
  types() { return this.sent.map((f) => f.type); }
}
