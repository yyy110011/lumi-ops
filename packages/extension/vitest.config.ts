import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['src/**/*.test.ts'],
    exclude: ['src/test/**'],
    environment: 'node',
    testTimeout: 30000,
  },
});
