import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    env: {
      LOG_LEVEL: 'silent',
    },
    // Only run tests in src/, exclude submodule tests
    include: ['src/**/*.test.ts'],
    exclude: ['lib/**', 'node_modules/**'],
  },
});
