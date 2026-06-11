import { BrowserWindow, globalShortcut, screen } from 'electron';
import path from 'node:path';

// Focus overlay: a small always-on-top, click-through window shown when the
// main window is unfocused and at least one workspace has something to report.
// Spec: docs/superpowers/specs/2026-06-11-focus-overlay-design.md
// Modeled on otto's OverlayManager, adapted to SAI's renderer-fed status.

const WIDTH = 380;
const HEIGHT = 230;
const MARGIN = 16;
// Brief grace before hiding on a reportable→idle transition: busy flags are
// fed by the renderer's streamSettled debounce and flicker mid-reply.
const LINGER_MS = 2500;
// Linux can't forward mouse events through a click-through window
// (setIgnoreMouseEvents forwarding is Windows/macOS-only), so Ctrl+Shift+hover
// can never be detected there. A global shortcut, registered only while the
// overlay is visible, toggles interactive mode instead.
const INTERACTIVE_SHORTCUT = 'Control+Shift+F9';

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
  private lingerTimer: ReturnType<typeof setTimeout> | null = null;
  private interactive = false;
  private shortcutRegistered = false;

  constructor(private readonly opts: OverlayManagerOpts) {}

  setEnabled(v: boolean): void {
    this.enabled = v;
    // Pre-warm: create the (hidden) window now so the renderer bundle is
    // loaded and painted long before the first blur — creating it lazily at
    // show time meant seconds of blank window while modules streamed in.
    if (v && (!this.win || this.win.isDestroyed())) this.create();
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
    this.interactive = v;
    // Ghost vs solid is handled by the overlay renderer's CSS — setOpacity is
    // a no-op on Linux, so only the mouse-event passthrough lives here.
    if (v) {
      this.win.setIgnoreMouseEvents(false);
    } else {
      this.win.setIgnoreMouseEvents(true, { forward: true });
    }
    // The renderer mirrors the state (it can't observe it on Linux, where no
    // mouse events reach a click-through window).
    this.win.webContents.send('overlay:interactive', v);
  }

  /** Manual drag (Linux: -webkit-app-region doesn't work on a non-focusable
   *  frameless window). Deltas are screen-coordinate based from the renderer. */
  dragBy(dx: number, dy: number): void {
    if (!this.win || this.win.isDestroyed()) return;
    const [x, y] = this.win.getPosition();
    this.win.setPosition(x + Math.round(dx), y + Math.round(dy));
  }

  noteMoved(): void {
    if (!this.win || this.win.isDestroyed()) return;
    const [x, y] = this.win.getPosition();
    this.opts.saveBounds({ x, y });
  }

  destroy(): void {
    this.clearLinger();
    this.releaseShortcut();
    if (this.win && !this.win.isDestroyed()) this.win.destroy();
    this.win = null;
  }

  private grabShortcut(): void {
    if (this.shortcutRegistered) return;
    try {
      globalShortcut.register(INTERACTIVE_SHORTCUT, () => this.setInteractive(!this.interactive));
      this.shortcutRegistered = true;
    } catch { /* another app owns it; overlay stays display-only */ }
  }

  private releaseShortcut(): void {
    if (!this.shortcutRegistered) return;
    try { globalShortcut.unregister(INTERACTIVE_SHORTCUT); } catch { /* gone */ }
    this.shortcutRegistered = false;
  }

  private hideAndReset(): void {
    if (this.interactive) this.setInteractive(false);
    this.releaseShortcut();
    this.win?.hide();
  }

  private clearLinger(): void {
    if (this.lingerTimer) {
      clearTimeout(this.lingerTimer);
      this.lingerTimer = null;
    }
  }

  private apply(): void {
    const show = shouldShowOverlay({
      enabled: this.enabled,
      mainFocused: this.mainFocused,
      hasReportable: this.hasReportable,
    });
    if (show) {
      this.clearLinger();
      if (!this.win || this.win.isDestroyed()) this.create();
      this.win!.setBounds({ ...this.position(), width: WIDTH, height: HEIGHT });
      if (this.lastPayload) this.win!.webContents.send('overlay:state', this.lastPayload);
      if (!this.win!.isVisible()) this.win!.showInactive();
      this.grabShortcut();
      return;
    }
    if (!this.win || this.win.isDestroyed() || !this.win.isVisible()) {
      this.clearLinger();
      this.releaseShortcut();
      return;
    }
    if (!this.enabled || this.mainFocused) {
      // User is back (or turned it off) — no reason to linger.
      this.clearLinger();
      this.hideAndReset();
      return;
    }
    // Reportable dropped — likely a stream-debounce flicker; hide after a grace.
    if (!this.lingerTimer) {
      this.lingerTimer = setTimeout(() => {
        this.lingerTimer = null;
        const stillHidden = !shouldShowOverlay({
          enabled: this.enabled,
          mainFocused: this.mainFocused,
          hasReportable: this.hasReportable,
        });
        if (stillHidden && this.win && !this.win.isDestroyed() && this.win.isVisible()) {
          this.hideAndReset();
        }
      }, LINGER_MS);
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
    // Not `transparent`: SAI disables GPU acceleration on Linux, where
    // transparent frameless windows render as a black box. The window IS the
    // card — its background matches the card surface and CSS draws the border.
    const win = new BrowserWindow({
      width: WIDTH,
      height: HEIGHT,
      ...this.position(),
      frame: false,
      alwaysOnTop: true,
      resizable: false,
      movable: true,
      minimizable: false,
      maximizable: false,
      skipTaskbar: true,
      focusable: false,
      show: false,
      hasShadow: false,
      backgroundColor: '#0d1117',
      webPreferences: { preload: path.join(__dirname, 'preload.js'), sandbox: false },
    });
    win.setAlwaysOnTop(true, 'screen-saver');
    win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
    win.setIgnoreMouseEvents(true, { forward: true });
    win.removeMenu();
    win.on('moved', () => this.noteMoved());
    // The first update() usually lands before the renderer is ready and its
    // webContents.send is lost — replay the latest payload once loaded.
    win.webContents.on('did-finish-load', () => {
      if (this.lastPayload) win.webContents.send('overlay:state', this.lastPayload);
    });
    if (process.env.VITE_DEV_SERVER_URL) {
      void win.loadURL(`${process.env.VITE_DEV_SERVER_URL.replace(/\/$/, '')}/#overlay`);
    } else {
      void win.loadFile(path.join(__dirname, '../dist/index.html'), { hash: 'overlay' });
    }
    this.win = win;
  }
}
