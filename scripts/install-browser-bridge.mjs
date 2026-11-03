#!/usr/bin/env node
/**
 * CLI front end for the browser bridge deploy logic.
 *
 * Settings → Browser does this with a button; this exists for headless setups
 * and for debugging. The real implementation lives in
 * electron/services/browserDeploy.ts and is required here from its build
 * output, so there is exactly one copy of it.
 *
 * Usage:
 *   node scripts/install-browser-bridge.mjs            # detect + report
 *   node scripts/install-browser-bridge.mjs --install [<extension-id>]
 *   node scripts/install-browser-bridge.mjs --uninstall
 *
 * With no <extension-id>, the ID is read out of each browser's profile — load
 * extension/chrome unpacked first and it will be found automatically.
 */

import { createRequire } from 'node:module';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const DEPLOY_BUNDLE = path.join(repoRoot, 'dist-electron', 'browserDeploy.js');
const RELAY_SCRIPT = path.join(repoRoot, 'dist-electron', 'browser-bridge-host.js');
const EXTENSION_DIR = path.join(repoRoot, 'extension', 'chrome');

if (!fs.existsSync(DEPLOY_BUNDLE)) {
  console.error(`error: ${DEPLOY_BUNDLE} not found — run \`npm run build\` first.`);
  process.exit(1);
}

const deploy = require(DEPLOY_BUNDLE);

function report(browsers) {
  if (!browsers.length) {
    console.log('No Chromium-based browser found.');
    return;
  }
  for (const b of browsers) {
    const ext = b.extensionId ? b.extensionId : 'not loaded';
    const host = b.hostInstalled ? 'host installed' : 'host missing';
    console.log(`${b.label.padEnd(16)} ${ext.padEnd(34)} ${host}`);
  }
}

const args = process.argv.slice(2);
const browsers = deploy.detectBrowsers({ extensionDir: EXTENSION_DIR });

try {
  if (args.includes('--uninstall')) {
    const removed = deploy.uninstallNativeHost(browsers);
    for (const p of removed) console.log(`Removed ${p}`);
    if (!removed.length) console.log('Nothing to remove.');
  } else if (args.includes('--install')) {
    const explicitId = args.find((a) => !a.startsWith('--'));
    // The manifest pins a `key`, so the id is known before the extension is
    // ever loaded and the host can be registered up front.
    const pinnedId = deploy.expectedExtensionId(EXTENSION_DIR);
    const fallbackId = explicitId || pinnedId;

    const targets = fallbackId
      ? browsers.map((b) => ({ browser: b, id: fallbackId }))
      : browsers.filter((b) => b.extensionId).map((b) => ({ browser: b, id: b.extensionId }));

    if (!targets.length) {
      console.error('error: no extension id found.');
      console.error(`Load ${EXTENSION_DIR} unpacked at chrome://extensions first,`);
      console.error('or pass the id explicitly: --install <extension-id>');
      process.exit(1);
    }

    for (const { browser, id } of targets) {
      const [result] = deploy.installNativeHost({
        browsers: [browser],
        extensionId: id,
        relayScript: RELAY_SCRIPT,
      });
      console.log(`Installed ${browser.label}: ${result.manifestPath}`);
      if (process.platform === 'win32') await deploy.registerWindowsHost(result.manifestPath);
    }

    const skipped = browsers.filter((b) => !targets.some((t) => t.browser.id === b.id));
    for (const b of skipped) console.log(`Skipped ${b.label} (extension not loaded there)`);
  } else {
    const pinned = deploy.expectedExtensionId(EXTENSION_DIR);
    console.log(`Extension folder: ${EXTENSION_DIR}`);
    console.log(`Relay script:     ${RELAY_SCRIPT}${fs.existsSync(RELAY_SCRIPT) ? '' : '  (MISSING — run npm run build)'}`);
    console.log(`Extension id:     ${pinned ? `${pinned}  (pinned by manifest key)` : 'path-derived — load the extension to discover it'}`);
    console.log('');
    report(browsers);
    console.log('');
    console.log('Run with --install to register the native host.');
  }
} catch (err) {
  console.error(`error: ${err.message}`);
  process.exit(1);
}
