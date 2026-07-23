import { spawn, ChildProcess } from 'node:child_process';

export interface AcpClientOptions {
  /** Executable to spawn, e.g. 'gemini' or 'kimi'. */
  command: string;
  /** Arguments, e.g. ['--acp'] or ['acp']. */
  args: string[];
  /** Human-readable prefix for error messages, e.g. 'Gemini ACP'. Error-string
   *  prefixes are load-bearing: acpProvider's transport-failure detection
   *  matches on `${label} transport` / `${label} initialize`. */
  label: string;
  cwd: string;
  env: NodeJS.ProcessEnv;
  clientInfo?: {
    name: string;
    version: string;
  };
  /** Test seam. Defaults to node:child_process spawn. */
  spawnImpl?: typeof spawn;
}

export interface AcpClient {
  start(): Promise<void>;
  request<T = unknown>(method: string, params?: Record<string, unknown>): Promise<T>;
  notify(method: string, params?: Record<string, unknown>): void;
  onEvent(listener: (event: unknown) => void): () => void;
  dispose(): void;
}

interface PendingRequest {
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
}

export function createAcpClient(options: AcpClientOptions): AcpClient {
  const { label } = options;
  const spawnFn = options.spawnImpl ?? spawn;
  const clientInfo = options.clientInfo ?? { name: 'sai', version: '1.0' };
  let processHandle: ChildProcess | null = null;
  let nextId = 0;
  let stdoutBuffer = '';
  let startPromise: Promise<void> | null = null;
  let startResolve: (() => void) | null = null;
  let startReject: ((error: Error) => void) | null = null;
  let started = false;
  const pending = new Map<number, PendingRequest>();
  const eventListeners = new Set<(event: unknown) => void>();

  function rejectAllPending(error: Error) {
    for (const entry of pending.values()) {
      entry.reject(error);
    }
    pending.clear();

    if (startReject) {
      startReject(error);
      startReject = null;
      startResolve = null;
      startPromise = null;
    }
  }

  function writeMessage(message: unknown) {
    if (!processHandle?.stdin) {
      throw new Error(`${label} transport not started`);
    }
    processHandle.stdin.write(JSON.stringify(message) + '\n');
  }

  function handleMessage(message: any) {
    if (typeof message?.id === 'number') {
      if (message.id === 0 && startResolve) {
        if (message.error) {
          const error = new Error(message.error.message || `${label} initialize failed`);
          startReject?.(error);
        } else {
          started = true;
          startResolve();
        }
        startResolve = null;
        startReject = null;
      }

      const pendingRequest = pending.get(message.id);
      if (!pendingRequest) return;

      pending.delete(message.id);
      if (message.error) {
        pendingRequest.reject(new Error(message.error.message || `${label} request failed`));
      } else {
        pendingRequest.resolve(message.result);
      }
      return;
    }

    eventListeners.forEach(listener => listener(message));
  }

  function ensureStarted() {
    if (!started || !processHandle) {
      throw new Error(`${label} transport not started`);
    }
  }

  return {
    start() {
      if (startPromise) return startPromise;
      if (started) return Promise.resolve();

      startPromise = new Promise<void>((resolve, reject) => {
        startResolve = resolve;
        startReject = reject;
      });

      const proc = spawnFn(options.command, options.args, {
        cwd: options.cwd,
        env: options.env,
        stdio: ['pipe', 'pipe', 'pipe'],
        shell: process.platform === 'win32',
      });
      processHandle = proc;

      proc.stdout?.on('data', (chunk: Buffer) => {
        stdoutBuffer += chunk.toString();
        const lines = stdoutBuffer.split('\n');
        stdoutBuffer = lines.pop() || '';

        for (const line of lines) {
          if (!line.trim()) continue;
          let parsed: unknown;
          try {
            parsed = JSON.parse(line);
          } catch {
            continue; // malformed JSON — skip
          }
          try {
            handleMessage(parsed);
          } catch (err) {
            // handleMessage threw (e.g. a buggy event listener) — reject all
            // pending requests so callers don't hang waiting for a response
            // that was already consumed but not dispatched.
            rejectAllPending(err instanceof Error ? err : new Error(String(err)));
          }
        }
      });

      proc.on('error', (error) => {
        processHandle = null;
        started = false;
        rejectAllPending(new Error(`${label} transport error: ${error.message}`));
      });

      proc.on('exit', () => {
        processHandle = null;
        started = false;
        rejectAllPending(new Error(`${label} transport exited`));
      });

      writeMessage({
        jsonrpc: '2.0',
        id: nextId++,
        method: 'initialize',
        params: {
          protocolVersion: 1,
          clientInfo,
        },
      });

      return startPromise;
    },

    request<T = unknown>(method: string, params: Record<string, unknown> = {}) {
      ensureStarted();
      const id = nextId++;
      return new Promise<T>((resolve, reject) => {
        pending.set(id, { resolve: resolve as (value: unknown) => void, reject });
        writeMessage({
          jsonrpc: '2.0',
          id,
          method,
          params,
        });
      });
    },

    notify(method: string, params: Record<string, unknown> = {}) {
      ensureStarted();
      writeMessage({
        jsonrpc: '2.0',
        method,
        params,
      });
    },

    onEvent(listener: (event: unknown) => void) {
      eventListeners.add(listener);
      return () => {
        eventListeners.delete(listener);
      };
    },

    dispose() {
      rejectAllPending(new Error(`${label} transport disposed`));
      if (processHandle) {
        processHandle.kill();
        processHandle = null;
      }
      started = false;
    },
  };
}
