import { defineConfig } from '@playwright/test';

// Real-browser E2E against the production build with providers disabled:
// deterministic offline mode, no live keys, no network flakiness in CI.
export default defineConfig({
  testDir: './e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: [['list'], ['html', { open: 'never' }]],
  use: {
    baseURL: 'http://127.0.0.1:3123',
    trace: 'retain-on-failure',
  },
  projects: [{ name: 'chromium', use: { browserName: 'chromium' } }],
  webServer: {
    command: 'npm run build && npm run start',
    url: 'http://127.0.0.1:3123/api/health',
    env: { NODE_ENV: 'production', PORT: '3123', MARKET_DATA_MODE: 'offline' },
    reuseExistingServer: !process.env.CI,
    timeout: 180_000,
  },
});
