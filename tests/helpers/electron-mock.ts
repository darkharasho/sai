import { vi } from 'vitest';

// ---------------------------------------------------------------------------
// BrowserWindow mock
// ---------------------------------------------------------------------------

export interface MockWebContents {
  send: ReturnType<typeof vi.fn>;
}

export interface MockBrowserWindow {
  webContents: MockWebContents;
  isDestroyed: ReturnType<typeof vi.fn>;
  isFocused: ReturnType<typeof vi.fn>;
  flashFrame: ReturnType<typeof vi.fn>;
  on: ReturnType<typeof vi.fn>;
  once: ReturnType<typeof vi.fn>;
}

export function createMockBrowserWindow(): MockBrowserWindow {
  return {
    webContents: {
      send: vi.fn(),
    },
    isDestroyed: vi.fn().mockReturnValue(false),
    isFocused: vi.fn().mockReturnValue(true),
    flashFrame: vi.fn(),
    on: vi.fn(),
    once: vi.fn(),
  };
}

// ---------------------------------------------------------------------------
// IpcMain mock
// ---------------------------------------------------------------------------

type IpcHandler = (...args: unknown[]) => unknown;
type IpcListener = (...args: unknown[]) => void;

export interface MockIpcMain {
  /** Stored invoke handlers keyed by channel */
  _handlers: Map<string, IpcHandler>;
  /** Stored event listeners keyed by channel (supports multiple per channel) */
  _listeners: Map<string, IpcListener[]>;

  handle: ReturnType<typeof vi.fn>;
  on: ReturnType<typeof vi.fn>;
  removeHandler: ReturnType<typeof vi.fn>;

  /**
   * Test helper — simulates `ipcRenderer.invoke(channel, ...args)`.
   * Calls the stored handler and returns its result (or rejects if none found).
   */
  _invoke(channel: string, ...args: unknown[]): Promise<unknown>;

  /**
   * Test helper — simulates `ipcRenderer.send(channel, ...args)`.
   * Calls all stored listeners for the channel.
   */
  _emit(channel: string, ...args: unknown[]): void;
}

export function createMockIpcMain(): MockIpcMain {
  const _handlers = new Map<string, IpcHandler>();
  const _listeners = new Map<string, IpcListener[]>();

  const mock: MockIpcMain = {
    _handlers,
    _listeners,

    handle: vi.fn((channel: string, handler: IpcHandler) => {
      _handlers.set(channel, handler);
    }),

    on: vi.fn((channel: string, listener: IpcListener) => {
      const existing = _listeners.get(channel) ?? [];
      _listeners.set(channel, [...existing, listener]);
    }),

    removeHandler: vi.fn((channel: string) => {
      _handlers.delete(channel);
    }),

    async _invoke(channel: string, ...args: unknown[]): Promise<unknown> {
      const handler = _handlers.get(channel);
      if (!handler) {
        throw new Error(`MockIpcMain: no handler registered for channel "${channel}"`);
      }
      // IPC handlers receive (event, ...args); pass a minimal event stub
      return handler({ sender: {} } as unknown, ...args);
    },

    _emit(channel: string, ...args: unknown[]): void {
      const listeners = _listeners.get(channel) ?? [];
      for (const listener of listeners) {
        listener({ sender: {} } as unknown, ...args);
      }
    },
  };

  return mock;
}

// ---------------------------------------------------------------------------
// Notification mock
// ---------------------------------------------------------------------------

export interface MockNotificationInstance {
  show: ReturnType<typeof vi.fn>;
  on: ReturnType<typeof vi.fn>;
}

export interface MockNotificationConstructor {
  new (options?: Record<string, unknown>): MockNotificationInstance;
  isSupported: ReturnType<typeof vi.fn>;
  _instances: MockNotificationInstance[];
}

export function createMockNotification(): MockNotificationConstructor {
  const _instances: MockNotificationInstance[] = [];

  class MockNotification {
    static isSupported = vi.fn().mockReturnValue(true);
    static _instances = _instances;

    show: ReturnType<typeof vi.fn>;
    on: ReturnType<typeof vi.fn>;

    constructor(_options?: Record<string, unknown>) {
      this.show = vi.fn();
      this.on = vi.fn();
      _instances.push(this);
    }
  }

  return MockNotification as unknown as MockNotificationConstructor;
}

// ---------------------------------------------------------------------------
// Dialog mock
// ---------------------------------------------------------------------------

export interface MockDialog {
  showOpenDialog: ReturnType<typeof vi.fn>;
  showSaveDialog: ReturnType<typeof vi.fn>;
  showMessageBox: ReturnType<typeof vi.fn>;
}

export function createMockDialog(): MockDialog {
  return {
    showOpenDialog: vi.fn().mockResolvedValue({ canceled: false, filePaths: [] }),
    showSaveDialog: vi.fn().mockResolvedValue({ canceled: false, filePath: undefined }),
    showMessageBox: vi.fn().mockResolvedValue({ response: 0, checkboxChecked: false }),
  };
}
