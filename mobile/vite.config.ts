import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import { builtinModules } from 'node:module';

/**
 * The phone web build (Capacitor webDir). It runs in WKWebView, so nothing in
 * its graph may reach Electron or Node. Type-only imports are erased before
 * resolution and never get here, so `import type … from 'electron'` is fine.
 */
function noElectronOrNode(): Plugin {
  const builtins = new Set(builtinModules);
  return {
    name: 'sai-mobile-no-electron-or-node',
    enforce: 'pre',
    resolveId(source, importer) {
      const bare = source.split('/')[0];
      const forbidden =
        source === 'electron' ||
        source.startsWith('electron/') ||
        source.startsWith('node:') ||
        builtins.has(source) ||
        builtins.has(bare);
      if (forbidden) {
        this.error(
          `[mobile] "${source}" is imported by ${importer ?? '(entry)'}; ` +
            'the phone build cannot use Electron or Node built-ins.',
        );
      }
      return null;
    },
  };
}

// The desktop renderer (vite.config.ts) uses only @vitejs/plugin-react; its
// CSS is plain (src/styles/globals.css), not Tailwind, so neither is this.
export default defineConfig({
  root: 'mobile',
  base: './',
  publicDir: false,
  plugins: [noElectronOrNode(), react()],
  define: {
    __MOBILE__: true,
  },
  build: {
    outDir: '../dist/mobile',
    emptyOutDir: true,
  },
});
