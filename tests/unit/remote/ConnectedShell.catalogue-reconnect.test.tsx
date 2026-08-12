import { act, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/renderer-remote/chat/Chat', () => ({
  default: ({ models }: { models: Array<{ id: string; label: string }> }) => (
    <output data-testid="remote-models">{models.map((model) => model.label).join(', ')}</output>
  ),
}));

vi.mock('@/renderer-remote/chat/NavDrawer', () => ({ default: () => null }));

import { ConnectedShell } from '@/renderer-remote/App';
import { connect, type WireClient } from '@/renderer-remote/wire';

class MockWebSocket {
  static readonly CONNECTING = 0;
  static readonly OPEN = 1;
  static readonly CLOSING = 2;
  static readonly CLOSED = 3;
  static instances: MockWebSocket[] = [];

  readyState = MockWebSocket.CONNECTING;
  onopen: (() => void) | null = null;
  onmessage: ((event: { data: string }) => void) | null = null;
  onclose: (() => void) | null = null;
  sent: Array<Record<string, unknown>> = [];

  constructor(_url: string) { MockWebSocket.instances.push(this); }
  send(data: string): void { this.sent.push(JSON.parse(data)); }
  close(): void { this.readyState = MockWebSocket.CLOSED; this.onclose?.(); }
  open(): void { this.readyState = MockWebSocket.OPEN; this.onopen?.(); }
  receive(message: unknown): void { this.onmessage?.({ data: JSON.stringify(message) }); }
}

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  MockWebSocket.instances = [];
});

describe('ConnectedShell model catalogue reconnect', () => {
  it('retries catalogue discovery after the active socket closes and its authenticated replacement opens', async () => {
    vi.useFakeTimers();
    vi.spyOn(Math, 'random').mockReturnValue(1);
    let request = 0;
    vi.stubGlobal('crypto', { randomUUID: vi.fn(() => `catalogue-${++request}`) });
    vi.stubGlobal('WebSocket', MockWebSocket);

    const client: WireClient = connect('token');
    const first = MockWebSocket.instances[0]!;
    first.open();
    first.receive({ type: 'auth_ok' });
    render(<ConnectedShell client={client} />);
    expect(first.sent).toContainEqual({ type: 'claude_models_request', requestId: 'catalogue-1' });

    // The original wait rejects on close. The shell must keep its fallback and
    // issue exactly one replacement request once the next socket authenticates.
    first.close();
    await act(async () => { await vi.advanceTimersByTimeAsync(1_200); });
    const second = MockWebSocket.instances[1]!;
    second.open();
    second.receive({ type: 'auth_ok' });
    second.receive({ type: 'auth_ok' }); // duplicate server frame, same socket

    expect(second.sent).toContainEqual({ type: 'claude_models_request', requestId: 'catalogue-2' });
    expect(second.sent.filter((message) => message.type === 'claude_models_request')).toHaveLength(1);

    await act(async () => {
      second.receive({
        type: 'claude_models',
        requestId: 'catalogue-2',
        models: [{ id: 'account-opus', label: 'Account Opus', description: 'Account model', recommended: true }],
      });
    });
    expect(screen.getByTestId('remote-models')).toHaveTextContent('Account Opus');
    client.close();
  });
});
