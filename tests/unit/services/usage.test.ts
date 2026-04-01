// @vitest-environment node
/**
 * Unit tests for electron/services/usage.ts
 *
 * Regression coverage:
 *   f2c6146 – mode detection reads file directly (not cached token), uses
 *             highest-utilization limit when multiple rate-limit objects exist
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { IncomingMessage, ClientRequest } from 'node:http';

// ---------------------------------------------------------------------------
// vi.hoisted — stable objects shared between vi.mock factories and test code
// ---------------------------------------------------------------------------
const { mockIpcMain, mockFs, mockHttps } = vi.hoisted(() => {
  // Minimal IpcMain mock
  type IpcHandler = (...args: unknown[]) => unknown;
  const handlers = new Map<string, IpcHandler>();

  const mockIpcMain = {
    _handlers: handlers,
    handle: vi.fn((channel: string, fn: IpcHandler) => {
      handlers.set(channel, fn);
    }),
    on: vi.fn(),
    removeHandler: vi.fn(),
    async _invoke(channel: string, ...args: unknown[]) {
      const fn = handlers.get(channel);
      if (!fn) throw new Error(`No handler for "${channel}"`);
      return fn({ sender: {} } as unknown, ...args);
    },
  };

  // fs mock — readFileSync is used by usage.ts
  const mockFs = {
    readFileSync: vi.fn(),
  };

  // https mock — used for fetchUsage
  const mockHttps = {
    request: vi.fn(),
  };

  return { mockIpcMain, mockFs, mockHttps };
});

// ---------------------------------------------------------------------------
// Module mocks
// ---------------------------------------------------------------------------

vi.mock('electron', () => ({
  ipcMain: mockIpcMain,
  BrowserWindow: vi.fn(),
  app: { getPath: vi.fn().mockReturnValue('/mock/userData') },
}));

vi.mock('node:fs', () => ({
  default: mockFs,
  readFileSync: mockFs.readFileSync,
}));

vi.mock('node:https', () => ({
  default: mockHttps,
}));

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeCredentialsJson(token: string | null) {
  if (token === null) {
    return JSON.stringify({ claudeAiOauth: {} });
  }
  return JSON.stringify({ claudeAiOauth: { accessToken: token } });
}

/**
 * Builds a fake https request/response that resolves synchronously
 * (callbacks are called directly on `req.end()`, no setImmediate).
 */
function makeSyncFakeRequest(
  statusCode: number,
  body: string,
  headers: Record<string, string> = {},
) {
  let dataCallback: ((chunk: Buffer) => void) | null = null;
  let endCallback: (() => void) | null = null;

  const fakeRes = {
    statusCode,
    headers,
    on(event: string, cb: (...a: unknown[]) => void) {
      if (event === 'data') dataCallback = cb as (chunk: Buffer) => void;
      if (event === 'end') endCallback = cb as () => void;
    },
  } as unknown as IncomingMessage;

  const fakeReq = {
    on: vi.fn(),
    setTimeout: vi.fn(),
    end: vi.fn(() => {
      // Fire synchronously so no timer/setImmediate issues
      dataCallback?.(Buffer.from(body));
      endCallback?.();
    }),
    destroy: vi.fn(),
  } as unknown as ClientRequest;

  mockHttps.request.mockImplementation((_opts: unknown, cb: (r: IncomingMessage) => void) => {
    cb(fakeRes);
    return fakeReq;
  });

  return { fakeReq, fakeRes };
}

function createMockBrowserWindow() {
  return {
    webContents: { send: vi.fn() },
    isDestroyed: vi.fn().mockReturnValue(false),
    isFocused: vi.fn().mockReturnValue(false),
    on: vi.fn(),
  };
}

// ---------------------------------------------------------------------------
// Per-test setup/teardown
// ---------------------------------------------------------------------------

beforeEach(() => {
  vi.resetModules();
  vi.useFakeTimers();
  mockIpcMain._handlers.clear();
  mockIpcMain.handle.mockClear();
  mockFs.readFileSync.mockReset();
  mockHttps.request.mockReset();
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

// ---------------------------------------------------------------------------
// Helpers to load a fresh module per test
// ---------------------------------------------------------------------------

async function loadService() {
  return import('../../../electron/services/usage');
}

// ===========================================================================
// OAuth token reading
// ===========================================================================

describe('readOAuthToken (via usage:fetch handler)', () => {
  it('reads OAuth token from credentials file', async () => {
    mockFs.readFileSync.mockReturnValue(makeCredentialsJson('tok-123'));
    makeSyncFakeRequest(200, JSON.stringify({ data: 'ok' }));

    const { registerUsageHandlers } = await loadService();
    registerUsageHandlers(createMockBrowserWindow() as never);

    const result = await mockIpcMain._invoke('usage:fetch');
    expect(result).toEqual({ data: 'ok' });
  });

  it('caches token after first read — readFileSync called once for multiple fetches', async () => {
    mockFs.readFileSync.mockReturnValue(makeCredentialsJson('tok-abc'));
    makeSyncFakeRequest(200, JSON.stringify({}));

    const { registerUsageHandlers } = await loadService();
    registerUsageHandlers(createMockBrowserWindow() as never);

    await mockIpcMain._invoke('usage:fetch');
    // Re-arm the https mock
    makeSyncFakeRequest(200, JSON.stringify({}));
    await mockIpcMain._invoke('usage:fetch');

    // The token read path hits readFileSync the first time, then uses cachedToken.
    expect(mockFs.readFileSync).toHaveBeenCalledTimes(1);
  });

  it('returns null when credentials file is missing', async () => {
    mockFs.readFileSync.mockImplementation(() => { throw new Error('ENOENT'); });

    const { registerUsageHandlers } = await loadService();
    registerUsageHandlers(createMockBrowserWindow() as never);

    const result = await mockIpcMain._invoke('usage:fetch');
    expect(result).toBeNull();
  });

  it('returns null when credentials file has no accessToken', async () => {
    mockFs.readFileSync.mockReturnValue(JSON.stringify({ claudeAiOauth: {} }));

    const { registerUsageHandlers } = await loadService();
    registerUsageHandlers(createMockBrowserWindow() as never);

    const result = await mockIpcMain._invoke('usage:fetch');
    expect(result).toBeNull();
  });
});

// ===========================================================================
// Billing mode detection (regression: f2c6146)
// ===========================================================================

describe('usage:mode — billing mode detection (regression f2c6146)', () => {
  it('returns "subscription" when accessToken is present', async () => {
    mockFs.readFileSync.mockReturnValue(makeCredentialsJson('tok-sub'));

    const { registerUsageHandlers } = await loadService();
    registerUsageHandlers(createMockBrowserWindow() as never);

    const mode = await mockIpcMain._invoke('usage:mode');
    expect(mode).toBe('subscription');
  });

  it('returns "api" when accessToken is absent', async () => {
    mockFs.readFileSync.mockReturnValue(makeCredentialsJson(null));

    const { registerUsageHandlers } = await loadService();
    registerUsageHandlers(createMockBrowserWindow() as never);

    const mode = await mockIpcMain._invoke('usage:mode');
    expect(mode).toBe('api');
  });

  it('returns "api" when credentials file is missing', async () => {
    mockFs.readFileSync.mockImplementation(() => { throw new Error('ENOENT'); });

    const { registerUsageHandlers } = await loadService();
    registerUsageHandlers(createMockBrowserWindow() as never);

    const mode = await mockIpcMain._invoke('usage:mode');
    expect(mode).toBe('api');
  });

  it('bypasses token cache — reads file fresh each time for mode detection', async () => {
    // First call: token present → subscription
    mockFs.readFileSync
      .mockReturnValueOnce(makeCredentialsJson('tok-present'))
      .mockReturnValueOnce(makeCredentialsJson(null));

    const { registerUsageHandlers } = await loadService();
    registerUsageHandlers(createMockBrowserWindow() as never);

    const mode1 = await mockIpcMain._invoke('usage:mode');
    const mode2 = await mockIpcMain._invoke('usage:mode');

    expect(mode1).toBe('subscription');
    expect(mode2).toBe('api');
    // File was read twice (once per mode call)
    expect(mockFs.readFileSync).toHaveBeenCalledTimes(2);
  });
});

// ===========================================================================
// Polling
// ===========================================================================

describe('polling', () => {
  it('sends usage:update after initial 5-second delay', async () => {
    mockFs.readFileSync.mockReturnValue(makeCredentialsJson('poll-token'));
    makeSyncFakeRequest(200, JSON.stringify({ updated: true }));

    const { registerUsageHandlers, destroyUsagePolling } = await loadService();
    const win = createMockBrowserWindow();
    registerUsageHandlers(win as never);

    // Advance past the initial 5s delay
    await vi.advanceTimersByTimeAsync(5_001);

    expect(win.webContents.send).toHaveBeenCalledWith('usage:update', expect.any(Object));

    destroyUsagePolling();
  });

  it('polls again at 60-second interval', async () => {
    mockFs.readFileSync.mockReturnValue(makeCredentialsJson('poll-token'));
    makeSyncFakeRequest(200, JSON.stringify({ tick: 0 }));

    const { registerUsageHandlers, destroyUsagePolling } = await loadService();
    const win = createMockBrowserWindow();
    registerUsageHandlers(win as never);

    // Initial fetch
    await vi.advanceTimersByTimeAsync(5_001);
    const callsAfterInit = (win.webContents.send as ReturnType<typeof vi.fn>).mock.calls.length;

    // Set up next response
    makeSyncFakeRequest(200, JSON.stringify({ tick: 1 }));
    await vi.advanceTimersByTimeAsync(60_001);

    expect((win.webContents.send as ReturnType<typeof vi.fn>).mock.calls.length)
      .toBeGreaterThan(callsAfterInit);

    destroyUsagePolling();
  });

  it('does not send when no OAuth token available', async () => {
    mockFs.readFileSync.mockImplementation(() => { throw new Error('ENOENT'); });

    const { registerUsageHandlers, destroyUsagePolling } = await loadService();
    const win = createMockBrowserWindow();
    registerUsageHandlers(win as never);

    await vi.advanceTimersByTimeAsync(65_001);

    expect(win.webContents.send).not.toHaveBeenCalledWith('usage:update', expect.anything());

    destroyUsagePolling();
  });
});

// ===========================================================================
// Rate-limit back-off on 429
// ===========================================================================

describe('backoff on 429', () => {
  it('backs off for retry-after header duration', async () => {
    mockFs.readFileSync.mockReturnValue(makeCredentialsJson('tok-429'));
    // First request returns 429 with retry-after: 120 (seconds)
    makeSyncFakeRequest(429, '', { 'retry-after': '120' });

    const { registerUsageHandlers, destroyUsagePolling } = await loadService();
    const win = createMockBrowserWindow();
    registerUsageHandlers(win as never);

    // Trigger initial poll (5s delay)
    await vi.advanceTimersByTimeAsync(5_001);
    expect(win.webContents.send).not.toHaveBeenCalledWith('usage:update', expect.anything());

    // Advance 60s (still within 120s backoff)
    makeSyncFakeRequest(200, JSON.stringify({ after: true }));
    await vi.advanceTimersByTimeAsync(60_001);
    expect(win.webContents.send).not.toHaveBeenCalledWith('usage:update', expect.anything());

    destroyUsagePolling();
  });

  it('backs off for 5 minutes when retry-after header is absent', async () => {
    mockFs.readFileSync.mockReturnValue(makeCredentialsJson('tok-429b'));
    makeSyncFakeRequest(429, '');

    const { registerUsageHandlers, destroyUsagePolling } = await loadService();
    const win = createMockBrowserWindow();
    registerUsageHandlers(win as never);

    // Trigger initial poll
    await vi.advanceTimersByTimeAsync(5_001);
    expect(win.webContents.send).not.toHaveBeenCalledWith('usage:update', expect.anything());

    // First interval tick at ~65s — still within 5 min (300s) backoff
    makeSyncFakeRequest(200, JSON.stringify({ ok: true }));
    await vi.advanceTimersByTimeAsync(60_001);
    expect(win.webContents.send).not.toHaveBeenCalledWith('usage:update', expect.anything());

    destroyUsagePolling();
  });
});

// ===========================================================================
// destroyUsagePolling
// ===========================================================================

describe('destroyUsagePolling', () => {
  it('stops the interval after destroy is called', async () => {
    mockFs.readFileSync.mockReturnValue(makeCredentialsJson('tok-stop'));
    makeSyncFakeRequest(200, JSON.stringify({}));

    const { registerUsageHandlers, destroyUsagePolling } = await loadService();
    const win = createMockBrowserWindow();
    registerUsageHandlers(win as never);

    // Let the first poll fire
    await vi.advanceTimersByTimeAsync(5_001);

    // Destroy — should clear the interval
    destroyUsagePolling();

    const sendCountAfterDestroy = (win.webContents.send as ReturnType<typeof vi.fn>).mock.calls.length;

    // Advance well beyond another interval — no more calls expected
    makeSyncFakeRequest(200, JSON.stringify({ nope: true }));
    await vi.advanceTimersByTimeAsync(120_001);

    expect((win.webContents.send as ReturnType<typeof vi.fn>).mock.calls.length)
      .toBe(sendCountAfterDestroy);
  });
});
