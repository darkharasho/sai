// @vitest-environment node
import { EventEmitter } from 'node:events';
import { describe, expect, it, vi } from 'vitest';
import { AppServerClient, AppServerProtocolError } from '../../../electron/services/codexBackend/appServerClient';

function fakeChild() {
  const child = new EventEmitter() as EventEmitter & {
    stdin: EventEmitter & { write: ReturnType<typeof vi.fn> };
    stdout: EventEmitter;
    kill: ReturnType<typeof vi.fn>;
  };
  child.stdin = Object.assign(new EventEmitter(), { write: vi.fn(() => true) });
  child.stdout = new EventEmitter();
  child.kill = vi.fn();
  return child;
}

function createClient(child: ReturnType<typeof fakeChild>, initializationTimeoutMs?: number) {
  const spawn = vi.fn(() => child);
  const client = new AppServerClient({
    spawn: spawn as never,
    resolveBundledCodex: () => ({ executablePath: '/app/codex', pathDirs: ['/app/bin'] }),
    getEnv: () => ({ PATH: '/usr/bin' }),
    initializationTimeoutMs,
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
      stdio: ['pipe', 'pipe', 'ignore'],
    }));
    expect(JSON.parse(child.stdin.write.mock.calls[1][0])).toEqual({ jsonrpc: '2.0', method: 'initialized' });
  });

  it('fails closed when initialize returns a JSON-RPC error', async () => {
    const child = fakeChild();
    const { client } = createClient(child);
    const failures: string[] = [];
    client.onFailure((error) => failures.push(error.message));

    const ready = client.start();
    reply(child, { jsonrpc: '2.0', id: 0, error: { code: -32000, message: 'initialization rejected' } });

    await expect(ready).rejects.toThrow(/initialization rejected/i);
    expect(client.failureReason).toMatch(/initialization rejected/i);
    expect(failures).toHaveLength(1);
    expect(child.kill).toHaveBeenCalledOnce();
  });

  it('fails closed when writing initialized fails', async () => {
    const child = fakeChild();
    child.stdin.write.mockImplementationOnce(() => true).mockImplementationOnce(() => {
      throw new Error('stdin closed');
    });
    const { client } = createClient(child);
    const failures: string[] = [];
    client.onFailure((error) => failures.push(error.message));

    const ready = client.start();
    reply(child, { jsonrpc: '2.0', id: 0, result: {} });

    await expect(ready).rejects.toThrow(/write failed: stdin closed/i);
    expect(client.failureReason).toMatch(/write failed: stdin closed/i);
    expect(failures).toEqual([expect.stringMatching(/write failed: stdin closed/i)]);
    expect(child.kill).toHaveBeenCalledOnce();
  });

  it('fails and terminates when initialization does not respond before its timeout', async () => {
    vi.useFakeTimers();
    try {
      const child = fakeChild();
      const { client } = createClient(child, 25);
      const ready = client.start();
      const rejected = expect(ready).rejects.toThrow(/initialization timed out after 25ms/i);

      await vi.advanceTimersByTimeAsync(25);

      await rejected;
      expect(client.failureReason).toMatch(/initialization timed out after 25ms/i);
      expect(child.kill).toHaveBeenCalledOnce();
    } finally {
      vi.useRealTimers();
    }
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

  it('rejects an unsupported server request, disables the preview, and surfaces its reason', async () => {
    const child = fakeChild();
    const { client } = createClient(child);
    await start(client, child);
    const failures: string[] = [];
    client.onFailure((error) => failures.push(error.message));
    const pending = client.request('thread/start', {});

    reply(child, { jsonrpc: '2.0', id: 99, method: 'item/commandExecution/requestApproval', params: {} });

    expect(JSON.parse(child.stdin.write.mock.calls.at(-1)[0])).toEqual({
      jsonrpc: '2.0', id: 99,
      error: { code: -32601, message: 'Unsupported App Server request in preview' },
    });
    await expect(pending).rejects.toThrow(/Unsupported App Server request in preview/);
    expect(client.failureReason).toBe('Unsupported App Server request in preview');
    expect(failures).toEqual(['Unsupported App Server request in preview']);
    expect(() => client.request('thread/start', {})).toThrow(/Unsupported App Server request in preview/);
  });

  it('fails closed rather than throwing from a server request when its error response cannot be written', async () => {
    const child = fakeChild();
    const { client } = createClient(child);
    await start(client, child);
    child.stdin.write.mockImplementationOnce(() => {
      throw new Error('stdin closed');
    });
    const pending = client.request('thread/start', {});

    expect(() => reply(child, { jsonrpc: '2.0', id: 99, method: 'item/commandExecution/requestApproval', params: {} })).not.toThrow();

    await expect(pending).rejects.toThrow(/write failed: stdin closed/i);
    expect(client.failureReason).toMatch(/write failed: stdin closed/i);
    expect(child.kill).toHaveBeenCalledOnce();
  });

  it('routes notifications to subscribers', async () => {
    const child = fakeChild();
    const { client } = createClient(child);
    await start(client, child);
    const events: unknown[] = [];
    client.onNotification((message) => events.push(message));

    reply(child, { jsonrpc: '2.0', method: 'turn/started', params: { turn: { id: 'turn-1' } } });

    expect(events).toEqual([{ jsonrpc: '2.0', method: 'turn/started', params: { turn: { id: 'turn-1' } } }]);
  });

  it('rejects pending requests after malformed protocol data', async () => {
    const child = fakeChild();
    const { client } = createClient(child);
    await start(client, child);
    const pending = client.request('thread/start', {});

    child.stdout.emit('data', Buffer.from('{not-json}\n'));

    await expect(pending).rejects.toBeInstanceOf(AppServerProtocolError);
  });

  it('rejects pending requests for an unexpected response ID', async () => {
    const child = fakeChild();
    const { client } = createClient(child);
    await start(client, child);
    const pending = client.request('thread/start', {});

    reply(child, { jsonrpc: '2.0', id: 99, result: {} });

    await expect(pending).rejects.toThrow(/unexpected response ID: 99/i);
  });

  it('rejects pending requests when the App Server process exits', async () => {
    const child = fakeChild();
    const { client } = createClient(child);
    await start(client, child);
    const pending = client.request('thread/start', {});

    child.emit('exit', 1);

    await expect(pending).rejects.toThrow(/transport exited/i);
  });

  it('rejects pending requests when the App Server process errors', async () => {
    const child = fakeChild();
    const { client } = createClient(child);
    await start(client, child);
    const pending = client.request('thread/start', {});

    child.emit('error', new Error('broken pipe'));

    await expect(pending).rejects.toThrow(/transport error: broken pipe/i);
  });

  it('fails closed when the App Server stdin stream errors', async () => {
    const child = fakeChild();
    const { client } = createClient(child);
    await start(client, child);
    const pending = client.request('thread/start', {});

    expect(() => child.stdin.emit('error', new Error('stdin disconnected'))).not.toThrow();

    await expect(pending).rejects.toThrow(/stdin error: stdin disconnected/i);
    expect(client.failureReason).toMatch(/stdin error: stdin disconnected/i);
    expect(child.kill).toHaveBeenCalledOnce();
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
