/**
 * Playwright script to capture extension UI screenshots for docs.
 *
 * Usage: npx tsx scripts/take-screenshots.ts
 *
 * Requires the extension to be built first (`pnpm build`).
 * Outputs PNGs to docs/screenshots/.
 *
 * When the Chrome extension can't be loaded (CI/containers), falls back
 * to mock HTML pages that mirror the real UI.
 */

import { chromium, type BrowserContext } from '@playwright/test';
import { resolve, dirname } from 'path';
import { existsSync, mkdirSync } from 'fs';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const EXTENSION_PATH = resolve(__dirname, '../dist/chrome');
const SCREENSHOTS_DIR = resolve(__dirname, '../docs/screenshots');
const MOCK_POPOVER_PATH = resolve(__dirname, 'mock-popover.html');
const MOCK_OPTIONS_PATH = resolve(__dirname, 'mock-options.html');
const MOCK_POPUP_PATH = resolve(__dirname, 'mock-popup.html');

async function captureWithMocks() {
  const browser = await chromium.launch({
    args: ['--no-sandbox', '--disable-gpu', '--disable-dev-shm-usage'],
  });

  // --- Popover ---
  console.log('Capturing popover...');
  const popoverPage = await browser.newPage();
  await popoverPage.setViewportSize({ width: 800, height: 600 });
  await popoverPage.goto(`file://${MOCK_POPOVER_PATH}`);
  await popoverPage.waitForSelector('.gh-lsp-popover');
  const container = await popoverPage.$('.mock-github');
  if (container) {
    await container.screenshot({
      path: resolve(SCREENSHOTS_DIR, 'popover.png'),
    });
  } else {
    await popoverPage.screenshot({
      path: resolve(SCREENSHOTS_DIR, 'popover.png'),
    });
  }
  console.log('  -> docs/screenshots/popover.png');
  await popoverPage.close();

  // --- Options page ---
  console.log('Capturing options page...');
  const optionsPage = await browser.newPage();
  await optionsPage.setViewportSize({ width: 800, height: 900 });
  await optionsPage.goto(`file://${MOCK_OPTIONS_PATH}`);
  await optionsPage.waitForSelector('.gh-lsp-options__title');
  await optionsPage.screenshot({
    path: resolve(SCREENSHOTS_DIR, 'options.png'),
    fullPage: true,
  });
  console.log('  -> docs/screenshots/options.png');
  await optionsPage.close();

  // --- Popup ---
  console.log('Capturing popup...');
  const popupPage = await browser.newPage();
  await popupPage.setViewportSize({ width: 400, height: 300 });
  await popupPage.goto(`file://${MOCK_POPUP_PATH}`);
  await popupPage.waitForSelector('.gh-lsp-popup');
  const popup = await popupPage.$('.gh-lsp-popup');
  if (popup) {
    await popup.screenshot({
      path: resolve(SCREENSHOTS_DIR, 'popup.png'),
    });
  } else {
    await popupPage.screenshot({
      path: resolve(SCREENSHOTS_DIR, 'popup.png'),
    });
  }
  console.log('  -> docs/screenshots/popup.png');
  await popupPage.close();

  await browser.close();
}

async function captureWithExtension(): Promise<boolean> {
  if (!existsSync(EXTENSION_PATH)) {
    return false;
  }

  try {
    console.log('Trying to launch Chromium with extension...');
    const context: BrowserContext = await chromium.launchPersistentContext('', {
      headless: false,
      timeout: 20_000,
      args: [
        `--disable-extensions-except=${EXTENSION_PATH}`,
        `--load-extension=${EXTENSION_PATH}`,
        '--headless=new',
        '--no-first-run',
        '--no-sandbox',
        '--disable-gpu',
        '--disable-dev-shm-usage',
      ],
    });

    let serviceWorker = context.serviceWorkers()[0];
    if (!serviceWorker) {
      serviceWorker = await context.waitForEvent('serviceworker', {
        timeout: 10_000,
      });
    }
    const url = serviceWorker.url();
    const match = url.match(/chrome-extension:\/\/([^/]+)/);
    if (!match) {
      throw new Error(`Could not extract extension ID from URL: ${url}`);
    }
    const extensionId = match[1]!;
    console.log(`Extension ID: ${extensionId}`);

    // Options page
    console.log('Capturing options page...');
    const optionsPage = await context.newPage();
    await optionsPage.goto(
      `chrome-extension://${extensionId}/pages/options/index.html`,
    );
    await optionsPage.waitForSelector('.gh-lsp-options__title');
    await optionsPage.screenshot({
      path: resolve(SCREENSHOTS_DIR, 'options.png'),
      fullPage: true,
    });
    console.log('  -> docs/screenshots/options.png');
    await optionsPage.close();

    // Popup page
    console.log('Capturing popup page...');
    const popupPage = await context.newPage();
    await popupPage.setViewportSize({ width: 320, height: 400 });
    await popupPage.goto(
      `chrome-extension://${extensionId}/pages/popup/index.html`,
    );
    await popupPage.waitForSelector('.gh-lsp-popup__title');
    await popupPage.screenshot({
      path: resolve(SCREENSHOTS_DIR, 'popup.png'),
    });
    console.log('  -> docs/screenshots/popup.png');
    await popupPage.close();

    await context.close();
    return true;
  } catch {
    console.warn(
      'Extension loading failed — falling back to mock HTML pages.',
    );
    return false;
  }
}

async function main() {
  mkdirSync(SCREENSHOTS_DIR, { recursive: true });

  // Try real extension first, fall back to mocks
  const extensionWorked = await captureWithExtension();

  if (extensionWorked) {
    // Still need the popover mock (it's always a mock)
    const browser = await chromium.launch({
      args: ['--no-sandbox', '--disable-gpu', '--disable-dev-shm-usage'],
    });
    console.log('Capturing popover...');
    const popoverPage = await browser.newPage();
    await popoverPage.setViewportSize({ width: 800, height: 600 });
    await popoverPage.goto(`file://${MOCK_POPOVER_PATH}`);
    await popoverPage.waitForSelector('.gh-lsp-popover');
    const container = await popoverPage.$('.mock-github');
    if (container) {
      await container.screenshot({
        path: resolve(SCREENSHOTS_DIR, 'popover.png'),
      });
    } else {
      await popoverPage.screenshot({
        path: resolve(SCREENSHOTS_DIR, 'popover.png'),
      });
    }
    console.log('  -> docs/screenshots/popover.png');
    await browser.close();
  } else {
    // Use mock pages for everything
    await captureWithMocks();
  }

  console.log('Done! Screenshots saved to docs/screenshots/');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
