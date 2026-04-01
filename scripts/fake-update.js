#!/usr/bin/env node
/**
 * Clears `lastSeenVersion` from Electron settings so the What's New modal
 * triggers on next launch, simulating a version update.
 */
const fs = require('fs');
const path = require('path');

// Electron's userData path varies by platform
const appName = 'sai';
const platform = process.platform;
let userDataDir;
if (platform === 'linux') {
  userDataDir = path.join(process.env.HOME || '', '.config', appName);
} else if (platform === 'darwin') {
  userDataDir = path.join(process.env.HOME || '', 'Library', 'Application Support', appName);
} else {
  userDataDir = path.join(process.env.APPDATA || '', appName);
}

const settingsFile = path.join(userDataDir, 'settings.json');

try {
  const settings = JSON.parse(fs.readFileSync(settingsFile, 'utf-8'));
  const prev = settings.lastSeenVersion;
  delete settings.lastSeenVersion;
  fs.writeFileSync(settingsFile, JSON.stringify(settings, null, 2));
  console.log(`Cleared lastSeenVersion (was "${prev ?? 'unset'}") from ${settingsFile}`);
  console.log('The What\'s New modal will appear on next launch.');
} catch (err) {
  if (err.code === 'ENOENT') {
    console.log('No settings file found — modal will show on first launch anyway.');
  } else {
    console.error('Error:', err.message);
    process.exit(1);
  }
}
