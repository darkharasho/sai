import { ipcMain, BrowserWindow, shell } from 'electron';
import https from 'node:https';
import { execFile } from 'node:child_process';
import path from 'node:path';
import fs from 'node:fs';

const CLIENT_ID = process.env.GH_CLIENT_ID || 'Ov23lix7TYcz9hm8M874';

function post(url: string, body: string): Promise<any> {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const data = Buffer.from(body);
    const req = https.request({
      hostname: u.hostname,
      path: u.pathname,
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Accept': 'application/json',
        'Content-Length': data.length,
        'User-Agent': 'SAI-App',
      },
    }, (res) => {
      let raw = '';
      res.on('data', c => raw += c);
      res.on('end', () => { try { resolve(JSON.parse(raw)); } catch { resolve(raw); } });
    });
    req.on('error', reject);
    req.write(data);
    req.end();
  });
}

function get(url: string, token: string): Promise<any> {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const req = https.request({
      hostname: u.hostname,
      path: u.pathname + u.search,
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Accept': 'application/json',
        'User-Agent': 'SAI-App',
      },
    }, (res) => {
      let raw = '';
      res.on('data', c => raw += c);
      res.on('end', () => { try { resolve(JSON.parse(raw)); } catch { resolve(raw); } });
    });
    req.on('error', reject);
    req.end();
  });
}

let pollTimer: ReturnType<typeof setTimeout> | null = null;
let expireTimer: ReturnType<typeof setTimeout> | null = null;
let polling = false;

function stopPolling() {
  polling = false;
  if (pollTimer) { clearTimeout(pollTimer); pollTimer = null; }
  if (expireTimer) { clearTimeout(expireTimer); expireTimer = null; }
}

export function registerGithubAuthHandlers(
  mainWindow: BrowserWindow,
  readSettings: () => Record<string, any>,
  writeSetting: (key: string, value: any) => void,
  onAuthComplete?: () => void,
) {
  ipcMain.handle('github:getUser', () => {
    return readSettings().github_auth?.user ?? null;
  });

  ipcMain.handle('github:startAuth', async () => {
    stopPolling();

    const deviceResult = await post(
      'https://github.com/login/device/code',
      `client_id=${CLIENT_ID}&scope=repo,read:user`,
    );

    if (!deviceResult.device_code) throw new Error('GitHub device flow failed');

    const { device_code, user_code, verification_uri, expires_in, interval } = deviceResult;

    // Auto-open browser
    shell.openExternal(verification_uri);

    let pollMs = Math.max((interval || 5), 5) * 1000;
    polling = true;

    const doPoll = async () => {
      if (!polling) return;
      try {
        const token = await post(
          'https://github.com/login/oauth/access_token',
          `client_id=${CLIENT_ID}&device_code=${device_code}&grant_type=urn:ietf:params:oauth:grant-type:device_code`,
        );

        if (token.access_token) {
          stopPolling();
          const ghUser = await get('https://api.github.com/user', token.access_token);
          const user = { login: ghUser.login, avatar_url: ghUser.avatar_url, name: ghUser.name || ghUser.login };
          writeSetting('github_auth', { token: token.access_token, user });
          mainWindow.webContents.send('github:authComplete', user);
          onAuthComplete?.();
          return;
        } else if (token.error === 'slow_down') {
          pollMs += 5000;
        } else if (token.error === 'access_denied' || token.error === 'expired_token') {
          stopPolling();
          mainWindow.webContents.send('github:authError', token.error);
          return;
        }
        // 'authorization_pending' or slow_down → schedule next poll
      } catch {
        // network error — keep polling
      }
      if (polling) pollTimer = setTimeout(doPoll, pollMs);
    };

    pollTimer = setTimeout(doPoll, pollMs);

    expireTimer = setTimeout(() => {
      if (pollTimer) {
        stopPolling();
        mainWindow.webContents.send('github:authError', 'expired_token');
      }
    }, (expires_in || 900) * 1000);

    return { user_code, verification_uri, expires_in };
  });

  ipcMain.handle('github:cancelAuth', () => stopPolling());

  ipcMain.handle('github:logout', () => {
    stopPolling();
    writeSetting('github_auth', null);
  });

  ipcMain.handle('github:listRepos', async (_event, page: number = 1, search?: string) => {
    const token = readSettings().github_auth?.token;
    if (!token) throw new Error('Not authenticated');

    const PER_PAGE = 50;
    const mapRepo = (r: any) => ({
      name: r.name,
      full_name: r.full_name,
      clone_url: r.clone_url,
      private: r.private,
      description: r.description,
      updated_at: r.updated_at,
      language: r.language,
    });

    if (search) {
      // Search all repos the user can access (owned, org, collaborator)
      const q = encodeURIComponent(`${search} in:name fork:true`);
      const result = await get(`https://api.github.com/search/repositories?q=${q}&per_page=${PER_PAGE}&page=${page}`, token);
      return {
        items: (result.items || []).map(mapRepo),
        hasMore: (result.total_count || 0) > page * PER_PAGE,
      };
    }

    const repos = await get(`https://api.github.com/user/repos?sort=updated&per_page=${PER_PAGE}&page=${page}&affiliation=owner,collaborator,organization_member`, token);
    if (!Array.isArray(repos)) throw new Error('Failed to fetch repos');
    return { items: repos.map(mapRepo), hasMore: repos.length === PER_PAGE };
  });

  ipcMain.handle('github:clone', async (_event, cloneUrl: string, targetDir: string) => {
    const token = readSettings().github_auth?.token;
    if (!token) throw new Error('Not authenticated');

    // Inject token into clone URL for auth: https://<token>@github.com/...
    const authedUrl = cloneUrl.replace('https://github.com/', `https://${token}@github.com/`);

    // Ensure parent dir exists
    fs.mkdirSync(targetDir, { recursive: true });

    // Extract repo name for the clone target
    const repoName = path.basename(cloneUrl, '.git');
    const clonePath = path.join(targetDir, repoName);

    if (fs.existsSync(clonePath)) {
      throw new Error(`Directory already exists: ${clonePath}`);
    }

    return new Promise<string>((resolve, reject) => {
      execFile('git', ['clone', authedUrl, clonePath], { timeout: 120000 }, (err) => {
        if (err) {
          reject(new Error(err.message));
        } else {
          resolve(clonePath);
        }
      });
    });
  });
}
