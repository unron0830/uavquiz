import { defineConfig } from 'vitest/config';
import path from 'node:path';
export default defineConfig({
  resolve: { alias: { '@uqa/shared': path.resolve(import.meta.dirname, 'packages/shared/src/index.ts') } },
  test: { include: ['tests/**/*.test.ts'], testTimeout: 30000, hookTimeout: 30000, pool: 'forks' },
});
