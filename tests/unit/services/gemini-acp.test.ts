import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const {
  mockSpawnFn,
  spawnProcesses,
  MockChildProcess,
} = vi.hoisted(() => {
  const { EventEmitter } = require('events');
  const { Readable, Writable } = require('stream');

  class MockChildProcess extends EventEmitter {
    stdout: InstanceType<typeof Readable>;
    stderr: InstanceType<typeof Readable>;
    stdin: InstanceType<typeof Writable>;
    kill: ReturnType<typeof vi.fn>;
    spawnArgs: string[];
    writeChunks: string[];

    private _stdout: InstanceType<typeof Readable>;
    private _stderr: InstanceType<typeof Readable>;

    constructor(args: string[] = []) {
      super();
      this.spawnArgs = args;
      this.writeChunks = [];
      this._stdout = new Readable({ read() {} });
      this._stderr = new Readable({ read() {} });
      this.stdout = this._stdout;
      this.stderr = this._stderr;
      this.stdin = new Writable({
        write: (chunk: Buffer | string, _enc: BufferEncoding, cb: (error?: Error | null) => void) => {
          this.writeChunks.push(chunk.toString());
          cb();
        },
      });
      this.kill = vi.fn(() => {
        process.nextTick(() => this.emit('exit', 0, null));
        return true;
      });
    }

    pushStdout(data: string | Buffer) {
      this._stdout.push(data);
    }

    pushStderr(data: string | Buffer) {
      this._stderr.push(data);
    }

    emitExit(code: number | null = 0, signal: string | null = null) {
      this._stdout.push(null);
      this._stderr.push(null);
      this.emit('exit', code, signal);
      this.emit('close', code, signal);
    }
  }

  const spawnProcesses: InstanceType<typeof MockChildProcess>[] = [];
  const mockSpawnFn = vi.fn((_cmd: string, args?: string[], _opts?: object) => {
    const proc = new MockChildProcess(args ?? []);
    spawnProcesses.push(proc);
    return proc;
  });

  return { mockSpawnFn, spawnProcesses, MockChildProcess };
});

vi.mock('node:child_process', () => {
  const { EventEmitter } = require('events');
  class ChildProcess extends EventEmitter {}
  return {
    spawn: mockSpawnFn,
    ChildProcess,
    default: { spawn: mockSpawnFn, ChildProcess },
  };
});

import { createGeminiAcpClient } from '@electron/services/gemini-acp';

const PROJECT = '/workspace/myproject';

function getLatestProcess(): InstanceType<typeof MockChildProcess> {
  if (spawnProcesses.length === 0) throw new Error('No spawned Gemini ACP process');
  return spawnProcesses[spawnProcesses.length - 1];
}

function parseWrittenMessages(proc: InstanceType<typeof MockChildProcess>) {
  return proc.writeChunks
    .join('')
    .split('\n')
    .filter(Boolean)
    .map(line => JSON.parse(line));
}

describe('gemini acp client', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    spawnProcesses.length = 0;
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('spawns gemini --acp and sends initialize on start', async () => {
    const client = createGeminiAcpClient({
      cwd: PROJECT,
      env: { PATH: process.env.PATH || '' },
      clientInfo: { name: 'sai', version: '1.0' },
    });

    const ready = client.start();
    const proc = getLatestProcess();

    expect(mockSpawnFn).toHaveBeenCalledWith(
      'gemini',
      ['--acp'],
      expect.objectContaining({
        cwd: PROJECT,
        stdio: ['pipe', 'pipe', 'pipe'],
      }),
    );

    const [initialize] = parseWrittenMessages(proc);
    expect(initialize).toEqual({
      jsonrpc: '2.0',
      id: 0,
      method: 'initialize',
      params: {
        protocolVersion: 1,
        clientInfo: { name: 'sai', version: '1.0' },
      },
    });

    proc.pushStdout(`${JSON.stringify({ jsonrpc: '2.0', id: 0, result: { protocolVersion: '1.0' } })}\n`);
    await expect(ready).resolves.toBeUndefined();
  });

  it('correlates request ids and resolves responses', async () => {
    const client = createGeminiAcpClient({ cwd: PROJECT, env: { PATH: process.env.PATH || '' } });
    const ready = client.start();
    const proc = getLatestProcess();
    proc.pushStdout(`${JSON.stringify({ jsonrpc: '2.0', id: 0, result: { protocolVersion: '1.0' } })}\n`);
    await ready;

    const promise = client.request<{ sessionId: string }>('session/new', { cwd: PROJECT });
    const requestMessage = parseWrittenMessages(proc)[1];
    expect(requestMessage).toEqual({
      jsonrpc: '2.0',
      id: 1,
      method: 'session/new',
      params: { cwd: PROJECT },
    });

    proc.pushStdout(`${JSON.stringify({ jsonrpc: '2.0', id: 1, result: { sessionId: 'gemini-session-1' } })}\n`);
    await expect(promise).resolves.toEqual({ sessionId: 'gemini-session-1' });
  });

  it('forwards non-response messages to event listeners', async () => {
    const client = createGeminiAcpClient({ cwd: PROJECT, env: { PATH: process.env.PATH || '' } });
    const onEvent = vi.fn();
    client.onEvent(onEvent);

    const ready = client.start();
    const proc = getLatestProcess();
    proc.pushStdout(`${JSON.stringify({ jsonrpc: '2.0', id: 0, result: { protocolVersion: '1.0' } })}\n`);
    await ready;

    proc.pushStdout(`${JSON.stringify({ jsonrpc: '2.0', method: 'session/updated', params: { sessionId: 'abc' } })}\n`);

    expect(onEvent).toHaveBeenCalledWith({
      jsonrpc: '2.0',
      method: 'session/updated',
      params: { sessionId: 'abc' },
    });
  });

  it('sends notifications without expecting a response', async () => {
    const client = createGeminiAcpClient({ cwd: PROJECT, env: { PATH: process.env.PATH || '' } });
    const ready = client.start();
    const proc = getLatestProcess();
    proc.pushStdout(`${JSON.stringify({ jsonrpc: '2.0', id: 0, result: { protocolVersion: '1.0' } })}\n`);
    await ready;

    client.notify('session/cancel', { sessionId: 'gemini-session-1' });

    const cancelMessage = parseWrittenMessages(proc)[1];
    expect(cancelMessage).toEqual({
      jsonrpc: '2.0',
      method: 'session/cancel',
      params: { sessionId: 'gemini-session-1' },
    });
  });

  it('rejects pending requests when the process exits unexpectedly', async () => {
    const client = createGeminiAcpClient({ cwd: PROJECT, env: { PATH: process.env.PATH || '' } });
    const ready = client.start();
    const proc = getLatestProcess();
    proc.pushStdout(`${JSON.stringify({ jsonrpc: '2.0', id: 0, result: { protocolVersion: '1.0' } })}\n`);
    await ready;

    const pending = client.request('session/load', { sessionId: 'dead-session' });
    proc.emitExit(1);

    await expect(pending).rejects.toThrow('Gemini ACP transport exited');
  });

  it('rejects requests when the transport returns a JSON-RPC error', async () => {
    const client = createGeminiAcpClient({ cwd: PROJECT, env: { PATH: process.env.PATH || '' } });
    const ready = client.start();
    const proc = getLatestProcess();
    proc.pushStdout(`${JSON.stringify({ jsonrpc: '2.0', id: 0, result: { protocolVersion: '1.0' } })}\n`);
    await ready;

    const pending = client.request('session/load', { sessionId: 'missing-session' });
    proc.pushStdout(`${JSON.stringify({
      jsonrpc: '2.0',
      id: 1,
      error: { code: -32001, message: 'session missing' },
    })}\n`);

    await expect(pending).rejects.toThrow('session missing');
  });
});
