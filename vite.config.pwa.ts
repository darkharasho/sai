import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import nodePath from 'node:path';

export default defineConfig({
  root: 'src/renderer-remote',
  plugins: [tailwindcss(), react()],
  build: {
    outDir: nodePath.resolve(__dirname, 'dist/renderer-remote'),
    emptyOutDir: true,
    sourcemap: true,
  },
});
