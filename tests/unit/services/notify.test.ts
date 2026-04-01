// @vitest-environment node
/**
 * Unit tests for electron/services/notify.ts
 *
 * Regression coverage:
 *   dd4d6a0 – suppress notification only when window is focused AND active
 *             workspace matches (not just when focused)
 *   3e0e7bf – duration formatting: seconds (<60s) and minutes+seconds (>60s)
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// ---------------------------------------------------------------------------
// vi.hoisted — must be declared before vi.mock factories
// ---------------------------------------------------------------------------
const { MockNotification, mockApp, mockFsModule } = vi.hoisted(() => {
  const _notifInstances: Array<{ options: Record<string, unknown>; show: ReturnType<typeof vi.fn> }> = [];

  class MockNotification {
    static isSupported = vi.fn().mockReturnValue(true);
    static _instances = _notifInstances;

    show: ReturnType<typeof vi.fn>;
    options: Record<string, unknown>;

    constructor(options: Record<string, unknown> = {}) {
      this.options = options;
      this.show = vi.fn();
      _notifInstances.push(this);
    }
  }

  const mockApp = {
    getPath: vi.fn().mockReturnValue('/mock/userData'),
  };

  const mockFsModule = {
    readFileSync: vi.fn(),
  };

  return { MockNotification, mockApp, mockFsModule };
});

// ---------------------------------------------------------------------------
// Module mocks — must happen before any import of the service
// ---------------------------------------------------------------------------

vi.mock('electron', () => ({
  Notification: MockNotification,
  BrowserWindow: vi.fn(),
  app: mockApp,
}));

// Mock node:fs as a default export (the service uses `import * as fs from 'node:fs'`)
vi.mock('node:fs', () => ({
  default: mockFsModule,
  readFileSync: mockFsModule.readFileSync,
}));

// ---------------------------------------------------------------------------
// Import the service once — state is reset via initFocusTracking + setActiveWorkspace
// ---------------------------------------------------------------------------

import {
  initFocusTracking,
  setActiveWorkspace,
  notifyCompletion,
} from '../../../electron/services/notify';

// ---------------------------------------------------------------------------
// Per-test setup
// ---------------------------------------------------------------------------

beforeEach(() => {
  MockNotification._instances.length = 0;
  MockNotification.isSupported.mockReturnValue(true);
  mockFsModule.readFileSync.mockReset();
  // Default: notifications enabled
  mockFsModule.readFileSync.mockReturnValue(
    JSON.stringify({ systemNotifications: true }),
  );
});

afterEach(() => {
  vi.restoreAllMocks();
});

// ---------------------------------------------------------------------------
// Helper — build mock BrowserWindow
// ---------------------------------------------------------------------------

function createWin(focused = true) {
  const callbacks: Record<string, Array<() => void>> = {};
  const win = {
    isDestroyed: vi.fn().mockReturnValue(false),
    isFocused: vi.fn().mockReturnValue(focused),
    flashFrame: vi.fn(),
    on: vi.fn((event: string, cb: () => void) => {
      callbacks[event] = callbacks[event] ?? [];
      callbacks[event].push(cb);
    }),
    _trigger(event: string) {
      for (const cb of callbacks[event] ?? []) cb();
    },
  };
  return win;
}

// ===========================================================================
// Suppression logic (regression: dd4d6a0)
// ===========================================================================

describe('Regression dd4d6a0: suppression requires focus AND active workspace match', () => {
  it('suppresses notification when window is focused AND active workspace matches', () => {
    const win = createWin(true);
    initFocusTracking(win as never);
    setActiveWorkspace('/home/user/project');

    notifyCompletion(win as never, '/home/user/project');

    expect(win.flashFrame).not.toHaveBeenCalled();
    expect(MockNotification._instances).toHaveLength(0);
  });

  it('shows notification when window is not focused (even if workspace matches)', () => {
    const win = createWin(false);
    initFocusTracking(win as never);
    setActiveWorkspace('/home/user/project');

    notifyCompletion(win as never, '/home/user/project');

    expect(win.flashFrame).toHaveBeenCalledWith(true);
  });

  it('shows notification when focused but different workspace is active', () => {
    const win = createWin(true);
    initFocusTracking(win as never);
    setActiveWorkspace('/home/user/other-project');

    notifyCompletion(win as never, '/home/user/project');

    expect(win.flashFrame).toHaveBeenCalledWith(true);
  });

  it('shows notification when focused and no active workspace is set', () => {
    const win = createWin(true);
    initFocusTracking(win as never);
    setActiveWorkspace('');

    notifyCompletion(win as never, '/home/user/project');

    expect(win.flashFrame).toHaveBeenCalledWith(true);
  });
});

// ===========================================================================
// Focus tracking
// ===========================================================================

describe('initFocusTracking', () => {
  it('registers focus and blur event handlers', () => {
    const win = createWin(true);
    initFocusTracking(win as never);

    expect(win.on).toHaveBeenCalledWith('focus', expect.any(Function));
    expect(win.on).toHaveBeenCalledWith('blur', expect.any(Function));
  });

  it('updates focused to false on blur event', () => {
    // Start focused, clear active workspace so notification fires if not focused
    const win = createWin(true);
    initFocusTracking(win as never);
    setActiveWorkspace('/proj');

    // Blur the window
    win._trigger('blur');

    // Now should show notification even for active workspace (unfocused)
    notifyCompletion(win as never, '/proj');
    expect(win.flashFrame).toHaveBeenCalledWith(true);
  });

  it('updates focused to true on focus event', () => {
    const win = createWin(false);
    initFocusTracking(win as never);
    setActiveWorkspace('/proj');

    // Focus the window
    win._trigger('focus');

    // Now should suppress notification for active workspace (focused)
    notifyCompletion(win as never, '/proj');
    expect(win.flashFrame).not.toHaveBeenCalled();
  });
});

// ===========================================================================
// setActiveWorkspace
// ===========================================================================

describe('setActiveWorkspace', () => {
  it('updates the active path used for suppression', () => {
    const win = createWin(true);
    initFocusTracking(win as never);

    // Set path A as active — should suppress
    setActiveWorkspace('/path/a');
    notifyCompletion(win as never, '/path/a');
    expect(win.flashFrame).not.toHaveBeenCalled();

    // Switch to path B — notification for A should now fire
    setActiveWorkspace('/path/b');
    notifyCompletion(win as never, '/path/a');
    expect(win.flashFrame).toHaveBeenCalledWith(true);
  });
});

// ===========================================================================
// Duration formatting (regression: 3e0e7bf)
// ===========================================================================

describe('Regression 3e0e7bf: duration formatting', () => {
  function getBody(duration: number): string {
    const win = createWin(false);
    initFocusTracking(win as never);
    setActiveWorkspace('');

    notifyCompletion(win as never, '/project', { duration });

    const instance = MockNotification._instances[MockNotification._instances.length - 1];
    return (instance?.options as { body?: string })?.body ?? '';
  }

  it('formats duration under 60 seconds as Xs', () => {
    const body = getBody(45_000);
    expect(body).toContain('45s');
  });

  it('formats duration of exactly 60 seconds as 1m', () => {
    const body = getBody(60_000);
    expect(body).toContain('1m');
  });

  it('formats duration over 60 seconds as Xm Ys', () => {
    const body = getBody(90_000); // 1m 30s
    expect(body).toContain('1m 30s');
  });

  it('formats duration of exactly 2 minutes as 2m (no seconds component)', () => {
    const body = getBody(120_000); // 2m exactly
    expect(body).toContain('2m');
    expect(body).not.toMatch(/2m \d+s/);
  });

  it('omits duration when duration is 0 (falsy)', () => {
    // duration=0 is treated as falsy by the service — no duration in body
    const body = getBody(0);
    // No duration metadata — just the workspace name and "has finished"
    expect(body).not.toContain('0s');
    expect(body).toContain('has finished');
  });
});

// ===========================================================================
// Notification body content
// ===========================================================================

describe('notification body content', () => {
  function notify(info: Parameters<typeof notifyCompletion>[2]) {
    const win = createWin(false);
    initFocusTracking(win as never);
    setActiveWorkspace('');

    notifyCompletion(win as never, '/my/workspace', info);

    const last = MockNotification._instances[MockNotification._instances.length - 1];
    return (last?.options ?? {}) as { title?: string; body?: string };
  }

  it('includes provider in notification body', () => {
    const { body } = notify({ provider: 'Claude' });
    expect(body).toContain('Claude');
  });

  it('includes turn count when > 1', () => {
    const { body } = notify({ turns: 3 });
    expect(body).toContain('3 turns');
  });

  it('omits turn count when turns is 1', () => {
    const { body } = notify({ turns: 1 });
    expect(body).not.toContain('turn');
  });

  it('includes cost formatted to 4 decimal places', () => {
    const { body } = notify({ cost: 0.0012 });
    expect(body).toContain('$0.0012');
  });

  it('truncates summary to 100 chars and appends ellipsis', () => {
    const longSummary = 'A'.repeat(150);
    const { body } = notify({ summary: longSummary });
    expect(body).toContain('A'.repeat(100) + '…');
    expect(body).not.toContain('A'.repeat(101));
  });

  it('uses full summary when <= 100 chars', () => {
    const summary = 'Short summary here.';
    const { body } = notify({ summary });
    expect(body).toContain(summary);
    expect(body).not.toContain('…');
  });

  it('includes workspace name derived from project path', () => {
    const win = createWin(false);
    initFocusTracking(win as never);
    setActiveWorkspace('');

    notifyCompletion(win as never, '/home/user/my-project');

    const last = MockNotification._instances[MockNotification._instances.length - 1];
    const body = (last?.options as { body?: string })?.body ?? '';
    expect(body).toContain('my-project');
  });

  it('uses "SAI" as notification title', () => {
    const { title } = notify({});
    expect(title).toBe('SAI');
  });
});

// ===========================================================================
// Notification suppressed when disabled in settings
// ===========================================================================

describe('system notifications disabled', () => {
  it('does not show Notification when systemNotifications is false', () => {
    mockFsModule.readFileSync.mockReturnValue(
      JSON.stringify({ systemNotifications: false }),
    );
    const win = createWin(false);
    initFocusTracking(win as never);
    setActiveWorkspace('');

    notifyCompletion(win as never, '/project');

    // flashFrame is NOT called because isEnabled() returns false and the
    // service returns early before reaching win.flashFrame()
    expect(win.flashFrame).not.toHaveBeenCalled();
    expect(MockNotification._instances).toHaveLength(0);
  });

  it('does not show Notification when settings file is missing', () => {
    mockFsModule.readFileSync.mockImplementation(() => { throw new Error('ENOENT'); });
    const win = createWin(false);
    initFocusTracking(win as never);
    setActiveWorkspace('');

    notifyCompletion(win as never, '/project');

    expect(MockNotification._instances).toHaveLength(0);
  });

  it('does not show Notification when Notification.isSupported() returns false', () => {
    MockNotification.isSupported.mockReturnValue(false);
    const win = createWin(false);
    initFocusTracking(win as never);
    setActiveWorkspace('');

    notifyCompletion(win as never, '/project');

    expect(MockNotification._instances).toHaveLength(0);
  });
});

// ===========================================================================
// Destroyed window guard
// ===========================================================================

describe('destroyed window guard', () => {
  it('returns early when window is destroyed', () => {
    const win = createWin(false);
    win.isDestroyed.mockReturnValue(true);

    expect(() => notifyCompletion(win as never, '/project')).not.toThrow();
    expect(win.flashFrame).not.toHaveBeenCalled();
  });
});
