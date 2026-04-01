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
            args.startup();
          }
        },
        vite: {
          build: {
            rollupOptions: {
              external: ['electron', 'node-pty', 'simple-git', 'electron-updater'],
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
    ]),
    renderer(),
  ],
  optimizeDeps: {
    include: ['monaco-editor'],
  },
});
