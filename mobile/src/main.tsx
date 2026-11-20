// The phone entry. Order matters:
// 1. mark <html> as the phone (isPhone() / phone.css);
// 2. install window.sai (the shim host): the chat graph calls
//    window.sai.settingsGet at import time (themes.ts, useMessageStampPref, …);
// 3. styles: fonts, globals.css, phone.css, the shell's own;
// 4. paint the cached appearance (bootstrapAppearance);
// 5. only then import the shell, which pulls in the shared chat graph.
// Live updates start before all of that, so even a bundle that fails to boot still looks for a
// fixed one; it's marked ready (no rollback) only once the shell has mounted.
import { installSai } from './shell/connection';
import { markAppReady, startLiveUpdates } from './update/liveUpdate';

startLiveUpdates();
document.documentElement.dataset.saiPhone = '1';
installSai();

async function boot(): Promise<void> {
  await import('../../src/styles/fonts');
  await import('../../src/styles/globals.css');
  await import('../../src/styles/phone.css');
  await import('./shell/shell.css');
  const { bootstrapAppearance } = await import('../../src/themes');
  await bootstrapAppearance().catch(() => { /* CSS defaults */ });
  const { mountApp } = await import('./shell/App');
  mountApp(document.getElementById('root')!);
  markAppReady();
}

void boot();
