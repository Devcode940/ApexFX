import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['src/**/*.test.{ts,tsx}', 'server/**/*.test.{ts,tsx}'],
    environment: 'node', // React lifecycle fixtures opt into jsdom explicitly, not a real browser.
    restoreMocks: true,
    testTimeout: 10_000,
    hookTimeout: 20_000,
  },
});
