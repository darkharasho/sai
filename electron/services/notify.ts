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

export interface CompletionInfo {
  provider?: string;
  duration?: number;   // ms
  turns?: number;
  cost?: number;       // USD
  summary?: string;    // final text snippet
}

function formatDuration(ms: number): string {
  const secs = Math.round(ms / 1000);
  if (secs < 60) return `${secs}s`;
  const mins = Math.floor(secs / 60);
  const rem = secs % 60;
  return rem > 0 ? `${mins}m ${rem}s` : `${mins}m`;
}

/**
 * Flash the taskbar and optionally send a system notification
 * when a response completes while the window is unfocused.
 */
export function notifyCompletion(win: BrowserWindow, projectPath: string, info?: CompletionInfo) {
  if (win.isFocused()) return;

  win.flashFrame(true);

  if (isEnabled() && Notification.isSupported()) {
    const wsName = projectPath.split('/').pop() || projectPath;

    const parts: string[] = [];
    if (info?.provider) parts.push(info.provider);
    if (info?.duration) parts.push(formatDuration(info.duration));
    if (info?.turns && info.turns > 1) parts.push(`${info.turns} turns`);
    if (info?.cost) parts.push(`$${info.cost.toFixed(4)}`);

    const meta = parts.length > 0 ? ` (${parts.join(' · ')})` : '';

    let body = `${wsName} has finished${meta}`;
    if (info?.summary) {
      const snippet = info.summary.length > 100 ? info.summary.slice(0, 100) + '…' : info.summary;
      body += `\n${snippet}`;
    }

    new Notification({
      title: 'SAI',
      body,
    }).show();
  }
}
