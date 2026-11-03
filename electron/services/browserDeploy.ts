/**
 * Deploying the browser bridge extension to a Chromium browser.
 *
 * Chrome deliberately offers no API to install an unpacked extension — that
 * click is reserved for a human. Everything else is automatable, and the part
 * that's actually tedious (finding the extension ID) turns out to be readable
 * straight out of the browser's profile: Chromium records every loaded
 * unpacked extension in `Secure Preferences` under
 * `extensions.settings[<id>].path` with `location: 4`. So the flow is:
 *
 *   1. detectBrowsers()         — which Chromium browsers actually exist
 *   2. (user clicks Load unpacked, pointed at extensionDir())
 *   3. findExtensionId()        — scan profiles for our path, get the ID free
 *   4. installNativeHost()      — write the host manifest pinned to that ID
 *
 * Imports nothing from electron so the CLI (scripts/install-browser-bridge.mjs)
 * can require the built bundle and share one implementation.
 */
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import * as crypto from 'node:crypto';
import { execFile } from 'node:child_process';
import { bridgeDir } from './browserBridgePaths';

export const HOST_NAME = 'com.sai.browser_bridge';

/** `location: 4` is Chromium's LOAD_UNPACKED. Anything else is a store/bundled install. */
const LOCATION_UNPACKED = 4;

export interface BrowserDef {
  id: string;
  label: string;
  /** Path to the user-data root, which is where NativeMessagingHosts lives. */
  userDataDir: string;
  /** macOS app name for `open -a`, when we can open its extensions page. */
  macAppName?: string;
}

export interface DetectedBrowser extends BrowserDef {
  nativeHostDir: string;
  /** Whether our host manifest is already installed for this browser. */
  hostInstalled: boolean;
  /** Extension ID of our unpacked extension, if the user has loaded it. */
  extensionId: string | null;
}

function macSupport(home: string): string {
  return path.join(home, 'Library', 'Application Support');
}

/**
 * Candidate browsers per platform. Chromium forks differ in whether the
 * user-data root is the support dir itself (Comet) or a `User Data` child
 * (Arc, Dia) — both were verified by inspecting real installs.
 */
export function browserCandidates(
  home: string = os.homedir(),
  platform: string = process.platform,
  env: NodeJS.ProcessEnv = process.env,
): BrowserDef[] {
  if (platform === 'darwin') {
    const s = macSupport(home);
    return [
      { id: 'chrome', label: 'Google Chrome', userDataDir: path.join(s, 'Google', 'Chrome'), macAppName: 'Google Chrome' },
      { id: 'chrome-beta', label: 'Chrome Beta', userDataDir: path.join(s, 'Google', 'Chrome Beta'), macAppName: 'Google Chrome Beta' },
      { id: 'chrome-canary', label: 'Chrome Canary', userDataDir: path.join(s, 'Google', 'Chrome Canary'), macAppName: 'Google Chrome Canary' },
      { id: 'chromium', label: 'Chromium', userDataDir: path.join(s, 'Chromium'), macAppName: 'Chromium' },
      { id: 'edge', label: 'Microsoft Edge', userDataDir: path.join(s, 'Microsoft Edge'), macAppName: 'Microsoft Edge' },
      { id: 'brave', label: 'Brave', userDataDir: path.join(s, 'BraveSoftware', 'Brave-Browser'), macAppName: 'Brave Browser' },
      { id: 'vivaldi', label: 'Vivaldi', userDataDir: path.join(s, 'Vivaldi'), macAppName: 'Vivaldi' },
      { id: 'opera', label: 'Opera', userDataDir: path.join(s, 'com.operasoftware.Opera'), macAppName: 'Opera' },
      { id: 'arc', label: 'Arc', userDataDir: path.join(s, 'Arc', 'User Data'), macAppName: 'Arc' },
      { id: 'dia', label: 'Dia', userDataDir: path.join(s, 'Dia', 'User Data'), macAppName: 'Dia' },
      { id: 'comet', label: 'Comet', userDataDir: path.join(s, 'Comet'), macAppName: 'Comet' },
    ];
  }

  if (platform === 'linux') {
    const config = env.XDG_CONFIG_HOME || path.join(home, '.config');
    return [
      { id: 'chrome', label: 'Google Chrome', userDataDir: path.join(config, 'google-chrome') },
      { id: 'chromium', label: 'Chromium', userDataDir: path.join(config, 'chromium') },
      { id: 'edge', label: 'Microsoft Edge', userDataDir: path.join(config, 'microsoft-edge') },
      { id: 'brave', label: 'Brave', userDataDir: path.join(config, 'BraveSoftware', 'Brave-Browser') },
      { id: 'vivaldi', label: 'Vivaldi', userDataDir: path.join(config, 'vivaldi') },
    ];
  }

  if (platform === 'win32') {
    const local = env.LOCALAPPDATA || path.join(home, 'AppData', 'Local');
    return [
      { id: 'chrome', label: 'Google Chrome', userDataDir: path.join(local, 'Google', 'Chrome', 'User Data') },
      { id: 'chromium', label: 'Chromium', userDataDir: path.join(local, 'Chromium', 'User Data') },
      { id: 'edge', label: 'Microsoft Edge', userDataDir: path.join(local, 'Microsoft', 'Edge', 'User Data') },
      { id: 'brave', label: 'Brave', userDataDir: path.join(local, 'BraveSoftware', 'Brave-Browser', 'User Data') },
    ];
  }

  return [];
}

/**
 * Chromium's extension-id derivation: SHA-256 the identity bytes, take the
 * first 16, and map each hex nibble 0–f onto a–p.
 *
 * The identity bytes are the DER SubjectPublicKeyInfo when the manifest has a
 * `key`, and the absolute install path when it doesn't — which is exactly why
 * we pin a key. Verified against a real Chromium-assigned id for a path-loaded
 * extension (see the test).
 */
function chromiumIdFromBytes(bytes: Buffer): string {
  return crypto.createHash('sha256').update(bytes).digest('hex').slice(0, 32)
    .replace(/[0-9a-f]/g, (c) => String.fromCharCode(97 + parseInt(c, 16)));
}

/** Extension id for a manifest `key` (base64 DER SubjectPublicKeyInfo). */
export function deriveExtensionId(publicKeyBase64: string): string {
  return chromiumIdFromBytes(Buffer.from(publicKeyBase64, 'base64'));
}

/** Extension id Chromium assigns an unpacked extension loaded from `dir`. */
export function unpackedExtensionId(dir: string): string {
  return chromiumIdFromBytes(Buffer.from(path.resolve(dir), 'utf8'));
}

/**
 * The id this extension will get, read from its own manifest `key`. Returns
 * null for an unkeyed manifest, where the id depends on the install path and
 * can only be discovered after loading.
 */
export function expectedExtensionId(extensionDir: string): string | null {
  try {
    const manifest = JSON.parse(fs.readFileSync(path.join(extensionDir, 'manifest.json'), 'utf8'));
    return typeof manifest?.key === 'string' ? deriveExtensionId(manifest.key) : null;
  } catch {
    return null;
  }
}

export function nativeHostDirFor(browser: BrowserDef): string {
  return path.join(browser.userDataDir, 'NativeMessagingHosts');
}

/**
 * A browser counts as installed only if its user-data dir holds a `Local
 * State` file. Uninstalled Chromium forks leave empty support directories
 * behind, and those would otherwise show up as real browsers.
 */
export function isBrowserPresent(browser: BrowserDef): boolean {
  try {
    return fs.statSync(path.join(browser.userDataDir, 'Local State')).isFile();
  } catch {
    return false;
  }
}

/** Profile sub-directories of a user-data dir (`Default`, `Profile 1`, …). */
export function profileDirs(userDataDir: string): string[] {
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(userDataDir, { withFileTypes: true });
  } catch {
    return [];
  }
  return entries
    .filter((e) => e.isDirectory() && (e.name === 'Default' || /^Profile[ _]?\d+$/.test(e.name)))
    .map((e) => path.join(userDataDir, e.name));
}

function samePath(a: string, b: string): boolean {
  const norm = (p: string) => path.resolve(p).replace(/[/\\]+$/, '');
  const x = norm(a);
  const y = norm(b);
  // macOS and Windows filesystems are case-insensitive by default.
  return process.platform === 'linux' ? x === y : x.toLowerCase() === y.toLowerCase();
}

/**
 * Finds the ID Chromium assigned to our unpacked extension by looking for a
 * profile entry whose source path is `extensionDir`.
 *
 * Both preference files are checked: unpacked extensions normally land in
 * `Secure Preferences`, but the plain file is read as a fallback because the
 * split has moved between Chromium versions.
 */
export function findExtensionId(userDataDir: string, extensionDir: string): string | null {
  for (const profile of profileDirs(userDataDir)) {
    for (const file of ['Secure Preferences', 'Preferences']) {
      let parsed: any;
      try {
        parsed = JSON.parse(fs.readFileSync(path.join(profile, file), 'utf8'));
      } catch {
        continue;
      }
      const settings = parsed?.extensions?.settings;
      if (!settings || typeof settings !== 'object') continue;

      for (const [id, raw] of Object.entries<any>(settings)) {
        if (raw?.location !== LOCATION_UNPACKED) continue;
        if (typeof raw?.path !== 'string') continue;
        // Unpacked paths are absolute; store-installed ones are relative.
        if (samePath(raw.path, extensionDir)) return id;
      }
    }
  }
  return null;
}

export function hostManifestPath(browser: BrowserDef): string {
  return path.join(nativeHostDirFor(browser), `${HOST_NAME}.json`);
}

export function isHostInstalled(browser: BrowserDef): boolean {
  return fs.existsSync(hostManifestPath(browser));
}

export interface DetectOptions {
  extensionDir: string;
  home?: string;
  platform?: string;
  env?: NodeJS.ProcessEnv;
}

export function detectBrowsers(opts: DetectOptions): DetectedBrowser[] {
  const candidates = browserCandidates(opts.home, opts.platform, opts.env);
  return candidates.filter(isBrowserPresent).map((browser) => ({
    ...browser,
    nativeHostDir: nativeHostDirFor(browser),
    hostInstalled: isHostInstalled(browser),
    extensionId: findExtensionId(browser.userDataDir, opts.extensionDir),
  }));
}

/**
 * Chromium execs the native host directly, so the manifest `path` has to point
 * at an executable — it can't be "node script.js". Write a shim that execs the
 * current Node/Electron binary with the relay script.
 */
export function writeLauncher(
  relayScript: string,
  nodeBinary: string = process.execPath,
  home: string = os.homedir(),
): string {
  const dir = bridgeDir(home);
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });

  if (process.platform === 'win32') {
    const cmd = path.join(dir, 'bridge-host.bat');
    fs.writeFileSync(cmd, `@echo off\r\n"${nodeBinary}" "${relayScript}" %*\r\n`);
    return cmd;
  }

  const sh = path.join(dir, 'bridge-host.sh');
  // ELECTRON_RUN_AS_NODE matters when nodeBinary is the Electron binary from a
  // packaged app: without it, Electron boots an app instead of running the script.
  fs.writeFileSync(
    sh,
    `#!/bin/sh\nexport ELECTRON_RUN_AS_NODE=1\nexec "${nodeBinary}" "${relayScript}" "$@"\n`,
    { mode: 0o755 },
  );
  return sh;
}

export function buildHostManifest(extensionId: string, launcher: string) {
  return {
    name: HOST_NAME,
    description: 'SAI Browser Bridge',
    path: launcher,
    type: 'stdio',
    // The trust boundary: only this extension may spawn the relay.
    allowed_origins: [`chrome-extension://${extensionId}/`],
  };
}

export function isValidExtensionId(id: string): boolean {
  return /^[a-p]{32}$/.test(id);
}

export interface InstallResult {
  browser: string;
  manifestPath: string;
}

export function installNativeHost(opts: {
  browsers: BrowserDef[];
  extensionId: string;
  relayScript: string;
  nodeBinary?: string;
  home?: string;
}): InstallResult[] {
  if (!isValidExtensionId(opts.extensionId)) {
    throw new Error(`"${opts.extensionId}" is not a Chromium extension id (32 chars, a-p)`);
  }
  if (!fs.existsSync(opts.relayScript)) {
    throw new Error(`relay script not found at ${opts.relayScript} — build SAI first`);
  }

  const launcher = writeLauncher(opts.relayScript, opts.nodeBinary, opts.home);
  const manifest = buildHostManifest(opts.extensionId, launcher);
  const results: InstallResult[] = [];

  for (const browser of opts.browsers) {
    const dir = nativeHostDirFor(browser);
    fs.mkdirSync(dir, { recursive: true });
    const manifestPath = path.join(dir, `${HOST_NAME}.json`);
    fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));
    results.push({ browser: browser.id, manifestPath });
  }

  return results;
}

export function uninstallNativeHost(browsers: BrowserDef[]): string[] {
  const removed: string[] = [];
  for (const browser of browsers) {
    const manifestPath = hostManifestPath(browser);
    try {
      fs.unlinkSync(manifestPath);
      removed.push(manifestPath);
    } catch {
      /* not installed for this browser */
    }
  }
  return removed;
}

/**
 * Windows resolves native hosts through the registry rather than a directory,
 * so the manifest file alone isn't enough. HKCU needs no elevation.
 */
export function registerWindowsHost(manifestPath: string, hive = 'HKCU'): Promise<void> {
  const key = `${hive}\\Software\\Google\\Chrome\\NativeMessagingHosts\\${HOST_NAME}`;
  return new Promise((resolve, reject) => {
    execFile('reg', ['add', key, '/ve', '/t', 'REG_SZ', '/d', manifestPath, '/f'], (err) => {
      if (err) reject(new Error(`registry registration failed: ${err.message}`));
      else resolve();
    });
  });
}

/**
 * Opens the browser's extensions page. Chromium accepts a chrome:// URL as a
 * command-line argument; if the fork doesn't, the caller still shows the
 * extension folder path so the user can finish by hand.
 */
export function openExtensionsPage(browser: BrowserDef): Promise<void> {
  return new Promise((resolve, reject) => {
    if (process.platform === 'darwin' && browser.macAppName) {
      execFile('open', ['-a', browser.macAppName, 'chrome://extensions'], (err) => {
        if (err) reject(new Error(`could not open ${browser.label}: ${err.message}`));
        else resolve();
      });
      return;
    }
    reject(new Error(`opening the extensions page is not supported for ${browser.label} on this platform`));
  });
}
