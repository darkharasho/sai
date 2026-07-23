import { describe, it, expect, vi } from 'vitest';
import { EventEmitter } from 'node:events';
import { createAcpClient } from '../../../electron/services/acp';

function fakeChild() {
  const child: any = new EventEmitter();
  child.stdin = { write: vi.fn() };
  child.stdout = new EventEmitter();
  child.stderr = new EventEmitter();
  child.kill = vi.fn();
  return child;
}

function makeClient(child: any, overrides: Partial<Parameters<typeof createAcpClient>[0]> = {}) {
  const spawnImpl = vi.fn(() => child);
  const client = createAcpClient({
    command: 'kimi',
    args: ['acp'],
    label: 'Kimi ACP',
    cwd: '/tmp/proj',
    env: { PATH: '/usr/bin' },
    spawnImpl: spawnImpl as any,
    ...overrides,
  });
  return { client, spawnImpl };
}

function reply(child: any, msg: unknown) {
  child.stdout.emit('data', Buffer.from(JSON.stringify(msg) + '\n'));
}

describe('createAcpClient', () => {
  it('spawns the configured command with args and cwd', async () => {
    const child = fakeChild();
    const { client, spawnImpl } = makeClient(child);
    const started = client.start();
    reply(child, { jsonrpc: '2.0', id: 0, result: {} });
    await started;
    expect(spawnImpl).toHaveBeenCalledWith('kimi', ['acp'], expect.objectContaining({ cwd: '/tmp/proj' }));
  });

  it('sends initialize as request id 0 and resolves start on its response', async () => {
    const child = fakeChild();
    const { client } = makeClient(child);
    const started = client.start();
    const firstWrite = JSON.parse(child.stdin.write.mock.calls[0][0]);
    expect(firstWrite).toMatchObject({ id: 0, method: 'initialize' });
    reply(child, { jsonrpc: '2.0', id: 0, result: {} });
    await expect(started).resolves.toBeUndefined();
  });

  it('routes responses to pending requests and events to listeners', async () => {
    const child = fakeChild();
    const { client } = makeClient(child);
    const started = client.start();
    reply(child, { jsonrpc: '2.0', id: 0, result: {} });
    await started;
    const events: unknown[] = [];
    client.onEvent(e => events.push(e));
    const req = client.request<{ ok: boolean }>('session/new', { cwd: '/tmp/proj' });
    const sent = JSON.parse(child.stdin.write.mock.calls.at(-1)[0]);
    reply(child, { jsonrpc: '2.0', method: 'session/update', params: { n: 1 } });
    reply(child, { jsonrpc: '2.0', id: sent.id, result: { ok: true } });
    await expect(req).resolves.toEqual({ ok: true });
    expect(events).toEqual([{ jsonrpc: '2.0', method: 'session/update', params: { n: 1 } }]);
  });

  it('rejects pending requests with the label when the process exits', async () => {
    const child = fakeChild();
    const { client } = makeClient(child);
    const started = client.start();
    reply(child, { jsonrpc: '2.0', id: 0, result: {} });
    await started;
    const req = client.request('session/prompt', {});
    child.emit('exit');
    await expect(req).rejects.toThrow('Kimi ACP transport exited');
  });

  it('uses the label in the not-started error', () => {
    const child = fakeChild();
    const { client } = makeClient(child);
    expect(() => client.notify('x')).toThrow('Kimi ACP transport not started');
  });
});
