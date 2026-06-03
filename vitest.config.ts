import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  test: {
    // Limit parallelism to avoid exhausting system memory
    pool: 'forks',
    poolOptions: {
      forks: { maxForks: 2, minForks: 1 },
    },
    maxWorkers: 2,
    minWorkers: 1,
    projects: [
      {
        extends: true,
        test: {
          name: 'unit',
          include: ['tests/unit/**/*.test.{ts,tsx}'],
          environment: 'jsdom',
          setupFiles: ['tests/setup/vitest.setup.ts'],
        },
      },
      {
        extends: true,
        test: {
          name: 'integration',
          include: ['tests/integration/**/*.test.ts'],
          environment: 'node',
          setupFiles: ['tests/setup/vitest.setup.ts'],
          testTimeout: 15000,
        },
      },
      {
        extends: true,
        test: {
          name: 'swarm',
          include: ['tests/swarm/**/*.test.{ts,tsx}'],
          environment: 'node',
          setupFiles: ['tests/setup/vitest.setup.ts'],
        },
      },
    ],
  },
  resolve: {
    alias: {
      '@': '/src',
      '@electron': '/electron',
    },
  },
});
