// @vitest-environment node
import { EventEmitter } from 'node:events';
import { describe, expect, it, vi } from 'vitest';
import { AppServerClient, AppServerProtocolError } from '../../../electron/services/codexBackend/appServerClient';

function fakeChild() {
  const child = new EventEmitter() as EventEmitter & {
    stdin: { write: ReturnType<typeof vi.fn> };
    stdout: EventEmitter;
    kill: ReturnType<typeof vi.fn>;
  };
  child.stdin = { write: vi.fn(() => true) };
  child.stdout = new EventEmitter();
  child.kill = vi.fn();
  return child;
}

function createClient(child: ReturnType<typeof fakeChild>) {
  const spawn = vi.fn(() => child);
  const client = new AppServerClient({
    spawn: spawn as never,
    resolveBundledCodex: () => ({ executablePath: '/app/codex', pathDirs: ['/app/bin'] }),
    getEnv: () => ({ PATH: '/usr/bin' }),
  });
  return { client, spawn };
}

function reply(child: ReturnType<typeof fakeChild>, body: unknown) {
  child.stdout.emit('data', Buffer.from(`${JSON.stringify(body)}\n`));
}

async function start(client: AppServerClient, child: ReturnType<typeof fakeChild>) {
  const ready = client.start();
  expect(JSON.parse(child.stdin.write.mock.calls[0][0])).toMatchObject({
    jsonrpc: '2.0', id: 0, method: 'initialize',
  });
  reply(child, { jsonrpc: '2.0', id: 0, result: { protocolVersion: 1 } });
  await ready;
}

describe('AppServerClient', () => {
  it('spawns the bundled executable and performs the initialize/initialized handshake', async () => {
    const child = fakeChild();
    const { client, spawn } = createClient(child);

    await start(client, child);

    expect(spawn).toHaveBeenCalledWith('/app/codex', ['app-server'], expect.objectContaining({
      shell: false,
      stdio: ['pipe', 'pipe', 'pipe'],
    }));
    expect(JSON.parse(child.stdin.write.mock.calls[1][0])).toEqual({ jsonrpc: '2.0', method: 'initialized' });
  });

  it('serializes requests as newline-delimited JSON and correlates their responses', async () => {
    const child = fakeChild();
    const { client } = createClient(child);
    await start(client, child);

    const pending = client.request<{ thread: { id: string } }>('thread/start', { cwd: '/repo' });
    const request = JSON.parse(child.stdin.write.mock.calls.at(-1)[0]);
    expect(child.stdin.write.mock.calls.at(-1)[0]).toMatch(/\n$/);
    expect(request).toMatchObject({ jsonrpc: '2.0', id: 1, method: 'thread/start', params: { cwd: '/repo' } });
    reply(child, { jsonrpc: '2.0', id: 1, result: { thread: { id: 'thread-1' } } });

    await expect(pending).resolves.toEqual({ thread: { id: 'thread-1' } });
  });

  it('rejects business requests until initialization has completed', () => {
    const child = fakeChild();
    const { client } = createClient(child);

    expect(() => client.request('thread/start', {})).toThrow(/not initialized/i);
  });

  it('routes notifications to subscribers and rejects unsupported server requests', async () => {
    const child = fakeChild();
    const { client } = createClient(child);
    await start(client, child);
    const events: unknown[] = [];
    client.onNotification((message) => events.push(message));

    reply(child, { jsonrpc: '2.0', method: 'turn/started', params: { turn: { id: 'turn-1' } } });
    reply(child, { jsonrpc: '2.0', id: 99, method: 'item/commandExecution/requestApproval', params: {} });

    expect(events).toEqual([{ jsonrpc: '2.0', method: 'turn/started', params: { turn: { id: 'turn-1' } } }]);
    expect(JSON.parse(child.stdin.write.mock.calls.at(-1)[0])).toEqual({
      jsonrpc: '2.0', id: 99,
      error: { code: -32601, message: 'Unsupported App Server request in preview' },
    });
  });

  it('rejects pending requests after malformed protocol data', async () => {
    const child = fakeChild();
    const { client } = createClient(child);
    await start(client, child);
    const pending = client.request('thread/start', {});

    child.stdout.emit('data', Buffer.from('{not-json}\n'));

    await expect(pending).rejects.toBeInstanceOf(AppServerProtocolError);
  });

  it('rejects pending requests when the App Server process exits', async () => {
    const child = fakeChild();
    const { client } = createClient(child);
    await start(client, child);
    const pending = client.request('thread/start', {});

    child.emit('exit', 1);

    await expect(pending).rejects.toThrow(/transport exited/i);
  });

  it('is safe to destroy more than once', async () => {
    const child = fakeChild();
    const { client } = createClient(child);
    await start(client, child);

    client.destroy();
    client.destroy();

    expect(child.kill).toHaveBeenCalledOnce();
  });
});
