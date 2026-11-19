import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { cloudflareTest } from '@cloudflare/vitest-plugin';
import { defineConfig } from 'vitest/config';

const schema = readFileSync(join(dirname(fileURLToPath(import.meta.url)), 'schema.sql'), 'utf8');

export default defineConfig({
  plugins: [
    cloudflareTest({
      wrangler: { configPath: './wrangler.toml' },
      // Test-only binding: the schema, applied by test/helpers.ts.
      miniflare: { bindings: { TEST_SCHEMA: schema } },
    }),
  ],
  test: {
    include: ['test/**/*.test.ts'],
    maxWorkers: 2,
  },
});
