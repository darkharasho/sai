import { Notification, BrowserWindow, app } from 'electron';
import * as path from 'node:path';
import * as fs from 'node:fs';

const settingsFile = path.join(app.getPath('userData'), 'settings.json');

function isEnabled(): boolean {
  try {
    const settings = JSON.parse(fs.readFileSync(settingsFile, 'utf-8'));
    return settings.systemNotifications === true;
  } catch {
    return false;
  }
}

/**
 * Flash the taskbar and optionally send a system notification
 * when a response completes while the window is unfocused.
 */
export function notifyCompletion(win: BrowserWindow, projectPath: string) {
  if (win.isFocused()) return;

  win.flashFrame(true);

  if (isEnabled() && Notification.isSupported()) {
    const wsName = projectPath.split('/').pop() || projectPath;
    new Notification({
      title: 'SAI',
      body: `${wsName} has finished`,
    }).show();
  }
}
