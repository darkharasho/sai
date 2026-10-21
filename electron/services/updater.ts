import { autoUpdater } from 'electron-updater';
import { app, BrowserWindow, ipcMain } from 'electron';
import path from 'node:path';
import fs from 'node:fs';
import crypto from 'node:crypto';

/**
 * Locate the update electron-updater has already downloaded and verified into
 * its pending cache (~/.cache/<name>-updater/pending/). Returns the AppImage
 * path plus the sha512 recorded in update-info.json, or null if none is ready.
 */
function pendingAppImageUpdate(): { file: string; sha512: string | null } | null {
  try {
    const dir = path.join(app.getPath('cache'), `${app.getName()}-updater`, 'pending');
    const infoPath = path.join(dir, 'update-info.json');
    if (!fs.existsSync(infoPath)) return null;
    const info = JSON.parse(fs.readFileSync(infoPath, 'utf8')) as {
      fileName?: string;
      sha512?: string;
    };
    if (!info.fileName) return null;
    const file = path.join(dir, info.fileName);
    if (!fs.existsSync(file)) return null;
    return { file, sha512: info.sha512 ?? null };
  } catch (err) {
    console.error('[updater] failed to read pending update info:', (err as Error)?.message);
    return null;
  }
}

function sha512Base64(file: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash('sha512');
    const stream = fs.createReadStream(file);
    stream.on('error', reject);
    stream.on('data', (chunk) => hash.update(chunk));
    stream.on('end', () => resolve(hash.digest('base64')));
  });
}

/**
 * Install a downloaded AppImage update atomically, in our own control instead
 * of electron-updater's fragile in-place swap. Strategy:
 *   1. verify the pending file against the recorded sha512
 *   2. copy it to a temp file on the SAME filesystem as the target, fsync
 *   3. keep a .bak of the currently-installed binary
 *   4. rename() the temp over the target — atomic, and Linux allows replacing
 *      the running executable
 * On any failure the target is left untouched (the .tmp is discarded), so a
 * botched update can never leave the user with no binary.
 *
 * Returns the target path to relaunch, or null if it couldn't install safely.
 */
async function installAppImageUpdateAtomic(): Promise<string | null> {
  const target = process.env.APPIMAGE;
  if (!target) {
    console.error('[updater] APPIMAGE env not set — cannot self-install');
    return null;
  }
  const pending = pendingAppImageUpdate();
  if (!pending) {
    console.error('[updater] no verified pending update found');
    return null;
  }

  if (pending.sha512) {
    const actual = await sha512Base64(pending.file);
    if (actual !== pending.sha512) {
      console.error('[updater] pending update failed sha512 verification — refusing to install');
      return null;
    }
  }

  const dir = path.dirname(target);
  const tmp = path.join(dir, `.${path.basename(target)}.update-${process.pid}.tmp`);
  const bak = `${target}.bak`;

  try {
    fs.copyFileSync(pending.file, tmp);
    fs.chmodSync(tmp, 0o755);
    const fd = fs.openSync(tmp, 'r+');
    try {
      fs.fsyncSync(fd);
    } finally {
      fs.closeSync(fd);
    }
    // Best-effort backup of the current binary for manual recovery.
    try {
      if (fs.existsSync(target)) fs.copyFileSync(target, bak);
    } catch (err) {
      console.error('[updater] could not write backup (continuing):', (err as Error)?.message);
    }
    fs.renameSync(tmp, target); // atomic within the same filesystem
    return target;
  } catch (err) {
    console.error('[updater] atomic install failed:', (err as Error)?.message);
    try {
      if (fs.existsSync(tmp)) fs.unlinkSync(tmp);
    } catch {
      /* ignore */
    }
    return null;
  }
}

/** Remove stale .update-*.tmp files left behind by an interrupted install. */
function cleanStaleUpdateTemps(): void {
  const target = process.env.APPIMAGE;
  if (!target) return;
  try {
    const dir = path.dirname(target);
    const base = path.basename(target);
    for (const name of fs.readdirSync(dir)) {
      if (name.startsWith(`.${base}.update-`) && name.endsWith('.tmp')) {
        try {
          fs.unlinkSync(path.join(dir, name));
        } catch {
          /* ignore */
        }
      }
    }
  } catch {
    /* ignore */
  }
}

export function registerUpdater(mainWindow: BrowserWindow) {
  // Always register getVersion — it works regardless of update capability
  ipcMain.handle('update:getVersion', () => {
    return process.env.VITE_DEV_SERVER_URL ? 'DEV' : app.getVersion();
  });

  const updateConfigPath = path.join(process.resourcesPath, 'app-update.yml');
  const isPortable = Boolean(process.env.PORTABLE_EXECUTABLE);
  const canAutoUpdate = app.isPackaged && !isPortable && fs.existsSync(updateConfigPath);

  if (!canAutoUpdate) {
    // Register no-op handlers so the renderer doesn't hang
    ipcMain.on('update:check', () => {});
    ipcMain.on('update:install', () => {});
    return;
  }

  // Clean up any temp file an interrupted install left beside the binary.
  cleanStaleUpdateTemps();

  autoUpdater.autoDownload = true;
  // On Linux we do our own verified, atomic AppImage swap (see
  // installAppImageUpdateAtomic). electron-updater's on-quit in-place swap can
  // die partway and leave the user with no binary, so disable it there.
  autoUpdater.autoInstallOnAppQuit = process.platform !== 'linux';

  // Disable code-signing verification on macOS. Without an Apple Developer
  // certificate the builds are ad-hoc signed, and each build gets a unique
  // identity — so the updater's default signature check always fails.
  if (process.platform === 'darwin') {
    autoUpdater.forceDevUpdateConfig = false;
    (autoUpdater as any).verifyUpdateCodeSignature = false;
  }

  // On Linux, only AppImage supports auto-update
  if (process.platform === 'linux' && !process.env.APPIMAGE) {
    autoUpdater.autoDownload = false;
  }

  autoUpdater.on('checking-for-update', () => {
    mainWindow.webContents.send('update:status', 'checking');
  });

  autoUpdater.on('update-available', (info: any) => {
    mainWindow.webContents.send('update:available', {
      version: info.version,
    });
  });

  autoUpdater.on('update-not-available', () => {
    mainWindow.webContents.send('update:status', 'up-to-date');
  });

  autoUpdater.on('download-progress', (progress: any) => {
    mainWindow.webContents.send('update:progress', {
      percent: progress.percent,
      transferred: progress.transferred,
      total: progress.total,
      bytesPerSecond: progress.bytesPerSecond,
    });
  });

  autoUpdater.on('update-downloaded', (info: any) => {
    mainWindow.webContents.send('update:downloaded', {
      version: info.version,
    });
  });

  autoUpdater.on('error', (err: any) => {
    console.error('[updater] error:', err?.message, err?.stack);
    mainWindow.webContents.send('update:error', {
      message: err?.message ?? 'Unknown update error',
    });
  });

  ipcMain.on('update:check', () => {
    autoUpdater.checkForUpdates().catch(() => {});
  });

  ipcMain.on('update:install', () => {
    // On Linux (AppImage), install ourselves with a verified atomic swap so a
    // failed install can never destroy the running binary. Fall back to
    // electron-updater if we can't (e.g. APPIMAGE env missing, no pending file).
    if (process.platform === 'linux' && process.env.APPIMAGE) {
      void installAppImageUpdateAtomic()
        .then((target) => {
          if (target) {
            app.relaunch({ execPath: target });
            app.exit(0);
          } else {
            // Nothing safe to install from — fall back rather than leave the
            // user stuck.
            autoUpdater.quitAndInstall();
          }
        })
        .catch((err) => {
          console.error('[updater] self-install threw:', err?.message);
          mainWindow.webContents.send('update:error', {
            message: 'Update install failed; your current version is intact.',
          });
        });
      return;
    }
    autoUpdater.quitAndInstall();
  });

  // Check after 3 second delay
  setTimeout(() => {
    autoUpdater.checkForUpdates().catch(() => {});
  }, 3000);
}
