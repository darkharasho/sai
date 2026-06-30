import { describe, it, expect, vi, afterEach } from 'vitest';

// ---------------------------------------------------------------------------
// vi.hoisted — shared state for the IPC routing test harness
// ---------------------------------------------------------------------------
const { readSaiSetting, sendImpl: mockSendImpl, mockIpcMain } = vi.hoisted(() => {
  const readSaiSetting = vi.fn();
  const sendImpl = vi.fn();

  type IpcHandler = (...args: unknown[]) => unknown;
  type IpcListener = (...args: unknown[]) => void;
  const handlers = new Map<string, IpcHandler>();
  const listeners = new Map<string, IpcListener[]>();
  const handle = vi.fn((ch: string, fn: IpcHandler) => { handlers.set(ch, fn); });
  const on = vi.fn((ch: string, fn: IpcListener) => {
    listeners.set(ch, [...(listeners.get(ch) ?? []), fn]);
  });
  const removeHandler = vi.fn((ch: string) => handlers.delete(ch));

  const mockIpcMain = {
    _handlers: handlers,
    _listeners: listeners,
    handle, on, removeHandler,
    async _invoke(ch: string, ...args: unknown[]): Promise<unknown> {
      const fn = handlers.get(ch);
      if (!fn) throw new Error(`No handler for "${ch}"`);
      return fn({ sender: {} } as unknown, ...args);
    },
    _emit(ch: string, ...args: unknown[]): void {
      for (const fn of listeners.get(ch) ?? []) fn({ sender: {} } as unknown, ...args);
    },
    _reset() {
      handlers.clear();
      listeners.clear();
    },
  };

  return { readSaiSetting, sendImpl, mockIpcMain };
});

// ---------------------------------------------------------------------------
// Module mocks
// ---------------------------------------------------------------------------
vi.mock('@electron/services/claude', async (importOriginal) => {
  const real = await importOriginal<typeof import('@electron/services/claude')>();
  return { ...real, readSaiSetting, sendImpl: mockSendImpl };
});

vi.mock('electron', () => ({
  ipcMain: mockIpcMain,
  app: { getPath: vi.fn().mockReturnValue('/tmp/sai-test') },
  BrowserWindow: vi.fn(),
}));

vi.mock('@electron/services/workspace', () => ({
  getOrCreate: vi.fn(),
  get: vi.fn(),
  getClaude: vi.fn(),
  touchActivity: vi.fn(),
  listAllWorkspaces: vi.fn().mockReturnValue([]),
}));

vi.mock('@electron/services/notify', () => ({
  notifyCompletion: vi.fn(),
  notifyApproval: vi.fn(),
  notifyQuestion: vi.fn(),
  notifyPlanReview: vi.fn(),
}));

vi.mock('node:fs', () => ({
  default: {
    existsSync: vi.fn().mockReturnValue(false),
    readFileSync: vi.fn().mockReturnValue('[]'),
    writeFileSync: vi.fn(),
    mkdirSync: vi.fn(),
  },
  existsSync: vi.fn().mockReturnValue(false),
  readFileSync: vi.fn().mockReturnValue('[]'),
  writeFileSync: vi.fn(),
  mkdirSync: vi.fn(),
}));

vi.mock('node:child_process', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:child_process')>();
  return { ...actual, spawn: vi.fn(), execFile: vi.fn() };
});

vi.mock('@electron/services/shellEnv', () => ({
  enrichedEnv: vi.fn().mockReturnValue({}),
  withNodeMemoryCap: vi.fn((env: any) => env),
}));

vi.mock('@electron/services/swarmMcpHost', () => ({
  start: vi.fn().mockReturnValue({ socketPath: '/tmp/sock', secret: 'x' }),
}));

vi.mock('@electron/services/swarmMcpConfig', () => ({
  writeSwarmMcpConfig: vi.fn().mockReturnValue('/tmp/mcp.json'),
}));

vi.mock('@electron/services/gemini', () => ({
  ensureGeminiCommitSession: vi.fn(),
  ensureGeminiTransport: vi.fn(),
  promptGeminiText: vi.fn(),
}));

vi.mock('@electron/services/idleScopeSweep', () => ({
  sweepIdleScopes: vi.fn(),
  IDLE_SCOPE_MS: 30 * 60 * 1000,
  SWEEP_INTERVAL_MS: 60 * 1000,
}));

vi.mock('@electron/services/claudeExit', () => ({
  exitTerminalEvents: vi.fn().mockReturnValue([]),
}));

vi.mock('@electron/services/imageFiles', () => ({
  imageReadResult: vi.fn().mockReturnValue(null),
}));

vi.mock('@electron/services/remote/session-bus', () => ({}));
vi.mock('@electron/services/remote/clamp', () => ({
  clamp: vi.fn((_a: any, _b: any) => _a),
}));

// ---------------------------------------------------------------------------
// Imports (after mocks)
// ---------------------------------------------------------------------------
import { getClaudeBackendSetting, getClaudeBackend, __setClaudeBackendForTests } from '@electron/services/claudeBackend';
import { CliBackend } from '@electron/services/claudeBackend/cliBackend';
import { registerClaudeHandlers } from '@electron/services/claude';

afterEach(() => {
  readSaiSetting.mockReset();
  mockSendImpl.mockReset();
});

describe('getClaudeBackendSetting', () => {
  it("defaults to 'cli' when unset", () => {
    readSaiSetting.mockReturnValue(undefined);
    expect(getClaudeBackendSetting()).toBe('cli');
  });
  it("returns 'sdk' when set to sdk", () => {
    readSaiSetting.mockReturnValue('sdk');
    expect(getClaudeBackendSetting()).toBe('sdk');
  });
  it("falls back to 'cli' for unknown values", () => {
    readSaiSetting.mockReturnValue('weird');
    expect(getClaudeBackendSetting()).toBe('cli');
  });
});

describe('CliBackend', () => {
  it('delegates send() to sendImpl with positional args', () => {
    const be = new CliBackend();
    be.send({ projectPath: '/p', message: 'hi', scope: 's' });
    expect(mockSendImpl).toHaveBeenCalledWith('/p', 'hi', undefined, undefined, undefined, undefined, 's', undefined);
  });

  it('send() with origin "remote" passes "remote" as the 8th positional arg', () => {
    const be = new CliBackend();
    be.send({ projectPath: '/p', message: 'hi', scope: 's', origin: 'remote' });
    expect(mockSendImpl).toHaveBeenCalledWith('/p', 'hi', undefined, undefined, undefined, undefined, 's', 'remote');
  });

  it('send() without origin passes undefined as the 8th positional arg', () => {
    const be = new CliBackend();
    be.send({ projectPath: '/p', message: 'hello' });
    expect(mockSendImpl).toHaveBeenCalledWith('/p', 'hello', undefined, undefined, undefined, undefined, undefined, undefined);
  });
});

describe('getClaudeBackend', () => {
  afterEach(() => __setClaudeBackendForTests(null));
  it('returns a CliBackend when flag is cli/absent', () => {
    readSaiSetting.mockReturnValue(undefined);
    expect(getClaudeBackend()).toBeInstanceOf(CliBackend);
  });
  it('falls back to CliBackend when flag is sdk (no SDK backend yet)', () => {
    readSaiSetting.mockReturnValue('sdk');
    expect(getClaudeBackend()).toBeInstanceOf(CliBackend);
  });
});

describe('IPC routing', () => {
  afterEach(() => {
    __setClaudeBackendForTests(null);
    mockIpcMain._reset();
  });

  it('claude:send IPC delegates to the active backend.send', () => {
    const sent: any[] = [];
    const stub = { send: (a: any) => sent.push(a) } as any;
    __setClaudeBackendForTests(stub);

    const fakeWin = { webContents: { send: vi.fn() }, isDestroyed: () => false } as any;
    registerClaudeHandlers(fakeWin);

    mockIpcMain._emit('claude:send', '/p', 'hi', undefined, undefined, undefined, undefined, 's');

    expect(sent).toHaveLength(1);
    expect(sent[0]).toEqual({
      projectPath: '/p',
      message: 'hi',
      imagePaths: undefined,
      permMode: undefined,
      effort: undefined,
      model: undefined,
      scope: 's',
    });
  });
});
