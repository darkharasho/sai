import { EventEmitter } from 'events';
import { Readable, Writable } from 'stream';
import { vi } from 'vitest';

// ---------------------------------------------------------------------------
// MockChildProcess
// ---------------------------------------------------------------------------

/**
 * A fake child process that exposes test helpers to drive stdout/stderr data
 * and the exit event without actually spawning anything.
 */
export class MockChildProcess extends EventEmitter {
  readonly stdin: Writable;
  readonly stdout: Readable;
  readonly stderr: Readable;

  /** Tracks whether kill() has been called and with which signal. */
  readonly kill: ReturnType<typeof vi.fn>;

  private readonly _stdout: Readable;
  private readonly _stderr: Readable;

  constructor() {
    super();

    // Stdin — tests can inspect what was written to the process
    this.stdin = new Writable({
      write(_chunk, _encoding, callback) {
        callback();
      },
    });

    // Stdout / stderr — we push data via helper methods
    this._stdout = new Readable({ read() {} });
    this._stderr = new Readable({ read() {} });
    this.stdout = this._stdout;
    this.stderr = this._stderr;

    this.kill = vi.fn((_signal?: NodeJS.Signals | number) => {
      // Simulate process being killed by emitting close
      process.nextTick(() => this.emit('close', null, _signal ?? 'SIGTERM'));
      return true;
    });
  }

  /** Push data onto the child process's stdout stream. */
  pushStdout(data: string | Buffer): void {
    this._stdout.push(data);
  }

  /** Push data onto the child process's stderr stream. */
  pushStderr(data: string | Buffer): void {
    this._stderr.push(data);
  }

  /**
   * Signal that the process exited with the given code.
   * Pushes null (EOF) to both streams then emits 'close' and 'exit'.
   */
  emitExit(code: number | null = 0): void {
    this._stdout.push(null);
    this._stderr.push(null);
    this.emit('exit', code, null);
    this.emit('close', code, null);
  }
}

// ---------------------------------------------------------------------------
// createMockSpawn
// ---------------------------------------------------------------------------

export interface MockSpawnResult {
  /** A vi.fn() that creates and tracks MockChildProcess instances */
  spawn: ReturnType<typeof vi.fn>;
  /** All MockChildProcess instances created so far */
  processes: MockChildProcess[];
  /** Returns the most recently spawned MockChildProcess, or throws if none */
  getLatest(): MockChildProcess;
}

/**
 * Returns a mock spawn function that creates MockChildProcess instances.
 * Inject `result.spawn` wherever `child_process.spawn` is used.
 *
 * @example
 * ```ts
 * const { spawn, getLatest } = createMockSpawn();
 * vi.spyOn(childProcess, 'spawn').mockImplementation(spawn);
 * // ... trigger code that calls spawn ...
 * const proc = getLatest();
 * proc.pushStdout('hello\n');
 * proc.emitExit(0);
 * ```
 */
export function createMockSpawn(): MockSpawnResult {
  const processes: MockChildProcess[] = [];

  const spawn = vi.fn((_command: string, _args?: string[], _options?: object) => {
    const proc = new MockChildProcess();
    processes.push(proc);
    return proc;
  });

  return {
    spawn,
    processes,
    getLatest(): MockChildProcess {
      if (processes.length === 0) {
        throw new Error('MockSpawn: no processes have been spawned yet');
      }
      return processes[processes.length - 1];
    },
  };
}
