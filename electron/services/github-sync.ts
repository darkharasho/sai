import https from 'node:https';
import { BrowserWindow } from 'electron';

const REPO_NAME = 'sai-config';
const SETTINGS_FILE = 'settings.json';
// Keys that are device-specific and should never be synced
const EXCLUDE_KEYS = new Set(['github_auth']);

function apiRequest(method: string, path: string, token: string, body?: any): Promise<{ status: number; data: any }> {
  return new Promise((resolve, reject) => {
    const payload = body ? JSON.stringify(body) : undefined;
    const req = https.request({
      hostname: 'api.github.com',
      path,
      method,
      headers: {
        'Authorization': `Bearer ${token}`,
        'Accept': 'application/vnd.github.v3+json',
        'User-Agent': 'SAI-App',
        'Content-Type': 'application/json',
        ...(payload ? { 'Content-Length': Buffer.byteLength(payload) } : {}),
      },
    }, (res) => {
      let raw = '';
      res.on('data', c => raw += c);
      res.on('end', () => {
        const status = res.statusCode ?? 0;
        let data: any = null;
        try { data = raw ? JSON.parse(raw) : null; } catch { data = raw; }
        if (status >= 400) {
          reject(new Error(`GitHub API ${method} ${path} failed: ${status} ${data?.message ?? ''}`));
        } else {
          resolve({ status, data });
        }
      });
    });
    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
  });
}

// In-memory SHA of the remote settings file (needed for updates)
let remoteSha: string | null = null;

async function ensureRepo(token: string, login: string): Promise<void> {
  // 404 is expected when the repo doesn't exist yet — catch it explicitly
  const exists = await apiRequest('GET', `/repos/${login}/${REPO_NAME}`, token).then(() => true).catch((e: Error) => {
    if (e.message.includes('404')) return false;
    throw e; // re-throw unexpected errors (403, network, etc.)
  });
  if (exists) return;
  await apiRequest('POST', '/user/repos', token, {
    name: REPO_NAME,
    private: true,
    description: 'SAI editor settings sync',
    auto_init: true,
  });
  // Brief pause for GitHub to initialize the repo
  await new Promise(r => setTimeout(r, 1500));
}

async function fetchRemote(token: string, login: string): Promise<Record<string, any> | null> {
  const result = await apiRequest('GET', `/repos/${login}/${REPO_NAME}/contents/${SETTINGS_FILE}`, token)
    .catch((e: Error) => {
      if (e.message.includes('404')) return null; // file doesn't exist yet
      throw e;
    });
  if (!result?.data?.content) return null;
  remoteSha = result.data.sha;
  const json = Buffer.from(result.data.content, 'base64').toString('utf-8');
  try { return JSON.parse(json); } catch { return null; }
}

async function pushRemote(token: string, login: string, settings: Record<string, any>): Promise<void> {
  const filtered = Object.fromEntries(
    Object.entries(settings).filter(([k]) => !EXCLUDE_KEYS.has(k))
  );
  const content = Buffer.from(JSON.stringify(filtered, null, 2)).toString('base64');
  const body: any = { message: 'sync: update settings', content };
  if (remoteSha) body.sha = remoteSha;

  const { data } = await apiRequest(
    'PUT', `/repos/${login}/${REPO_NAME}/contents/${SETTINGS_FILE}`, token, body
  );
  if (data?.content?.sha) remoteSha = data.content.sha;
}

// Push debounce
let pushTimer: ReturnType<typeof setTimeout> | null = null;

export function schedulePush(
  token: string,
  login: string,
  readSettings: () => Record<string, any>,
  win: BrowserWindow,
  delayMs = 2000,
) {
  if (pushTimer) clearTimeout(pushTimer);
  pushTimer = setTimeout(async () => {
    pushTimer = null;
    try {
      win.webContents.send('github:syncStatus', { status: 'syncing' });
      await pushRemote(token, login, readSettings());
      win.webContents.send('github:syncStatus', { status: 'synced', lastSynced: Date.now() });
    } catch {
      win.webContents.send('github:syncStatus', { status: 'error' });
    }
  }, delayMs);
}

export async function initialSync(
  token: string,
  login: string,
  readSettings: () => Record<string, any>,
  writeSetting: (key: string, value: any) => void,
  win: BrowserWindow,
): Promise<void> {
  win.webContents.send('github:syncStatus', { status: 'syncing' });
  try {
    await ensureRepo(token, login);

    const remote = await fetchRemote(token, login);

    if (remote && Object.keys(remote).length > 0) {
      // Remote exists — apply remote values, keep local for keys not in remote
      for (const [key, value] of Object.entries(remote)) {
        if (!EXCLUDE_KEYS.has(key)) {
          writeSetting(key, value);
        }
      }
      // Notify renderer to reload settings
      win.webContents.send('github:settingsApplied', remote);
    } else {
      // No remote settings yet — push current local settings
      await pushRemote(token, login, readSettings());
    }

    win.webContents.send('github:syncStatus', { status: 'synced', lastSynced: Date.now() });
  } catch {
    win.webContents.send('github:syncStatus', { status: 'error' });
  }
}
