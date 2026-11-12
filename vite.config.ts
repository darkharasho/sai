import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import electron from 'vite-plugin-electron';
import renderer from 'vite-plugin-electron-renderer';

export default defineConfig({
  plugins: [
    react(),
    electron([
      {
        entry: 'electron/main.ts',
        onstart(args) {
          if (!process.env.PLAYWRIGHT) {
            args.startup(['.', '--no-sandbox', '--in-process-gpu']);
          }
        },
        vite: {
          build: {
            rollupOptions: {
              external: ['electron', 'node-pty', 'simple-git', 'electron-updater', 'ws', 'dbus-next'],
            },
          },
        },
      },
      {
        entry: 'electron/preload.ts',
        onstart(args) {
          args.reload();
        },
      },
      {
        entry: 'electron/sai-mcp-server.ts',
        vite: {
          build: {
            rollupOptions: {
              external: ['electron'],
              output: { format: 'cjs' },
            },
          },
        },
      },
      {
        // Built as its own CJS bundle so scripts/install-browser-bridge.mjs can
        // require it and share one implementation with the Settings UI.
        entry: 'electron/services/browserDeploy.ts',
        vite: {
          build: {
            rollupOptions: {
              external: ['electron'],
              output: { format: 'cjs' },
            },
          },
        },
      },
      {
        // Spawned by Chrome as the `com.sai.browser_bridge` native host, so it
        // must be a plain CJS Node script with no electron dependency.
        entry: 'electron/browser-bridge-host.ts',
        vite: {
          build: {
            rollupOptions: {
              external: ['electron'],
              output: { format: 'cjs' },
            },
          },
        },
      },
    ]),
    renderer(),
  ],
  optimizeDeps: {
    include: ['monaco-editor'],
  },
});
