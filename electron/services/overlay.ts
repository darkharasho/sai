import { BrowserWindow, screen } from 'electron';
import path from 'node:path';

// Focus overlay: a small always-on-top, click-through window shown when the
// main window is unfocused and at least one workspace has something to report.
// Spec: docs/superpowers/specs/2026-06-11-focus-overlay-design.md
// Modeled on otto's OverlayManager, adapted to SAI's renderer-fed status.

const WIDTH = 380;
const HEIGHT = 230;
const MARGIN = 16;
const GHOST_OPACITY = 0.65;

export interface OverlayVisibilityInputs {
  enabled: boolean;
  mainFocused: boolean;
  hasReportable: boolean;
}

export function shouldShowOverlay(i: OverlayVisibilityInputs): boolean {
  return i.enabled && !i.mainFocused && i.hasReportable;
}

export interface OverlayManagerOpts {
  getSavedBounds: () => { x: number; y: number } | undefined;
  saveBounds: (b: { x: number; y: number }) => void;
}

export class OverlayManager {
  private win: BrowserWindow | null = null;
  private enabled = false;
  private mainFocused = true;
  private lastPayload: unknown = null;
  private hasReportable = false;

  constructor(private readonly opts: OverlayManagerOpts) {}

  setEnabled(v: boolean): void {
    this.enabled = v;
    this.apply();
  }

  setMainFocused(v: boolean): void {
    this.mainFocused = v;
    this.apply();
  }

  update(payload: { hasReportable?: boolean } | null): void {
    this.lastPayload = payload;
    this.hasReportable = !!payload?.hasReportable;
    if (this.win && !this.win.isDestroyed()) {
      this.win.webContents.send('overlay:state', payload);
    }
    this.apply();
  }

  setInteractive(v: boolean): void {
    if (!this.win || this.win.isDestroyed()) return;
    if (v) {
      this.win.setIgnoreMouseEvents(false);
      this.win.setOpacity(1);
    } else {
      this.win.setIgnoreMouseEvents(true, { forward: true });
      this.win.setOpacity(GHOST_OPACITY);
    }
  }

  noteMoved(): void {
    if (!this.win || this.win.isDestroyed()) return;
    const [x, y] = this.win.getPosition();
    this.opts.saveBounds({ x, y });
  }

  destroy(): void {
    if (this.win && !this.win.isDestroyed()) this.win.destroy();
    this.win = null;
  }

  private apply(): void {
    const show = shouldShowOverlay({
      enabled: this.enabled,
      mainFocused: this.mainFocused,
      hasReportable: this.hasReportable,
    });
    if (show) {
      if (!this.win || this.win.isDestroyed()) this.create();
      this.win!.setBounds({ ...this.position(), width: WIDTH, height: HEIGHT });
      if (this.lastPayload) this.win!.webContents.send('overlay:state', this.lastPayload);
      if (!this.win!.isVisible()) this.win!.showInactive();
    } else if (this.win && !this.win.isDestroyed() && this.win.isVisible()) {
      this.win.hide();
    }
  }

  /** Bottom-right of the primary display, or the persisted position clamped
   *  to its nearest display's work area (an unplugged monitor must not
   *  strand the overlay offscreen). */
  private position(): { x: number; y: number } {
    const saved = this.opts.getSavedBounds();
    const wa = saved
      ? screen.getDisplayNearestPoint({ x: saved.x, y: saved.y }).workArea
      : screen.getPrimaryDisplay().workArea;
    if (!saved) {
      return { x: wa.x + wa.width - WIDTH - MARGIN, y: wa.y + wa.height - HEIGHT - MARGIN };
    }
    return {
      x: Math.min(Math.max(saved.x, wa.x), wa.x + wa.width - WIDTH),
      y: Math.min(Math.max(saved.y, wa.y), wa.y + wa.height - HEIGHT),
    };
  }

  private create(): void {
    const win = new BrowserWindow({
      width: WIDTH,
      height: HEIGHT,
      ...this.position(),
      frame: false,
      transparent: true,
      alwaysOnTop: true,
      resizable: false,
      movable: true,
      minimizable: false,
      maximizable: false,
      skipTaskbar: true,
      focusable: false,
      show: false,
      hasShadow: false,
      backgroundColor: '#00000000',
      webPreferences: { preload: path.join(__dirname, 'preload.js'), sandbox: false },
    });
    win.setAlwaysOnTop(true, 'screen-saver');
    win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
    win.setIgnoreMouseEvents(true, { forward: true });
    win.setOpacity(GHOST_OPACITY);
    win.removeMenu();
    win.on('moved', () => this.noteMoved());
    if (process.env.VITE_DEV_SERVER_URL) {
      void win.loadURL(`${process.env.VITE_DEV_SERVER_URL.replace(/\/$/, '')}/#overlay`);
    } else {
      void win.loadFile(path.join(__dirname, '../dist/index.html'), { hash: 'overlay' });
    }
    this.win = win;
  }
}
