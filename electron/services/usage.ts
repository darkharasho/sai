import { BrowserWindow, ipcMain } from 'electron';
import fs from 'node:fs';
import path from 'node:path';
import https from 'node:https';

const USAGE_API = 'https://api.anthropic.com/api/oauth/usage';
const POLL_INTERVAL = 60_000; // 60 seconds
const CREDENTIALS_PATH = path.join(process.env.HOME || '', '.claude', '.credentials.json');

let pollTimer: ReturnType<typeof setInterval> | null = null;
let cachedToken: string | null = null;
let tokenReadFailed = false;
let backoffUntil = 0; // Timestamp — skip polls until this time

function readOAuthToken(): string | null {
  if (cachedToken) return cachedToken;
  if (tokenReadFailed) return null;
  try {
    const raw = fs.readFileSync(CREDENTIALS_PATH, 'utf-8');
    const creds = JSON.parse(raw);
    const token = creds?.claudeAiOauth?.accessToken;
    if (token) {
      cachedToken = token;
      return token;
    }
    tokenReadFailed = true;
    return null;
  } catch {
    tokenReadFailed = true;
    return null;
  }
}

function fetchUsage(token: string): Promise<Record<string, unknown> | null> {
  return new Promise((resolve) => {
    const url = new URL(USAGE_API);
    const req = https.request({
      hostname: url.hostname,
      path: url.pathname,
      method: 'GET',
      headers: { 'x-api-key': token },
    }, (res) => {
      let body = '';
      res.on('data', (chunk: Buffer) => { body += chunk.toString(); });
      res.on('end', () => {
        if (res.statusCode === 200) {
          try {
            const parsed = JSON.parse(body);
            console.log('[usage] API response:', JSON.stringify(parsed, null, 2));
            resolve(parsed);
          } catch { resolve(null); }
        } else if (res.statusCode === 429) {
          // Back off using retry-after header, or default to 5 minutes
          const retryAfter = parseInt(res.headers['retry-after'] as string, 10);
          backoffUntil = Date.now() + (retryAfter > 0 ? retryAfter * 1000 : 300_000);
          resolve(null);
        } else {
          resolve(null);
        }
      });
    });
    req.on('error', () => resolve(null));
    req.setTimeout(10_000, () => { req.destroy(); resolve(null); });
    req.end();
  });
}

function safeSend(win: BrowserWindow, channel: string, ...args: unknown[]) {
  try {
    if (!win.isDestroyed()) {
      win.webContents.send(channel, ...args);
    }
  } catch { /* Window destroyed */ }
}

export function registerUsageHandlers(win: BrowserWindow) {
  // Manual fetch
  ipcMain.handle('usage:fetch', async () => {
    const token = readOAuthToken();
    if (!token) return null;
    return fetchUsage(token);
  });

  ipcMain.handle('usage:mode', () => {
    return readOAuthToken() ? 'subscription' : 'api';
  });

  // Start polling — sends usage:update events to renderer
  const poll = async () => {
    if (Date.now() < backoffUntil) return; // Skip if rate limited
    const token = readOAuthToken();
    if (!token) return;
    const data = await fetchUsage(token);
    if (data) {
      safeSend(win, 'usage:update', data);
    }
  };

  // Initial fetch after a short delay (let the app settle)
  setTimeout(poll, 5_000);
  pollTimer = setInterval(poll, POLL_INTERVAL);
}

export function destroyUsagePolling() {
  if (pollTimer) {
    clearInterval(pollTimer);
    pollTimer = null;
  }
}
