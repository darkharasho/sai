// Over-the-air updates for the phone app (Capgo, self-hosted on this repo's GitHub releases; see
// scripts/ota-publish.sh and .github/workflows/ota.yml). From ~/.claude/templates/release-sync.
//
// startLiveUpdates() runs first thing in main.tsx. On launch and on every resume it reads the
// manifest for this exact native build (ota-ios-<CFBundleVersion>), downloads a newer bundle in the
// background and applies it the next time the app goes to the background. markAppReady() runs once
// the shell has mounted: a bundle that never gets there within appReadyTimeout
// (capacitor.config.ts) is rolled back by the plugin to the previous one.
//
// An update never carries native code: ota-publish.sh refuses to publish when plugins or
// mobile/ios changed since the native release it targets.
import { App } from '@capacitor/app';
import { Capacitor, CapacitorHttp } from '@capacitor/core';
import { CapacitorUpdater } from '@capgo/capacitor-updater';

const REPO = 'darkharasho/sai';

interface Manifest {
  version: string;
  url: string;
  /** sha256 of the zip, lowercase hex: what the plugin's download() compares against. */
  checksum: string;
  build: string;
}

let checking = false;

export function startLiveUpdates(): void {
  if (!Capacitor.isNativePlatform()) return;
  void checkForLiveUpdate();
  void App.addListener('resume', () => void checkForLiveUpdate());
}

/** Tells the updater this bundle started; call once the app has mounted. */
export function markAppReady(): void {
  if (!Capacitor.isNativePlatform()) return;
  CapacitorUpdater.notifyAppReady().catch((e) => console.warn('notifyAppReady failed', e));
}

export async function checkForLiveUpdate(): Promise<void> {
  if (checking) return;
  checking = true;
  try {
    const { build } = await App.getInfo();
    const platform = Capacitor.getPlatform();
    const res = await CapacitorHttp.get({
      url: `https://github.com/${REPO}/releases/download/ota-${platform}-${build}/manifest.json`,
      responseType: 'json',
    });
    if (res.status !== 200) return; // no update published for this build yet
    const m: Manifest = typeof res.data === 'string' ? JSON.parse(res.data) : res.data;
    if (m.build !== build || !m.version || !m.url || !m.checksum) return;
    const { bundle } = await CapacitorUpdater.current();
    if (bundle.version === m.version) return;
    const { bundles } = await CapacitorUpdater.list();
    const have = bundles.find((b) => b.version === m.version && b.status !== 'error');
    const next = have ?? (await CapacitorUpdater.download({ url: m.url, version: m.version, checksum: m.checksum }));
    await CapacitorUpdater.next({ id: next.id });
  } catch (e) {
    console.warn('Live update check failed', e);
  } finally {
    checking = false;
  }
}
