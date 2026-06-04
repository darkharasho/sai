import { ipcMain } from 'electron';
import * as https from 'node:https';

function readSettings(): Record<string, any> {
  // Lazy import to avoid circular dependency — settings file managed by main.ts
  const fs = require('node:fs');
  const path = require('node:path');
  const { app } = require('electron');
  const settingsFile = path.join(app.getPath('userData'), 'settings.json');
  try { return JSON.parse(fs.readFileSync(settingsFile, 'utf-8')); } catch { return {}; }
}

function jiraGet(domain: string, path: string, email: string, token: string): Promise<{ ok: boolean; status: number; body: any }> {
  return new Promise((resolve, reject) => {
    const auth = Buffer.from(`${email}:${token}`).toString('base64');
    const req = https.request({
      hostname: domain,
      path,
      method: 'GET',
      headers: {
        'Accept': 'application/json',
        'Authorization': `Basic ${auth}`,
        'User-Agent': 'SAI-App',
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
    req.end();
  });
}

export function registerJiraHandlers() {
  ipcMain.handle('jira:configured', () => {
    const s = readSettings();
    return !!(s.jira_domain && s.jira_email && s.jira_api_token);
  });

  ipcMain.handle('jira:getIssue', async (_event, issueKey: string) => {
    const s = readSettings();
    if (!s.jira_domain || !s.jira_email || !s.jira_api_token) {
      return { ok: false, status: 0, body: { error: 'Jira not configured' } };
    }
    return jiraGet(
      s.jira_domain,
      `/rest/api/3/issue/${encodeURIComponent(issueKey)}?fields=summary,status,issuetype,assignee,priority,project`,
      s.jira_email,
      s.jira_api_token,
    );
  });

  ipcMain.handle('jira:test', async () => {
    const s = readSettings();
    if (!s.jira_domain || !s.jira_email || !s.jira_api_token) {
      return { ok: false, status: 0, body: { error: 'Jira not configured' } };
    }
    return jiraGet(s.jira_domain, '/rest/api/3/myself', s.jira_email, s.jira_api_token);
  });
}
