import { defineConfig } from '@playwright/test';
import { resolve } from 'path';

/**
 * Playwright configuration for gh-lsp browser extension E2E tests.
 *
 * Uses Chromium with the extension loaded from `dist/chrome/`.
 * Tests must run `pnpm build` before execution to produce the
 * extension build.
 */
export default defineConfig({
  testDir: resolve(__dirname, 'tests/e2e'),
  timeout: 30_000,
  retries: 1,
  workers: 1, // extensions must run serially — each test gets its own browser context
  reporter: [['list'], ['html', { open: 'never' }]],
  use: {
    // Extension tests require headed Chromium with --load-extension
    // Headless mode does not support extensions
    headless: false,
    viewport: { width: 1280, height: 720 },
    actionTimeout: 10_000,
    screenshot: 'only-on-failure',
  },
  projects: [
    {
      name: 'chromium-extension',
      use: {
        browserName: 'chromium',
      },
    },
  ],
});
