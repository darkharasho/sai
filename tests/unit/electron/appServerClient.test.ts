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
  expect(JSON.parse(child.stdin.write.mock.calls[0][0])).toEqual({
    id: 0, method: 'initialize', params: { clientInfo: { name: 'sai', version: '1.0' } },
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
    expect(JSON.parse(child.stdin.write.mock.calls[1][0])).toEqual({ method: 'initialized' });
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

  it('serializes every outgoing App Server message as headerless newline-delimited JSON', async () => {
    const child = fakeChild();
    const { client } = createClient(child);
    await start(client, child);

    const pending = client.request<{ thread: { id: string } }>('thread/start', { cwd: '/repo' });
    const request = JSON.parse(child.stdin.write.mock.calls.at(-1)[0]);
    expect(child.stdin.write.mock.calls.at(-1)[0]).toMatch(/\n$/);
    expect(request).toEqual({ id: 1, method: 'thread/start', params: { cwd: '/repo' } });
    reply(child, { jsonrpc: '2.0', id: 1, result: { thread: { id: 'thread-1' } } });

    await expect(pending).resolves.toEqual({ thread: { id: 'thread-1' } });
    client.notify('thread/archive', { threadId: 'thread-1' });

    reply(child, { jsonrpc: '2.0', id: 99, method: 'item/commandExecution/requestApproval', params: {} });

    const outgoing = child.stdin.write.mock.calls.map(([line]) => JSON.parse(line));
    expect(outgoing).toEqual([
      { id: 0, method: 'initialize', params: { clientInfo: { name: 'sai', version: '1.0' } } },
      { method: 'initialized' },
      { id: 1, method: 'thread/start', params: { cwd: '/repo' } },
      { method: 'thread/archive', params: { threadId: 'thread-1' } },
      { id: 99, error: { code: -32601, message: 'Unsupported App Server request in preview' } },
    ]);
    expect(outgoing.every((message) => !Object.hasOwn(message, 'jsonrpc'))).toBe(true);
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
      id: 99,
      error: { code: -32601, message: 'Unsupported App Server request in preview' },
    });
    await expect(pending).rejects.toThrow(/Unsupported App Server request in preview/);
    expect(client.failureReason).toBe('Unsupported App Server request in preview');
    expect(failures).toEqual(['Unsupported App Server request in preview']);
    expect(() => client.request('thread/start', {})).toThrow(/Unsupported App Server request in preview/);
  });

  it('lets a subscriber claim and settle a server request exactly once with headerless JSONL', async () => {
    const child = fakeChild();
    const { client } = createClient(child);
    await start(client, child);
    const received: Array<{ id: string | number; method: string; params?: unknown }> = [];
    let responder: { respond(result?: unknown): void } | undefined;

    client.onServerRequest((request) => {
      received.push(request);
      responder = client.claimServerRequest(request.id);
    });

    reply(child, {
      id: 'approval-1',
      method: 'item/commandExecution/requestApproval',
      params: { command: 'git status' },
    });

    expect(received).toEqual([{
      id: 'approval-1',
      method: 'item/commandExecution/requestApproval',
      params: { command: 'git status' },
    }]);
    expect(responder).toBeDefined();
    responder?.respond({ decision: 'accept' });

    const outgoing = child.stdin.write.mock.calls.map(([line]) => ({ line, body: JSON.parse(line) }));
    expect(outgoing.at(-1)).toEqual({
      line: `${JSON.stringify({ id: 'approval-1', result: { decision: 'accept' } })}\n`,
      body: { id: 'approval-1', result: { decision: 'accept' } },
    });
    expect(outgoing.at(-1)?.body).not.toHaveProperty('jsonrpc');
    expect(() => responder?.respond({ decision: 'accept' })).toThrow(/already resolved/i);
    expect(() => client.claimServerRequest('approval-1')).toThrow(/unknown or already claimed/i);
  });

  it('rejects duplicate and unknown server request settlement attempts', async () => {
    const child = fakeChild();
    const { client } = createClient(child);
    await start(client, child);
    let responder: { reject(error: { code: number; message: string }): void } | undefined;

    client.onServerRequest((request) => {
      responder = client.claimServerRequest(request.id);
    });
    reply(child, { id: 72, method: 'item/fileChange/requestApproval', params: {} });

    responder?.reject({ code: 4001, message: 'Denied' });
    expect(JSON.parse(child.stdin.write.mock.calls.at(-1)[0])).toEqual({
      id: 72,
      error: { code: 4001, message: 'Denied' },
    });
    expect(() => responder?.reject({ code: 4001, message: 'Denied' })).toThrow(/already resolved/i);
    expect(() => client.claimServerRequest('missing')).toThrow(/unknown or already claimed/i);
  });

  it('invalidates a claimed server request when the transport fails', async () => {
    const child = fakeChild();
    const { client } = createClient(child);
    await start(client, child);
    let responder: { respond(result?: unknown): void } | undefined;
    client.onServerRequest((request) => {
      responder = client.claimServerRequest(request.id);
    });
    reply(child, { id: 73, method: 'item/permissions/requestApproval', params: {} });

    child.emit('exit', 1);

    expect(() => responder?.respond({ decision: 'accept' })).toThrow(/no longer active/i);
    expect(child.stdin.write).toHaveBeenCalledTimes(2);
  });

  it('fails closed and invalidates the original responder when the server reuses a pending request ID', async () => {
    const child = fakeChild();
    const { client } = createClient(child);
    await start(client, child);
    let responder: { respond(result?: unknown): void } | undefined;
    client.onServerRequest((request) => {
      responder = client.claimServerRequest(request.id);
    });
    reply(child, { id: 74, method: 'item/permissions/requestApproval', params: {} });

    expect(() => reply(child, { id: 74, method: 'item/permissions/requestApproval', params: {} })).not.toThrow();

    expect(client.failureReason).toMatch(/duplicate server request ID: 74/i);
    expect(() => responder?.respond({ decision: 'accept' })).toThrow(/no longer active/i);
    expect(child.kill).toHaveBeenCalledOnce();
  });

  it('invalidates a claimed server request when destroyed', async () => {
    const child = fakeChild();
    const { client } = createClient(child);
    await start(client, child);
    let responder: { respond(result?: unknown): void } | undefined;
    client.onServerRequest((request) => {
      responder = client.claimServerRequest(request.id);
    });
    reply(child, { id: 75, method: 'item/permissions/requestApproval', params: {} });

    client.destroy();

    expect(() => responder?.respond({ decision: 'accept' })).toThrow(/no longer active/i);
    expect(child.stdin.write).toHaveBeenCalledTimes(2);
  });

  it('fails closed when a server request subscriber cannot claim the request', async () => {
    const child = fakeChild();
    const { client } = createClient(child);
    await start(client, child);
    client.onServerRequest(() => {
      throw new Error('backend registry failed');
    });

    expect(() => reply(child, { id: 76, method: 'item/permissions/requestApproval', params: {} })).not.toThrow();

    expect(client.failureReason).toMatch(/server request handler failed: backend registry failed/i);
    expect(child.kill).toHaveBeenCalledOnce();
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
