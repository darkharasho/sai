import { describe, it, expect, afterEach, vi } from 'vitest';
import { extractPairCode, BEARER_KEY, connect } from '@/renderer-remote/wire';

class MockWebSocket {
  static readonly CONNECTING = 0;
  static readonly OPEN = 1;
  static readonly CLOSING = 2;
  static readonly CLOSED = 3;
  static latest: MockWebSocket | null = null;
  static instances: MockWebSocket[] = [];
  readyState = MockWebSocket.CONNECTING;
  onopen: (() => void) | null = null;
  onmessage: ((event: { data: string }) => void) | null = null;
  onclose: (() => void) | null = null;
  sent: unknown[] = [];

  constructor(_url: string) {
    MockWebSocket.latest = this;
    MockWebSocket.instances.push(this);
  }
  send(data: string): void { this.sent.push(JSON.parse(data)); }
  close(): void { this.readyState = MockWebSocket.CLOSED; this.onclose?.(); }
  open(): void { this.readyState = MockWebSocket.OPEN; this.onopen?.(); }
  receive(msg: unknown): void { this.onmessage?.({ data: JSON.stringify(msg) }); }
}

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  MockWebSocket.latest = null;
  MockWebSocket.instances = [];
});

describe('PWA wire helpers', () => {
  it('extracts ?code= from URL', () => {
    expect(extractPairCode('https://x.y/?code=abc123')).toBe('abc123');
    expect(extractPairCode('https://x.y/?other=1&code=zz')).toBe('zz');
    expect(extractPairCode('https://x.y/')).toBeNull();
  });

  it('exposes a stable localStorage key', () => {
    expect(BEARER_KEY).toBe('sai-remote-bearer');
  });

  it('correlates a Claude model catalogue reply with its crypto-random request ID', async () => {
    vi.stubGlobal('WebSocket', MockWebSocket);
    vi.stubGlobal('crypto', { randomUUID: vi.fn(() => 'random-model-request') });
    const wire = connect('token');
    const socket = MockWebSocket.latest!;
    socket.open();
    socket.receive({ type: 'auth_ok' });

    const requestId = wire.requestClaudeModels();
    expect(requestId).toBe('random-model-request');
    expect(socket.sent).toContainEqual({ type: 'claude_models_request', requestId });

    const models = [{ id: 'fable', label: 'Fable', description: 'Account model', recommended: true }];
    socket.receive({ type: 'claude_models', requestId: 'other-request', models: [] });
    socket.receive({ type: 'claude_models', requestId, models });
    await expect(wire.waitForClaudeModels()).resolves.toEqual(models);
    wire.close();
  });

  it('requests a Claude model catalogue when crypto.randomUUID is unavailable', () => {
    vi.stubGlobal('WebSocket', MockWebSocket);
    vi.stubGlobal('crypto', {});
    const wire = connect('token');
    const socket = MockWebSocket.latest!;
    socket.open();
    socket.receive({ type: 'auth_ok' });

    const requestId = wire.requestClaudeModels();
    expect(requestId).toMatch(/.+/);
    expect(socket.sent).toContainEqual({ type: 'claude_models_request', requestId });
    wire.close();
  });

  it('rejects and clears a pending Claude model catalogue wait when the socket closes', async () => {
    vi.stubGlobal('WebSocket', MockWebSocket);
    vi.stubGlobal('crypto', { randomUUID: vi.fn(() => 'close-model-request') });
    const wire = connect('token');
    const socket = MockWebSocket.latest!;
    socket.open();
    socket.receive({ type: 'auth_ok' });

    const requestId = wire.requestClaudeModels();
    const pending = wire.waitForClaudeModels();
    socket.close();
    await expect(pending).rejects.toThrow('connection lost');

    // A late response cannot revive the cleared waiter.
    socket.receive({ type: 'claude_models', requestId, models: [{ id: 'fable' }] });
    await expect(pending).rejects.toThrow('connection lost');
    wire.close();
  });

  it('ignores a delayed close from a replaced socket while a model request is pending', async () => {
    vi.useFakeTimers();
    vi.spyOn(Math, 'random').mockReturnValue(1);
    vi.stubGlobal('WebSocket', MockWebSocket);
    vi.stubGlobal('crypto', { randomUUID: vi.fn(() => 'replacement-model-request') });
    const wire = connect('token');
    const states: string[] = [];
    wire.onState((state) => states.push(state));
    const first = MockWebSocket.latest!;
    first.open();
    first.receive({ type: 'auth_ok' });
    first.close();
    await vi.advanceTimersByTimeAsync(1_200);

    const second = MockWebSocket.latest!;
    expect(second).not.toBe(first);
    second.open();
    second.receive({ type: 'auth_ok' });
    states.length = 0;
    const requestId = wire.requestClaudeModels();
    const pending = wire.waitForClaudeModels();

    first.onclose?.(); // delayed callback after the replacement is live
    expect(states).not.toContain('closed');
    second.receive({ type: 'claude_models', requestId, models: [{ id: 'fable' }] });
    await expect(pending).resolves.toEqual([{ id: 'fable' }]);
    wire.close();
  });

  it('does not let a replaced socket watchdog close a newer model request', async () => {
    vi.useFakeTimers();
    vi.stubGlobal('WebSocket', MockWebSocket);
    vi.stubGlobal('crypto', { randomUUID: vi.fn(() => 'watchdog-model-request') });
    const wire = connect('token');
    const first = MockWebSocket.latest!;
    first.open();
    first.receive({ type: 'auth_ok' });
    await vi.advanceTimersByTimeAsync(25_000); // old heartbeat starts its pong deadline

    // Simulate a zombie socket observed as closed before its delayed onclose.
    first.readyState = MockWebSocket.CLOSED;
    window.dispatchEvent(new Event('online'));
    const second = MockWebSocket.latest!;
    expect(second).not.toBe(first);
    await vi.advanceTimersByTimeAsync(10_000); // old pong deadline would fire here
    expect(second.readyState).toBe(MockWebSocket.CONNECTING);
    second.open();
    second.receive({ type: 'auth_ok' });
    const requestId = wire.requestClaudeModels();
    const pending = wire.waitForClaudeModels();

    second.receive({ type: 'claude_models', requestId, models: [{ id: 'fable' }] });
    await expect(pending).resolves.toEqual([{ id: 'fable' }]);
    wire.close();
  });
});
