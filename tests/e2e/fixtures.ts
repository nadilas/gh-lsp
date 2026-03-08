import { test as base, chromium, type BrowserContext, type Page } from '@playwright/test';
import { resolve } from 'path';
import { existsSync } from 'fs';

const EXTENSION_PATH = resolve(__dirname, '../../dist/chrome');

/**
 * Custom Playwright fixtures for browser extension E2E testing.
 *
 * - `context`: A persistent Chromium browser context with the extension loaded
 * - `extensionId`: The runtime ID of the loaded extension
 * - `popupPage`: Opens and returns the extension popup page
 * - `optionsPage`: Opens and returns the extension options page
 */
export const test = base.extend<{
  context: BrowserContext;
  extensionId: string;
  popupPage: Page;
  optionsPage: Page;
}>({
  // eslint-disable-next-line no-empty-pattern
  context: async ({}, use) => {
    if (!existsSync(EXTENSION_PATH)) {
      throw new Error(
        `Extension build not found at ${EXTENSION_PATH}. Run "pnpm build" first.`,
      );
    }

    const context = await chromium.launchPersistentContext('', {
      headless: false,
      args: [
        `--disable-extensions-except=${EXTENSION_PATH}`,
        `--load-extension=${EXTENSION_PATH}`,
        '--no-first-run',
        '--disable-gpu',
        '--disable-dev-shm-usage',
      ],
    });

    await use(context);
    await context.close();
  },

  extensionId: async ({ context }, use) => {
    // Wait for the service worker to register
    let serviceWorker = context.serviceWorkers()[0];
    if (!serviceWorker) {
      serviceWorker = await context.waitForEvent('serviceworker');
    }

    // Extract extension ID from service worker URL
    // Format: chrome-extension://<id>/background/index.js
    const url = serviceWorker.url();
    const match = url.match(/chrome-extension:\/\/([^/]+)/);
    if (!match) {
      throw new Error(`Could not extract extension ID from URL: ${url}`);
    }

    await use(match[1]!);
  },

  popupPage: async ({ context, extensionId }, use) => {
    const page = await context.newPage();
    await page.goto(`chrome-extension://${extensionId}/pages/popup/index.html`);
    await use(page);
    await page.close();
  },

  optionsPage: async ({ context, extensionId }, use) => {
    const page = await context.newPage();
    await page.goto(`chrome-extension://${extensionId}/pages/options/index.html`);
    await use(page);
    await page.close();
  },
});

export { expect } from '@playwright/test';
