#!/usr/bin/env node
// Builds the SAI PWA (from the repo root) and copies the output into
// sai-mobile/assets/pwa/ where Metro can bundle it as native assets.
// Also produces an inlined.html best-effort variant that inlines the entry
// JS + CSS so Expo Go (which puts each asset in its own hashed dir) can at
// least boot the app. Dynamic chunks (xterm/shiki languages) still need
// sibling assets, so terminal + syntax highlighting want a dev/prod build.

import { execSync } from 'node:child_process';
import {
  copyFileSync, mkdirSync, readdirSync, statSync, rmSync,
  readFileSync, writeFileSync, existsSync,
} from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, '../..');
const pwaSrc = join(repoRoot, 'dist/renderer-remote');
const pwaDest = join(here, '..', 'assets', 'pwa');

console.log('[sync-pwa] building PWA…');
try {
  execSync('npm run build:pwa', { cwd: repoRoot, stdio: 'inherit' });
} catch {
  execSync('npx vite build --config vite.config.pwa.ts', { cwd: repoRoot, stdio: 'inherit' });
}

if (!existsSync(pwaSrc)) {
  console.error('[sync-pwa] build output not found at', pwaSrc);
  process.exit(1);
}

console.log('[sync-pwa] clearing', pwaDest);
rmSync(pwaDest, { recursive: true, force: true });
mkdirSync(pwaDest, { recursive: true });

function copyDir(from, to) {
  for (const entry of readdirSync(from)) {
    const src = join(from, entry);
    const dst = join(to, entry);
    if (statSync(src).isDirectory()) {
      mkdirSync(dst, { recursive: true });
      copyDir(src, dst);
    } else {
      copyFileSync(src, dst);
    }
  }
}

console.log('[sync-pwa] copying', pwaSrc, '→', pwaDest);
copyDir(pwaSrc, pwaDest);

// Best-effort inline: rewrite the entry <script> and <link> tags to use
// embedded content so the WebView only needs one file. Dynamic chunks still
// require sibling assets on disk (see header comment).
try {
  const indexPath = join(pwaDest, 'index.html');
  let html = readFileSync(indexPath, 'utf8');

  html = html.replace(/<link[^>]*rel=["']stylesheet["'][^>]*href=["']([^"']+)["'][^>]*>/g, (_m, href) => {
    const rel = href.replace(/^\//, '');
    const path = join(pwaDest, rel);
    if (!existsSync(path)) return _m;
    const css = readFileSync(path, 'utf8');
    return `<style>${css}</style>`;
  });

  html = html.replace(/<script[^>]*src=["']([^"']+)["'][^>]*><\/script>/g, (_m, src) => {
    const rel = src.replace(/^\//, '');
    const path = join(pwaDest, rel);
    if (!existsSync(path)) return _m;
    const js = readFileSync(path, 'utf8');
    return `<script type="module">${js}</script>`;
  });

  writeFileSync(join(pwaDest, 'inlined.html'), html);
  console.log('[sync-pwa] wrote inlined.html');
} catch (e) {
  console.warn('[sync-pwa] inline step failed:', e.message);
}

console.log('[sync-pwa] done');
