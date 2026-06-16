// @vitest-environment node
/**
 * Unit tests for electron/services/overlay.ts — the focus-overlay window
 * manager (spec: docs/superpowers/specs/2026-06-11-focus-overlay-design.md).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const windows: MockWin[] = [];

class MockWin {
  destroyed = false;
  visible = false;
  opacity = 1;
  bounds = { x: 0, y: 0, width: 380, height: 230 };
  setIgnoreMouseEvents = vi.fn();
  setOpacity = vi.fn((v: number) => { this.opacity = v; });
  setAlwaysOnTop = vi.fn();
  setVisibleOnAllWorkspaces = vi.fn();
  removeMenu = vi.fn();
  loadURL = vi.fn().mockResolvedValue(undefined);
  loadFile = vi.fn().mockResolvedValue(undefined);
  on = vi.fn();
  showInactive = vi.fn(() => { this.visible = true; });
  hide = vi.fn(() => { this.visible = false; });
  isVisible = () => this.visible;
  isDestroyed = () => this.destroyed;
  destroy = vi.fn(() => { this.destroyed = true; });
  setBounds = vi.fn((b: any) => { this.bounds = { ...this.bounds, ...b }; });
  setPosition = vi.fn((x: number, y: number) => { this.bounds.x = x; this.bounds.y = y; });
  getPosition = () => [this.bounds.x, this.bounds.y];
  webContents = { send: vi.fn(), on: vi.fn() };
  constructor(opts: any) { this.bounds = { x: opts.x, y: opts.y, width: opts.width, height: opts.height }; windows.push(this); }
}

const globalShortcut = vi.hoisted(() => ({ register: vi.fn(), unregister: vi.fn() }));

vi.mock('electron', () => ({
  BrowserWindow: vi.fn().mockImplementation(function (this: unknown, opts: any) { return new MockWin(opts); }),
  screen: {
    getPrimaryDisplay: vi.fn(() => ({ workArea: { x: 0, y: 0, width: 1920, height: 1080 } })),
    getDisplayNearestPoint: vi.fn(() => ({ workArea: { x: 0, y: 0, width: 1920, height: 1080 } })),
  },
  globalShortcut,
  app: { dock: { show: vi.fn() } },
}));

import { OverlayManager, shouldShowOverlay } from '@electron/services/overlay';

function makeManager(saved?: { x: number; y: number }) {
  const saveBounds = vi.fn();
  const mgr = new OverlayManager({ getSavedBounds: () => saved, saveBounds });
  return { mgr, saveBounds };
}

beforeEach(() => { windows.length = 0; vi.clearAllMocks(); });

describe('shouldShowOverlay', () => {
  it('requires enabled + unfocused + reportable', () => {
    expect(shouldShowOverlay({ enabled: true, mainFocused: false, hasReportable: true })).toBe(true);
    expect(shouldShowOverlay({ enabled: false, mainFocused: false, hasReportable: true })).toBe(false);
    expect(shouldShowOverlay({ enabled: true, mainFocused: true, hasReportable: true })).toBe(false);
    expect(shouldShowOverlay({ enabled: true, mainFocused: false, hasReportable: false })).toBe(false);
  });
});

describe('OverlayManager', () => {
  it('pre-warms a hidden window at enable time; shows only when conditions hold', () => {
    const { mgr } = makeManager();
    expect(windows).toHaveLength(0);
    mgr.setEnabled(true);
    // Window exists immediately (renderer loads in the background) but stays
    // hidden until blur + reportable.
    expect(windows).toHaveLength(1);
    expect(windows[0].visible).toBe(false);
    mgr.setMainFocused(true);
    mgr.update({ hasReportable: true });
    expect(windows[0].visible).toBe(false);
    mgr.setMainFocused(false);
    expect(windows).toHaveLength(1);
    expect(windows[0].showInactive).toHaveBeenCalled();
  });

  it('replays the last payload when the renderer finishes loading', () => {
    const { mgr } = makeManager();
    mgr.setEnabled(true);
    const payload = { hasReportable: true, rows: [], focusPath: null };
    mgr.update(payload);
    const onLoad = windows[0].webContents.on.mock.calls.find((c: any[]) => c[0] === 'did-finish-load')?.[1];
    expect(onLoad).toBeTypeOf('function');
    windows[0].webContents.send.mockClear();
    onLoad();
    expect(windows[0].webContents.send).toHaveBeenCalledWith('overlay:state', payload);
  });

  it('hides on focus (immediately) and re-shows on blur without recreating', () => {
    const { mgr } = makeManager();
    mgr.setEnabled(true);
    mgr.update({ hasReportable: true });
    mgr.setMainFocused(false);
    expect(windows[0].visible).toBe(true);
    mgr.setMainFocused(true);
    expect(windows[0].hide).toHaveBeenCalled();
    mgr.setMainFocused(false);
    expect(windows).toHaveLength(1);
    expect(windows[0].visible).toBe(true);
  });

  it('hides when everything goes idle (after the linger)', () => {
    vi.useFakeTimers();
    try {
      const { mgr } = makeManager();
      mgr.setEnabled(true);
      mgr.update({ hasReportable: true });
      mgr.setMainFocused(false);
      mgr.update({ hasReportable: false });
      vi.advanceTimersByTime(2600);
      expect(windows[0].visible).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });

  it('forwards payloads to the window', () => {
    const { mgr } = makeManager();
    mgr.setEnabled(true);
    mgr.update({ hasReportable: true });
    mgr.setMainFocused(false);
    const payload = { hasReportable: true, strip: [], focus: null };
    mgr.update(payload);
    expect(windows[0].webContents.send).toHaveBeenCalledWith('overlay:state', payload);
  });

  it('interactive mode flips mouse events (ghosting is CSS-side: Linux ignores setOpacity)', () => {
    const { mgr } = makeManager();
    mgr.setEnabled(true);
    mgr.update({ hasReportable: true });
    mgr.setMainFocused(false);
    mgr.setInteractive(true);
    expect(windows[0].setIgnoreMouseEvents).toHaveBeenLastCalledWith(false);
    mgr.setInteractive(false);
    expect(windows[0].setIgnoreMouseEvents).toHaveBeenLastCalledWith(true, { forward: true });
  });

  it('lingers before hiding when the show condition drops, and cancels on re-show', () => {
    vi.useFakeTimers();
    try {
      const { mgr } = makeManager();
      mgr.setEnabled(true);
      mgr.update({ hasReportable: true });
      mgr.setMainFocused(false);
      expect(windows[0].visible).toBe(true);
      // Condition drops (e.g. busy flicker from the streamSettled debounce)
      mgr.update({ hasReportable: false });
      expect(windows[0].visible).toBe(true); // still visible during linger
      // Condition returns before the linger expires → no hide
      mgr.update({ hasReportable: true });
      vi.advanceTimersByTime(5000);
      expect(windows[0].visible).toBe(true);
      // Condition drops for good → hides after the linger
      mgr.update({ hasReportable: false });
      vi.advanceTimersByTime(2400);
      expect(windows[0].visible).toBe(true);
      vi.advanceTimersByTime(200);
      expect(windows[0].visible).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });

  it('hides immediately when disabled (no linger)', () => {
    vi.useFakeTimers();
    try {
      const { mgr } = makeManager();
      mgr.setEnabled(true);
      mgr.update({ hasReportable: true });
      mgr.setMainFocused(false);
      mgr.setEnabled(false);
      expect(windows[0].visible).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });

  it('clamps persisted bounds to the work area', () => {
    const { mgr } = makeManager({ x: 99999, y: -500 });
    mgr.setEnabled(true);
    mgr.update({ hasReportable: true });
    mgr.setMainFocused(false);
    const b = windows[0].setBounds.mock.calls.at(-1)![0];
    expect(b.x).toBeLessThanOrEqual(1920 - 380);
    expect(b.x).toBeGreaterThanOrEqual(0);
    expect(b.y).toBeGreaterThanOrEqual(0);
  });

  it('saves position on move', () => {
    const { mgr, saveBounds } = makeManager();
    mgr.setEnabled(true);
    mgr.update({ hasReportable: true });
    mgr.setMainFocused(false);
    windows[0].bounds.x = 50; windows[0].bounds.y = 60;
    mgr.noteMoved();
    expect(saveBounds).toHaveBeenCalledWith({ x: 50, y: 60 });
  });

  it('registers the interactive shortcut while visible and toggles on press', () => {
    const { mgr } = makeManager();
    mgr.setEnabled(true);
    mgr.update({ hasReportable: true });
    expect(globalShortcut.register).not.toHaveBeenCalled();
    mgr.setMainFocused(false);
    expect(globalShortcut.register).toHaveBeenCalledWith('Control+Shift+F9', expect.any(Function));
    const toggle = globalShortcut.register.mock.calls[0][1];
    toggle();
    expect(windows[0].setIgnoreMouseEvents).toHaveBeenLastCalledWith(false);
    expect(windows[0].webContents.send).toHaveBeenCalledWith('overlay:interactive', true);
    toggle();
    expect(windows[0].setIgnoreMouseEvents).toHaveBeenLastCalledWith(true, { forward: true });
    expect(windows[0].webContents.send).toHaveBeenCalledWith('overlay:interactive', false);
    // Hiding resets interactive and releases the shortcut
    mgr.setMainFocused(true);
    expect(globalShortcut.unregister).toHaveBeenCalledWith('Control+Shift+F9');
  });

  it('dragBy moves the window and dragEnd persistence works via noteMoved', () => {
    const { mgr, saveBounds } = makeManager();
    mgr.setEnabled(true);
    mgr.update({ hasReportable: true });
    mgr.setMainFocused(false);
    const [x0, y0] = windows[0].getPosition();
    mgr.dragBy(15, -10);
    expect(windows[0].bounds.x).toBe(x0 + 15);
    expect(windows[0].bounds.y).toBe(y0 - 10);
    mgr.noteMoved();
    expect(saveBounds).toHaveBeenCalledWith({ x: x0 + 15, y: y0 - 10 });
  });

  it("mode 'off' hides immediately; mode 'persist' shows on blur even when idle", () => {
    const { mgr } = makeManager();
    mgr.setEnabled(true);
    mgr.update({ hasReportable: true });
    mgr.setMainFocused(false);
    expect(windows[0].visible).toBe(true);
    mgr.setMode('off');
    expect(windows[0].visible).toBe(false);
    mgr.setMode('persist');
    expect(windows[0].visible).toBe(true);
    // Persist ignores reportable…
    mgr.update({ hasReportable: false });
    expect(windows[0].visible).toBe(true);
    // …but still hides when the main window regains focus.
    mgr.setMainFocused(true);
    expect(windows[0].visible).toBe(false);
    mgr.setMainFocused(false);
    expect(windows[0].visible).toBe(true);
  });

  it('does not reposition a visible window when payloads arrive (drag must stick)', () => {
    const { mgr } = makeManager();
    mgr.setEnabled(true);
    mgr.update({ hasReportable: true });
    mgr.setMainFocused(false);
    mgr.dragBy(120, 80);
    const [x, y] = windows[0].getPosition();
    mgr.update({ hasReportable: true, rows: [], focusPath: null });
    expect(windows[0].getPosition()).toEqual([x, y]);
  });

  it("persist does not show before the first activity since launch", () => {
    const { mgr } = makeManager();
    mgr.setEnabled(true);
    mgr.setMode('persist');
    mgr.setMainFocused(false);
    // Fresh launch, nothing has ever run — the pre-warmed window stays hidden.
    expect(windows[0].visible).toBe(false);
    expect(windows[0].showInactive).not.toHaveBeenCalled();
    // First reportable activity arms persist for the rest of the session.
    mgr.update({ hasReportable: true });
    expect(windows[0].visible).toBe(true);
    mgr.update({ hasReportable: false });
    expect(windows[0].visible).toBe(true);
  });

  it('destroy tears the window down', () => {
    const { mgr } = makeManager();
    mgr.setEnabled(true);
    mgr.update({ hasReportable: true });
    mgr.setMainFocused(false);
    mgr.destroy();
    expect(windows[0].destroy).toHaveBeenCalled();
  });
});
