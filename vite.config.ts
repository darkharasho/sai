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
              external: ['electron', 'node-pty', 'simple-git', 'electron-updater', 'better-sqlite3', 'argon2', 'ws'],
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
        entry: 'electron/swarm-mcp-server.ts',
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
