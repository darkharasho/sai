/**
 * Exercised against a synthetic browser-profile tree whose layout mirrors the
 * real installs these paths were derived from (Arc/Dia keep user data under a
 * `User Data` child; Comet uses the support dir itself).
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import {
  HOST_NAME,
  deriveExtensionId,
  unpackedExtensionId,
  expectedExtensionId,
  browserCandidates,
  nativeHostDirFor,
  isBrowserPresent,
  profileDirs,
  findExtensionId,
  detectBrowsers,
  buildHostManifest,
  isValidExtensionId,
  installNativeHost,
  uninstallNativeHost,
  isHostInstalled,
  writeLauncher,
} from '@electron/services/browserDeploy';

const EXT_ID = 'a'.repeat(32);
const EXT_DIR_NAME = path.join('extension', 'chrome');

let home = '';
let extensionDir = '';
let relayScript = '';

function support(...parts: string[]): string {
  return path.join(home, 'Library', 'Application Support', ...parts);
}

/** Creates a user-data dir that detection will treat as a real install. */
function makeBrowser(userDataDir: string): string {
  fs.mkdirSync(userDataDir, { recursive: true });
  fs.writeFileSync(path.join(userDataDir, 'Local State'), '{}');
  return userDataDir;
}

function writeProfile(
  userDataDir: string,
  profile: string,
  settings: Record<string, unknown>,
  file = 'Secure Preferences',
): void {
  const dir = path.join(userDataDir, profile);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, file), JSON.stringify({ extensions: { settings } }));
}

beforeEach(() => {
  home = fs.mkdtempSync(path.join(os.tmpdir(), 'sai-deploy-'));
  extensionDir = path.join(home, 'repo', EXT_DIR_NAME);
  fs.mkdirSync(extensionDir, { recursive: true });

  relayScript = path.join(home, 'repo', 'dist-electron', 'browser-bridge-host.js');
  fs.mkdirSync(path.dirname(relayScript), { recursive: true });
  fs.writeFileSync(relayScript, '// relay');
});

afterEach(() => {
  try { fs.rmSync(home, { recursive: true, force: true }); } catch { /* noop */ }
});

describe('extension id derivation', () => {
  it('matches a real Chromium-assigned id for a path-loaded extension', () => {
    // Ground truth: Arc assigned this id to an unpacked extension at this
    // exact path. It pins the whole algorithm — SHA-256, first 16 bytes, and
    // the 0-f -> a-p nibble mapping — against real browser output rather than
    // against our own reimplementation of it.
    expect(unpackedExtensionId('/Users/michaelstephens/Documents/GitHub/minimal-volume-booster'))
      .toBe('kgbcfmbannmcahnpjpceglepcffnonmg');
  });

  it('normalises the path before hashing', () => {
    const canonical = unpackedExtensionId('/tmp/ext');
    expect(unpackedExtensionId('/tmp/ext/')).toBe(canonical);
    expect(unpackedExtensionId('/tmp/./ext')).toBe(canonical);
    expect(unpackedExtensionId('/tmp/other/../ext')).toBe(canonical);
  });

  it('derives a well-formed id from a public key', () => {
    const id = deriveExtensionId('MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8A');
    expect(id).toMatch(/^[a-p]{32}$/);
    expect(isValidExtensionId(id)).toBe(true);
  });

  it('is deterministic and key-dependent', () => {
    const a = deriveExtensionId('AAAA');
    expect(deriveExtensionId('AAAA')).toBe(a);
    expect(deriveExtensionId('AAAB')).not.toBe(a);
  });

  it('reads the pinned id out of the extension manifest', () => {
    const key = 'MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8A';
    fs.writeFileSync(path.join(extensionDir, 'manifest.json'), JSON.stringify({ key }));
    expect(expectedExtensionId(extensionDir)).toBe(deriveExtensionId(key));
  });

  it('returns null for an unkeyed or unreadable manifest', () => {
    fs.writeFileSync(path.join(extensionDir, 'manifest.json'), JSON.stringify({ name: 'x' }));
    expect(expectedExtensionId(extensionDir)).toBeNull();

    fs.writeFileSync(path.join(extensionDir, 'manifest.json'), 'not json');
    expect(expectedExtensionId(extensionDir)).toBeNull();

    expect(expectedExtensionId(path.join(home, 'missing'))).toBeNull();
  });

  it('pins the shipped extension to a stable id', () => {
    // The whole point of the manifest key: this id must not depend on where
    // the extension is installed from, so a clone, a packaged app, and a
    // translocated bundle are all the same extension.
    const shipped = path.resolve(__dirname, '../../../extension/chrome');
    const id = expectedExtensionId(shipped);
    expect(id).toBe('hlockbfefhbphlhfbnabmobbcoijkcjb');
    expect(id).not.toBe(unpackedExtensionId(shipped));
  });
});

describe('browser candidates', () => {
  it('knows the per-fork user-data layouts on macOS', () => {
    const byId = new Map(browserCandidates('/Users/u', 'darwin').map((b) => [b.id, b.userDataDir]));
    const base = '/Users/u/Library/Application Support';

    // Verified against real installs: Arc and Dia nest under `User Data`,
    // Comet and Chrome do not.
    expect(byId.get('arc')).toBe(`${base}/Arc/User Data`);
    expect(byId.get('dia')).toBe(`${base}/Dia/User Data`);
    expect(byId.get('comet')).toBe(`${base}/Comet`);
    expect(byId.get('chrome')).toBe(`${base}/Google/Chrome`);
    expect(byId.get('brave')).toBe(`${base}/BraveSoftware/Brave-Browser`);
  });

  it('uses XDG config on linux and LOCALAPPDATA on windows', () => {
    const linux = browserCandidates('/home/u', 'linux', { XDG_CONFIG_HOME: '/home/u/.conf' });
    expect(linux.find((b) => b.id === 'chrome')!.userDataDir).toBe('/home/u/.conf/google-chrome');

    const win = browserCandidates('C:\\Users\\u', 'win32', { LOCALAPPDATA: 'C:\\Users\\u\\AppData\\Local' });
    expect(win.find((b) => b.id === 'chrome')!.userDataDir)
      .toBe(path.join('C:\\Users\\u\\AppData\\Local', 'Google', 'Chrome', 'User Data'));
  });

  it('puts the native host dir at the user-data root', () => {
    expect(nativeHostDirFor({ id: 'x', label: 'X', userDataDir: '/a/b' }))
      .toBe(path.join('/a/b', 'NativeMessagingHosts'));
  });
});

describe('presence detection', () => {
  it('requires a Local State file, not just a directory', () => {
    const dir = path.join(home, 'Library', 'Application Support', 'Chromium');
    fs.mkdirSync(dir, { recursive: true });

    // Uninstalled Chromium forks leave empty support dirs behind — those must
    // not register as installed browsers.
    expect(isBrowserPresent({ id: 'chromium', label: 'Chromium', userDataDir: dir })).toBe(false);

    fs.writeFileSync(path.join(dir, 'Local State'), '{}');
    expect(isBrowserPresent({ id: 'chromium', label: 'Chromium', userDataDir: dir })).toBe(true);
  });

  it('lists only Default and Profile N directories', () => {
    const userData = makeBrowser(support('Arc', 'User Data'));
    for (const name of ['Default', 'Profile 1', 'Profile 2', 'Crashpad', 'ShaderCache']) {
      fs.mkdirSync(path.join(userData, name), { recursive: true });
    }
    const names = profileDirs(userData).map((p) => path.basename(p)).sort();
    expect(names).toEqual(['Default', 'Profile 1', 'Profile 2']);
  });

  it('returns no profiles for a missing dir', () => {
    expect(profileDirs(path.join(home, 'nope'))).toEqual([]);
  });
});

describe('extension id discovery', () => {
  it('finds an unpacked extension by its source path', () => {
    const userData = makeBrowser(support('Arc', 'User Data'));
    writeProfile(userData, 'Default', {
      [EXT_ID]: { location: 4, path: extensionDir },
    });
    expect(findExtensionId(userData, extensionDir)).toBe(EXT_ID);
  });

  it('searches every profile, not just Default', () => {
    const userData = makeBrowser(support('Arc', 'User Data'));
    writeProfile(userData, 'Default', { zzz: { location: 4, path: '/somewhere/else' } });
    writeProfile(userData, 'Profile 2', { [EXT_ID]: { location: 4, path: extensionDir } });
    expect(findExtensionId(userData, extensionDir)).toBe(EXT_ID);
  });

  it('falls back to the plain Preferences file', () => {
    const userData = makeBrowser(support('Comet'));
    writeProfile(userData, 'Default', { [EXT_ID]: { location: 4, path: extensionDir } }, 'Preferences');
    expect(findExtensionId(userData, extensionDir)).toBe(EXT_ID);
  });

  it('ignores store and browser-bundled extensions', () => {
    const userData = makeBrowser(support('Arc', 'User Data'));
    writeProfile(userData, 'Default', {
      // location 5 is browser-bundled; Arc ships several pointing at app paths.
      bundled: { location: 5, path: extensionDir },
      store: { location: 1, path: extensionDir },
    });
    expect(findExtensionId(userData, extensionDir)).toBeNull();
  });

  it('ignores an unpacked extension loaded from a different folder', () => {
    const userData = makeBrowser(support('Arc', 'User Data'));
    writeProfile(userData, 'Default', {
      other: { location: 4, path: path.join(home, 'repo', 'something-else') },
    });
    expect(findExtensionId(userData, extensionDir)).toBeNull();
  });

  it('tolerates a trailing slash on the recorded path', () => {
    const userData = makeBrowser(support('Arc', 'User Data'));
    writeProfile(userData, 'Default', { [EXT_ID]: { location: 4, path: extensionDir + path.sep } });
    expect(findExtensionId(userData, extensionDir)).toBe(EXT_ID);
  });

  it('survives an unreadable or malformed preferences file', () => {
    const userData = makeBrowser(support('Arc', 'User Data'));
    const dir = path.join(userData, 'Default');
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'Secure Preferences'), 'not json at all');
    expect(() => findExtensionId(userData, extensionDir)).not.toThrow();
    expect(findExtensionId(userData, extensionDir)).toBeNull();
  });
});

describe('detectBrowsers', () => {
  it('reports only present browsers, with id and host state', () => {
    const arc = makeBrowser(support('Arc', 'User Data'));
    makeBrowser(support('Comet'));
    // Present on disk but empty — must not be reported.
    fs.mkdirSync(support('Google', 'Chrome'), { recursive: true });

    writeProfile(arc, 'Default', { [EXT_ID]: { location: 4, path: extensionDir } });

    const detected = detectBrowsers({ extensionDir, home, platform: 'darwin' });
    const ids = detected.map((b) => b.id).sort();
    expect(ids).toEqual(['arc', 'comet']);

    const found = detected.find((b) => b.id === 'arc')!;
    expect(found.extensionId).toBe(EXT_ID);
    expect(found.hostInstalled).toBe(false);
    expect(found.nativeHostDir).toBe(path.join(arc, 'NativeMessagingHosts'));

    expect(detected.find((b) => b.id === 'comet')!.extensionId).toBeNull();
  });
});

describe('native host manifest', () => {
  it('pins allowed_origins to the one extension', () => {
    const manifest = buildHostManifest(EXT_ID, '/launcher.sh');
    expect(manifest).toEqual({
      name: HOST_NAME,
      description: 'SAI Browser Bridge',
      path: '/launcher.sh',
      type: 'stdio',
      allowed_origins: [`chrome-extension://${EXT_ID}/`],
    });
  });

  it('validates extension ids', () => {
    expect(isValidExtensionId(EXT_ID)).toBe(true);
    expect(isValidExtensionId('abc')).toBe(false);
    // Chromium ids use a-p only; hex-looking ids are not valid.
    expect(isValidExtensionId('z'.repeat(32))).toBe(false);
    expect(isValidExtensionId('a'.repeat(33))).toBe(false);
  });

  it('writes a manifest per browser and reports it installed', () => {
    const arc = makeBrowser(support('Arc', 'User Data'));
    const comet = makeBrowser(support('Comet'));
    const browsers = [
      { id: 'arc', label: 'Arc', userDataDir: arc },
      { id: 'comet', label: 'Comet', userDataDir: comet },
    ];

    const results = installNativeHost({ browsers, extensionId: EXT_ID, relayScript, home });
    expect(results.map((r) => r.browser)).toEqual(['arc', 'comet']);

    for (const result of results) {
      const written = JSON.parse(fs.readFileSync(result.manifestPath, 'utf8'));
      expect(written.allowed_origins).toEqual([`chrome-extension://${EXT_ID}/`]);
      expect(fs.existsSync(written.path)).toBe(true);
    }
    expect(browsers.every(isHostInstalled)).toBe(true);
  });

  it('refuses a bad extension id before touching the filesystem', () => {
    const arc = makeBrowser(support('Arc', 'User Data'));
    const browsers = [{ id: 'arc', label: 'Arc', userDataDir: arc }];
    expect(() => installNativeHost({ browsers, extensionId: 'nope', relayScript, home }))
      .toThrow(/not a Chromium extension id/);
    expect(isHostInstalled(browsers[0])).toBe(false);
  });

  it('refuses to install against a missing relay script', () => {
    const arc = makeBrowser(support('Arc', 'User Data'));
    expect(() => installNativeHost({
      browsers: [{ id: 'arc', label: 'Arc', userDataDir: arc }],
      extensionId: EXT_ID,
      relayScript: path.join(home, 'nope.js'),
      home,
    })).toThrow(/build SAI first/);
  });

  it('removes manifests and ignores browsers that have none', () => {
    const arc = makeBrowser(support('Arc', 'User Data'));
    const comet = makeBrowser(support('Comet'));
    const arcDef = { id: 'arc', label: 'Arc', userDataDir: arc };
    const cometDef = { id: 'comet', label: 'Comet', userDataDir: comet };

    installNativeHost({ browsers: [arcDef], extensionId: EXT_ID, relayScript, home });

    const removed = uninstallNativeHost([arcDef, cometDef]);
    expect(removed).toHaveLength(1);
    expect(isHostInstalled(arcDef)).toBe(false);
  });
});

describe('launcher shim', () => {
  it('writes an executable that execs the relay via node', () => {
    const launcher = writeLauncher(relayScript, '/usr/bin/node', home);
    const body = fs.readFileSync(launcher, 'utf8');

    expect(body).toContain('/usr/bin/node');
    expect(body).toContain(relayScript);
    // Chromium execs this directly, so it has to be runnable, and Electron
    // binaries need ELECTRON_RUN_AS_NODE to behave as a plain Node.
    expect(body).toContain('ELECTRON_RUN_AS_NODE=1');
    expect(fs.statSync(launcher).mode & 0o111).toBeTruthy();
  });
});
