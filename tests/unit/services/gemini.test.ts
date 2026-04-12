/**
 * Unit tests for electron/services/gemini.ts
 *
 * Design notes:
 * - vi.mock factories are hoisted before any variable declarations. Variables
 *   they reference must be created with vi.hoisted() so they're available when
 *   the factory runs.
 * - node:child_process is mocked without importOriginal — a direct factory with
 *   mockSpawnFn works reliably; the importOriginal spread approach does not
 *   intercept the spawn binding inside gemini.ts.
 * - @electron/services/workspace is NOT mocked via vi.mock because the alias
 *   path and the relative path used inside gemini.ts are different module IDs
 *   in Vitest's registry. We use the real workspace module and seed it in
 *   beforeEach instead.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// ---------------------------------------------------------------------------
// vi.hoisted — create stable shared objects before vi.mock factories run
// ---------------------------------------------------------------------------

const {
  mockIpcMain,
  mockHandlers,
  mockListeners,
  mockSpawnFn,
  spawnProcesses,
} = vi.hoisted(() => {
  const { EventEmitter } = require('events');
  const { Readable, Writable } = require('stream');

  // ---- Minimal MockChildProcess ----
  class MockChildProcess extends EventEmitter {
    stdout: InstanceType<typeof Readable>;
    stderr: InstanceType<typeof Readable>;
    stdin: InstanceType<typeof Writable>;
    kill: ReturnType<typeof vi.fn>;
    spawnArgs: string[];

    private _stdout: InstanceType<typeof Readable>;
    private _stderr: InstanceType<typeof Readable>;

    constructor(args: string[] = []) {
      super();
      this.spawnArgs = args;
      this._stdout = new Readable({ read() {} });
      this._stderr = new Readable({ read() {} });
      this.stdout = this._stdout;
      this.stderr = this._stderr;
      this.stdin = new Writable({ write(_c: unknown, _e: unknown, cb: () => void) { cb(); } });
      this.kill = vi.fn((_signal?: string | number) => {
        process.nextTick(() => this.emit('close', null, _signal ?? 'SIGTERM'));
        return true;
      });
    }

    pushStdout(data: string | Buffer) { this._stdout.push(data); }
    pushStderr(data: string | Buffer) { this._stderr.push(data); }
    emitExit(code: number | null = 0) {
      this._stdout.push(null);
      this._stderr.push(null);
      this.emit('exit', code, null);
      this.emit('close', code, null);
    }
  }

  // ---- Spawn mock ----
  const spawnProcesses: MockChildProcess[] = [];
  const mockSpawnFn = vi.fn((_cmd: string, _args?: string[], _opts?: object) => {
    const proc = new MockChildProcess(_args ?? []);
    spawnProcesses.push(proc);
    return proc;
  });

  // ---- ipcMain mock ----
  const mockHandlers = new Map<string, (...args: unknown[]) => unknown>();
  const mockListeners = new Map<string, Array<(...args: unknown[]) => void>>();

  const mockIpcMain = {
    _handlers: mockHandlers,
    _listeners: mockListeners,

    handle: vi.fn((channel: string, handler: (...args: unknown[]) => unknown) => {
      mockHandlers.set(channel, handler);
    }),
    on: vi.fn((channel: string, listener: (...args: unknown[]) => void) => {
      const existing = mockListeners.get(channel) ?? [];
      mockListeners.set(channel, [...existing, listener]);
    }),
    removeHandler: vi.fn((channel: string) => {
      mockHandlers.delete(channel);
    }),

    async _invoke(channel: string, ...args: unknown[]): Promise<unknown> {
      const handler = mockHandlers.get(channel);
      if (!handler) throw new Error(`No handler for channel "${channel}"`);
      return handler({ sender: {} }, ...args);
    },
    _emit(channel: string, ...args: unknown[]): void {
      const listeners = mockListeners.get(channel) ?? [];
      for (const listener of listeners) listener({ sender: {} }, ...args);
    },

    getLatestProcess(): MockChildProcess {
      if (spawnProcesses.length === 0) throw new Error('No processes spawned yet');
      return spawnProcesses[spawnProcesses.length - 1];
    },
  };

  return { mockIpcMain, mockHandlers, mockListeners, mockSpawnFn, spawnProcesses };
});

// ---------------------------------------------------------------------------
// Module mocks
// ---------------------------------------------------------------------------

vi.mock('node:child_process', () => {
  // Provide a minimal ChildProcess class so the named import in gemini.ts resolves
  const { EventEmitter } = require('events');
  class ChildProcess extends EventEmitter {}
  return {
    spawn: mockSpawnFn,
    ChildProcess,
    default: { spawn: mockSpawnFn, ChildProcess },
  };
});

vi.mock('electron', () => ({
  ipcMain: mockIpcMain,
  app: {
    getPath: vi.fn().mockReturnValue('/tmp'),
    getName: vi.fn().mockReturnValue('sai'),
  },
}));

// NOTE: We intentionally do NOT mock @electron/services/workspace here.
// Vitest resolves vi.mock('@electron/services/workspace') via the @electron alias,
// but gemini.ts imports workspace via the relative path './workspace'. These paths
// resolve to the same file on disk but are different module IDs in Vitest's registry,
// so the mock would not intercept the import inside gemini.ts.
// We use the real workspace module and seed it with getOrCreate() in beforeEach.

vi.mock('@electron/services/notify', () => ({
  notifyCompletion: vi.fn(),
}));

// ---------------------------------------------------------------------------
// Imports after mocks
// ---------------------------------------------------------------------------

import { registerGeminiHandlers } from '@electron/services/gemini';
import { getOrCreate, get } from '@electron/services/workspace';
import { createMockBrowserWindow } from '../../helpers/electron-mock';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const PROJECT = '/workspace/myproject';

/** Await one event-loop tick */
const tick = () => new Promise<void>(r => process.nextTick(r));

function collectSentEvents(win: ReturnType<typeof createMockBrowserWindow>) {
  return (win.webContents.send as ReturnType<typeof vi.fn>).mock.calls
    .filter(([ch]: [string]) => ch === 'claude:message')
    .map(([, ev]: [string, unknown]) => ev);
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('gemini service', () => {
  let mockWin: ReturnType<typeof createMockBrowserWindow>;

  beforeEach(() => {
    vi.clearAllMocks();
    mockHandlers.clear();
    mockListeners.clear();
    spawnProcesses.length = 0;

    mockWin = createMockBrowserWindow();
    registerGeminiHandlers(mockWin as unknown as import('electron').BrowserWindow);

    // Seed the real workspace module with a fresh workspace for PROJECT
    getOrCreate(PROJECT);
    const ws = get(PROJECT)!;
    // Reset any lingering process state from previous tests
    if (ws.gemini.process) {
      try { ws.gemini.process.kill(); } catch { /* ignore */ }
      ws.gemini.process = null;
    }
    ws.gemini.busy = false;
    ws.gemini.buffer = '';
    ws.gemini.cwd = PROJECT;
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // -------------------------------------------------------------------------
  // Models
  // -------------------------------------------------------------------------

  describe('gemini:models handler', () => {
    it('returns the hardcoded model list', async () => {
      const result = await mockIpcMain._invoke('gemini:models') as {
        models: { id: string; name: string }[];
      };

      expect(result.models).toBeInstanceOf(Array);
      expect(result.models.length).toBeGreaterThan(0);
      const ids = result.models.map(m => m.id);
      expect(ids).toContain('auto-gemini-3');
      expect(ids).toContain('gemini-2.5-pro');
      for (const model of result.models) {
        expect(typeof model.id).toBe('string');
        expect(typeof model.name).toBe('string');
      }
    });

    it('returns auto-gemini-3 as the default model', async () => {
      const result = await mockIpcMain._invoke('gemini:models') as { defaultModel: string };
      expect(result.defaultModel).toBe('auto-gemini-3');
    });
  });

  // -------------------------------------------------------------------------
  // Event translation (via gemini:send integration)
  // -------------------------------------------------------------------------

  describe('event translation via gemini:send', () => {
    function sendMessage(opts: {
      message?: string;
      approvalMode?: string;
      conversationMode?: string;
      model?: string;
    } = {}) {
      mockIpcMain._emit(
        'gemini:send',
        PROJECT,
        opts.message ?? 'Hello',
        undefined,
        opts.approvalMode,
        opts.conversationMode,
        opts.model,
      );
    }

    it('does not emit session_id events (stateless one-shot turns)', async () => {
      sendMessage();
      const proc = mockIpcMain.getLatestProcess();
      (mockWin.webContents.send as ReturnType<typeof vi.fn>).mockClear();

      proc.pushStdout(JSON.stringify({ type: 'init', session_id: 'abc-123' }) + '\n');
      await tick();

      const events = collectSentEvents(mockWin);
      expect(events).not.toContainEqual(
        expect.objectContaining({ type: 'session_id' }),
      );
    });

    it('does not pass --resume flag (stateless turns)', async () => {
      sendMessage();
      const proc1 = mockIpcMain.getLatestProcess();
      const resumeIdx = proc1.spawnArgs.indexOf('--resume');
      expect(resumeIdx).toBe(-1);
    });

    it('translates assistant message to assistant event with text', async () => {
      sendMessage();
      const proc = mockIpcMain.getLatestProcess();
      proc.pushStdout(
        JSON.stringify({ type: 'message', role: 'assistant', content: 'Hello world' }) + '\n',
      );
      await tick();

      expect(collectSentEvents(mockWin)).toContainEqual(
        expect.objectContaining({
          type: 'assistant',
          projectPath: PROJECT,
          message: { content: [{ type: 'text', text: 'Hello world' }] },
        }),
      );
    });

    it('skips user message echoes', async () => {
      sendMessage();
      const proc = mockIpcMain.getLatestProcess();
      proc.pushStdout(
        JSON.stringify({ type: 'message', role: 'user', content: 'User said this' }) + '\n',
      );
      await tick();

      expect(collectSentEvents(mockWin)).not.toContainEqual(
        expect.objectContaining({ type: 'assistant' }),
      );
    });

    it('translates tool_use event to assistant with tool_use content', async () => {
      sendMessage();
      const proc = mockIpcMain.getLatestProcess();
      proc.pushStdout(
        JSON.stringify({ type: 'tool_use', tool_name: 'bash', parameters: { command: 'ls' } }) + '\n',
      );
      await tick();

      expect(collectSentEvents(mockWin)).toContainEqual(
        expect.objectContaining({
          type: 'assistant',
          projectPath: PROJECT,
          message: { content: [{ type: 'tool_use', name: 'bash', input: { command: 'ls' } }] },
        }),
      );
    });

    it('translates tool_use using fallback name fields', async () => {
      sendMessage();
      const proc = mockIpcMain.getLatestProcess();
      proc.pushStdout(
        JSON.stringify({ type: 'tool_use', name: 'read_file', arguments: { path: '/foo' } }) + '\n',
      );
      await tick();

      expect(collectSentEvents(mockWin)).toContainEqual(
        expect.objectContaining({
          type: 'assistant',
          message: expect.objectContaining({
            content: [expect.objectContaining({ name: 'read_file' })],
          }),
        }),
      );
    });

    it('translates result event with stats to result + done', async () => {
      sendMessage();
      const proc = mockIpcMain.getLatestProcess();
      proc.pushStdout(
        JSON.stringify({
          type: 'result',
          status: 'success',
          stats: { input_tokens: 100, output_tokens: 50, cached: 10 },
        }) + '\n',
      );
      await tick();

      const events = collectSentEvents(mockWin);
      expect(events).toContainEqual(
        expect.objectContaining({
          type: 'result',
          projectPath: PROJECT,
          usage: {
            input_tokens: 100,
            cache_read_input_tokens: 10,
            cache_creation_input_tokens: 0,
            output_tokens: 50,
          },
        }),
      );
      expect(events).toContainEqual(expect.objectContaining({ type: 'done', projectPath: PROJECT }));
    });

    it('translates result with error status to error + done', async () => {
      sendMessage();
      const proc = mockIpcMain.getLatestProcess();
      proc.pushStdout(
        JSON.stringify({ type: 'result', status: 'error', error: 'Rate limit exceeded' }) + '\n',
      );
      await tick();

      const events = collectSentEvents(mockWin);
      expect(events).toContainEqual(
        expect.objectContaining({ type: 'error', projectPath: PROJECT, text: 'Rate limit exceeded' }),
      );
      expect(events).toContainEqual(expect.objectContaining({ type: 'done', projectPath: PROJECT }));
    });

    it('translates error event to error + done', async () => {
      sendMessage();
      const proc = mockIpcMain.getLatestProcess();
      proc.pushStdout(
        JSON.stringify({ type: 'error', message: 'Something went wrong' }) + '\n',
      );
      await tick();

      const events = collectSentEvents(mockWin);
      expect(events).toContainEqual(
        expect.objectContaining({ type: 'error', projectPath: PROJECT, text: 'Something went wrong' }),
      );
      expect(events).toContainEqual(expect.objectContaining({ type: 'done', projectPath: PROJECT }));
    });

    it('translates error event using error string field', async () => {
      sendMessage();
      const proc = mockIpcMain.getLatestProcess();
      proc.pushStdout(JSON.stringify({ type: 'error', error: 'Quota exceeded' }) + '\n');
      await tick();

      expect(collectSentEvents(mockWin)).toContainEqual(
        expect.objectContaining({ type: 'error', text: 'Quota exceeded' }),
      );
    });

    it('falls back to "Gemini error" when error event has no message or error field', async () => {
      sendMessage();
      const proc = mockIpcMain.getLatestProcess();
      proc.pushStdout(JSON.stringify({ type: 'error' }) + '\n');
      await tick();

      expect(collectSentEvents(mockWin)).toContainEqual(
        expect.objectContaining({ type: 'error', text: 'Gemini error' }),
      );
    });

    it('ignores tool_result event types silently', async () => {
      sendMessage();
      const proc = mockIpcMain.getLatestProcess();
      // Clear streaming_start sent by gemini:send itself
      (mockWin.webContents.send as ReturnType<typeof vi.fn>).mockClear();

      proc.pushStdout(JSON.stringify({ type: 'tool_result', content: 'ok' }) + '\n');
      await tick();

      expect(collectSentEvents(mockWin)).toHaveLength(0);
    });
  });

  // -------------------------------------------------------------------------
  // Spawn args
  // -------------------------------------------------------------------------

  describe('gemini:send spawn args', () => {
    function getSpawnArgs(): string[] {
      return mockSpawnFn.mock.calls[0][1] as string[];
    }

    it('includes --output-format stream-json in args', () => {
      mockIpcMain._emit('gemini:send', PROJECT, 'test', undefined, undefined, undefined, undefined);
      const args = getSpawnArgs();
      expect(args).toContain('--output-format');
      expect(args).toContain('stream-json');
    });

    it('spawns the gemini binary', () => {
      mockIpcMain._emit('gemini:send', PROJECT, 'test', undefined, undefined, undefined, undefined);
      expect(mockSpawnFn.mock.calls[0][0]).toBe('gemini');
    });

    it('uses gemini-2.5-flash model when conversationMode is fast', () => {
      mockIpcMain._emit('gemini:send', PROJECT, 'test', undefined, undefined, 'fast', undefined);
      const args = getSpawnArgs();
      const idx = args.indexOf('-m');
      expect(idx).toBeGreaterThan(-1);
      expect(args[idx + 1]).toBe('gemini-2.5-flash');
    });

    it('uses the specified model in normal mode', () => {
      mockIpcMain._emit('gemini:send', PROJECT, 'test', undefined, undefined, 'normal', 'gemini-2.5-pro');
      const args = getSpawnArgs();
      const idx = args.indexOf('-m');
      expect(idx).toBeGreaterThan(-1);
      expect(args[idx + 1]).toBe('gemini-2.5-pro');
    });

    it('falls back to default model (auto-gemini-3) when no model or mode is specified', () => {
      mockIpcMain._emit('gemini:send', PROJECT, 'test', undefined, undefined, undefined, undefined);
      const args = getSpawnArgs();
      const idx = args.indexOf('-m');
      expect(idx).toBeGreaterThan(-1);
      expect(args[idx + 1]).toBe('auto-gemini-3');
    });

    it('adds --approval-mode flag with explicit value when provided', () => {
      mockIpcMain._emit('gemini:send', PROJECT, 'test', undefined, 'suggest', undefined, undefined);
      const args = getSpawnArgs();
      expect(args).toContain('--approval-mode');
      expect(args).toContain('suggest');
    });

    it('passes explicit "default" approval mode when set', () => {
      mockIpcMain._emit('gemini:send', PROJECT, 'test', undefined, 'default', undefined, undefined);
      const args = getSpawnArgs();
      expect(args).toContain('--approval-mode');
      expect(args).toContain('default');
    });

    it('defaults to auto_edit approval mode when not specified', () => {
      mockIpcMain._emit('gemini:send', PROJECT, 'test', undefined, undefined, undefined, undefined);
      const args = getSpawnArgs();
      expect(args).toContain('--approval-mode');
      expect(args).toContain('auto_edit');
    });

    it('passes the prompt with -p flag as first two args', () => {
      mockIpcMain._emit('gemini:send', PROJECT, 'my prompt', undefined, undefined, undefined, undefined);
      const args = getSpawnArgs();
      expect(args[0]).toBe('-p');
      expect(args[1]).toBe('my prompt');
    });
  });

  // -------------------------------------------------------------------------
  // Streaming buffer accumulation
  // -------------------------------------------------------------------------

  describe('streaming buffer accumulation', () => {
    it('accumulates partial chunks and only parses complete JSON lines', async () => {
      mockIpcMain._emit('gemini:send', PROJECT, 'test', undefined, undefined, undefined, undefined);
      const proc = mockIpcMain.getLatestProcess();

      const fullLine = JSON.stringify({ type: 'message', role: 'assistant', content: 'chunked' });
      const half = Math.floor(fullLine.length / 2);

      // Push first half — no newline so no complete line yet
      proc.pushStdout(fullLine.slice(0, half));
      await tick();

      const partialAssistant = (mockWin.webContents.send as ReturnType<typeof vi.fn>).mock.calls
        .filter(([, ev]: [string, unknown]) => (ev as { type?: string })?.type === 'assistant');
      expect(partialAssistant).toHaveLength(0);

      // Push remainder + newline → line is now complete and should be parsed
      proc.pushStdout(fullLine.slice(half) + '\n');
      await tick();

      expect(collectSentEvents(mockWin)).toContainEqual(
        expect.objectContaining({ type: 'assistant', projectPath: PROJECT }),
      );
    });

    it('parses multiple JSON lines arriving in a single chunk', async () => {
      mockIpcMain._emit('gemini:send', PROJECT, 'test', undefined, undefined, undefined, undefined);
      const proc = mockIpcMain.getLatestProcess();

      const twoLines =
        JSON.stringify({ type: 'message', role: 'assistant', content: 'first' }) + '\n' +
        JSON.stringify({ type: 'message', role: 'assistant', content: 'second' }) + '\n';

      proc.pushStdout(twoLines);
      await tick();

      const assistantEvents = (mockWin.webContents.send as ReturnType<typeof vi.fn>).mock.calls
        .filter(([ch, ev]: [string, unknown]) =>
          ch === 'claude:message' && (ev as { type?: string })?.type === 'assistant',
        );
      expect(assistantEvents).toHaveLength(2);
    });

    it('skips empty and blank lines without throwing', async () => {
      mockIpcMain._emit('gemini:send', PROJECT, 'test', undefined, undefined, undefined, undefined);
      const proc = mockIpcMain.getLatestProcess();

      proc.pushStdout('\n\n   \n' + JSON.stringify({ type: 'init' }) + '\n');
      await tick();

      expect(collectSentEvents(mockWin)).toContainEqual(
        expect.objectContaining({ type: 'streaming_start' }),
      );
    });

    it('ignores malformed JSON lines without throwing and continues parsing valid ones', async () => {
      mockIpcMain._emit('gemini:send', PROJECT, 'test', undefined, undefined, undefined, undefined);
      const proc = mockIpcMain.getLatestProcess();

      proc.pushStdout('not valid json {\n');
      proc.pushStdout(JSON.stringify({ type: 'message', role: 'assistant', content: 'ok' }) + '\n');
      await tick();

      expect(collectSentEvents(mockWin)).toContainEqual(
        expect.objectContaining({ type: 'assistant' }),
      );
    });
  });
});
