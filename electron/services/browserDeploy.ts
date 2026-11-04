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
import { execFile, execFileSync } from 'node:child_process';
import { bridgeDir } from './browserBridgePaths';

export const HOST_NAME = 'com.sai.browser_bridge';

/** `location: 4` is Chromium's LOAD_UNPACKED. Anything else is a store/bundled install. */
const LOCATION_UNPACKED = 4;

export interface BrowserDef {
  id: string;
  label: string;
  /** Path to the user-data root. Profiles and preference files live here. */
  userDataDir: string;
  /**
   * Where this browser actually looks for native-messaging host manifests,
   * when that isn't `<userDataDir>/NativeMessagingHosts`. See the Arc/Dia note
   * in `browserCandidates`.
   */
  nativeHostDir?: string;
  /** macOS app name for `open -a`, when we can open its extensions page. */
  macAppName?: string;
  /**
   * Flatpak application id, for a browser installed from Flathub. Such a
   * browser runs in a bubblewrap sandbox: it reads manifests from its own
   * `~/.var/app/<id>/config`, can't see `~/.sai` unless granted, and can't
   * exec SAI's Electron binary at all. See `installNativeHost`.
   */
  flatpakAppId?: string;
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
 *
 * The manifest directory is a separate question from the user-data root. On
 * macOS, Chromium resolves `DIR_USER_NATIVE_MESSAGING` from a *branded*
 * constant rather than from the profile, so a fork that never rebranded it
 * keeps reading Chrome's directory. Arc and Dia both ship the same
 * `ArcCore.framework` and do exactly that — verified on Dia by bisecting
 * candidate directories against a live `connectNative`, and carried over to
 * Arc because the binary is byte-for-byte the same engine.
 */
export function browserCandidates(
  home: string = os.homedir(),
  platform: string = process.platform,
  env: NodeJS.ProcessEnv = process.env,
): BrowserDef[] {
  if (platform === 'darwin') {
    const s = macSupport(home);
    // Unrebranded forks (Arc, Dia) read Chrome's manifest directory.
    const chromeHostDir = path.join(s, 'Google', 'Chrome', 'NativeMessagingHosts');
    return [
      { id: 'chrome', label: 'Google Chrome', userDataDir: path.join(s, 'Google', 'Chrome'), macAppName: 'Google Chrome' },
      { id: 'chrome-beta', label: 'Chrome Beta', userDataDir: path.join(s, 'Google', 'Chrome Beta'), macAppName: 'Google Chrome Beta' },
      { id: 'chrome-canary', label: 'Chrome Canary', userDataDir: path.join(s, 'Google', 'Chrome Canary'), macAppName: 'Google Chrome Canary' },
      { id: 'chromium', label: 'Chromium', userDataDir: path.join(s, 'Chromium'), macAppName: 'Chromium' },
      { id: 'edge', label: 'Microsoft Edge', userDataDir: path.join(s, 'Microsoft Edge'), macAppName: 'Microsoft Edge' },
      { id: 'brave', label: 'Brave', userDataDir: path.join(s, 'BraveSoftware', 'Brave-Browser'), macAppName: 'Brave Browser' },
      { id: 'vivaldi', label: 'Vivaldi', userDataDir: path.join(s, 'Vivaldi'), macAppName: 'Vivaldi' },
      { id: 'opera', label: 'Opera', userDataDir: path.join(s, 'com.operasoftware.Opera'), macAppName: 'Opera' },
      { id: 'arc', label: 'Arc', userDataDir: path.join(s, 'Arc', 'User Data'), nativeHostDir: chromeHostDir, macAppName: 'Arc' },
      { id: 'dia', label: 'Dia', userDataDir: path.join(s, 'Dia', 'User Data'), nativeHostDir: chromeHostDir, macAppName: 'Dia' },
      { id: 'comet', label: 'Comet', userDataDir: path.join(s, 'Comet'), macAppName: 'Comet' },
    ];
  }

  if (platform === 'linux') {
    const config = env.XDG_CONFIG_HOME || path.join(home, '.config');
    // Flatpak gives each app its own XDG_CONFIG_HOME under ~/.var/app, and the
    // host's XDG_CONFIG_HOME doesn't leak in, so these are always home-relative.
    const flatpak = (id: string, label: string, appId: string, ...sub: string[]): BrowserDef => ({
      id: `${id}-flatpak`,
      label: `${label} (Flatpak)`,
      userDataDir: path.join(home, '.var', 'app', appId, 'config', ...sub),
      flatpakAppId: appId,
    });
    return [
      { id: 'chrome', label: 'Google Chrome', userDataDir: path.join(config, 'google-chrome') },
      { id: 'chromium', label: 'Chromium', userDataDir: path.join(config, 'chromium') },
      { id: 'edge', label: 'Microsoft Edge', userDataDir: path.join(config, 'microsoft-edge') },
      { id: 'brave', label: 'Brave', userDataDir: path.join(config, 'BraveSoftware', 'Brave-Browser') },
      { id: 'vivaldi', label: 'Vivaldi', userDataDir: path.join(config, 'vivaldi') },
      flatpak('chrome', 'Google Chrome', 'com.google.Chrome', 'google-chrome'),
      flatpak('chromium', 'Chromium', 'org.chromium.Chromium', 'chromium'),
      flatpak('ungoogled', 'Ungoogled Chromium', 'io.github.ungoogled_software.ungoogled_chromium', 'chromium'),
      flatpak('edge', 'Microsoft Edge', 'com.microsoft.Edge', 'microsoft-edge'),
      flatpak('brave', 'Brave', 'com.brave.Browser', 'BraveSoftware', 'Brave-Browser'),
      flatpak('vivaldi', 'Vivaldi', 'com.vivaldi.Vivaldi', 'vivaldi'),
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
  return browser.nativeHostDir ?? path.join(browser.userDataDir, 'NativeMessagingHosts');
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
 * With a pinned id (the manifest `key`), an unpacked entry carrying that id
 * counts too, wherever it was loaded from. Path matching alone misses two real
 * cases: a Flatpak browser records the document-portal path
 * (`/run/flatpak/doc/<hash>/chrome`) its file chooser handed it, and an
 * AppImage build's folder moves with every launch.
 *
 * Both preference files are checked: unpacked extensions normally land in
 * `Secure Preferences`, but the plain file is read as a fallback because the
 * split has moved between Chromium versions.
 */
export function findExtensionId(
  userDataDir: string,
  extensionDir: string,
  pinnedId: string | null = null,
): string | null {
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
        if (pinnedId && id === pinnedId) return id;
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
    extensionId: findExtensionId(browser.userDataDir, opts.extensionDir, expectedExtensionId(opts.extensionDir)),
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

/**
 * Relay for sandboxed (Flatpak) browsers. Inside bubblewrap the Electron
 * binary isn't on the filesystem and couldn't run if it were, but every
 * freedesktop runtime ships python3 — so this is a stdlib-only port of
 * electron/browser-bridge-host.ts. Same framing, same handshake, same errors;
 * keep the two in step.
 */
export const FLATPAK_RELAY_SOURCE = String.raw`#!/usr/bin/env python3
# SAI Browser Bridge relay for Flatpak browsers. Written by SAI — do not edit.
# Python port of browser-bridge-host.ts: Chrome native messages (4-byte LE
# length + UTF-8 JSON) on stdio <-> NDJSON on ~/.sai/browser-bridge/bridge.sock.
import json, os, socket, struct, sys, threading

MAX = 1024 * 1024
BASE = os.path.join(os.path.expanduser("~"), ".sai", "browser-bridge")
out = sys.stdout.buffer
out_lock = threading.Lock()


def send(obj):
    body = json.dumps(obj).encode("utf-8")
    if len(body) > MAX:
        body = json.dumps({"type": "bridge-error", "error": "native message too large: %d bytes" % len(body)}).encode("utf-8")
    with out_lock:
        out.write(struct.pack("<I", len(body)) + body)
        out.flush()


try:
    with open(os.path.join(BASE, "token")) as f:
        token = f.read().strip()
except OSError:
    token = ""
if not token:
    send({"type": "bridge-error", "error": "SAI is not running (no bridge token found)"})
    sys.exit(1)

sock = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
try:
    sock.connect(os.path.join(BASE, "bridge.sock"))
except OSError as e:
    send({"type": "bridge-error", "error": "cannot reach SAI: %s" % e})
    sys.exit(1)

sock_lock = threading.Lock()
state_lock = threading.Lock()
authed = False
queued = []


def to_sai(obj):
    with sock_lock:
        sock.sendall((json.dumps(obj) + "\n").encode("utf-8"))


def from_sai():
    global authed
    buf = b""
    while True:
        try:
            chunk = sock.recv(65536)
        except OSError:
            chunk = b""
        if not chunk:
            os._exit(0)
        buf += chunk
        while b"\n" in buf:
            line, buf = buf.split(b"\n", 1)
            line = line.strip()
            if not line:
                continue
            try:
                msg = json.loads(line)
            except ValueError:
                continue
            with state_lock:
                if not authed:
                    if isinstance(msg, dict) and msg.get("type") == "welcome":
                        authed = True
                        for q in queued:
                            to_sai(q)
                        del queued[:]
                        continue
                    err = msg.get("error") if isinstance(msg, dict) else None
                    send({"type": "bridge-error", "error": err or "bridge handshake rejected"})
                    os._exit(1)
            send(msg)


to_sai({"type": "hello", "role": "relay", "token": token})
threading.Thread(target=from_sai, daemon=True).start()

inp = sys.stdin.buffer
while True:
    header = inp.read(4)
    if len(header) < 4:
        # Chrome closes stdin when the extension disconnects the port.
        os._exit(0)
    (length,) = struct.unpack("<I", header)
    if length > MAX:
        send({"type": "bridge-error", "error": "native message length %d exceeds limit" % length})
        os._exit(1)
    data = inp.read(length)
    if len(data) < length:
        os._exit(0)
    try:
        msg = json.loads(data)
    except ValueError:
        continue
    with state_lock:
        if authed:
            to_sai(msg)
        else:
            queued.append(msg)
`;

export function writeFlatpakLauncher(home: string = os.homedir()): string {
  const dir = bridgeDir(home);
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  const py = path.join(dir, 'bridge-host-flatpak.py');
  fs.writeFileSync(py, FLATPAK_RELAY_SOURCE, { mode: 0o755 });
  // writeFileSync's mode only applies on create; an older copy keeps its own.
  fs.chmodSync(py, 0o755);
  return py;
}

/** Runs the `flatpak` CLI and returns stdout. Injectable for tests. */
export type FlatpakRunner = (args: string[]) => string;

const defaultFlatpakRunner: FlatpakRunner = (args) =>
  execFileSync('flatpak', args, { encoding: 'utf8', timeout: 10_000 });

/**
 * Home-relative form of the bridge dir for `flatpak override`. `~/` is
 * resolved by flatpak itself, which sidesteps /home → /var/home symlinks on
 * image-based distros (Silverblue, Bazzite).
 */
function flatpakBridgePath(home: string): string {
  return `~/${path.relative(home, bridgeDir(home)).split(path.sep).join('/')}`;
}

/**
 * Lets a Flatpak browser see ~/.sai/browser-bridge (relay script, socket,
 * token, stable extension copy). A per-user override needs no elevation.
 *
 * Returns true when the grant is new: a running browser keeps its old sandbox
 * until it is fully quit, so the caller has to say so.
 */
export function grantFlatpakAccess(
  appId: string,
  home: string = os.homedir(),
  run: FlatpakRunner = defaultFlatpakRunner,
): boolean {
  const want = flatpakBridgePath(home);
  const abs = bridgeDir(home);
  let current = '';
  try {
    current = run(['override', '--user', '--show', appId]);
  } catch {
    /* no overrides yet, or an old flatpak without --show: just grant */
  }
  const line = current.split('\n').find((l) => l.startsWith('filesystems='));
  const granted = (line?.slice('filesystems='.length).split(';') ?? [])
    .some((fsEntry) => fsEntry === want || fsEntry === abs || fsEntry === `${want}:rw` || fsEntry === `${abs}:rw`);
  if (granted) return false;
  try {
    run(['override', '--user', `--filesystem=${want}`, appId]);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    throw new Error(
      `couldn't give ${appId} access to ${want}: ${message}. `
      + `Run: flatpak override --user --filesystem=${want} ${appId}`,
    );
  }
  return true;
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
  /**
   * The browser needs a full quit and relaunch before the bridge can work —
   * set when a Flatpak sandbox permission was just granted.
   */
  restartRequired?: boolean;
}

export function installNativeHost(opts: {
  browsers: BrowserDef[];
  extensionId: string;
  relayScript: string;
  nodeBinary?: string;
  home?: string;
  flatpak?: FlatpakRunner;
}): InstallResult[] {
  if (!isValidExtensionId(opts.extensionId)) {
    throw new Error(`"${opts.extensionId}" is not a Chromium extension id (32 chars, a-p)`);
  }
  if (!fs.existsSync(opts.relayScript)) {
    throw new Error(`relay script not found at ${opts.relayScript} — build SAI first`);
  }

  const home = opts.home ?? os.homedir();
  // Each launcher is written only if some browser needs it, so a Flatpak-only
  // machine doesn't get a shim pointing at a binary nothing can use.
  let nativeLauncher: string | null = null;
  let flatpakLauncher: string | null = null;
  const results: InstallResult[] = [];

  for (const browser of opts.browsers) {
    let launcher: string;
    let restartRequired = false;
    if (browser.flatpakAppId) {
      flatpakLauncher ??= writeFlatpakLauncher(home);
      launcher = flatpakLauncher;
      restartRequired = grantFlatpakAccess(browser.flatpakAppId, home, opts.flatpak);
    } else {
      nativeLauncher ??= writeLauncher(opts.relayScript, opts.nodeBinary, home);
      launcher = nativeLauncher;
    }
    const dir = nativeHostDirFor(browser);
    fs.mkdirSync(dir, { recursive: true });
    const manifestPath = path.join(dir, `${HOST_NAME}.json`);
    fs.writeFileSync(manifestPath, JSON.stringify(buildHostManifest(opts.extensionId, launcher), null, 2));
    results.push(restartRequired
      ? { browser: browser.id, manifestPath, restartRequired }
      : { browser: browser.id, manifestPath });
  }

  return results;
}

/**
 * Copies the bundled extension to a stable folder and returns it.
 *
 * Chromium remembers an unpacked extension by its folder and reloads from it
 * on every start. An AppImage mounts at a fresh /tmp/.mount_* path each
 * launch, so loading straight from the bundle breaks the extension the next
 * time SAI restarts; a Flatpak browser can't read the bundle at all. The copy
 * lives in the bridge dir, which Flatpak browsers are granted anyway.
 *
 * The old copy is replaced wholesale so files dropped from the bundle don't
 * linger. Chromium only rereads the folder on reload, so this is safe while
 * the extension is running.
 */
export function syncExtensionCopy(sourceDir: string, home: string = os.homedir()): string {
  const dest = path.join(bridgeDir(home), 'extension');
  fs.mkdirSync(bridgeDir(home), { recursive: true, mode: 0o700 });
  const staging = `${dest}.tmp-${process.pid}`;
  fs.rmSync(staging, { recursive: true, force: true });
  fs.cpSync(sourceDir, staging, { recursive: true });
  fs.rmSync(dest, { recursive: true, force: true });
  fs.renameSync(staging, dest);
  return dest;
}

/**
 * Removing the manifest for Chrome, Arc or Dia on macOS removes it for all
 * three — they share one directory (see `browserCandidates`), and there is no
 * per-browser manifest to remove instead. The duplicate unlink is a harmless
 * ENOENT, so `removed` still lists each path once.
 */
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
