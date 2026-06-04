import { ipcMain } from 'electron';
import * as https from 'node:https';

function readSettings(): Record<string, any> {
  const fs = require('node:fs');
  const path = require('node:path');
  const { app } = require('electron');
  const settingsFile = path.join(app.getPath('userData'), 'settings.json');
  try { return JSON.parse(fs.readFileSync(settingsFile, 'utf-8')); } catch { return {}; }
}

function linearGraphQL(token: string, query: string): Promise<{ ok: boolean; status: number; body: any }> {
  return new Promise((resolve, reject) => {
    const postBody = JSON.stringify({ query });
    const req = https.request({
      hostname: 'api.linear.app',
      path: '/graphql',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': token,
        'User-Agent': 'SAI-App',
        'Content-Length': Buffer.byteLength(postBody),
      },
    }, (res) => {
      let raw = '';
      res.on('data', c => raw += c);
      res.on('end', () => {
        let body: any = raw;
        try { body = JSON.parse(raw); } catch { /* keep as text */ }
        resolve({ ok: (res.statusCode ?? 0) >= 200 && (res.statusCode ?? 0) < 300, status: res.statusCode ?? 0, body });
      });
    });
    req.on('error', reject);
    req.write(postBody);
    req.end();
  });
}

export function registerLinearHandlers() {
  ipcMain.handle('linear:configured', () => {
    return !!readSettings().linear_api_key;
  });

  ipcMain.handle('linear:getIssue', async (_event, issueKey: string) => {
    const token = readSettings().linear_api_key;
    if (!token) {
      return { ok: false, status: 0, body: { error: 'Linear not configured' } };
    }
    const query = `query {
      issueSearch(filter: { identifier: { eq: "${issueKey}" } }, first: 1) {
        nodes {
          identifier
          title
          state { name color }
          assignee { name avatarUrl }
          priority
          priorityLabel
          url
        }
      }
    }`;
    return linearGraphQL(token, query);
  });

  ipcMain.handle('linear:test', async () => {
    const token = readSettings().linear_api_key;
    if (!token) {
      return { ok: false, status: 0, body: { error: 'Linear not configured' } };
    }
    return linearGraphQL(token, '{ viewer { id name } }');
  });
}
