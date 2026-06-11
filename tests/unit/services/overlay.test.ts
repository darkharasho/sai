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
  getPosition = () => [this.bounds.x, this.bounds.y];
  webContents = { send: vi.fn() };
  constructor(opts: any) { this.bounds = { x: opts.x, y: opts.y, width: opts.width, height: opts.height }; windows.push(this); }
}

vi.mock('electron', () => ({
  BrowserWindow: vi.fn().mockImplementation(function (this: unknown, opts: any) { return new MockWin(opts); }),
  screen: {
    getPrimaryDisplay: vi.fn(() => ({ workArea: { x: 0, y: 0, width: 1920, height: 1080 } })),
    getDisplayNearestPoint: vi.fn(() => ({ workArea: { x: 0, y: 0, width: 1920, height: 1080 } })),
  },
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
  it('creates the window lazily: nothing until all show conditions hold', () => {
    const { mgr } = makeManager();
    mgr.setEnabled(true);
    mgr.setMainFocused(true);
    mgr.update({ hasReportable: true });
    expect(windows).toHaveLength(0);
    mgr.setMainFocused(false);
    expect(windows).toHaveLength(1);
    expect(windows[0].showInactive).toHaveBeenCalled();
  });

  it('hides on focus and re-shows on blur without recreating', () => {
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

  it('hides when everything goes idle', () => {
    const { mgr } = makeManager();
    mgr.setEnabled(true);
    mgr.update({ hasReportable: true });
    mgr.setMainFocused(false);
    mgr.update({ hasReportable: false });
    expect(windows[0].visible).toBe(false);
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

  it('interactive mode flips opacity and mouse events', () => {
    const { mgr } = makeManager();
    mgr.setEnabled(true);
    mgr.update({ hasReportable: true });
    mgr.setMainFocused(false);
    mgr.setInteractive(true);
    expect(windows[0].setIgnoreMouseEvents).toHaveBeenLastCalledWith(false);
    expect(windows[0].setOpacity).toHaveBeenLastCalledWith(1);
    mgr.setInteractive(false);
    expect(windows[0].setIgnoreMouseEvents).toHaveBeenLastCalledWith(true, { forward: true });
    expect(windows[0].setOpacity).toHaveBeenLastCalledWith(0.65);
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

  it('destroy tears the window down', () => {
    const { mgr } = makeManager();
    mgr.setEnabled(true);
    mgr.update({ hasReportable: true });
    mgr.setMainFocused(false);
    mgr.destroy();
    expect(windows[0].destroy).toHaveBeenCalled();
  });
});
